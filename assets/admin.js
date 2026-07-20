/* global SFM */
( function () {
	'use strict';

	var cwd = '';        // 현재 폴더(base 기준 상대경로)
	var lastData = null; // 마지막으로 받은 폴더 목록(정렬 다시 그릴 때 사용)
	var el = {};
	var nodeMap = {};    // rel -> 트리 노드 element
	var histStack = [];  // 방문 경로 히스토리(앞으로/뒤로)
	var histPos = -1;    // 현재 히스토리 위치

	function $( id ) { return document.getElementById( id ); }

	function esc( s ) {
		return String( s ).replace( /[&<>"']/g, function ( c ) {
			return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ c ];
		} );
	}

	function fmtSize( bytes ) {
		if ( ! bytes ) { return '—'; }
		var u = [ 'B', 'KB', 'MB', 'GB', 'TB' ], i = 0, v = bytes;
		while ( v >= 1024 && i < u.length - 1 ) { v /= 1024; i++; }
		return ( i ? Math.round( v * 10 ) / 10 : v ) + ' ' + u[ i ];
	}

	function fmtTime( ts ) {
		if ( ! ts ) { return '—'; }
		var d = new Date( ts * 1000 );
		function p( n ) { return ( n < 10 ? '0' : '' ) + n; }
		return d.getFullYear() + '-' + p( d.getMonth() + 1 ) + '-' + p( d.getDate() ) +
			' ' + p( d.getHours() ) + ':' + p( d.getMinutes() );
	}

	function msg( text, isErr ) {
		el.msg.hidden = false;
		el.msg.textContent = text;
		el.msg.className = 'sfm-msg ' + ( isErr ? 'sfm-msg--err' : 'sfm-msg--ok' );
		if ( ! isErr ) {
			setTimeout( function () { el.msg.hidden = true; }, 2500 );
		}
	}

	function post( action, data ) {
		var body = new FormData();
		body.append( 'action', action );
		body.append( 'nonce', SFM.nonce );
		Object.keys( data || {} ).forEach( function ( k ) { body.append( k, data[ k ] ); } );
		return fetch( SFM.ajax, { method: 'POST', credentials: 'same-origin', body: body } )
			.then( function ( r ) { return r.json(); } );
	}

	/* ------------------------------ 오른쪽: 폴더 내용 ------------------------------ */

	function load( path ) {
		// 깜빡임 방지:
		//  - 기존 표 내용을 지우지 않고 새 내용이 오면 한 번에 교체.
		//  - 로딩 표시[흐리게]는 180ms 넘게 걸릴 때만 — 로컬 목록은 대개 즉시라 흐려짐 자체가 안 보임.
		var tbl = el.list.closest( 'table' );
		var busyTimer = tbl ? setTimeout( function () { tbl.classList.add( 'sfm-busy' ); }, 180 ) : null;
		function done() {
			if ( busyTimer ) { clearTimeout( busyTimer ); }
			if ( tbl ) { tbl.classList.remove( 'sfm-busy' ); }
		}
		post( 'sfm_list', { path: path || '' } ).then( function ( res ) {
			done();
			if ( ! res.success ) { msg( res.data.msg || '오류', true ); return; }
			cwd = res.data.path;
			render( res.data );
			revealInTree( cwd );
		} ).catch( function () {
			done();
			msg( '네트워크 오류', true );
		} );
	}

	/* ------------------------------ 앞으로/뒤로 히스토리 ------------------------------ */

	// 사용자가 새 위치로 이동 — 우리 스택 + 브라우저 히스토리(pushState)에 기록.
	// 브라우저 히스토리에 넣어야 마우스 뒤로가기 버튼·백스페이스가 popstate 로 들어와
	// 플러그인 화면을 벗어나지 않고 폴더 뒤로가기가 된다.
	function navigate( path ) {
		path = path || '';
		if ( histStack[ histPos ] === path ) { return; } // 같은 위치 → 재로딩·중복 기록 방지(깜빡임 방지).
		histStack = histStack.slice( 0, histPos + 1 );    // 뒤로 간 상태에서 새로 이동하면 앞쪽 기록 폐기.
		histStack.push( path );
		histPos = histStack.length - 1;
		history.pushState( { sfmPos: histPos }, '', location.href );
		load( path );
		updateNav();
	}

	// 브라우저 뒤로/앞으로(버튼·마우스 사이드버튼·백스페이스) → popstate 로 수렴.
	function onPopState( e ) {
		var st = e.state;
		if ( st && typeof st.sfmPos === 'number' && histStack[ st.sfmPos ] !== undefined ) {
			histPos = st.sfmPos;
			load( histStack[ histPos ] );
			updateNav();
		}
		// 우리 상태가 아니면(루트보다 더 뒤) 브라우저 기본 동작 = 페이지 벗어남.
	}

	function goBack() { history.back(); }
	function goForward() { history.forward(); }

	function updateNav() {
		if ( el.back ) { el.back.disabled = ( histPos <= 0 ); }
		if ( el.fwd ) { el.fwd.disabled = ( histPos >= histStack.length - 1 ); }
	}

	function render( data ) {
		lastData = data; // 다시 정렬해 그릴 수 있게 원본 목록 보관.
		renderBreadcrumb( data.path );
		el.up.disabled = ( data.parent === null );
		anchorRel = null; // 폴더가 바뀌면 선택/기준 초기화.
		renderRows();
	}

	/* ------------------------------ 정렬 ------------------------------ */

	var sortKey = null; // null 이면 서버가 준 순서 그대로. 'name'|'size'|'modified'|'perms'.
	var sortDir = 1;    // 1=오름차순, -1=내림차순.

	function compareBy( a, b, key ) {
		if ( 'size' === key ) { return ( a.size || 0 ) - ( b.size || 0 ); }
		if ( 'modified' === key ) { return ( a.modified || 0 ) - ( b.modified || 0 ); }
		if ( 'perms' === key ) { return String( a.perms ).localeCompare( String( b.perms ) ); }
		// 이름(기본) — 한글·숫자 자연스러운 순서.
		return String( a.name ).localeCompare( String( b.name ), undefined, { numeric: true, sensitivity: 'base' } );
	}

	// 폴더를 항상 위로 유지한 채, 각 그룹 안에서 선택한 열 기준으로 정렬.
	function sortEntries( entries ) {
		var arr = entries.slice();
		arr.sort( function ( a, b ) {
			if ( a.type !== b.type ) { return 'dir' === a.type ? -1 : 1; }
			return compareBy( a, b, sortKey ) * sortDir;
		} );
		return arr;
	}

	function updateSortIndicators() {
		if ( ! el.thead ) { return; }
		var ths = el.thead.querySelectorAll( 'th[data-sort]' );
		Array.prototype.forEach.call( ths, function ( th ) {
			var ind = th.querySelector( '.sfm-sort-ind' );
			var on = ( th.getAttribute( 'data-sort' ) === sortKey );
			th.classList.toggle( 'sfm-sorted', on );
			if ( ind ) { ind.textContent = on ? ( sortDir > 0 ? ' ▲' : ' ▼' ) : ''; }
		} );
	}

	// 헤더 클릭: 같은 열이면 방향 토글, 다른 열이면 그 열 오름차순부터.
	function onHeadClick( e ) {
		var th = e.target.closest( 'th[data-sort]' );
		if ( ! th ) { return; }
		var key = th.getAttribute( 'data-sort' );
		if ( sortKey === key ) { sortDir = -sortDir; } else { sortKey = key; sortDir = 1; }
		renderRows();
	}

	function renderRows() {
		updateSortIndicators();
		if ( ! lastData || ! lastData.entries.length ) {
			el.list.innerHTML = '<tr><td colspan="5" class="sfm-empty">빈 폴더입니다.</td></tr>';
			return;
		}

		var entries = sortKey ? sortEntries( lastData.entries ) : lastData.entries;
		var rows = entries.map( function ( e ) {
			var icon = e.type === 'dir' ? '📁' : '📄';
			// 이름은 클릭 링크가 아니라 텍스트 — 한 번 클릭=선택, 더블클릭=열기(행 전체).
			var nameCell = '<span class="sfm-file-name">' + esc( e.name ) + '</span>';

			var acts = [];
			if ( e.type === 'file' && e.editable ) {
				acts.push( '<a class="button-link" data-edit="' + esc( e.rel ) + '">편집</a>' );
			}
			// 파일·폴더 모두 다운로드(폴더는 zip).
			acts.push( '<a class="button-link" data-download="' + esc( e.rel ) + '">다운로드</a>' );
			acts.push( '<a class="button-link" data-rename="' + esc( e.rel ) + '" data-name="' + esc( e.name ) + '">이름변경</a>' );
			acts.push( '<a class="button-link sfm-del" data-delete="' + esc( e.rel ) + '" data-name="' + esc( e.name ) + '" data-type="' + e.type + '">삭제</a>' );

			var ro = e.writable ? '' : ' <span class="sfm-ro" title="쓰기 불가">🔒</span>';
			var sizeText = fmtSize( e.size ) + ( e.size_approx ? '+' : '' );

			return '<tr data-rel="' + esc( e.rel ) + '" data-type="' + e.type + '" data-editable="' + ( e.editable ? '1' : '0' ) + '" data-name="' + esc( e.name ) + '">' +
				'<td class="sfm-col-name"><span class="sfm-name"><span class="sfm-icon">' + icon + '</span>' + nameCell + ro + '</span></td>' +
				'<td class="sfm-col-size">' + sizeText + '</td>' +
				'<td class="sfm-col-modified">' + fmtTime( e.modified ) + '</td>' +
				'<td class="sfm-col-perms"><span class="sfm-perms">' + esc( e.perms ) + '</span></td>' +
				'<td class="sfm-col-act"><span class="sfm-row-act">' + acts.join( '' ) + '</span></td>' +
				'</tr>';
		} );
		el.list.innerHTML = rows.join( '' );
	}

	function renderBreadcrumb( path ) {
		var parts = path ? path.split( '/' ) : [];
		var html = '<a data-open-dir="">🏠 루트</a>';
		var acc = '';
		parts.forEach( function ( part, i ) {
			acc = acc ? acc + '/' + part : part;
			html += '<span class="sfm-crumb-sep">/</span>';
			if ( i === parts.length - 1 ) {
				html += '<span class="sfm-crumb-current">' + esc( part ) + '</span>';
			} else {
				html += '<a data-open-dir="' + esc( acc ) + '">' + esc( part ) + '</a>';
			}
		} );
		el.breadcrumb.innerHTML = html;
	}

	/* ------------------------------ 왼쪽: 디렉터리 트리 ------------------------------ */

	function createNode( name, rel, hasDirs ) {
		var node = document.createElement( 'div' );
		node.className = 'sfm-node';
		node.dataset.rel = rel;
		node.innerHTML =
			'<div class="sfm-node-row">' +
				'<span class="sfm-toggle"></span>' +
				'<span class="sfm-node-icon">📁</span>' +
				'<span class="sfm-node-label"></span>' +
			'</div>' +
			'<div class="sfm-children"></div>';
		node.querySelector( '.sfm-node-label' ).textContent = name;
		// 하위 폴더가 없는 폴더는 처음부터 화살표 숨김(leaf). 더 불러올 것도 없으니 loaded 처리.
		if ( false === hasDirs ) {
			node.classList.add( 'leaf' );
			node.dataset.loaded = '1';
		}
		nodeMap[ rel ] = node;
		return node;
	}

	function initTree() {
		nodeMap = {};
		el.tree.innerHTML = '';
		var root = createNode( '루트', '' );
		root.querySelector( '.sfm-node-icon' ).textContent = '🏠';
		el.tree.appendChild( root );
	}

	// 노드의 하위 폴더를 (다시) 불러와 트리에 채운다.
	function loadChildren( rel ) {
		var node = nodeMap[ rel ];
		if ( ! node ) { return Promise.resolve(); }
		return post( 'sfm_list', { path: rel } ).then( function ( res ) {
			if ( ! res.success ) { return; }
			var box = node.querySelector( '.sfm-children' );
			box.innerHTML = '';
			var dirs = res.data.entries.filter( function ( e ) { return e.type === 'dir'; } );
			node.classList.toggle( 'leaf', dirs.length === 0 );
			dirs.forEach( function ( d ) { box.appendChild( createNode( d.name, d.rel, d.has_dirs ) ); } );
			node.dataset.loaded = '1';
		} );
	}

	// 노드를 펼친다(필요하면 lazy 로드).
	function ensureExpanded( rel ) {
		var node = nodeMap[ rel ];
		if ( ! node ) { return Promise.resolve(); }
		if ( node.dataset.loaded === '1' ) {
			node.classList.add( 'expanded' );
			return Promise.resolve();
		}
		return loadChildren( rel ).then( function () { node.classList.add( 'expanded' ); } );
	}

	function selectNode( rel ) {
		var prev = el.tree.querySelectorAll( '.sfm-node-row.selected' );
		Array.prototype.forEach.call( prev, function ( r ) { r.classList.remove( 'selected' ); } );
		var node = nodeMap[ rel ];
		if ( node ) {
			var row = node.querySelector( '.sfm-node-row' );
			row.classList.add( 'selected' );
			row.scrollIntoView( { block: 'nearest' } );
		}
	}

	// 트리를 현재 경로까지 펼치고 해당 노드를 선택.
	function revealInTree( path ) {
		var segs = path ? path.split( '/' ) : [];
		// 상위(조상)들만 펼쳐 대상이 보이게 한다. 대상 노드 자체의 펼침/접힘은 더블클릭이 담당.
		var prefixes = [ '' ];
		var acc = '';
		for ( var i = 0; i < segs.length - 1; i++ ) {
			acc = acc ? acc + '/' + segs[ i ] : segs[ i ];
			prefixes.push( acc );
		}

		var chain = Promise.resolve();
		prefixes.forEach( function ( pfx ) { chain = chain.then( function () { return ensureExpanded( pfx ); } ); } );
		chain.then( function () { selectNode( path ); } );
	}

	// 트리 노드 하나만 갱신(폴더 생성/삭제/이름변경/업로드 후).
	function refreshTreeNode( rel ) {
		var node = nodeMap[ rel ];
		if ( ! node || node.dataset.loaded !== '1' ) { return; }
		var wasExpanded = node.classList.contains( 'expanded' );
		loadChildren( rel ).then( function () {
			if ( wasExpanded ) { node.classList.add( 'expanded' ); }
		} );
	}

	function onTreeClick( e ) {
		var node = e.target.closest( '.sfm-node' );
		if ( ! node ) { return; }
		var rel = node.dataset.rel;

		if ( e.target.closest( '.sfm-toggle' ) ) {
			toggleNode( node, rel );
			return;
		}
		// 라벨/아이콘 클릭 → 선택 + 오른쪽에 내용 표시(히스토리 기록).
		navigate( rel );
	}

	// 트리 노드 더블클릭 → 펼침/접힘 토글.
	function onTreeDblClick( e ) {
		var node = e.target.closest( '.sfm-node' );
		if ( ! node ) { return; }
		toggleNode( node, node.dataset.rel );
	}

	function toggleNode( node, rel ) {
		if ( node.classList.contains( 'expanded' ) ) {
			node.classList.remove( 'expanded' );
		} else {
			ensureExpanded( rel );
		}
	}

	/* ------------------------------ 편집기 ------------------------------ */

	var editing = null;

	function openEditor( rel ) {
		post( 'sfm_read', { path: rel } ).then( function ( res ) {
			if ( ! res.success ) { msg( res.data.msg || '오류', true ); return; }
			editing = res.data.rel;
			el.editorName.textContent = res.data.name;
			el.editorText.value = res.data.content;
			el.editorText.readOnly = ! res.data.writable;
			el.editorStatus.textContent = res.data.writable ? '' : '읽기 전용(쓰기 권한 없음)';
			el.editorSave.disabled = ! res.data.writable;
			el.editorModal.hidden = false;
			el.editorText.focus();
		} );
	}

	function saveEditor() {
		if ( editing === null ) { return; }
		el.editorSave.disabled = true;
		el.editorStatus.textContent = '저장 중…';
		post( 'sfm_save', { path: editing, content: el.editorText.value } ).then( function ( res ) {
			if ( ! res.success ) {
				el.editorStatus.textContent = res.data.msg || '저장 실패';
				el.editorSave.disabled = false;
				return;
			}
			el.editorStatus.textContent = '저장됨 (' + fmtSize( res.data.size ) + ')';
			el.editorSave.disabled = false;
			load( cwd );
		} );
	}

	function closeEditor() { el.editorModal.hidden = true; editing = null; }

	/* ------------------------------ 작업 ------------------------------ */

	function download( rel ) {
		var url = SFM.downloadBase + '?action=sfm_download&nonce=' + encodeURIComponent( SFM.nonce ) +
			'&path=' + encodeURIComponent( rel );
		window.location.href = url;
	}

	function newFolder() {
		var name = prompt( '새 폴더 이름:' );
		if ( ! name ) { return; }
		post( 'sfm_mkdir', { path: cwd, name: name } ).then( function ( res ) {
			if ( ! res.success ) { msg( res.data.msg, true ); return; }
			msg( '폴더를 만들었습니다.' ); load( cwd ); refreshTreeNode( cwd );
		} );
	}

	function newFile() {
		var name = prompt( '새 파일 이름:' );
		if ( ! name ) { return; }
		post( 'sfm_newfile', { path: cwd, name: name } ).then( function ( res ) {
			if ( ! res.success ) { msg( res.data.msg, true ); return; }
			msg( '파일을 만들었습니다.' ); load( cwd );
		} );
	}

	function renameEntry( rel, cur ) {
		var name = prompt( '새 이름:', cur );
		if ( ! name || name === cur ) { return; }
		post( 'sfm_rename', { path: rel, name: name } ).then( function ( res ) {
			if ( ! res.success ) { msg( res.data.msg, true ); return; }
			msg( '이름을 변경했습니다.' ); load( cwd ); refreshTreeNode( cwd );
		} );
	}

	function deleteEntry( rel, name, type ) {
		var label = type === 'dir' ? '폴더(및 안의 모든 파일)' : '파일';
		if ( ! confirm( '"' + name + '" ' + label + '을(를) 삭제할까요?\n되돌릴 수 없습니다.' ) ) { return; }
		post( 'sfm_delete', { path: rel } ).then( function ( res ) {
			if ( ! res.success ) { msg( res.data.msg, true ); return; }
			msg( '삭제했습니다.' ); load( cwd ); refreshTreeNode( cwd );
		} );
	}

	function uploadFiles( files ) {
		if ( ! files || ! files.length ) { return; }
		var queue = Array.prototype.slice.call( files );
		var done = 0, failed = 0;

		function next() {
			if ( ! queue.length ) {
				msg( '업로드 완료: ' + done + '개' + ( failed ? ', 실패 ' + failed + '개' : '' ), failed > 0 );
				load( cwd );
				return;
			}
			var f = queue.shift();
			var body = new FormData();
			body.append( 'action', 'sfm_upload' );
			body.append( 'nonce', SFM.nonce );
			body.append( 'path', cwd );
			body.append( 'file', f );
			msg( '업로드 중… ' + f.name, false );
			fetch( SFM.ajax, { method: 'POST', credentials: 'same-origin', body: body } )
				.then( function ( r ) { return r.json(); } )
				.then( function ( res ) { if ( res.success ) { done++; } else { failed++; } next(); } )
				.catch( function () { failed++; next(); } );
		}
		next();
	}

	/* ------------------------------ 업데이트 ------------------------------ */

	var updLatest = '';

	// 평소엔 "확인" 버튼만. 확인해서 새 버전이 있으면 그 오른쪽에 "설치" 버튼이 나타난다.
	function checkUpdate() {
		var btn = $( 'sfm-check-update' );
		var inst = $( 'sfm-do-update' );
		var status = $( 'sfm-update-status' );
		btn.disabled = true;
		status.textContent = '확인 중…';
		post( 'sfm_check_update', {} ).then( function ( res ) {
			btn.disabled = false;
			if ( ! res.success ) { status.textContent = ( res.data && res.data.msg ) || '확인 실패'; return; }
			var d = res.data;
			if ( d.has_update ) {
				updLatest = d.latest;
				inst.textContent = '⬇ v' + d.latest + ' 설치';
				inst.hidden = false;
				status.textContent = '새 버전 v' + d.latest + ' 있음 (현재 v' + d.current + ')';
			} else {
				inst.hidden = true;
				status.textContent = '최신 버전입니다 (v' + d.current + ')';
			}
		} ).catch( function () { btn.disabled = false; status.textContent = '네트워크 오류'; } );
	}

	function doUpdate() {
		var inst = $( 'sfm-do-update' );
		var status = $( 'sfm-update-status' );
		if ( ! confirm( 'v' + updLatest + ' 로 업데이트할까요?' ) ) { return; }
		inst.disabled = true;
		status.textContent = '업데이트 설치 중… (페이지를 닫지 마세요)';
		post( 'sfm_do_update', {} ).then( function ( res ) {
			if ( ! res.success ) {
				inst.disabled = false;
				status.textContent = ( res.data && res.data.msg ) || '업데이트 실패';
				return;
			}
			status.textContent = res.data.msg || '업데이트 완료! 새로고침합니다…';
			setTimeout( function () { location.reload(); }, 1200 );
		} ).catch( function () { inst.disabled = false; status.textContent = '네트워크 오류'; } );
	}

	/* ------------------------------ 이벤트: 오른쪽 목록 (선택/다중선택) ------------------------------ */

	var anchorRel = null; // Shift 범위 선택 기준 행.

	function rowsArray() {
		return Array.prototype.slice.call( el.list.querySelectorAll( 'tr[data-rel]' ) );
	}
	function clearSel() {
		rowsArray().forEach( function ( r ) { r.classList.remove( 'sfm-row-selected' ); } );
	}
	function getSelected() {
		return Array.prototype.slice.call( el.list.querySelectorAll( 'tr.sfm-row-selected' ) );
	}
	function indexOfRel( rel ) {
		var rs = rowsArray();
		for ( var i = 0; i < rs.length; i++ ) { if ( rs[ i ].getAttribute( 'data-rel' ) === rel ) { return i; } }
		return -1;
	}
	// 단일 선택(다른 선택 해제).
	function selectRow( tr ) {
		clearSel();
		if ( tr ) { tr.classList.add( 'sfm-row-selected' ); anchorRel = tr.getAttribute( 'data-rel' ); }
	}

	// 행의 기본 동작(더블클릭): 폴더=진입, 편집가능 파일=편집, 그 외=다운로드.
	function openRow( tr ) {
		var rel = tr.getAttribute( 'data-rel' );
		var type = tr.getAttribute( 'data-type' );
		if ( 'dir' === type ) { navigate( rel ); }
		else if ( '1' === tr.getAttribute( 'data-editable' ) ) { openEditor( rel ); }
		else { download( rel ); }
	}

	// 작업 버튼(맨 오른쪽 열) 처리.
	function handleAction( t ) {
		if ( t.hasAttribute( 'data-edit' ) ) { openEditor( t.getAttribute( 'data-edit' ) ); }
		else if ( t.hasAttribute( 'data-download' ) ) { download( t.getAttribute( 'data-download' ) ); }
		else if ( t.hasAttribute( 'data-rename' ) ) { renameEntry( t.getAttribute( 'data-rename' ), t.getAttribute( 'data-name' ) ); }
		else if ( t.hasAttribute( 'data-delete' ) ) { deleteEntry( t.getAttribute( 'data-delete' ), t.getAttribute( 'data-name' ), t.getAttribute( 'data-type' ) ); }
	}

	function onListClick( e ) {
		var act = e.target.closest( '[data-edit],[data-download],[data-rename],[data-delete]' );
		if ( act ) { e.preventDefault(); handleAction( act ); return; }
		var tr = e.target.closest( 'tr[data-rel]' );
		if ( ! tr ) { return; }
		var rel = tr.getAttribute( 'data-rel' );

		if ( e.shiftKey && anchorRel !== null ) {
			// Shift: 기준 행부터 현재 행까지 범위 선택.
			var rs = rowsArray();
			var a = indexOfRel( anchorRel );
			var b = indexOfRel( rel );
			if ( a === -1 ) { a = b; }
			clearSel();
			for ( var i = Math.min( a, b ); i <= Math.max( a, b ); i++ ) { rs[ i ].classList.add( 'sfm-row-selected' ); }
		} else if ( e.ctrlKey || e.metaKey ) {
			// Ctrl/Cmd: 개별 토글.
			tr.classList.toggle( 'sfm-row-selected' );
			anchorRel = rel;
		} else {
			selectRow( tr );
		}
	}

	function onListDblClick( e ) {
		if ( e.target.closest( '[data-edit],[data-download],[data-rename],[data-delete]' ) ) { return; }
		var tr = e.target.closest( 'tr[data-rel]' );
		if ( tr ) { selectRow( tr ); openRow( tr ); }
	}

	function onListContext( e ) {
		var tr = e.target.closest( 'tr[data-rel]' );
		if ( ! tr ) { return; }
		e.preventDefault();
		// 우클릭한 행이 이미 다중선택에 포함돼 있으면 선택 유지, 아니면 그 행만 단일 선택.
		if ( ! tr.classList.contains( 'sfm-row-selected' ) ) { selectRow( tr ); }
		showListMenu( e.clientX, e.clientY );
	}

	// 오른쪽 목록의 선택 상태로 메뉴 구성.
	function showListMenu( x, y ) {
		var sel = getSelected();
		if ( ! sel.length ) { return; }
		var items = [];

		if ( 1 === sel.length ) {
			var tr = sel[ 0 ];
			var type = tr.getAttribute( 'data-type' );
			var rel = tr.getAttribute( 'data-rel' );
			var name = tr.getAttribute( 'data-name' );
			var editable = '1' === tr.getAttribute( 'data-editable' );
			if ( 'dir' === type ) {
				items.push( { label: '📂 열기', act: function () { navigate( rel ); } } );
				items.push( { label: '⬇ 다운로드(zip)', act: function () { download( rel ); } } );
			} else {
				if ( editable ) { items.push( { label: '✏ 편집', act: function () { openEditor( rel ); } } ); }
				items.push( { label: '⬇ 다운로드', act: function () { download( rel ); } } );
			}
			items.push( { label: '🔤 이름 변경', act: function () { renameEntry( rel, name ); } } );
			items.push( { sep: true } );
			items.push( { label: 'ⓘ 속성', act: function () { showProperties( [ rel ] ); } } );
		} else {
			// 다중 선택: 실수 삭제 방지를 위해 삭제는 메뉴에서 제외, 속성만.
			var rels = sel.map( function ( t ) { return t.getAttribute( 'data-rel' ); } );
			items.push( { label: 'ⓘ 속성 (' + rels.length + '개)', act: function () { showProperties( rels ); } } );
		}
		renderCtxMenu( items, x, y );
	}

	/* ------------------------------ 공용 컨텍스트 메뉴 렌더러 ------------------------------ */

	function renderCtxMenu( items, x, y ) {
		var menu = el.ctxmenu;
		menu.innerHTML = '';
		items.forEach( function ( it ) {
			if ( it.sep ) {
				var hr = document.createElement( 'div' );
				hr.className = 'sfm-ctx-sep';
				menu.appendChild( hr );
				return;
			}
			var b = document.createElement( 'button' );
			b.type = 'button';
			b.className = 'sfm-ctx-item' + ( it.danger ? ' sfm-ctx-danger' : '' );
			b.textContent = it.label;
			b.addEventListener( 'click', function () { hideCtxMenu(); it.act(); } );
			menu.appendChild( b );
		} );

		menu.hidden = false;
		// 화면 밖으로 넘어가지 않게 위치 보정.
		var mw = menu.offsetWidth, mh = menu.offsetHeight;
		menu.style.left = Math.max( 6, Math.min( x, window.innerWidth - mw - 6 ) ) + 'px';
		menu.style.top = Math.max( 6, Math.min( y, window.innerHeight - mh - 6 ) ) + 'px';
	}

	function hideCtxMenu() {
		if ( el.ctxmenu ) { el.ctxmenu.hidden = true; }
	}

	/* ------------------------------ 왼쪽 트리 우클릭 메뉴 ------------------------------ */

	function onTreeContext( e ) {
		var node = e.target.closest( '.sfm-node' );
		if ( ! node ) { return; }
		e.preventDefault();
		var rel = node.dataset.rel;
		var name = node.querySelector( '.sfm-node-label' ).textContent;
		selectNode( rel );

		var items = [];
		items.push( { label: '📂 열기', act: function () { navigate( rel ); } } );
		items.push( { label: '⬇ 다운로드(zip)', act: function () { download( rel ); } } );
		if ( '' !== rel ) { // 루트는 이름 변경 불가.
			items.push( { label: '🔤 이름 변경', act: function () { renameEntry( rel, name ); } } );
		}
		items.push( { sep: true } );
		items.push( { label: 'ⓘ 속성', act: function () { showProperties( [ rel ] ); } } );
		renderCtxMenu( items, e.clientX, e.clientY );
	}

	/* ------------------------------ 속성 ------------------------------ */

	function showProperties( rels ) {
		el.propsBody.innerHTML = '<p class="sfm-props-loading">계산 중…</p>';
		el.propsModal.hidden = false;

		var body = new FormData();
		body.append( 'action', 'sfm_stat' );
		body.append( 'nonce', SFM.nonce );
		rels.forEach( function ( r ) { body.append( 'paths[]', r ); } );

		fetch( SFM.ajax, { method: 'POST', credentials: 'same-origin', body: body } )
			.then( function ( r ) { return r.json(); } )
			.then( function ( res ) {
				if ( ! res.success ) { el.propsBody.innerHTML = '<p class="sfm-props-loading">' + esc( ( res.data && res.data.msg ) || '오류' ) + '</p>'; return; }
				var d = res.data;
				var title = ( 1 === rels.length ) ? esc( baseName( rels[ 0 ] ) ) : ( rels.length + '개 항목' );
				var sizeText = fmtSize( d.bytes ) + ( d.approx ? ' 이상' : '' );
				el.propsBody.innerHTML =
					'<div class="sfm-props-title">' + title + '</div>' +
					'<table class="sfm-props-table">' +
						'<tr><th>폴더</th><td>' + d.folders.toLocaleString() + '개</td></tr>' +
						'<tr><th>파일</th><td>' + d.files.toLocaleString() + '개</td></tr>' +
						'<tr><th>총 용량</th><td>' + sizeText + ' <span class="sfm-props-bytes">(' + d.bytes.toLocaleString() + ' 바이트)</span></td></tr>' +
					'</table>' +
					( d.approx ? '<p class="sfm-props-note">※ 항목이 매우 많아 일부만 집계한 근사치입니다.</p>' : '' );
			} )
			.catch( function () { el.propsBody.innerHTML = '<p class="sfm-props-loading">네트워크 오류</p>'; } );
	}

	function baseName( rel ) {
		if ( ! rel ) { return '루트'; }
		var i = rel.lastIndexOf( '/' );
		return i === -1 ? rel : rel.substring( i + 1 );
	}

	/* ------------------------------ 이벤트: 빵부스러기 ------------------------------ */

	function onBreadcrumbClick( e ) {
		var a = e.target.closest( '[data-open-dir]' );
		if ( ! a ) { return; }
		e.preventDefault();
		navigate( a.getAttribute( 'data-open-dir' ) );
	}

	function init() {
		el.tree = $( 'sfm-tree' );
		el.breadcrumb = $( 'sfm-breadcrumb' );
		el.list = $( 'sfm-list' );
		el.msg = $( 'sfm-msg' );
		el.up = $( 'sfm-up' );
		el.back = $( 'sfm-back' );
		el.fwd = $( 'sfm-fwd' );
		el.ctxmenu = $( 'sfm-ctxmenu' );
		el.propsModal = $( 'sfm-props-modal' );
		el.propsBody = $( 'sfm-props-body' );
		el.editorModal = $( 'sfm-editor-modal' );
		el.editorName = $( 'sfm-editor-name' );
		el.editorText = $( 'sfm-editor-text' );
		el.editorStatus = $( 'sfm-editor-status' );
		el.editorSave = $( 'sfm-editor-save' );

		el.thead = el.list.closest( 'table' ).querySelector( 'thead' );
		if ( el.thead ) { el.thead.addEventListener( 'click', onHeadClick ); }

		el.tree.addEventListener( 'click', onTreeClick );
		el.tree.addEventListener( 'dblclick', onTreeDblClick );
		el.tree.addEventListener( 'contextmenu', onTreeContext );
		el.list.addEventListener( 'click', onListClick );
		el.list.addEventListener( 'dblclick', onListDblClick );
		el.list.addEventListener( 'contextmenu', onListContext );
		el.breadcrumb.addEventListener( 'click', onBreadcrumbClick );

		// 속성 모달 닫기.
		function closeProps() { el.propsModal.hidden = true; }
		$( 'sfm-props-close' ).addEventListener( 'click', closeProps );
		$( 'sfm-props-ok' ).addEventListener( 'click', closeProps );
		el.propsModal.addEventListener( 'click', function ( e ) { if ( e.target === el.propsModal ) { closeProps(); } } );

		el.back.addEventListener( 'click', goBack );
		el.fwd.addEventListener( 'click', goForward );
		el.up.addEventListener( 'click', function () {
			if ( ! cwd ) { return; }
			var idx = cwd.lastIndexOf( '/' );
			navigate( idx === -1 ? '' : cwd.substring( 0, idx ) );
		} );
		$( 'sfm-refresh' ).addEventListener( 'click', function () { load( cwd ); refreshTreeNode( cwd ); } );

		// 컨텍스트 메뉴 닫기(바깥 클릭·Esc·스크롤·리사이즈).
		document.addEventListener( 'click', function ( e ) {
			if ( el.ctxmenu && ! el.ctxmenu.hidden && ! e.target.closest( '#sfm-ctxmenu' ) ) { hideCtxMenu(); }
		} );
		document.addEventListener( 'keydown', function ( e ) {
			if ( e.key === 'Escape' ) { hideCtxMenu(); if ( ! el.propsModal.hidden ) { el.propsModal.hidden = true; } }
		} );
		window.addEventListener( 'resize', hideCtxMenu );
		el.main = el.list.closest( '.sfm-main' );
		if ( el.main ) {
			el.main.addEventListener( 'scroll', hideCtxMenu );
			// 드래그앤드롭 업로드 — .sfm-main 위에 파일을 끌어다 놓으면 현재 폴더로 업로드(input change와 동일 경로).
			function isFileDrag( e ) {
				return e.dataTransfer && Array.prototype.indexOf.call( e.dataTransfer.types || [], 'Files' ) !== -1;
			}
			el.main.addEventListener( 'dragover', function ( e ) {
				if ( ! isFileDrag( e ) ) { return; }
				e.preventDefault();
				e.dataTransfer.dropEffect = 'copy';
				el.main.classList.add( 'sfm-dragover' );
			} );
			el.main.addEventListener( 'dragleave', function ( e ) {
				// 자식 요소로 옮겨갈 때의 dragleave 깜빡임 방지 — 컨테이너 밖으로 나갈 때만 해제.
				if ( ! el.main.contains( e.relatedTarget ) ) { el.main.classList.remove( 'sfm-dragover' ); }
			} );
			el.main.addEventListener( 'drop', function ( e ) {
				if ( ! isFileDrag( e ) ) { return; }
				e.preventDefault();
				el.main.classList.remove( 'sfm-dragover' );
				var files = e.dataTransfer.files;
				if ( ! files || ! files.length ) { return; }
				// 실수 방지 — 업로드 전 개수·파일명을 보여주고 승인받는다.
				var names = Array.prototype.map.call( files, function ( f ) { return f.name; } );
				var preview = names.slice( 0, 8 ).join( '\n· ' );
				if ( names.length > 8 ) { preview += '\n… 외 ' + ( names.length - 8 ) + '개'; }
				if ( confirm( '현재 폴더에 파일 ' + files.length + '개를 업로드할까요?\n\n· ' + preview ) ) {
					uploadFiles( files );
				}
			} );
		}
		$( 'sfm-download-folder' ).addEventListener( 'click', function () {
			msg( '현재 폴더를 압축하는 중… 크기가 크면 시간이 걸립니다.', false );
			download( cwd );
		} );
		$( 'sfm-new-folder' ).addEventListener( 'click', newFolder );
		$( 'sfm-new-file' ).addEventListener( 'click', newFile );
		$( 'sfm-upload' ).addEventListener( 'change', function ( e ) { uploadFiles( e.target.files ); e.target.value = ''; } );

		$( 'sfm-editor-save' ).addEventListener( 'click', saveEditor );
		$( 'sfm-editor-cancel' ).addEventListener( 'click', closeEditor );
		$( 'sfm-editor-close' ).addEventListener( 'click', closeEditor );
		el.editorModal.addEventListener( 'click', function ( e ) { if ( e.target === el.editorModal ) { closeEditor(); } } );
		document.addEventListener( 'keydown', function ( e ) {
			if ( ! el.editorModal.hidden ) {
				if ( e.key === 'Escape' ) { closeEditor(); }
				if ( ( e.ctrlKey || e.metaKey ) && e.key === 's' ) { e.preventDefault(); saveEditor(); }
			}
		} );

		$( 'sfm-check-update' ).addEventListener( 'click', checkUpdate );
		$( 'sfm-do-update' ).addEventListener( 'click', doUpdate );

		// 브라우저 뒤로/앞으로(마우스 사이드버튼 포함) 연동.
		window.addEventListener( 'popstate', onPopState );
		// 백스페이스 = 뒤로(입력창·편집창에서는 제외).
		document.addEventListener( 'keydown', function ( e ) {
			if ( e.key !== 'Backspace' ) { return; }
			var t = e.target;
			var tag = t && t.tagName ? t.tagName.toLowerCase() : '';
			if ( tag === 'input' || tag === 'textarea' || ( t && t.isContentEditable ) ) { return; }
			if ( el.editorModal && ! el.editorModal.hidden ) { return; }
			e.preventDefault();
			goBack();
		} );

		initTree();
		// 초기 위치를 히스토리 첫 항목으로 심는다(replaceState — 새 항목 추가 아님).
		histStack = [ '' ];
		histPos = 0;
		history.replaceState( { sfmPos: 0 }, '', location.href );
		load( '' );
		updateNav();
	}

	if ( document.readyState === 'loading' ) {
		document.addEventListener( 'DOMContentLoaded', init );
	} else {
		init();
	}
} )();

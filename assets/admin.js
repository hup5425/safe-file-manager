/* global SFM */
( function () {
	'use strict';

	var cwd = '';        // 현재 폴더(base 기준 상대경로)
	var el = {};
	var nodeMap = {};    // rel -> 트리 노드 element
	var hist = [];       // 방문 경로 히스토리(앞으로/뒤로)
	var histIdx = -1;    // 현재 히스토리 위치

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
		// 깜빡임 방지: 기존 표 내용을 지우지 않고, 로딩 중엔 살짝 흐리게만 표시했다가 한 번에 교체.
		var tbl = el.list.closest( 'table' );
		if ( tbl ) { tbl.classList.add( 'sfm-busy' ); }
		post( 'sfm_list', { path: path || '' } ).then( function ( res ) {
			if ( tbl ) { tbl.classList.remove( 'sfm-busy' ); }
			if ( ! res.success ) { msg( res.data.msg || '오류', true ); return; }
			cwd = res.data.path;
			render( res.data );
			revealInTree( cwd );
		} ).catch( function () {
			if ( tbl ) { tbl.classList.remove( 'sfm-busy' ); }
			msg( '네트워크 오류', true );
		} );
	}

	/* ------------------------------ 앞으로/뒤로 히스토리 ------------------------------ */

	// 사용자가 새 위치로 이동 — 히스토리에 기록하고 로드.
	function navigate( path ) {
		path = path || '';
		if ( hist[ histIdx ] !== path ) {
			hist = hist.slice( 0, histIdx + 1 ); // 뒤로 간 상태에서 새로 이동하면 앞쪽 기록 폐기.
			hist.push( path );
			histIdx = hist.length - 1;
		}
		load( path );
		updateNav();
	}

	function goBack() {
		if ( histIdx > 0 ) { histIdx--; load( hist[ histIdx ] ); updateNav(); }
	}

	function goForward() {
		if ( histIdx < hist.length - 1 ) { histIdx++; load( hist[ histIdx ] ); updateNav(); }
	}

	function updateNav() {
		if ( el.back ) { el.back.disabled = ( histIdx <= 0 ); }
		if ( el.fwd ) { el.fwd.disabled = ( histIdx >= hist.length - 1 ); }
	}

	function render( data ) {
		renderBreadcrumb( data.path );
		el.up.disabled = ( data.parent === null );

		if ( ! data.entries.length ) {
			el.list.innerHTML = '<tr><td colspan="5" class="sfm-empty">빈 폴더입니다.</td></tr>';
			return;
		}

		var rows = data.entries.map( function ( e ) {
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

			var ro = e.writable ? '' : ' <span class="sfm-ro" title="쓰기 불가(서버 파일 권한)">🔒</span>';
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

	function createNode( name, rel ) {
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
			dirs.forEach( function ( d ) { box.appendChild( createNode( d.name, d.rel ) ); } );
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

	// 버튼 1개: 평소엔 "확인", 새 버전 감지 후엔 "설치"로 바뀐다.
	function onUpdateBtn() {
		var btn = $( 'sfm-update-btn' );
		if ( btn.dataset.mode === 'install' ) { doUpdate(); } else { checkUpdate(); }
	}

	function checkUpdate() {
		var btn = $( 'sfm-update-btn' );
		var status = $( 'sfm-update-status' );
		btn.disabled = true;
		status.textContent = '확인 중…';
		post( 'sfm_check_update', {} ).then( function ( res ) {
			btn.disabled = false;
			if ( ! res.success ) { status.textContent = ( res.data && res.data.msg ) || '확인 실패'; return; }
			var d = res.data;
			if ( d.has_update ) {
				updLatest = d.latest;
				btn.dataset.mode = 'install';
				btn.textContent = '⬇ v' + d.latest + ' 업데이트 설치';
				status.textContent = '새 버전 v' + d.latest + ' 있음 (현재 v' + d.current + ')';
			} else {
				btn.dataset.mode = 'check';
				btn.textContent = '🔄 지금 업데이트 확인';
				status.textContent = '최신 버전입니다 (v' + d.current + ')';
			}
		} ).catch( function () { btn.disabled = false; status.textContent = '네트워크 오류'; } );
	}

	function doUpdate() {
		var btn = $( 'sfm-update-btn' );
		var status = $( 'sfm-update-status' );
		if ( ! confirm( 'v' + updLatest + ' 로 업데이트할까요?' ) ) { return; }
		btn.disabled = true;
		status.textContent = '업데이트 설치 중… (페이지를 닫지 마세요)';
		post( 'sfm_do_update', {} ).then( function ( res ) {
			if ( ! res.success ) {
				btn.disabled = false;
				status.textContent = ( res.data && res.data.msg ) || '업데이트 실패';
				return;
			}
			status.textContent = res.data.msg || '업데이트 완료! 새로고침합니다…';
			setTimeout( function () { location.reload(); }, 1200 );
		} ).catch( function () { btn.disabled = false; status.textContent = '네트워크 오류'; } );
	}

	/* ------------------------------ 이벤트: 오른쪽 목록 ------------------------------ */

	function selectRow( tr ) {
		var prev = el.list.querySelectorAll( 'tr.sfm-row-selected' );
		Array.prototype.forEach.call( prev, function ( r ) { r.classList.remove( 'sfm-row-selected' ); } );
		if ( tr ) { tr.classList.add( 'sfm-row-selected' ); }
	}

	// 행의 기본 동작(더블클릭/메뉴 열기): 폴더=진입, 편집가능 파일=편집, 그 외=다운로드.
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
		// 여백 포함 행 어디든 한 번 클릭 → 선택.
		var tr = e.target.closest( 'tr[data-rel]' );
		if ( tr ) { selectRow( tr ); }
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
		selectRow( tr );
		showCtxMenu( e.clientX, e.clientY, tr );
	}

	/* ------------------------------ 우클릭 컨텍스트 메뉴 ------------------------------ */

	function showCtxMenu( x, y, tr ) {
		var type = tr.getAttribute( 'data-type' );
		var rel = tr.getAttribute( 'data-rel' );
		var name = tr.getAttribute( 'data-name' );
		var editable = '1' === tr.getAttribute( 'data-editable' );

		var items = [];
		if ( 'dir' === type ) {
			items.push( { label: '📂 열기', act: function () { navigate( rel ); } } );
			items.push( { label: '⬇ 다운로드(zip)', act: function () { download( rel ); } } );
		} else {
			if ( editable ) { items.push( { label: '✏ 편집', act: function () { openEditor( rel ); } } ); }
			items.push( { label: '⬇ 다운로드', act: function () { download( rel ); } } );
		}
		items.push( { label: '🔤 이름 변경', act: function () { renameEntry( rel, name ); } } );
		items.push( { label: '🗑 삭제', act: function () { deleteEntry( rel, name, type ); }, danger: true } );

		var menu = el.ctxmenu;
		menu.innerHTML = '';
		items.forEach( function ( it ) {
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
		var px = Math.min( x, window.innerWidth - mw - 6 );
		var py = Math.min( y, window.innerHeight - mh - 6 );
		menu.style.left = Math.max( 6, px ) + 'px';
		menu.style.top = Math.max( 6, py ) + 'px';
	}

	function hideCtxMenu() {
		if ( el.ctxmenu ) { el.ctxmenu.hidden = true; }
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
		el.editorModal = $( 'sfm-editor-modal' );
		el.editorName = $( 'sfm-editor-name' );
		el.editorText = $( 'sfm-editor-text' );
		el.editorStatus = $( 'sfm-editor-status' );
		el.editorSave = $( 'sfm-editor-save' );

		el.tree.addEventListener( 'click', onTreeClick );
		el.tree.addEventListener( 'dblclick', onTreeDblClick );
		el.list.addEventListener( 'click', onListClick );
		el.list.addEventListener( 'dblclick', onListDblClick );
		el.list.addEventListener( 'contextmenu', onListContext );
		el.breadcrumb.addEventListener( 'click', onBreadcrumbClick );

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
		document.addEventListener( 'keydown', function ( e ) { if ( e.key === 'Escape' ) { hideCtxMenu(); } } );
		window.addEventListener( 'resize', hideCtxMenu );
		el.main = el.list.closest( '.sfm-main' );
		if ( el.main ) { el.main.addEventListener( 'scroll', hideCtxMenu ); }
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

		$( 'sfm-update-btn' ).addEventListener( 'click', onUpdateBtn );

		initTree();
		navigate( '' );
	}

	if ( document.readyState === 'loading' ) {
		document.addEventListener( 'DOMContentLoaded', init );
	} else {
		init();
	}
} )();

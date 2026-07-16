/* global SFM */
( function () {
	'use strict';

	var cwd = '';        // 현재 폴더(base 기준 상대경로)
	var el = {};
	var nodeMap = {};    // rel -> 트리 노드 element

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
		el.list.innerHTML = '<tr><td colspan="5" class="sfm-loading">불러오는 중…</td></tr>';
		post( 'sfm_list', { path: path || '' } ).then( function ( res ) {
			if ( ! res.success ) { msg( res.data.msg || '오류', true ); return; }
			cwd = res.data.path;
			render( res.data );
			revealInTree( cwd );
		} ).catch( function () { msg( '네트워크 오류', true ); } );
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
			var nameCell;
			if ( e.type === 'dir' ) {
				nameCell = '<a class="sfm-open" data-open-dir="' + esc( e.rel ) + '">' + esc( e.name ) + '</a>';
			} else if ( e.editable ) {
				nameCell = '<a class="sfm-open" data-edit="' + esc( e.rel ) + '">' + esc( e.name ) + '</a>';
			} else {
				nameCell = '<span class="sfm-file-name">' + esc( e.name ) + '</span>';
			}

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

			return '<tr>' +
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
		var prefixes = [ '' ];
		var acc = '';
		segs.forEach( function ( s ) { acc = acc ? acc + '/' + s : s; prefixes.push( acc ); } );

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
			if ( node.classList.contains( 'expanded' ) ) {
				node.classList.remove( 'expanded' );
			} else {
				ensureExpanded( rel );
			}
			return;
		}
		// 라벨/아이콘 클릭 → 오른쪽에 내용 표시(+ reveal 이 펼침/선택 처리).
		load( rel );
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

	/* ------------------------------ 이벤트 ------------------------------ */

	function onListClick( e ) {
		var t = e.target.closest( '[data-open-dir],[data-edit],[data-download],[data-rename],[data-delete]' );
		if ( ! t ) { return; }
		e.preventDefault();
		if ( t.hasAttribute( 'data-open-dir' ) ) { load( t.getAttribute( 'data-open-dir' ) ); }
		else if ( t.hasAttribute( 'data-edit' ) ) { openEditor( t.getAttribute( 'data-edit' ) ); }
		else if ( t.hasAttribute( 'data-download' ) ) { download( t.getAttribute( 'data-download' ) ); }
		else if ( t.hasAttribute( 'data-rename' ) ) { renameEntry( t.getAttribute( 'data-rename' ), t.getAttribute( 'data-name' ) ); }
		else if ( t.hasAttribute( 'data-delete' ) ) { deleteEntry( t.getAttribute( 'data-delete' ), t.getAttribute( 'data-name' ), t.getAttribute( 'data-type' ) ); }
	}

	function init() {
		el.tree = $( 'sfm-tree' );
		el.breadcrumb = $( 'sfm-breadcrumb' );
		el.list = $( 'sfm-list' );
		el.msg = $( 'sfm-msg' );
		el.up = $( 'sfm-up' );
		el.editorModal = $( 'sfm-editor-modal' );
		el.editorName = $( 'sfm-editor-name' );
		el.editorText = $( 'sfm-editor-text' );
		el.editorStatus = $( 'sfm-editor-status' );
		el.editorSave = $( 'sfm-editor-save' );

		el.tree.addEventListener( 'click', onTreeClick );
		el.list.addEventListener( 'click', onListClick );
		el.breadcrumb.addEventListener( 'click', onListClick );
		el.up.addEventListener( 'click', function () {
			if ( ! cwd ) { return; }
			var idx = cwd.lastIndexOf( '/' );
			load( idx === -1 ? '' : cwd.substring( 0, idx ) );
		} );
		$( 'sfm-refresh' ).addEventListener( 'click', function () { load( cwd ); refreshTreeNode( cwd ); } );
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

		$( 'sfm-autoupdate' ).addEventListener( 'change', function ( e ) {
			post( 'sfm_toggle_autoupdate', { on: e.target.checked ? 1 : 0 } ).then( function ( res ) {
				if ( res.success ) { msg( res.data.on ? '자동 업데이트를 켰습니다.' : '자동 업데이트를 껐습니다.' ); }
			} );
		} );

		initTree();
		load( '' );
	}

	if ( document.readyState === 'loading' ) {
		document.addEventListener( 'DOMContentLoaded', init );
	} else {
		init();
	}
} )();

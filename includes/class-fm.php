<?php
/**
 * 파일 시스템 코어 — 경로 안전성(디렉터리 탈출 방지)과 실제 파일 작업.
 *
 * 보안 원칙:
 *  - 모든 작업은 base_dir(기본 ABSPATH) 내부로 한정. realpath 로 정규화 후 경계 검사.
 *  - 심볼릭 링크로 base 밖을 가리키면 거부.
 *  - 호출 측(SFM_Ajax)에서 권한(SFM_CAP) + nonce 를 반드시 확인.
 *
 * @package safe-file-manager
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class SFM_FM {

	/** 편집기로 열 수 있는 최대 파일 크기(2MB). 이보다 크면 다운로드만. */
	const MAX_EDIT_BYTES = 2097152;

	/**
	 * 파일 관리자의 최상위(루트) 디렉터리. 이 밖으로는 절대 나갈 수 없다.
	 * 기본은 워드프레스 설치 루트(ABSPATH). 필요하면 필터로 좁힐 수 있다.
	 *
	 * @return string 트레일링 슬래시 없는 절대경로.
	 */
	public static function base_dir() {
		$base = apply_filters( 'sfm_base_dir', ABSPATH );
		$real = realpath( $base );
		if ( false === $real ) {
			$real = untrailingslashit( ABSPATH );
		}
		return untrailingslashit( $real );
	}

	/**
	 * 상대경로(base 기준)를 안전한 절대경로로 변환.
	 * base 를 벗어나면 WP_Error 반환.
	 *
	 * @param string $rel        base 기준 상대경로(예: 'wp-content/uploads').
	 * @param bool   $must_exist true 면 존재하지 않을 때 오류.
	 * @return string|WP_Error 절대경로.
	 */
	public static function resolve( $rel, $must_exist = true ) {
		$base = self::base_dir();
		$rel  = (string) $rel;

		// 널바이트·역슬래시 차단, 앞쪽 슬래시 제거.
		if ( false !== strpos( $rel, "\0" ) ) {
			return new WP_Error( 'sfm_path', '잘못된 경로입니다.' );
		}
		$rel = str_replace( '\\', '/', $rel );
		$rel = ltrim( $rel, '/' );

		$target = '' === $rel ? $base : $base . '/' . $rel;

		if ( $must_exist ) {
			$real = realpath( $target );
			if ( false === $real ) {
				return new WP_Error( 'sfm_notfound', '대상이 존재하지 않습니다.' );
			}
		} else {
			// 아직 없는 파일/폴더: 상위 폴더는 반드시 존재해야 하고, 그 상위가 base 내부여야 한다.
			$parent      = dirname( $target );
			$real_parent = realpath( $parent );
			if ( false === $real_parent ) {
				return new WP_Error( 'sfm_notfound', '상위 폴더가 존재하지 않습니다.' );
			}
			$real = $real_parent . '/' . basename( $target );
		}

		if ( ! self::within_base( $real, $base ) ) {
			return new WP_Error( 'sfm_denied', '허용 범위를 벗어난 경로입니다.' );
		}
		return $real;
	}

	/** $path 가 $base 내부(또는 base 자신)인지. */
	protected static function within_base( $path, $base ) {
		$path = untrailingslashit( $path );
		$base = untrailingslashit( $base );
		if ( $path === $base ) {
			return true;
		}
		return 0 === strpos( $path, $base . '/' );
	}

	/**
	 * 절대경로 → base 기준 상대경로(UI 표시·재요청용).
	 *
	 * @param string $abs
	 * @return string
	 */
	public static function to_rel( $abs ) {
		$base = self::base_dir();
		$abs  = untrailingslashit( $abs );
		if ( $abs === $base ) {
			return '';
		}
		if ( 0 === strpos( $abs, $base . '/' ) ) {
			return ltrim( substr( $abs, strlen( $base ) ), '/' );
		}
		return '';
	}

	/**
	 * 디렉터리 목록.
	 *
	 * @param string $rel base 기준 상대경로.
	 * @return array|WP_Error { path, parent, entries[] }.
	 */
	public static function listing( $rel ) {
		$abs = self::resolve( $rel, true );
		if ( is_wp_error( $abs ) ) {
			return $abs;
		}
		if ( ! is_dir( $abs ) ) {
			return new WP_Error( 'sfm_notdir', '폴더가 아닙니다.' );
		}

		$entries = array();
		$dh      = @opendir( $abs );
		if ( false === $dh ) {
			return new WP_Error( 'sfm_open', '폴더를 열 수 없습니다(권한 확인).' );
		}
		while ( false !== ( $name = readdir( $dh ) ) ) {
			if ( '.' === $name || '..' === $name ) {
				continue;
			}
			$full   = $abs . '/' . $name;
			$is_dir = is_dir( $full );
			$entries[] = array(
				'name'     => $name,
				'rel'      => self::to_rel( $full ),
				'type'     => $is_dir ? 'dir' : 'file',
				'size'     => $is_dir ? 0 : (int) @filesize( $full ),
				'modified' => (int) @filemtime( $full ),
				'perms'    => substr( sprintf( '%o', @fileperms( $full ) ), -4 ),
				'writable' => is_writable( $full ),
				'editable' => ! $is_dir && (int) @filesize( $full ) <= self::MAX_EDIT_BYTES && self::looks_text( $full ),
			);
		}
		closedir( $dh );

		// 폴더 먼저, 그다음 이름순.
		usort(
			$entries,
			function ( $a, $b ) {
				if ( $a['type'] !== $b['type'] ) {
					return 'dir' === $a['type'] ? -1 : 1;
				}
				return strcasecmp( $a['name'], $b['name'] );
			}
		);

		$rel_now = self::to_rel( $abs );
		return array(
			'path'    => $rel_now,
			'parent'  => '' === $rel_now ? null : self::to_rel( dirname( $abs ) ),
			'entries' => $entries,
		);
	}

	/** 파일 내용 읽기(텍스트 편집용). */
	public static function read( $rel ) {
		$abs = self::resolve( $rel, true );
		if ( is_wp_error( $abs ) ) {
			return $abs;
		}
		if ( ! is_file( $abs ) ) {
			return new WP_Error( 'sfm_notfile', '파일이 아닙니다.' );
		}
		if ( (int) filesize( $abs ) > self::MAX_EDIT_BYTES ) {
			return new WP_Error( 'sfm_toobig', '편집기로 열기엔 너무 큰 파일입니다. 다운로드해서 확인하세요.' );
		}
		$content = file_get_contents( $abs );
		if ( false === $content ) {
			return new WP_Error( 'sfm_read', '파일을 읽을 수 없습니다(권한 확인).' );
		}
		return array(
			'rel'      => self::to_rel( $abs ),
			'name'     => basename( $abs ),
			'content'  => $content,
			'writable' => is_writable( $abs ),
		);
	}

	/** 파일 내용 저장(기존 파일 덮어쓰기). */
	public static function write( $rel, $content ) {
		$abs = self::resolve( $rel, true );
		if ( is_wp_error( $abs ) ) {
			return $abs;
		}
		if ( ! is_file( $abs ) ) {
			return new WP_Error( 'sfm_notfile', '파일이 아닙니다.' );
		}
		$ok = @file_put_contents( $abs, $content );
		if ( false === $ok ) {
			return new WP_Error( 'sfm_write', '저장 실패(파일 권한을 확인하세요).' );
		}
		return array( 'rel' => self::to_rel( $abs ), 'size' => (int) filesize( $abs ) );
	}

	/** 새 폴더 만들기. */
	public static function make_dir( $parent_rel, $name ) {
		$name = self::sanitize_name( $name );
		if ( is_wp_error( $name ) ) {
			return $name;
		}
		$parent = self::resolve( $parent_rel, true );
		if ( is_wp_error( $parent ) ) {
			return $parent;
		}
		$target = self::resolve( self::to_rel( $parent ) . '/' . $name, false );
		if ( is_wp_error( $target ) ) {
			return $target;
		}
		if ( file_exists( $target ) ) {
			return new WP_Error( 'sfm_exists', '같은 이름이 이미 있습니다.' );
		}
		if ( ! @mkdir( $target, 0755 ) ) {
			return new WP_Error( 'sfm_mkdir', '폴더 생성 실패(권한 확인).' );
		}
		return array( 'rel' => self::to_rel( $target ) );
	}

	/** 새 빈 파일 만들기. */
	public static function make_file( $parent_rel, $name ) {
		$name = self::sanitize_name( $name );
		if ( is_wp_error( $name ) ) {
			return $name;
		}
		$parent = self::resolve( $parent_rel, true );
		if ( is_wp_error( $parent ) ) {
			return $parent;
		}
		$target = self::resolve( self::to_rel( $parent ) . '/' . $name, false );
		if ( is_wp_error( $target ) ) {
			return $target;
		}
		if ( file_exists( $target ) ) {
			return new WP_Error( 'sfm_exists', '같은 이름이 이미 있습니다.' );
		}
		if ( false === @file_put_contents( $target, '' ) ) {
			return new WP_Error( 'sfm_newfile', '파일 생성 실패(권한 확인).' );
		}
		return array( 'rel' => self::to_rel( $target ) );
	}

	/** 이름 바꾸기(같은 폴더 내). */
	public static function rename_entry( $rel, $new_name ) {
		$new_name = self::sanitize_name( $new_name );
		if ( is_wp_error( $new_name ) ) {
			return $new_name;
		}
		$abs = self::resolve( $rel, true );
		if ( is_wp_error( $abs ) ) {
			return $abs;
		}
		$target = self::resolve( self::to_rel( dirname( $abs ) ) . '/' . $new_name, false );
		if ( is_wp_error( $target ) ) {
			return $target;
		}
		if ( file_exists( $target ) ) {
			return new WP_Error( 'sfm_exists', '같은 이름이 이미 있습니다.' );
		}
		if ( ! @rename( $abs, $target ) ) {
			return new WP_Error( 'sfm_rename', '이름 변경 실패(권한 확인).' );
		}
		return array( 'rel' => self::to_rel( $target ) );
	}

	/** 삭제(폴더는 재귀). */
	public static function delete_entry( $rel ) {
		$abs = self::resolve( $rel, true );
		if ( is_wp_error( $abs ) ) {
			return $abs;
		}
		// base 자신은 삭제 불가.
		if ( untrailingslashit( $abs ) === self::base_dir() ) {
			return new WP_Error( 'sfm_denied', '루트 폴더는 삭제할 수 없습니다.' );
		}
		if ( is_dir( $abs ) ) {
			if ( ! self::rrmdir( $abs ) ) {
				return new WP_Error( 'sfm_delete', '폴더 삭제 실패(권한 확인).' );
			}
		} else {
			if ( ! @unlink( $abs ) ) {
				return new WP_Error( 'sfm_delete', '파일 삭제 실패(권한 확인).' );
			}
		}
		return array( 'ok' => true );
	}

	/** 업로드된 파일을 현재 폴더에 저장. */
	public static function receive_upload( $parent_rel, $file ) {
		if ( empty( $file ) || ! isset( $file['tmp_name'] ) || ! is_uploaded_file( $file['tmp_name'] ) ) {
			return new WP_Error( 'sfm_upload', '업로드된 파일이 없습니다.' );
		}
		if ( ! empty( $file['error'] ) ) {
			return new WP_Error( 'sfm_upload', '업로드 오류(코드 ' . (int) $file['error'] . ').' );
		}
		$name = self::sanitize_name( $file['name'] );
		if ( is_wp_error( $name ) ) {
			return $name;
		}
		$parent = self::resolve( $parent_rel, true );
		if ( is_wp_error( $parent ) ) {
			return $parent;
		}
		$target = self::resolve( self::to_rel( $parent ) . '/' . $name, false );
		if ( is_wp_error( $target ) ) {
			return $target;
		}
		if ( ! @move_uploaded_file( $file['tmp_name'], $target ) ) {
			return new WP_Error( 'sfm_upload', '저장 실패(폴더 권한을 확인하세요).' );
		}
		return array( 'rel' => self::to_rel( $target ), 'name' => $name );
	}

	/**
	 * 다운로드용 절대경로 확보(파일만).
	 *
	 * @return string|WP_Error
	 */
	public static function download_path( $rel ) {
		$abs = self::resolve( $rel, true );
		if ( is_wp_error( $abs ) ) {
			return $abs;
		}
		if ( ! is_file( $abs ) ) {
			return new WP_Error( 'sfm_notfile', '파일만 다운로드할 수 있습니다.' );
		}
		return $abs;
	}

	/* ------------------------------ 내부 헬퍼 ------------------------------ */

	/** 파일/폴더명 검증: 경로 구분자·상위참조·널바이트 금지. */
	protected static function sanitize_name( $name ) {
		$name = trim( (string) $name );
		if ( '' === $name || '.' === $name || '..' === $name ) {
			return new WP_Error( 'sfm_name', '올바른 이름을 입력하세요.' );
		}
		if ( preg_match( '#[/\\\\\0]#', $name ) ) {
			return new WP_Error( 'sfm_name', '이름에 / \\ 나 특수문자는 쓸 수 없습니다.' );
		}
		return $name;
	}

	/** 재귀 삭제. */
	protected static function rrmdir( $dir ) {
		$items = @scandir( $dir );
		if ( false === $items ) {
			return false;
		}
		foreach ( $items as $item ) {
			if ( '.' === $item || '..' === $item ) {
				continue;
			}
			$path = $dir . '/' . $item;
			if ( is_dir( $path ) && ! is_link( $path ) ) {
				if ( ! self::rrmdir( $path ) ) {
					return false;
				}
			} else {
				if ( ! @unlink( $path ) ) {
					return false;
				}
			}
		}
		return @rmdir( $dir );
	}

	/** 텍스트 파일로 보이는지(편집 가능 여부 판단). 바이너리면 false. */
	protected static function looks_text( $file ) {
		$size = (int) @filesize( $file );
		if ( 0 === $size ) {
			return true;
		}
		$fh = @fopen( $file, 'rb' );
		if ( ! $fh ) {
			return false;
		}
		$chunk = fread( $fh, 1024 );
		fclose( $fh );
		if ( false === $chunk || '' === $chunk ) {
			return true;
		}
		// 널바이트가 있으면 바이너리로 간주.
		return false === strpos( $chunk, "\0" );
	}

	/** 사람이 읽는 크기. */
	public static function human_size( $bytes ) {
		$bytes = (int) $bytes;
		$units = array( 'B', 'KB', 'MB', 'GB', 'TB' );
		$i     = 0;
		$val   = $bytes;
		while ( $val >= 1024 && $i < count( $units ) - 1 ) {
			$val /= 1024;
			$i++;
		}
		return ( $i ? round( $val, 1 ) : $val ) . ' ' . $units[ $i ];
	}
}

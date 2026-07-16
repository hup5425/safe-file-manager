<?php
/**
 * AJAX 핸들러 — 모든 진입점에서 권한(SFM_CAP) + nonce 를 강제한다.
 * 이 이중 확인이 이 플러그인의 핵심 보안(무인증 접근 불가).
 *
 * @package safe-file-manager
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class SFM_Ajax {

	/** 공통 관문: 권한 + nonce. 통과 못 하면 즉시 종료. */
	protected static function guard() {
		if ( ! current_user_can( SFM_CAP ) ) {
			wp_send_json_error( array( 'msg' => '권한이 없습니다.' ), 403 );
		}
		if ( ! check_ajax_referer( 'sfm_ajax', 'nonce', false ) ) {
			wp_send_json_error( array( 'msg' => '보안 토큰이 만료되었습니다. 새로고침 후 다시 시도하세요.' ), 400 );
		}
	}

	/** WP_Error → JSON 오류, 성공 → JSON 성공. */
	protected static function respond( $result ) {
		if ( is_wp_error( $result ) ) {
			wp_send_json_error( array( 'msg' => $result->get_error_message() ) );
		}
		wp_send_json_success( $result );
	}

	protected static function rel() {
		return isset( $_POST['path'] ) ? wp_unslash( $_POST['path'] ) : '';
	}

	public static function list_dir() {
		self::guard();
		self::respond( SFM_FM::listing( self::rel() ) );
	}

	public static function read_file() {
		self::guard();
		self::respond( SFM_FM::read( self::rel() ) );
	}

	public static function save_file() {
		self::guard();
		// 내용은 slash 처리/필터 없이 원본 그대로 저장해야 함(코드 파일 편집).
		$content = isset( $_POST['content'] ) ? wp_unslash( $_POST['content'] ) : '';
		self::respond( SFM_FM::write( self::rel(), $content ) );
	}

	public static function mkdir() {
		self::guard();
		$name = isset( $_POST['name'] ) ? wp_unslash( $_POST['name'] ) : '';
		self::respond( SFM_FM::make_dir( self::rel(), $name ) );
	}

	public static function new_file() {
		self::guard();
		$name = isset( $_POST['name'] ) ? wp_unslash( $_POST['name'] ) : '';
		self::respond( SFM_FM::make_file( self::rel(), $name ) );
	}

	public static function rename() {
		self::guard();
		$name = isset( $_POST['name'] ) ? wp_unslash( $_POST['name'] ) : '';
		self::respond( SFM_FM::rename_entry( self::rel(), $name ) );
	}

	public static function delete() {
		self::guard();
		self::respond( SFM_FM::delete_entry( self::rel() ) );
	}

	public static function upload() {
		self::guard();
		$parent = isset( $_POST['path'] ) ? wp_unslash( $_POST['path'] ) : '';
		$file   = isset( $_FILES['file'] ) ? $_FILES['file'] : array();
		self::respond( SFM_FM::receive_upload( $parent, $file ) );
	}

	/** 파일/폴더 다운로드 — 파일은 그대로, 폴더는 zip 으로 스트림(권한/nonce 확인 후). */
	public static function download() {
		if ( ! current_user_can( SFM_CAP ) ) {
			wp_die( '권한이 없습니다.' );
		}
		// 다운로드는 GET 링크라 nonce 를 쿼리로 받는다.
		$nonce = isset( $_GET['nonce'] ) ? sanitize_text_field( wp_unslash( $_GET['nonce'] ) ) : '';
		if ( ! wp_verify_nonce( $nonce, 'sfm_ajax' ) ) {
			wp_die( '보안 토큰이 유효하지 않습니다.' );
		}
		$rel = isset( $_GET['path'] ) ? wp_unslash( $_GET['path'] ) : '';
		$abs = SFM_FM::resolve( $rel, true );
		if ( is_wp_error( $abs ) ) {
			wp_die( esc_html( $abs->get_error_message() ) );
		}

		$cleanup  = '';
		$filename = basename( $abs );

		if ( is_dir( $abs ) ) {
			// 폴더 → 임시 zip 생성 후 스트림, 전송 끝나면 삭제.
			$zip = SFM_FM::zip_dir( $rel );
			if ( is_wp_error( $zip ) ) {
				wp_die( esc_html( $zip->get_error_message() ) );
			}
			$abs      = $zip['path'];
			$filename = $zip['name'];
			$cleanup  = $zip['path'];
		} elseif ( ! is_file( $abs ) ) {
			wp_die( '다운로드할 수 없는 대상입니다.' );
		}

		nocache_headers();
		header( 'Content-Type: application/octet-stream' );
		header( 'Content-Disposition: attachment; filename="' . $filename . '"' );
		header( 'Content-Length: ' . filesize( $abs ) );
		header( 'X-Content-Type-Options: nosniff' );
		// 대용량도 안전하게 스트리밍.
		$fh = fopen( $abs, 'rb' );
		if ( $fh ) {
			while ( ! feof( $fh ) ) {
				echo fread( $fh, 8192 ); // phpcs:ignore
				flush();
			}
			fclose( $fh );
		}
		if ( '' !== $cleanup ) {
			@unlink( $cleanup ); // 임시 zip 정리.
		}
		exit;
	}

	/**
	 * 지금 업데이트 확인 — 캐시 비우고 강제 재검사 후 결과 반환.
	 */
	public static function check_update() {
		self::guard();

		// 우리 릴리스 응답 캐시 + WP 업데이트 트랜지언트 비우고 강제 재검사.
		if ( defined( 'SFM_UPDATE_REPO' ) && SFM_UPDATE_REPO ) {
			delete_transient( 'sfm_upd_' . md5( SFM_UPDATE_REPO ) );
		}
		delete_site_transient( 'update_plugins' );
		wp_update_plugins();

		$basename = plugin_basename( SFM_FILE );
		$t        = get_site_transient( 'update_plugins' );
		$has      = is_object( $t ) && isset( $t->response[ $basename ] );

		$latest = SFM_VERSION;
		if ( $has ) {
			$latest = $t->response[ $basename ]->new_version;
		} elseif ( is_object( $t ) && isset( $t->no_update[ $basename ] ) ) {
			$latest = $t->no_update[ $basename ]->new_version;
		}

		wp_send_json_success(
			array(
				'current'     => SFM_VERSION,
				'latest'      => $latest,
				'has_update'  => $has,
				'plugins_url' => self_admin_url( 'plugins.php' ),
			)
		);
	}

	/**
	 * 설정 화면에서 그 자리 업데이트(플러그인 화면 이동 없이).
	 * WP 의 Plugin_Upgrader 를 ajax 로 실행.
	 */
	public static function do_update() {
		self::guard();
		if ( ! current_user_can( 'update_plugins' ) ) {
			wp_send_json_error( array( 'msg' => '업데이트 권한이 없습니다.' ), 403 );
		}

		require_once ABSPATH . 'wp-admin/includes/file.php';
		require_once ABSPATH . 'wp-admin/includes/misc.php';
		require_once ABSPATH . 'wp-admin/includes/plugin.php';
		require_once ABSPATH . 'wp-admin/includes/class-wp-upgrader.php';
		if ( ! class_exists( 'WP_Ajax_Upgrader_Skin' ) ) {
			require_once ABSPATH . 'wp-admin/includes/class-wp-ajax-upgrader-skin.php';
		}

		// 최신 정보 강제 재확인(캐시 비우기) → 업데이트 트랜지언트에 새 버전 주입.
		if ( defined( 'SFM_UPDATE_REPO' ) && SFM_UPDATE_REPO ) {
			delete_transient( 'sfm_upd_' . md5( SFM_UPDATE_REPO ) );
		}
		delete_site_transient( 'update_plugins' );
		wp_update_plugins();

		$plugin = plugin_basename( SFM_FILE );
		// WP 업그레이더는 교체 전 플러그인을 조용히 비활성화하는데, 단일 AJAX 자가
		// 업데이트에서는 다시 켜주지 않는다 → 업데이트 전 활성 상태를 기억해 뒀다 복구.
		$was_active = is_plugin_active( $plugin );

		$skin     = new WP_Ajax_Upgrader_Skin();
		$upgrader = new Plugin_Upgrader( $skin );
		$result   = $upgrader->upgrade( $plugin );

		if ( $skin->get_errors()->has_errors() ) {
			wp_send_json_error( array( 'msg' => $skin->get_errors()->get_error_message() ), 500 );
		}
		if ( is_wp_error( $result ) ) {
			wp_send_json_error( array( 'msg' => $result->get_error_message() ), 500 );
		}
		if ( false === $result ) {
			wp_send_json_error( array( 'msg' => '업데이트할 새 버전을 찾지 못했습니다(잠시 후 다시 시도).' ), 500 );
		}

		// 업데이트 과정에서 비활성화됐다면 원래대로 다시 활성화(조용히).
		if ( $was_active && ! is_plugin_active( $plugin ) ) {
			activate_plugin( $plugin, '', false, true );
		}

		wp_send_json_success( array( 'msg' => '업데이트 완료! 곧 새로고침됩니다.' ) );
	}
}

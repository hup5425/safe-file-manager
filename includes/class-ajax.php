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

	/** 파일 다운로드 — 스트림 전송(권한/nonce 확인 후). */
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
		$abs = SFM_FM::download_path( $rel );
		if ( is_wp_error( $abs ) ) {
			wp_die( esc_html( $abs->get_error_message() ) );
		}

		nocache_headers();
		header( 'Content-Type: application/octet-stream' );
		header( 'Content-Disposition: attachment; filename="' . basename( $abs ) . '"' );
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
		exit;
	}

	public static function toggle_autoupdate() {
		self::guard();
		$on = ! empty( $_POST['on'] ) ? 1 : 0;
		update_option( 'sfm_auto_update', $on );
		wp_send_json_success( array( 'on' => $on ) );
	}
}

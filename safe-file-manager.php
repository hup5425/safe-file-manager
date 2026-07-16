<?php
/**
 * Plugin Name: 안전 파일 관리자
 * Description: 워드프레스 관리자 화면에서 서버 파일을 직접 열람·편집·업로드·다운로드할 수 있는 파일 관리자. 취약한 WP File Manager(elFinder) 대체용으로, 모든 동작이 관리자 권한(manage_options) + nonce 로만 실행됩니다. GitHub 릴리스 기반 자동 업데이트 포함.
 * Version: 1.0.2
 * Author: You
 * License: GPL-2.0+
 * Text Domain: safe-file-manager
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

if ( defined( 'SFM_VERSION' ) ) {
	return;
}

define( 'SFM_VERSION', '1.0.2' );
define( 'SFM_FILE', __FILE__ );
define( 'SFM_DIR', plugin_dir_path( __FILE__ ) );
define( 'SFM_URL', plugin_dir_url( __FILE__ ) );

// 파일 작업을 허용할 권한. 기본은 최고 관리자(manage_options).
// wp-config.php 등에서 define( 'SFM_CAP', '...' ) 로 재정의 가능.
if ( ! defined( 'SFM_CAP' ) ) {
	define( 'SFM_CAP', 'manage_options' );
}

// 자동 업데이트 소스 — GitHub 'owner/repo'. 비우면 업데이트 비활성(안전).
if ( ! defined( 'SFM_UPDATE_REPO' ) ) {
	define( 'SFM_UPDATE_REPO', 'hup5425/safe-file-manager' );
}
// 비공개 저장소일 때만 필요한 read 전용 토큰. 공개 저장소면 비워 둔다.
// wp-config.php 에서 define( 'SFM_UPDATE_TOKEN', 'github_pat_...' ) 로 재정의 가능.
if ( ! defined( 'SFM_UPDATE_TOKEN' ) ) {
	define( 'SFM_UPDATE_TOKEN', '' );
}

require_once SFM_DIR . 'includes/class-fm.php';
require_once SFM_DIR . 'includes/class-ajax.php';
require_once SFM_DIR . 'includes/class-updater.php';

// 플러그인 목록에 "열기" 바로가기 링크.
add_filter(
	'plugin_action_links_' . plugin_basename( __FILE__ ),
	function ( $links ) {
		$links[] = '<a href="' . esc_url( admin_url( 'admin.php?page=safe-file-manager' ) ) . '">열기</a>';
		return $links;
	}
);

// 자동 업데이트 — 관리자/크론 컨텍스트에서만 등록(프런트 부하 없음).
if ( is_admin() || ( function_exists( 'wp_doing_cron' ) && wp_doing_cron() ) ) {
	SFM_Updater::init( SFM_UPDATE_REPO, plugin_basename( SFM_FILE ), SFM_UPDATE_TOKEN );
}

// 설정의 "자동 업데이트"가 켜져 있으면 이 플러그인 자동 설치 허용.
add_filter(
	'auto_update_plugin',
	function ( $update, $item ) {
		if ( is_object( $item ) && isset( $item->plugin ) && plugin_basename( SFM_FILE ) === $item->plugin ) {
			if ( get_option( 'sfm_auto_update' ) ) {
				return true;
			}
		}
		return $update;
	},
	10,
	2
);

/* ------------------------------ 관리자 메뉴 ------------------------------ */

add_action(
	'admin_menu',
	function () {
		add_menu_page(
			'파일 관리자',
			'파일 관리자',
			SFM_CAP,
			'safe-file-manager',
			'sfm_render_page',
			'dashicons-media-default',
			80
		);
	}
);

function sfm_render_page() {
	if ( ! current_user_can( SFM_CAP ) ) {
		wp_die( '권한이 없습니다.' );
	}
	require SFM_DIR . 'admin/admin-page.php';
}

/**
 * 제목 옆 버전 + 최신/업데이트 배지(추가 네트워크 호출 없음).
 */
function sfm_version_badge() {
	$basename = plugin_basename( SFM_FILE );
	$latest   = '';
	$t        = get_site_transient( 'update_plugins' );
	if ( is_object( $t ) ) {
		if ( isset( $t->response[ $basename ]->new_version ) ) {
			$latest = $t->response[ $basename ]->new_version;
		} elseif ( isset( $t->no_update[ $basename ]->new_version ) ) {
			$latest = $t->no_update[ $basename ]->new_version;
		}
	}
	if ( '' === $latest && method_exists( 'SFM_Updater', 'cached_latest_version' ) ) {
		$latest = SFM_Updater::cached_latest_version();
	}
	$html = '<span class="sfm-ver">v' . esc_html( SFM_VERSION ) . '</span>';
	if ( '' !== $latest && version_compare( SFM_VERSION, $latest, '<' ) ) {
		$html .= ' <a class="sfm-ver-badge sfm-ver-badge--upd" href="' . esc_url( self_admin_url( 'plugins.php' ) ) . '">업데이트 v' . esc_html( $latest ) . ' 있음</a>';
	} elseif ( '' !== $latest ) {
		$html .= ' <span class="sfm-ver-badge sfm-ver-badge--latest">최신</span>';
	}
	return $html;
}

/* ------------------------------ 관리자 스크립트/스타일 ------------------------------ */

add_action(
	'admin_enqueue_scripts',
	function ( $hook ) {
		$page = isset( $_GET['page'] ) ? sanitize_key( $_GET['page'] ) : '';
		if ( 'safe-file-manager' !== $page ) {
			return;
		}
		wp_enqueue_style( 'sfm-admin', SFM_URL . 'assets/admin.css', array(), SFM_VERSION );
		wp_enqueue_script( 'sfm-admin', SFM_URL . 'assets/admin.js', array(), SFM_VERSION, true );
		wp_localize_script(
			'sfm-admin',
			'SFM',
			array(
				'ajax'         => admin_url( 'admin-ajax.php' ),
				'nonce'        => wp_create_nonce( 'sfm_ajax' ),
				'downloadBase' => admin_url( 'admin-ajax.php' ),
				'maxEditBytes' => SFM_FM::MAX_EDIT_BYTES,
			)
		);
	}
);

/* ------------------------------ AJAX 엔드포인트 ------------------------------ */

add_action( 'wp_ajax_sfm_list', array( 'SFM_Ajax', 'list_dir' ) );
add_action( 'wp_ajax_sfm_read', array( 'SFM_Ajax', 'read_file' ) );
add_action( 'wp_ajax_sfm_save', array( 'SFM_Ajax', 'save_file' ) );
add_action( 'wp_ajax_sfm_mkdir', array( 'SFM_Ajax', 'mkdir' ) );
add_action( 'wp_ajax_sfm_newfile', array( 'SFM_Ajax', 'new_file' ) );
add_action( 'wp_ajax_sfm_rename', array( 'SFM_Ajax', 'rename' ) );
add_action( 'wp_ajax_sfm_delete', array( 'SFM_Ajax', 'delete' ) );
add_action( 'wp_ajax_sfm_upload', array( 'SFM_Ajax', 'upload' ) );
add_action( 'wp_ajax_sfm_download', array( 'SFM_Ajax', 'download' ) );
add_action( 'wp_ajax_sfm_toggle_autoupdate', array( 'SFM_Ajax', 'toggle_autoupdate' ) );
add_action( 'wp_ajax_sfm_check_update', array( 'SFM_Ajax', 'check_update' ) );
add_action( 'wp_ajax_sfm_do_update', array( 'SFM_Ajax', 'do_update' ) );

<?php
/**
 * 파일 관리자 관리자 화면.
 *
 * @package safe-file-manager
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

$sfm_base    = SFM_FM::base_dir();
$sfm_auto_on = (bool) get_option( 'sfm_auto_update' );
?>
<div class="wrap sfm-wrap">
	<h1 class="sfm-title">
		파일 관리자
		<?php echo wp_kses_post( sfm_version_badge() ); ?>
	</h1>

	<p class="sfm-root-note">
		접근 루트: <code><?php echo esc_html( $sfm_base ); ?></code>
		<span class="sfm-sep">·</span>
		이 폴더 밖으로는 접근할 수 없습니다.
	</p>

	<div class="sfm-toolbar">
		<div class="sfm-breadcrumb" id="sfm-breadcrumb"></div>
		<div class="sfm-actions">
			<button class="button" id="sfm-up" title="상위 폴더">⬆ 상위</button>
			<button class="button" id="sfm-refresh" title="새로고침">↻ 새로고침</button>
			<button class="button" id="sfm-new-folder">＋ 새 폴더</button>
			<button class="button" id="sfm-new-file">＋ 새 파일</button>
			<label class="button sfm-upload-btn">
				⬆ 업로드
				<input type="file" id="sfm-upload" multiple hidden>
			</label>
		</div>
	</div>

	<div class="sfm-msg" id="sfm-msg" hidden></div>

	<table class="widefat striped sfm-table">
		<thead>
			<tr>
				<th class="sfm-col-name">이름</th>
				<th class="sfm-col-size">크기</th>
				<th class="sfm-col-modified">수정일</th>
				<th class="sfm-col-perms">권한</th>
				<th class="sfm-col-act">작업</th>
			</tr>
		</thead>
		<tbody id="sfm-list">
			<tr><td colspan="5" class="sfm-loading">불러오는 중…</td></tr>
		</tbody>
	</table>

	<p class="sfm-autoupdate">
		<label>
			<input type="checkbox" id="sfm-autoupdate" <?php checked( $sfm_auto_on ); ?>>
			새 버전이 올라오면 자동으로 업데이트
		</label>
		<span class="sfm-autoupdate-hint">(끄면 플러그인 목록에서 수동으로 업데이트합니다)</span>
	</p>
</div>

<!-- 편집기 모달 -->
<div class="sfm-modal" id="sfm-editor-modal" hidden>
	<div class="sfm-modal-box sfm-editor-box">
		<div class="sfm-modal-head">
			<strong id="sfm-editor-name">파일 편집</strong>
			<button class="button-link sfm-modal-close" id="sfm-editor-close">✕</button>
		</div>
		<textarea id="sfm-editor-text" spellcheck="false" wrap="off"></textarea>
		<div class="sfm-modal-foot">
			<span class="sfm-editor-status" id="sfm-editor-status"></span>
			<span class="sfm-spacer"></span>
			<button class="button" id="sfm-editor-cancel">닫기</button>
			<button class="button button-primary" id="sfm-editor-save">저장</button>
		</div>
	</div>
</div>

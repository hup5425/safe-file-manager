<?php
/**
 * 파일 관리자 관리자 화면 — 파일질라식 2단(좌: 디렉터리 트리 / 우: 폴더 내용).
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

	<div class="sfm-msg" id="sfm-msg" hidden></div>

	<div class="sfm-body">
		<!-- 왼쪽: 디렉터리 트리 -->
		<div class="sfm-tree" id="sfm-tree"></div>

		<!-- 오른쪽: 현재 폴더 내용 -->
		<div class="sfm-main">
			<div class="sfm-toolbar">
				<div class="sfm-breadcrumb" id="sfm-breadcrumb"></div>
				<div class="sfm-actions">
					<button class="button" id="sfm-up" title="상위 폴더">⬆ 상위</button>
					<button class="button" id="sfm-refresh" title="새로고침">↻</button>
					<button class="button" id="sfm-download-folder" title="현재 폴더를 zip으로 다운로드">⬇ 폴더</button>
					<button class="button" id="sfm-new-folder">＋ 폴더</button>
					<button class="button" id="sfm-new-file">＋ 파일</button>
					<label class="button sfm-upload-btn">
						⬆ 업로드
						<input type="file" id="sfm-upload" multiple hidden>
					</label>
				</div>
			</div>

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
		</div>
	</div>

	<div class="sfm-update-box">
		<div class="sfm-update-row">
			<button class="button" id="sfm-check-update">🔄 지금 업데이트 확인</button>
			<button class="button button-primary" id="sfm-do-update" hidden>업데이트 설치</button>
			<span class="sfm-update-status" id="sfm-update-status">현재 버전 v<?php echo esc_html( SFM_VERSION ); ?></span>
		</div>
		<p class="sfm-autoupdate">
			<label>
				<input type="checkbox" id="sfm-autoupdate" <?php checked( $sfm_auto_on ); ?>>
				새 버전이 올라오면 자동으로 업데이트
			</label>
			<span class="sfm-autoupdate-hint">(꺼도 위 "지금 업데이트 확인"으로 수동 설치할 수 있습니다)</span>
		</p>
	</div>
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

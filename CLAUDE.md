# safe-file-manager — CLAUDE.md

## 🚨 최우선 개발 원칙 — "원본 우선, 땜질 금지"

문제가 생기면 **절대 그 위에 즉흥적으로 코드를 덧붙여 증상만 덮지 말 것.**
1. **원본을 본다** — 정상 동작하던 원래 코드/디자인을 먼저 확인(git 이력 포함).
2. **원인을 찾는다** — 무엇이 원본과 달라졌고 왜 깨졌는지 근본 원인 파악.
3. **원본을 고친다 / 되돌린다.**
4. **정말 안 될 때만 차선책**(이유 기록).

빠른 우회보다 **느리더라도 원인을 고치는 것**을 항상 우선한다.

---

## 이 플러그인이 무엇인가

취약한 **WP File Manager(elFinder)** 를 대체하는 안전한 파일 관리자.
호스팅사가 CVE(무인증 RCE) 때문에 WP File Manager 를 삭제하는 상황에서, 같은 편의를 안전하게 제공한다.

**이름/슬러그를 일부러 다르게** 했다(`safe-file-manager`, "안전 파일 관리자").
→ 호스팅사가 `wp-file-manager` 를 자동 탐지·삭제하므로, 같은 이름이면 이것도 삭제당한다.

## 보안 불변식 (절대 깨지 말 것)

- 모든 AJAX 진입점은 `SFM_Ajax::guard()` 로 **권한(SFM_CAP) + nonce** 를 매번 확인한다.
- 모든 경로는 `SFM_FM::resolve()` 를 거쳐 **base_dir(기본 ABSPATH) 밖으로 못 나가게** 한다(realpath 경계 검사). 새 작업을 추가할 때도 반드시 이 함수를 통해 경로를 얻을 것.
- elFinder 등 외부 파일관리 라이브러리를 다시 들이지 말 것.

## 구조

- `safe-file-manager.php` — 부트스트랩, 메뉴, 훅, 상수.
- `includes/class-fm.php` — 파일시스템 코어 + 경로 안전성.
- `includes/class-ajax.php` — AJAX 핸들러(권한/nonce 관문).
- `includes/class-updater.php` — GitHub 릴리스 자동 업데이트(방문자통계와 동일 패턴).
- `admin/admin-page.php`, `assets/*` — 관리자 UI.

## 배포(릴리스) 절차 — 여러 사이트 자동 업데이트의 핵심

버전 올릴 때 **세 곳의 버전을 반드시 일치**시킨다:
1. `safe-file-manager.php` 헤더 `Version:` 
2. 같은 파일 `define( 'SFM_VERSION', ... )`
3. `readme.txt` `Stable tag:`

그다음:
```
cd ~/클로드작업/safe-file-manager
zip -r safe-file-manager-vX.Y.Z.zip safe-file-manager  # (상위에서 폴더째로)
git add -A && git commit -m "vX.Y.Z: ..." && git push
gh release create vX.Y.Z safe-file-manager-vX.Y.Z.zip -t vX.Y.Z -n "변경 내용"
```
릴리스가 올라가면 각 사이트 WP 가 업데이트 트랜지언트 체크 시 새 버전을 감지 → 플러그인 목록 "업데이트" 또는 자동 업데이트로 반영된다.

⚠ zip 은 반드시 **`safe-file-manager/` 폴더를 감싼 구조**여야 한다(그래야 설치 경로가 맞다).
저장소는 공개(hup5425/safe-file-manager)라 사이트 쪽에 토큰이 필요 없다.

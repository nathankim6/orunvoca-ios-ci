# 옳은VOCA Windows 셸 1.0.1 (unsigned, 배포 전 검증용)

Electron 기반 Windows 데스크톱 셸. https://orunvoca.co.kr 를 원격 콘텐츠로 표시합니다.
오프라인 노트와 앱 좌측 사이드바는 없습니다.

## 상태
- 설치파일: `dist/OrunVoca-Setup-1.0.1-x64-unsigned.exe` (NSIS x64, **코드 서명 없음**: 인증서 없음). Windows SmartScreen 경고가 표시될 수 있습니다.
- 빌드/실행 검증은 수동 GitHub Actions 워크플로 `.github/workflows/windows-build.yml` (windows-latest **호스티드 VM**, 실제 사용자 기기 아님)에서 수행합니다. macOS 샌드박스에서는 7za 실행이 막혀 NSIS를 만들 수 없습니다.
- 릴리스/배포/스토어 제출 없음. 워크플로는 artifact 업로드만 합니다. 배포는 사용자의 명시적 "완료" 이후에만.

## 구조
- 상단 컴팩트 툴바(로컬, 신뢰 UI) + 원격 WebContentsView 하나.
- 화면 모드: 데스크톱(창 전체 폭) → 태블릿(실제 768px) → 휴대폰(실제 390px). 태블릿·휴대폰은 중앙 정렬하고 창보다 좁게 제한합니다(CSS transform 아님). 단축키는 Ctrl+1/2/3입니다.
- 모드 전환은 같은 원격 webContents/세션(`persist:orunvoca`)을 유지하며 bounds만 변경 (새로고침 없음).

## 보안
contextIsolation, sandbox, webSecurity 사용, nodeIntegration 끔. 원격 콘텐츠에는 preload/IPC 없음.
탐색은 정확히 `https://orunvoca.co.kr` 만 허용 (사용자명/비밀번호가 포함된 URL 거부). 안전한 외부 https 링크만 기본 브라우저로 열기, 기타 프로토콜 차단.
팝업은 기본 차단. 예외는 사이트 시험지 인쇄 흐름(`window.open('', '_blank')` → `document.write` → `print()` → `close()`)용 **인쇄 팝업 1개**뿐:
열어준 페이지가 정확히 사이트 URL이고, 팝업이 about:blank이며 실제 frame origin이 사이트 origin일 때만 허용. 팝업은 sandbox/contextIsolation,
nodeIntegration 끔, preload 없음, 메뉴 없음, 중첩 팝업 차단, 모든 탐색 차단, 동시 1개 제한(닫히면 해제). 셸은 팝업을 타이머로 닫거나 대신 인쇄하지 않습니다.
모든 권한 요청 거부. 다운로드는 다운로드 폴더에 저장만 하고 자동 실행하지 않음.
**테스트 훅 없음**: `src/`에는 테스트 URL/환경변수/플래그가 없고, 패키지에는 `src/**`와 `package.json`만 들어갑니다 (`smoke/check-asar.js`로 확인).

## 스모크 테스트 (`smoke/`, 패키지에 포함되지 않음)
- `smoke/harness-main.js`: 개발용 Electron으로 **수정되지 않은** `src/main.js`(또는 설치된 app.asar의 main)를 실행. 실행 전에 같은 세션에
  `protocol.handle('https')` 라우터를 등록해 운영 origin(`https://orunvoca.co.kr`)에서만 합성 fixture(`smoke/fixture.js`, 빨간 "SYNTHETIC" 배너,
  가짜 발음 WAV)를 제공하고 그 외 https는 403. 실제 사이트/계정에 접속하지 않습니다.
- `smoke/installed-app.js` + `smoke/installed-app-driver.js`: 설치된 exe를 `--inspect=0`으로 실행하고 메인 프로세스 Node inspector에만 직접 연결해 같은 probe를 실행
  (렌더러/CDP attach 없음. 이전 Playwright `_electron.launch`는 CDP 연결 후 90초 멈춤 발생). 시도마다 새 `--user-data-dir`, 실패한 시도는 프로세스 트리 종료,
  재시도는 실행/연결 인프라 실패에 한해 1회만. probe가 시작된 뒤의 실패는 재시도하지 않음. 네트워크는 `--proxy-server=127.0.0.1:9`,
  `--host-resolver-rules=MAP * ~NOTFOUND` 로 차단.
- `smoke/probe.js` 검사: 창 1개/뷰 2개, 데스크톱 전체 폭, 태블릿 실제 768px와 휴대폰 실제 390px(innerWidth, media query), 툴바/메뉴/창 크기 변경 후에도
  같은 webContents id/렌더러 pid/세션, 문서 재로드 없음, 노트/사이드바 없음, 원격 페이지 Node/브리지 없음, 탐색/무관한 팝업/권한 차단, 합성 오디오 fetch+decode,
  합성 시험지 인쇄 팝업(같은 origin 접근, sandbox/Node 없음, 중첩 팝업·탐색 차단, 1개 제한, 닫힘 후 재허용, Electron `printToPDF` 결과 `%PDF` 파일을 증거로 저장. 실제 프린터 검증 아님).
- `smoke/windows-installer-smoke.ps1`: 무인 설치(`/S /currentuser /D=`) → 파일/레지스트리/바로가기 확인 → 일반 실행+화면 캡처(시각 참고용) →
  inspector probe → 설치된 asar 교차 검사 → 무인 제거 → 깨끗한 제거 확인.

## 명령
```
npm ci
npm test              # Node 테스트 (레이아웃/보안/패키지 격리/실제 main.js+가짜 Electron probe)
npm run smoke:source  # 실제 Electron 실행 스모크 (Windows 러너에서)
npm run package:win   # NSIS x64, --publish never (Windows에서만)
```

# TCR-261019 — go2joy 위젯 Figma 반영: 런처 스타일·인사 말풍선·아바타 메시지 테스트 케이스

- 근거: [PLN-261019](../plan/PLN-261019-Go2Joy-Widget-Figma-Design.md) · 구현 PR #650
- 범위: 타입 정규화 · API(문구·디자인·패키지) · 로더 닫힘 프레임 · 위젯 렌더 · 콘솔 · go2joy 스테이징 실측

## 1. 단위 테스트 (자동)

| ID | 대상 | 케이스 | 기대 | 파일 |
|---|---|---|---|---|
| U1 | `normalizeLauncher` | `style:'bare'`·`teaser:{enabled,delaySec:99}` | style 유지, delaySec 30으로 클램프 | `widget-theme.spec.ts` |
| U2 | `normalizeLauncher` | `delay_sec:-4`(snake) / delaySec 없음 | 0 / 기본 3 | 〃 |
| U3 | `normalizeLauncher` | `style:'neon'`, `teaser.enabled:false` | 둘 다 저장 안 됨(현행 JSON과 동일) | 〃 |
| U4 | `normalizeWidgetTheme` | bare + `design.launcherIcon` 없음 / 있음 | style 제거 / 유지 | 〃 |
| U5 | `normalizeDesign` | 기본값만(logo·plain·paperclip·icons {}) | `null`(저장 안 함) | 〃 |
| U6 | `normalizeDesign` | logo-title·avatar·image·icons(유효 1·불량 uuid 1·미지 슬롯 1) | 유효 슬롯만 남음 | 〃 |
| U7 | `normalizeDesign` | 옵션 생기기 전 디자인 `{radius:'sm'}` | 그대로 | 〃 |
| U8 | `mergeWidgetCopy` | 4 bag 언어별 저장·trim·빈 값 제거 | 빈 bag은 키 자체 없음, 전부 비면 `null` | `tenant.service.spec.ts` |
| U9 | `SessionService.privacyNotice` | 테넌트가 bag 미설정 | `widgetCopy`에 `{}` 4개 전달 | `session.service.agent-copy.spec.ts` |
| U10 | 패키지 export/import | `icons.botAvatar` + logo-title·avatar·image·card | 자산 role=botAvatar 동봉, import 후 옵션·슬롯 복원 | `widget-design.service.spec.ts` |
| U11 | 로더 `applyLauncher` | `closed` 없음(구 위젯) | 96×96 유지 | `embed-teaser-frame.test.mjs` |
| U12 | 로더 | `closed {360,96}` → `{96,96}` | 넓힘 뒤 복귀 | 〃 |
| U13 | 로더 | `closed {10,10}` / `{9999,9999}` | 96 하한 / 360×160 상한 | 〃 |
| U14 | 로더 | 넓힌 뒤 localStorage | `closed` 미저장, size 96 | 〃 |
| U15 | 로더 | 패널 열린 상태에서 `closed` 수신 | 열린 박스 유지 | 〃 |
| U16 | 로더 SDK 계약 | `localStorage.setItem(LAUNCHER_KEY` 문자열 | 존재(CI에서 1회 실패 → 수정) | `embed-loader.spec.ts` |

## 2. 통합 시나리오 (스테이징 go2joy, 수동)

| ID | 시나리오 | 절차 | 기대 |
|---|---|---|---|
| I1 | P1 설정만(배포 전) | SQL 적용 후 `POST /session/ensure {shop_domain:"https://www.go2joy.vn"}` | brand `#1570EF`·headerStyle brand·로고 id·launcher lg·design(inter/lg/launcherIcon/customCss) 전달, 새 키(style·teaser·headerLayout…)는 구 API가 제거 |
| I2 | 배포 후 세션 | 같은 호출 | `launcher.style:'bare'`·`teaser`·`design.headerLayout/messageStyle/attachIcon/icons`·`widgetCopy.headerTitle/aiSenderName/agentSenderName/launcherTeaser` 전달 |
| I3 | 로더 번들 | `GET /widget/embed.js` | `next.closed` 처리 코드 포함 |
| I4 | 자산 공개 URL | `/public/widget/asset/{uuid}?v=1` ×2, `/public/widget/logo?shop=…&v={id}` | 200 image/png |
| I5 | 런처(웹 임베드) | go2joy 스니펫 페이지 열기 | 마스코트가 원·그림자 없이 64px로 뜨고, 3초 뒤 왼쪽에 파란 인사 말풍선 "Xin chào! JoyBot sẵn sàng hỗ trợ bạn!" |
| I6 | 말풍선 닫기 | 말풍선 X 클릭 | 말풍선 사라지고 iframe 폭이 112px로 복귀(페이지 요소 클릭 가능), 새로고침해도 같은 탭 세션에선 다시 안 뜸 |
| I7 | 말풍선 클릭 | 말풍선 본문 클릭 | 패널 열림 |
| I8 | 헤더 | 패널 열기 | 파란 헤더 · 흰 G2J 모노그램 + "Trung tâm hỗ trợ"(VI) / "Support center"(EN) · 🌐VI · ⚙ · X |
| I9 | AI 메시지 | 인사 말풍선 | 왼쪽 마스코트 아바타 28px + "JoyBot - Tổng đài viên AI" 파란 굵은 글씨 + 연회색 말풍선 |
| I10 | 상담원 메시지 | 상담원 응답(또는 미리보기) | 기본 사람 아이콘 아바타 + "Nhân viên hỗ trợ Go2Joy" |
| I11 | 고객 메시지 | 메시지 전송 | 연파랑 배경·짙은 글자(CSS 애드온) |
| I12 | 입력부 | — | 이미지 아이콘 첨부 버튼, pill 입력, 원형 전송 |
| I13 | 언어 전환 | 🌐 → EN | 제목·발신자명·말풍선 문구가 EN으로 |
| I14 | 앱 모드 | `?mode=app` | 런처·말풍선 없음, 헤더·아바타는 동일 |
| I15 | 다른 테넌트 | ivyusa 스토어(트리거 모드) | 변화 없음 |
| I16 | 콘솔 | 설정 > 위젯 설정 | 테마 카드에 런처 스타일·인사 말풍선, 편집기에 5필드, 문구 카드에 4행(6언어 탭) 표시·저장 토스트 |

## 3. 엣지 케이스

| ID | 케이스 | 기대 |
|---|---|---|
| E1 | bare 선택 후 아이콘 파일 삭제 | 정규화가 style 제거 → 채운 버튼으로 복귀 |
| E2 | 말풍선 켠 채 트리거 모드 | 말풍선 미표시(런처 자체가 없음) |
| E3 | sessionStorage 불가(프라이빗 모드 등) | 말풍선은 매 페이지 표시, 오류 없음 |
| E4 | 구 로더(캐시) + 신 위젯 | `closed`를 모르는 로더는 정사각 유지 → 말풍선이 프레임 밖에서 잘릴 뿐 동작 정상 |
| E5 | 아바타 슬롯 없이 `messageStyle:'avatar'` | lucide Bot/User 폴백 아바타 |
| E6 | `aiSenderName` 비움 | displayName(에이전트 표시명 우선)으로 |
| E7 | 로고 없이 `logo-title` | 제목만(현행과 동일) |
| E8 | 첨부 PDF 등 비이미지 | 아이콘만 바뀌고 accept 목록은 그대로 |
| E9 | 콘솔 문구 VI 입력 | 저장됨(이전엔 EN/ES/KO만 전송돼 VI가 조용히 유실) |
| E10 | 패키지 가져오기(구 패키지, 새 키 없음) | 새 키 없이 복원, 오류 없음 |

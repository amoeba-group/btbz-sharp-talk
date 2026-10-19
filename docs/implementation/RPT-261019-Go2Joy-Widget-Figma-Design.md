# RPT-261019 — go2joy 위젯 Figma(Chat HA) 반영: 구현·스테이징 적용 결과

- 근거: [REQ-261019](../analysis/REQ-261019-Go2Joy-Widget-Figma-Design.md) · [PLN-261019](../plan/PLN-261019-Go2Joy-Widget-Figma-Design.md)(2026-10-19 승인, 권장안 D1~D7) · [TCR-261019](../test/TCR-261019-Go2Joy-Widget-Figma-Design.md)
- 캡처: `docs/log/2026-10-19/`(gitignored) — Figma 4장, 스테이징 전/후 5장

## 1. 배포 상태

| 항목 | 값 |
|---|---|
| PR | **#650** `feat(widget): 마스코트 런처·인사 말풍선·아바타 메시지를 테넌트 옵션으로 (PLN-261019)` — squash merge |
| main SHA | `e54e745` (2026-10-19) |
| CI | 1차 실패(로더 SDK 계약 테스트가 `localStorage.setItem(LAUNCHER_KEY` 한 줄을 기대 — 줄바꿈 리팩터가 깨뜨림) → `74dedb1`로 수정 후 통과 |
| 스테이징 | 2026-10-19 11:14(KST) `deploy-staging.sh` — api/web/widget 재빌드, `Nest application successfully started`, 컨테이너 Up |
| 스키마 | 변경 없음(JSON 컬럼 키 추가만). SQL 마이그레이션 없음 |
| go2joy 설정(P1+P5) | 스테이징 테넌트 4에 SQL로 적용(아래 §3) — 콘솔 로그인 없이 진행했으므로 **감사 로그 없음** |
| 프로덕션 | **대상 없음** — go2joy 프로덕션 테넌트 미생성. 생성 시 패키지 가져오기 + 테마/문구 설정으로 이관 |

## 2. 변경 내용 (코드, PR #650)

| 영역 | 내용 |
|---|---|
| `packages/types` | `WidgetLauncher.style`(button/bare)·`teaser {enabled, delaySec 0~30}`·`TEASER_FRAME_WIDTH=360`; `WidgetDesign.headerLayout / messageStyle / attachIcon / icons{botAvatar,agentAvatar}`(`ICON_SLOTS`); `WidgetCopy`에 `headerTitle aiSenderName agentSenderName launcherTeaser`; `WidgetCopyText`에 VI/JA/ZH; `WIDGET_COPY_DEFAULTS.launcherTeaser` 6언어. 정규화는 **기본값이면 저장하지 않음**(구 JSON과 동일), bare는 `design.launcherIcon` 없으면 제거 |
| 위젯 | `Widget.tsx` 런처 bare + 인사 말풍선(지연·세션 1회 `ivy:teaser-seen`·X·클릭=열기·배지는 페이지 쪽) · `useLauncherReport` `closed {w,h}` 보고 · `WidgetPanel` `logo-title` + 언어별 제목 + `.st-header-control` · `MessageBubble` 아바타 행(`st-avatar`/`st-sender`, 슬롯 없으면 lucide Bot/User) · `ChatTab` 첨부 아이콘 프리셋 `.st-attach`, 후속·폴백 칩 `.st-quick-reply` · `CsatCard` `.st-csat*` · 공용 `lib/copy.ts`(pickCopy/fill) · a11y `closeTeaser` 6언어 |
| 로더 `embed.js` | `applyLauncher`가 `next.closed`를 클램프(폭 ≤360, 높이 ≤160, 하한=버튼)해 `CLOSED`에 적용, localStorage에는 `closed` 미저장 |
| API | 문구 DTO 24필드(`{bag}_{lang}`), `mergeWidgetCopy` 4 bag(빈 bag은 키 삭제), 세션 `widgetCopy` 전달, `resolveDesign` 5필드(아바타 uuid는 아이콘 자산 소유 검증), 패키지 export/import가 아바타 자산·파일 없는 옵션 동봉(가져오기가 `quickReplyStyle`·`reviewLinkTemplate`을 버리던 것도 수정) |
| 콘솔 | 테마 카드: 런처 스타일 라디오·인사 말풍선 토글/지연 · 편집기: 헤더 레이아웃·메시지 스타일·AI/상담원 아바타·첨부 아이콘 · 문구 카드: 4행(공용 언어 탭) · `copyWire()`가 **6언어 전부 전송**(이전엔 EN/ES/KO만 보내 VI/JA/ZH 인사말이 저장되지 않던 결함) · settings.json 6언어 |
| 매뉴얼 | 05 커스텀 위젯 **v1.1** ko/en/vi md+html — 2.1 필드 4행, 3.2-2 런처 스타일·인사 말풍선, 5.1 훅 5행(en/vi엔 빠져 있던 빠른 답장 스타일 행도 추가) |

파일 44개, +1,129/−120 (+ 로더 수정 1건).

## 3. go2joy 스테이징 적용값 (테넌트 4)

| 항목 | 값 |
|---|---|
| 테마 | brand `#1570EF` · header **brand** · logo = 흰 G2J 모노그램(id `02a4fab6…`, 96×96, 현행 주황 로고에서 추출) · launcher right/**lg**/chat + **style bare** + teaser on 3s |
| 디자인 #7 | Inter 14 · 404×600 · radius **lg** · launcherIcon = JoyBot 128px(`8ed3fc76…`) · headerLayout logo-title · messageStyle avatar · botAvatar = JoyBot 64px(`ecfff310…`) · attachIcon image · customCss(고객 말풍선 primary-100+짙은 글자, 봇 말풍선 #F2F4F7, 입력창·칩 외곽선 #D0D5DD) |
| CSS 애드온 | `custom_css_enabled = 1` |
| 문구 | headerTitle VI "Trung tâm hỗ trợ"/EN "Support center"/KO · aiSenderName "JoyBot - Tổng đài viên AI"/"JoyBot - AI Operator" · agentSenderName "Nhân viên hỗ trợ Go2Joy"/"Go2Joy Support" · launcherTeaser "Xin chào! JoyBot sẵn sàng hỗ trợ bạn!"/"Hi! JoyBot is ready to help you!" |
| 임베드 오리진 | + `https://go2joy-ha-uat.go2joy.io` |
| 자산 | `tenant_assets` 2행(임시 라벨 "(temp)") + 볼륨 `tenants/4/design/*.png`, 로고 `4/branding/02a4fab6….png` |

에이전트 `hotel-partner`의 `display_name = "Hotel Partner"`는 그대로 두었다 — `headerTitle`이 헤더 제목을 우선하므로 화면엔 영향 없고, `{shop}` 치환에만 쓰인다.

## 4. 실측 결과 (TCR 대응)

| ID | 결과 |
|---|---|
| U1~U16 | 자동 통과 — types 168 · api tenant/session 150 · widget node --test 48 · 전체 CI 2,277(1회 실패 후 수정) |
| I1 | 배포 전 세션 응답: brand·header·로고·launcher lg·design(inter/lg/launcherIcon/customCss) 전달, 새 키는 구 API가 제거 — **P1만으로도 색·서체·모서리·런처 그림 반영** 확인(캡처 `staging-before-deploy-p1-launcher.jpg`: 파란 원 안에 마스코트) |
| I2 | 배포 후: `launcher.style:'bare'`·`teaser`·`design.{headerLayout,messageStyle,attachIcon,icons}`·`widgetCopy.{headerTitle,aiSenderName,agentSenderName,launcherTeaser}` 전달 ✓ |
| I3 | `/widget/embed.js`에 `next.closed` 3곳 ✓ |
| I4 | 자산 2건·로고 200 image/png ✓ |
| I5 | 로컬 점검 페이지(go2joy 스니펫 그대로, 스테이징 로더) — 마스코트 64px 원·그림자 없음, 3초 뒤 파란 말풍선 ✓ (`staging-after-launcher-teaser.png`) |
| I6 | 말풍선 X → 사라짐, iframe `112px × 112px` 복귀, 페이지 버튼 클릭 정상 ✓; 같은 탭 새로고침 시 말풍선 재표시 없음 ✓ |
| I7 | 말풍선 클릭 → 패널 열림 ✓ |
| I8 | 파란 헤더 · 흰 모노그램 + "Trung tâm hỗ trợ" · 🌐VI · ⚙ · X ✓ (`staging-after-panel-open.jpg`) |
| I9 | 마스코트 아바타 + "JoyBot - Tổng đài viên AI" + 연회색 말풍선 ✓ |
| I10 | 상담원 메시지 — 실제 상담원 응답 없이 미실측(코드·단위 테스트로 폴백 확인) |
| I11 | 고객 말풍선 — 테스트 메시지 발송은 go2joy 대화 생성·AI 크레딧 소모라 **미발송**, CSS 규칙만 확인 |
| I12 | 이미지 아이콘·pill 입력·원형 전송(비활성 연파랑) ✓ (`staging-after-chips-composer.png`) |
| I13 | EN 전환: "Support center" · "JoyBot - AI Operator" ✓ (`staging-after-panel-en.png`) |
| I14 | 앱 모드 — 코드 경로(`isAppMode()` → 런처·말풍선 미렌더) 유지, 실기기 미실측 |
| I15 | ivyusa — 새 키 기본값 = 현행 렌더(단위 테스트 U3·U5·U7), 화면 미실측 |
| I16 | 콘솔 — 타입체크·빌드 통과, 화면 클릭 미실측(콘솔 로그인 미진행) |

## 5. 발견·수정한 결함

| # | 내용 | 처리 |
|---|---|---|
| F1 | 콘솔 문구 저장이 EN/ES/KO만 전송 → VI/JA/ZH 인사말 유실 | `copyWire()` 6언어 전송 |
| F2 | 패키지 가져오기가 `quickReplyStyle`·`reviewLinkTemplate` 폐기 | 동봉 |
| F3 | CI: 로더 SDK 계약 테스트가 특정 문자열 의존 | 한 줄 유지(`74dedb1`) |
| F4 | SQL 적용 시 `mysql` 기본 charset(latin1)으로 VI/KO 문구가 깨짐 | `--default-character-set=utf8mb4`로 재적용 — **스테이징 SQL은 항상 utf8mb4 지정** |
| F5 | 시나리오 칩에 `border-color`만 줘서 외곽선이 안 보임(chip 스타일은 border 0) | `border: 1px solid` |
| F6 | 매뉴얼 en/vi 2.1 표에 빠른 답장 스타일 행이 없었음(PLN-260916 이후 미반영) | 추가 |

## 6. 남은 일

- **Go2Joy 에셋**: 현재 마스코트·아바타는 Figma 화면 캡처 → 배경 키잉(PNG 128/64px), 모노그램은 주황 로고에서 추출한 임시본. 정식 PNG(마스코트 128px 투명, 상담원 아바타 56px, 흰 모노그램 32px 이상)를 받으면 콘솔 디자인 파일에 올리고 편집기에서 교체(코드 무관).
- **상담원 아바타**: 현재 기본 아이콘(lucide User). 에셋 수령 후 `agentAvatar` 슬롯 지정.
- **AI 이름 확인**: 기존 인사말은 "Joydesk", Figma는 "JoyBot". `aiSenderName`은 Figma대로 두었으니 Go2Joy 확인 필요.
- **UAT 페이지 실측**: 스니펫·오리진·세션 응답은 확인했고 화면은 로컬 점검 페이지(동일 스니펫)로 확인. `go2joy-ha-uat.go2joy.io`에서의 눈 확인은 운영자 몫.
- **감사 로그**: SQL 직접 적용이라 테마·CSS 애드온·문구 변경 감사 행이 없다. 콘솔에서 한 번 저장하면 정규 경로로 기록된다.
- 만족도 3문항(D5)·AI 고지 하단 배치(D4)는 별도 REQ.

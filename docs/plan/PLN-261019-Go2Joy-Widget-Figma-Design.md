# PLN-261019 — go2joy 위젯 Figma(Chat HA) 반영: 마스코트 런처·인사 말풍선·아바타 메시지를 테넌트 옵션으로

- 근거: [REQ-261019-Go2Joy-Widget-Figma-Design](../analysis/REQ-261019-Go2Joy-Widget-Figma-Design.md)
- **UI 변경 있음**(§4 와이어프레임). **스키마 변경 없음**(JSON 컬럼 추가 키만, SQL 없음).
- 전제 결정(REQ §6 제안대로): D1 플로팅 런처 · D2 `headerTitle` 새 키 · D3 톱니 유지 · D4 고지 상단 유지 ·
  D5 만족도 3문항은 별도 REQ · D6 에셋은 Go2Joy 제공(임시 PNG로 선검증) · D7 아바타 2종 + 첨부 프리셋
- 상태: **승인됨(2026-10-19, 권장안 그대로 D1~D7)** → 구현 진행

## 1. 단계

### P1 — 설정만으로 근접 (코드 없음, 스테이징 go2joy 즉시)
| 항목 | 값 | 경로 |
|---|---|---|
| 브랜드색 · 헤더 | `#1570EF` · **brand** | 설정 > 위젯 설정 > 위젯 테마 |
| 로고 | 흰 "G2J" 모노그램 PNG(높이 32 기준, 투명 배경) — 받기 전엔 현재 로고 유지 | 같은 카드 |
| 커스텀 위젯 #7 | 폰트 **Inter** · 모서리 **lg(16)** · 패널 404×600 유지 · 아이콘 파일 = 마스코트 PNG | 커스텀 위젯 > 편집 → [저장 후 사용함] |
| CSS 애드온 | 어드민 > 테넌트 go2joy > 요금제/애드온 > **커스텀 위젯 CSS 허용** ON | 어드민 콘솔 |
| 정제 CSS | 아래 블록 | 편집기 CSS 칸 → [검사] → 저장 |
| 표시명 | "Trung tâm hỗ trợ"(P3에서 `headerTitle`로 이관). **실측: UAT 스니펫의 에이전트 `hotel-partner`(id 10, 기본)는 `display_name = "Hotel Partner"`라 지금 헤더 제목이 이 값**(세션이 에이전트명을 우선) → 에이전트 표시명을 "Trung tâm hỗ trợ"로 바꾸거나 비운다 | 문구 카드 · AI 에이전트 |
| 임베드 오리진 | `https://go2joy-ha-uat.go2joy.io` 추가(기존 2개 유지) | 설정 > 임베드 |

```css
.st-message-user { background-color: var(--ivy-primary-100); color: #111827; }
.st-message-bot  { background-color: #F2F4F7; color: #1F2937; }
.st-send         { border-radius: 999px; }
.st-input        { border-color: #D0D5DD; }
.st-quick-reply  { background-color: #fff; border-color: #D0D5DD; color: #344054; }
```
P1 결과 = 색·모서리·서체·말풍선 색·런처 그림까지 일치. 남는 차이 = 런처 원/그림자, 인사 말풍선, 아바타/발신자명,
헤더 모노그램+제목 동시 표시, 첨부 아이콘.

### P2 — 런처 스타일 `bare` + 인사 말풍선 (G4·G5)
- `packages/types` `WidgetLauncher`에 추가: `style?: 'button' | 'bare'`(기본 button), `teaser?: { enabled: boolean; delaySec?: number(0~30, 기본 3) }`. `normalizeLauncher`가 범위 밖 값을 기본으로.
- `widget_copy`에 `launcherTeaser: Record<LangCode,string>` 추가(기본값 `WIDGET_COPY_DEFAULTS.launcherTeaser` 6언어: "Hi! {shop} support is ready to help." 계열). 세션 `widgetCopy` 조립(session.service)과 콘솔 문구 카드에 한 줄 추가.
- `Widget.tsx` 런처: `bare`면 `bg/shadow/hover:scale` 제거, 버튼 크기 = 아이콘 크기(sm 48 / md 56 / lg 64 그대로), 배지는 **페이지 쪽 모서리**(right 런처 → 좌상단). 커스텀 아이콘 없이 `bare`를 고르면 `button`으로 그린다(빈 투명 버튼 방지, normalize에서 강제).
- 말풍선: 런처 옆 pill(브랜드 채움·`text-on-primary`·`rounded-full`·그림자). 표시 조건 = 패널 닫힘 **and** `teaser.enabled` **and** 세션에서 닫은 적 없음(`sessionStorage ivy:teaser:{shop}`) **and** 앱 모드·트리거 모드 아님. 클릭 = 패널 열기, 작은 X = 닫기(세션 기억). `delaySec` 뒤에 나타남.
- 닫힘 프레임: `useLauncherReport`가 `frame.closed = { w, h }`를 보고 → `embed.js applyLauncher`가 `CLOSED`를 그 값으로(말풍선 있으면 폭 최대 **360px**, 없으면 현행 정사각). 말풍선 닫힘 → 위젯이 재보고 → 프레임이 다시 줄어 **페이지 클릭을 가로채지 않음**(FIX-260916 교훈: 프레임이 보이지 않는 영역을 덮으면 안 됨). 구 로더(캐시) 호환: `closed`가 없으면 현행 계산.
- 콘솔 테마 카드: 런처 스타일 라디오 + 인사 말풍선 토글/지연 초. i18n 6언어. `npm run i18n:check`.
- 테스트: `widget-theme.spec`(normalize: style/teaser 기본·범위·bare without icon → button), 위젯 런처 스펙(bare 클래스·배지 위치·teaser 표시/닫힘/세션 기억), embed `trigger-test.html`류 수동 페이지에 teaser 케이스 추가.

### P3 — 헤더 `logo-title` + 언어별 제목, 메시지 `avatar` 스타일 (G6·G7·G9·G11)
- `WidgetDesign`에 추가: `headerLayout?: 'logo' | 'logo-title'`(기본 logo = 현행 "로고가 있으면 로고만"), `messageStyle?: 'plain' | 'avatar'`(기본 plain), `icons?: { botAvatar?: AssetRef; agentAvatar?: AssetRef }`(`AssetRef = {uuid, version}` — `launcherIcon`과 동일 형태·검증·공개 URL `assetUrl()`).
- `widget_copy`에 추가: `headerTitle`(6언어, 비면 displayName), `aiSenderName`(6언어, 비면 에이전트 `display_name` → 테넌트 displayName), `agentSenderName`(6언어, 비면 상담원 실명 = 현행).
- `WidgetPanel` 헤더: `logo-title`이면 `<img>` + `.st-header-title` 둘 다(로고 높이 24 캡, 제목 truncate). 언어 pill·톱니·X에 `.st-header-control` 훅.
- `MessageBubble`: `avatar`면 AI/상담원 행 = 좌측 28px 원형 `<img>`(슬롯 없으면 lucide `Bot`/`User` 폴백, `bg-primary-100 text-primary-600`) + 말풍선 첫 줄 `.st-sender`(`text-primary-600 font-semibold text-xs`) + 본문. 고객 메시지는 변화 없음. 시스템 메시지는 아바타 없음.
- 자산: `tenant_assets` kind `icon` 그대로(PNG/WebP 256KB·512px). 디자인 편집기에 "봇 아바타 / 상담원 아바타" 선택란(아이콘 파일과 같은 드롭다운).
- 패키지 내보내기/가져오기·디자인 이력·설정 스냅샷: `launcherIcon`을 동봉하는 자리에 `icons.*`도 동봉(`widget-design.service` export/import의 자산 수집 루프를 슬롯 배열로 일반화).
- 라이브 파일(`widget-live.service`)·`preview-theme`: 추가 키 통과(정규화가 걸러 주므로 코드는 `normalizeDesign` 확장만).
- 테스트: normalize 스펙(새 키 기본·불량 AssetRef 제거), MessageBubble 스펙(plain/avatar·슬롯 유무·sender 문구 폴백 순서), session.service 스펙(widgetCopy 조립 폴백 순서), export/import 라운드트립(아바타 2종 동봉).

### P4 — 첨부 아이콘 프리셋 + CSS 훅 + 문서 (G13·G12·G15 색)
- `WidgetDesign.attachIcon?: 'paperclip' | 'image'`(기본 paperclip). `ChatTab` 첨부 버튼에 `.st-attach`, lucide `Image` 분기.
- 훅 추가(클래스만, 스타일 변화 없음): 후속·폴백 칩 `.st-quick-reply`, 만족도 카드 `.st-csat` `.st-csat-option` `.st-csat-submit`. `css-sanitizer`의 허용 선택자 목록(`.st-*` 패턴)은 이미 와일드카드라 변경 없음 — 매뉴얼 5.1 표에 행 추가.
- 콘솔 편집기 필드: 헤더 레이아웃·메시지 스타일·아바타 2종·첨부 아이콘(P3·P4 통합 1회 UI 변경).
- 매뉴얼 05(ko/en/vi md + 변환기 `scripts/manual-md2html.mjs`) 2.1 필드 표·5.1 훅 표 갱신, 캡처 2장(편집기·아바타 메시지).

### P5 — go2joy 적용·검증·RPT
- 스테이징 go2joy: P1 값 위에 `style: bare`·말풍선 ON·`logo-title`·`avatar`·아바타 2종·`attachIcon: image`·문구(VI/EN) 저장 → [사용함] → **UAT 페이지(`go2joy-ha-uat.go2joy.io/homepage`) 실측**(데스크톱 + 휴대폰 폭) — 콘솔 미리보기만으로 끝내지 않음(iframe-media-query 교훈).
- 확인 항목: 말풍선 닫은 뒤 프레임 폭 복귀(페이지 버튼 클릭 가능), 배지 위치, 앱 모드(`?mode=app`)에서 런처·말풍선 없음, 다른 테넌트(ivyusa 트리거 모드) 무변화, i18n:check 0건.
- RPT-261019 + 메모리. 프로덕션은 go2joy 프로덕션 테넌트가 없어 **대상 없음**(생성 시 패키지 가져오기로 이관).

## 2. 사이드 임팩트
| 영역 | 영향 | 대응 |
|---|---|---|
| 다른 테넌트 | 새 키 전부 기본값 = 현행 렌더 | normalize 기본값 테스트로 고정, ivyusa 스테이징 비교 캡처 |
| embed.js 캐시 | 구 로더가 새 `closed` 필드를 모름 → 말풍선이 프레임 밖으로 잘림(기능은 정상) | 로더가 `closed` 없을 때 현행 계산 유지, 새 로더는 `Cache-Control` 정책 그대로(배포 후 새로고침) |
| 페이지 클릭 가로채기 | 말풍선 때문에 닫힘 프레임이 넓어짐 | 말풍선 숨김 시 즉시 재보고로 축소, 프레임 `pointer-events`는 변경하지 않음(iframe은 통과 불가) |
| 세션 `widgetCopy` 응답 | 키 4개 추가 | 위젯 타입 동반 갱신, 구 위젯은 무시 |
| 디자인 이력·패키지·스냅샷 | 새 키·아바타 자산 | 동봉 루프 일반화 + 라운드트립 테스트 |
| CSS 애드온 | go2joy ON 필요 | 어드민 1회 토글(감사 로그) |
| 번들 | lucide `Bot`/`User`/`Image` 추가(수 KB) | — |
| AI 에이전트 `display_name` | 헤더 제목을 덮음 | `headerTitle`이 있으면 그것이 우선(폴백 순서 문서화) |

## 3. 리스크
- **에셋 지연**: Go2Joy PNG가 늦으면 임시 마스코트로 코드 검증, 실제 에셋은 설정 교체만(코드 무관).
- **말풍선 접근성**: 자동 표시 요소 — `role="status"`, 포커스 훔치지 않음, Esc로 닫힘.
- **bare 런처 대비**: 투명 배경 위 마스코트가 페이지 색과 겹칠 수 있음 → 테넌트 책임(매뉴얼 팁), 기본은 button.
- **헤더 폭**: 모노그램 + 긴 제목 + 컨트롤 3개가 360px 패널에서 겹칠 수 있음 → 제목 truncate, 모노그램 24px 캡.

## 4. 와이어프레임

```
① 런처 (닫힘 프레임)                       현재(button)            변경 후(bare + 말풍선)
┌─────────────────────────────────────┐   ┌──────┐            ┌──────────────────────────────────┐
│ 페이지                               │   │ (●)  │ 파란 원     │ [Xin chào! JoyBot sẵn sàng…] (x) ✦🤖 │ 프레임 폭 ≤360
│                                     │   │  💬  │ +그림자     │                         9+ 배지 좌상 │
└─────────────────────────────────────┘   └──────┘            └──────────────────────────────────┘
   말풍선 (x) 또는 세션 1회 뒤 →  ┌────┐  프레임 다시 정사각
                                 │✦🤖 │
                                 └────┘
② 헤더                      현재(logo)                         변경 후(logo-title)
┌──────────────────────────────────┐   ┌──────────────────────────────────────────┐
│ [로고 이미지 max-h-8]  🌐VI ⚙ X  │   │ G2J  Trung tâm hỗ trợ         (🌐VI)(⚙)(X)│ 브랜드 배경
└──────────────────────────────────┘   └──────────────────────────────────────────┘
                                         ↑24px 모노그램  ↑headerTitle[lang] ∥ displayName   ↑.st-header-control
③ 메시지                   현재(plain)                          변경 후(avatar)
 ┌────────────────────────┐             ┌──┐┌─────────────────────────────┐
 │ Xin chào, mình là …    │  (이름 없음)  │🤖││ JoyBot - Tổng đài viên AI    │ .st-sender (brand, bold)
 └────────────────────────┘             └──┘│ Xin chào, mình là trợ lý …  │ .st-message-bot (#F2F4F7)
                                            └─────────────────────────────┘
          ┌──────────────────────────┐                    ┌──────────────────────────┐
          │ Mình muốn hỏi về …(흰 글자)│  브랜드 채움          │ Mình muốn hỏi về …(짙은 글자)│ .st-message-user (primary-100, CSS)
          └──────────────────────────┘                    └──────────────────────────┘
 Hoàng Anh (회색 11px)                    ┌──┐┌─────────────────────────────┐
 ┌────────────────────────┐              │👩││ Nhân viên hỗ trợ Go2Joy      │ agentSenderName[lang] ∥ 실명
 │ Dạ, em là Hoàng Anh …  │              └──┘│ Dạ, em là Hoàng Anh …        │
 └────────────────────────┘                  └─────────────────────────────┘
④ 입력부                   현재                                 변경 후(attachIcon: image)
 [📎] (Type a message……………) (➤)           [🖼] (Nhập tin nhắn……………) (➤)   .st-attach / .st-input / .st-send
⑤ 콘솔 — 위젯 테마 카드(런처 블록)                  콘솔 — 커스텀 위젯 편집기(추가 필드)
 런처 위치  (●우) ( 좌)                             헤더 레이아웃   (●로고만) ( 로고+제목)
 런처 크기  ( sm)(●md)( lg)                          메시지 스타일   (●기본) ( 아바타+발신자명)
 런처 아이콘 [chat ▾]                                봇 아바타      [디자인 파일 ▾]   상담원 아바타 [디자인 파일 ▾]
 런처 스타일 (●버튼) ( 아이콘만)  ← 신규              첨부 아이콘     (●클립) ( 이미지)
 인사 말풍선 [ ] 표시   지연 [3]초 ← 신규(문구는 문구 카드)
⑥ 콘솔 — 문구 카드(추가 행, 6언어 탭)
 헤더 제목 ……… | AI 발신자명 ……… | 상담원 발신자명 ……… | 런처 인사 말풍선 ………
```

## 5. 승인 요청
- P1은 설정 변경만이라 승인 즉시 스테이징에 적용 가능(되돌리기 = 설정 스냅샷). P2~P4가 코드.
- 결정 D1~D7 중 다른 선택이 있으면 알려 주세요. 특히 **D1(진입 방식)** 과 **D5(만족도 3문항 분리)**.
- 에셋(마스코트·아바타 2종·흰 모노그램 PNG)은 Go2Joy에 요청이 필요합니다.

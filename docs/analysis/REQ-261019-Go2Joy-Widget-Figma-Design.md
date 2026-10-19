# REQ-261019 — go2joy 위젯을 Figma(Chat HA) 디자인에 맞춤: 아이콘·색을 커스텀 위젯으로

- 요청(2026-10-19): "https://go2joy-ha-uat.go2joy.io/homepage — go2joy 테넌트의 위젯을 아래 피그마 디자인
  화면 참조하여 아이콘과 칼러 등을 커스텀 위젯으로 구현한다."
- Figma: `https://www.figma.com/design/zno1SuNOoXjYtAh6P8pw98/-Design--Chat-HA` node `4417-44833`
  (Frame 427321542). 익명 보기 전용이라 **인스펙트·에셋 내보내기 불가** — 색·치수는 화면 관찰값이고,
  주색은 go2joy HA 앱 CSS(`app-v24.1.0.*.css`)에서 교차 확인했다.
- 조사 기준: main `c676353`(2026-10-19) · 스테이징 테넌트 4(go2joy) 실측 · UAT 페이지 HTML 실측
- 원칙(REQ-260916과 동일): **go2joy 하드코딩 금지** — 전부 테넌트 설정(테마·커스텀 위젯·문구·CSS)으로
  표현하고, 코드 변경은 모든 테넌트가 고를 수 있는 옵션으로 넣는다.
- 선행: [REQ-260916-Ivyusa-Widget-Figma-Design](REQ-260916-Ivyusa-Widget-Figma-Design.md)(ivyusa 동일
  작업, 런처 트리거·카드 칩·CSS 애드온이 그때 생김) · [GUIDE-260920-Ivyusa-Custom-Widget-Apply](../guide/GUIDE-260920-Ivyusa-Custom-Widget-Apply.md)
  · 매뉴얼 05 `apps/web/public/manual/custom-widget.ko.md`

---

## 1. Figma 디자인 요약 (관찰 사실, 2026-10-19)

프레임 구성: HA 콘솔(예약 상세) 4장 + 위젯 단독 3장(VI 만족도 짧은 버전 · VI 불만족 사유 버전 · EN).

| 영역 | 디자인 |
|---|---|
| **진입** | HA 콘솔 **우하단 플로팅 런처** = JoyBot 마스코트(파란 원 안 반짝임 ✦ + 원 아래로 삐져나온 흰 로봇 얼굴, 약 64px, **버튼 원·그림자 없음**). 3상태: ① 마스코트만 ② **빨간 "9+" 배지(좌상단)** ③ 배지 + 왼쪽에 **인사 말풍선 pill** "Xin chào! JoyBot sẵn sàng hỗ trợ bạn!"(브랜드 채움·흰 글자·완전 둥근) |
| **콘솔 헤더** | 앱 자체 아이콘 3개(QR · 말풍선 **6** · 종 **9+**). 말풍선 배지는 HA 앱의 "Quản lý tin nhắn"(고객 메시지)로 보임 — 위젯 트리거로 쓰라는 표시 없음(→ D1) |
| **열린 패널** | 약 **400 × 600**, 우하단(여백 16), **모서리 16**, 흰 배경, 열려 있는 동안 런처 없음 |
| **헤더** | **브랜드 파랑 배경**. 좌: 흰 **"G2J" 모노그램** + 굵은 흰 제목 **"Trung tâm hỗ trợ"**(EN 프레임은 "Support center"). 우: 언어 pill **"🌐 VI"**(반투명 흰 둥근) + **X**(반투명 흰 원). **톱니(설정) 없음** |
| **AI 메시지** | 좌측 **아바타**(JoyBot 마스코트 원형 28px) + 말풍선 안 첫 줄 **발신자명** "JoyBot - Tổng đài viên AI"(브랜드색 굵은 12px) + 본문. 말풍선 연회색(≈`#F2F4F7`), 모서리 12 |
| **상담원 메시지** | 같은 구조. 아바타 = 사람 일러스트, 발신자명 **"Nhân viên hỗ trợ Go2Joy"**(일반 호칭 — 본문에서 "em là Hoàng Anh"로 자기소개) |
| **고객 메시지** | 우측, **연파랑 채움(≈`#D1E9FF`) + 짙은 글자**, 아바타·이름 없음 |
| **칩** | "Chat với chăm sóc khách sạn" — 흰 배경·회색 외곽선·짙은 글자·완전 둥근 pill(현행 후속 칩과 같은 꼴) |
| **만족도 카드** | 제목 "Khảo sát mức độ hài lòng" + X · Q1 라디오(처리됨/미처리) · Q2 **이모지 5단 세그먼트 박스**(선택=연파랑 칸) + 라벨 · (불만족 시) Q3 사유 라디오 4개 + "Lý do khác" 텍스트영역 0/50 · 전폭 브랜드 버튼 "Gửi phản hồi" |
| **입력부** | 좌 **이미지 아이콘**(둥근 사각 외곽선, 회색) · pill 입력 "Nhập tin nhắn" · 우 **원형 전송**(종이비행기, 비활성=연파랑) · 아래 작은 회색 중앙 문구 "Được tạo bởi AI, áp dụng **điều khoản dịch vụ**"(밑줄 링크) |
| **서체·색** | Inter 계열 14px(Untitled UI 체계). 주색 **`#1570EF`**(HA 앱 CSS primary, 버튼·헤더·발신자명·전송), 회색 `#475467`/`#667085`, 배지 빨강 `#F04438` |

> 캡처는 세션 로그 `docs/log/2026-10-19/`에 보관(gitignored). 에셋(마스코트·아바타·모노그램)은 익명 보기로
> 내보낼 수 없어 **Go2Joy 측 PNG 제공이 필요**(→ D6).

## 2. AS-IS (스테이징 go2joy = 테넌트 4, 2026-10-19 실측)

| 영역 | 현재 |
|---|---|
| 테마 카드 | 브랜드 **`#F9CCAE`**(살구색 — 디자인과 무관, 테스트 잔재로 보임), 헤더 **white**, 로고 PNG 206×76 업로드됨(주황 워드마크로 추정), 런처 `chat`/`md`/`right`(**플로팅**) |
| 커스텀 위젯 | 디자인 #7 "Go2Joy Support" **사용 중** — pretendard 14 · 404×600 · 모서리 **sm(8)**. 아이콘 파일 없음, CSS 없음 |
| CSS 애드온 | `custom_css_enabled = 0` (어드민이 켜야 편집기에 CSS 칸이 보임) |
| 탭·문구 | 탭 `["chat"]` 상단 · `displayName` "Go2Joy Support"(단일 문자열, 언어별 아님) · 인사말 기본값. 단 UAT 스니펫의 에이전트 `hotel-partner`(id 10, 기본 에이전트)는 `display_name = "Hotel Partner"`라 **실제 헤더 제목은 "Hotel Partner"** |
| 임베드 | UAT 페이지 스니펫: `shop: "https://www.go2joy.vn"`, `agent: "hotel-partner"`, 로더 `shoptalk.amoeba.site/widget/embed.js`. **`embed_origins`에 `go2joy-ha-uat.go2joy.io` 없음**(관측 모드라 지금은 뜸) |
| 위젯 렌더 | 런처 = **브랜드 원 + 그림자 + lucide 아이콘**(업로드 PNG는 원 안에 그려짐) · 배지 우상단 · **인사 말풍선 없음** · 헤더 = 로고가 있으면 **제목 대신** 로고, 언어 pill(🌐+코드 ✓) + **톱니** + X · 메시지 = 아바타 없음, 상담원만 이름(회색 11px), **AI 메시지 이름 없음** · 고객 말풍선 **브랜드 채움 + 흰 글자** · 후속 칩 흰/회색 외곽선 ✓ · 입력부 클립 아이콘 + pill + 원형 전송 ✓ · AI 고지 = **상단 바**(✦ + 처리 지역 문구 + 상담 종료 링크) · 만족도 = **이모지 5단 1문항** |
| 모바일 앱(Kotlin SDK) | `?mode=app` → 런처·말풍선 없음, 패널 전체 화면. 헤더·색·아바타는 그대로 적용됨 |
| 바꿀 수 있는 레버 | 테마 카드(브랜드색·헤더 흰/브랜드·로고·런처 위치/크기/아이콘/모드) · 커스텀 위젯(폰트·크기·모서리·패널·**런처 아이콘 PNG**·칩/카드·정제 CSS) · 문구(표시명·인사말 6언어) · 정제 CSS `.st-*` 13지점(색·폰트·간격·테두리·그림자만, `url()`·`display` 불가) |

## 3. 갭 분석 — 설정으로 되는 것 / 코드가 필요한 것

| # | 갭 | 층 | 해소 |
|---|---|---|---|
| G1 | 브랜드 `#1570EF`, 헤더 브랜드색 | 테마 카드 | **설정** |
| G2 | 모서리 16 · Inter · 404×600 유지 | 커스텀 위젯 #7 편집 | **설정** |
| G3 | 런처 = JoyBot 마스코트 PNG | 커스텀 위젯 아이콘 파일 | **설정**(PNG 업로드) — 단 원·그림자 안에 그려짐 → G4 |
| G4 | 런처 **버튼 원·그림자 없이 마스코트 자체가 버튼**, 배지 **안쪽(좌상단)** | 코드(Widget.tsx) | **코드 필요(소)** — 런처 스타일 옵션 `button \| bare`; bare면 배지는 페이지 쪽 모서리 |
| G5 | 런처 옆 **인사 말풍선 pill**(문구 6언어·세션당 1회 닫힘·클릭=열기) | 코드(위젯 + embed.js 닫힘 프레임 폭 + 문구 스키마) | **코드 필요(중)** — `launcher.teaser` 옵션 + `widget_copy.launcherTeaser` |
| G6 | 헤더에 **모노그램 + 제목 함께** | 코드(WidgetPanel 헤더) | **코드 필요(소)** — 헤더 레이아웃 옵션 `logo \| logo-title`; 모노그램 PNG는 로고 업로드(설정) |
| G7 | 헤더 제목 **언어별**("Trung tâm hỗ trợ"/"Support center") | 코드(문구 스키마) | **코드 필요(소)** — `widget_copy.headerTitle` 6언어 맵(비면 displayName) |
| G8 | 헤더 톱니 없음, 언어 pill·X 반투명 원형 | 위젯 | **톱니는 유지**(설정 패널 안에 동의 철회·알림 설정 = 법적·기능) → D3. 모양은 CSS: 컨트롤에 `.st-header-control` 훅 추가(코드 소) |
| G9 | AI·상담원 메시지에 **아바타 + 발신자명**(AI "JoyBot - …", 상담원 일반 호칭) | 코드(MessageBubble + 아이콘 슬롯 + 문구) | **코드 필요(중)** — 메시지 스타일 옵션 `plain \| avatar`, 아이콘 슬롯 `botAvatar`/`agentAvatar`(PNG, 자산 저장소), 문구 `aiSenderName`/`agentSenderName` 6언어 |
| G10 | 고객 말풍선 **연파랑 + 짙은 글자** | 정제 CSS `.st-message-user` | **설정**(어드민 CSS 애드온 ON) |
| G11 | 봇 말풍선 `#F2F4F7`, 발신자명 브랜드색 | 정제 CSS | **설정**(G9 이후 `.st-sender` 훅) |
| G12 | 후속·폴백 칩 모양 | 이미 일치 | 없음(CSS로 손보려면 `.st-quick-reply` 훅이 후속 칩에 없음 → 코드 소) |
| G13 | 입력부 첨부 아이콘 = **이미지 아이콘**(둥근 사각 외곽선) | 코드 | **코드 필요(소)** — 디자인 옵션 `attachIcon: paperclip \| image` + `.st-attach` 훅 |
| G14 | AI 고지 문구를 **입력부 아래 한 줄** + 약관 링크 | 위젯 | **유지 권장**(상단 바가 법적 고지 + 상담 종료를 겸함; 약관 URL 필드 없음) → D4 |
| G15 | 만족도 **3문항(처리 여부·이모지·불만족 사유)** | 기능 변경 | **범위 밖** — 별도 REQ(D5). 색만 CSS `.st-csat*` 훅(코드 소) |
| G16 | 모바일 앱 모드 | — | 갭 없음(런처·말풍선은 웹 임베드에만, 나머지는 공통) |
| G17 | UAT 오리진 미등록 | 운영 | **설정** — `embed_origins`에 `https://go2joy-ha-uat.go2joy.io` 추가 |
| G18 | 언어 pill "🌐 VI" | 이미 일치 | 없음 |

**결론**: 색·모서리·서체·런처 그림·말풍선 색은 **설정만으로** 오늘 가능(P1). 디자인의 핵심 인상인
**마스코트 런처(원 없음) + 인사 말풍선 + 아바타/발신자명 메시지**는 코드가 필요하며, 셋 다 ivyusa 때처럼
**모든 테넌트의 옵션**으로 넣는다.

## 4. 사용자 흐름 (TO-BE)

```
HA 콘솔(go2joy-ha-uat)                     [Xin chào! JoyBot sẵn sàng hỗ trợ bạn!] (9+)🤖  ← 플로팅 런처(bare) + 말풍선
                                                                             │ 클릭(말풍선 또는 마스코트)
                                                                             ▼
                                        ┌ 404×600, r16 ───────────────────────┐
                                        │ G2J Trung tâm hỗ trợ     (🌐VI)(⚙)(X)│  브랜드 헤더
                                        │ 🤖 JoyBot - Tổng đài viên AI        │  아바타+이름
                                        │    Xin chào, mình là trợ lý …        │  연회색
                                        │              Mình muốn hỏi về …      │  연파랑+짙은 글자
                                        │ (Chat với chăm sóc khách sạn)        │  칩
                                        │ 👩 Nhân viên hỗ trợ Go2Joy           │
                                        │ [🖼] (Nhập tin nhắn…………) (➤)         │
                                        └──────────────────────────────────────┘
콘솔: 설정 > 위젯 설정 > 위젯 테마   브랜드 #1570EF · 헤더 브랜드 · 로고(흰 모노그램) · 런처 스타일 bare · 인사 말풍선 ON
     설정 > 위젯 설정 > 디자인 파일  마스코트(런처)·봇 아바타·상담원 아바타 PNG 업로드
     설정 > 위젯 설정 > 커스텀 위젯  #7 편집: Inter · r16 · 아이콘 파일 · 메시지 스타일 avatar · 첨부 아이콘 image · CSS → [저장 후 사용함]
     설정 > 위젯 설정 > 문구        headerTitle · aiSenderName · agentSenderName · launcherTeaser (VI/EN …)
```

## 5. 제약·전제

| # | 내용 |
|---|---|
| C1 | **SVG 업로드 불가**(자산 검증 E5081) — 마스코트·아바타·모노그램은 PNG/WebP(아이콘 256KB·512px). 2× 해상도로 받는다 |
| C2 | 정제 CSS는 `.st-*` + 색·폰트·간격·테두리·그림자만 — 아이콘 교체·숨김·위치 이동은 CSS로 못 한다(그래서 G4·G5·G9·G13이 코드) |
| C3 | 런처·말풍선은 **iframe 안**에 그려지고 닫힘 프레임 크기는 로더(embed.js)가 잡는다 → 말풍선은 닫힘 프레임 폭을 넓혀야 하며, 말풍선을 닫으면 다시 좁혀야 페이지 클릭을 가로채지 않는다 |
| C4 | AI 고지(처리 지역)와 동의 철회 경로는 법적 요건 — 디자인에 없어도 유지(G8·G14) |
| C5 | `displayName`은 단일 문자열이며 **AI 에이전트 `display_name`이 헤더 제목을 덮는다**(session.service `widgetCopy.displayName`). 언어별 제목은 새 키로 두고 기존 키 형태를 바꾸지 않는다(기존 테넌트 데이터 무마이그레이션) |
| C6 | 모바일 앱(`mode=app`)에는 런처·말풍선이 없다 — G4·G5는 웹 임베드 전용 |
| C7 | 새 옵션의 **기본값 = 현행 렌더**(button · 말풍선 off · plain · paperclip · logo) — 다른 테넌트 화면 무변화 |
| C8 | 디자인 JSON·문구 JSON은 추가 키만(스키마 변경 없음, SQL 없음). 디자인 이력·패키지 내보내기·설정 스냅샷이 새 키와 아바타 자산을 **동봉**해야 한다(launcherIcon과 같은 취급) |

## 6. 미결 결정

| # | 결정 | 선택지 | 제안 |
|---|---|---|---|
| **D1** | 진입 방식 | ⓐ **플로팅 런처(디자인 프레임 1~3 그대로)** / ⓑ HA 헤더 말풍선 아이콘을 트리거로(런처 모드 trigger, 기존 기능) | **ⓐ** — 헤더 말풍선(배지 6)은 HA 앱 자체 메시지 기능으로 보임. Go2Joy가 ⓑ를 원하면 설정만 바꾸면 됨(코드 없음) |
| **D2** | 헤더 제목 언어별 | 새 키 `headerTitle`(6언어, 비면 displayName) / displayName 단일 유지("Trung tâm hỗ trợ"만) | **새 키** — EN 프레임이 있고 비용이 작다 |
| **D3** | 헤더 톱니 | 유지 / 숨김 옵션 | **유지** — 설정 패널에 동의 철회·알림 설정이 있다 |
| **D4** | AI 고지 위치 | 상단 바 유지 / 하단 한 줄 옵션 | **유지** — 이번 범위 밖, 필요 시 후속 |
| **D5** | 만족도 3문항 | 이번 포함 / 별도 REQ | **별도 REQ** — "아이콘·색" 요청 범위를 넘는 기능 변경(수집 데이터·통계 영향) |
| **D6** | 에셋 입수 | Go2Joy가 PNG 제공(마스코트 128px·아바타 56px·흰 모노그램 32px) / 우리가 임시 제작 | **Go2Joy 제공** 요청, 받기 전까지 임시 PNG로 스테이징 검증 |
| **D7** | 아이콘 슬롯 범위 | 아바타 2종만 / + 첨부·전송·닫기까지 PNG 슬롯 | **아바타 2종 + 첨부는 프리셋 2택** — 첨부·전송·닫기는 lucide와 디자인이 사실상 같고, PNG는 hover 색이 안 바뀐다 |

## 7. 범위 제안

| 단계 | 내용 | 코드 |
|---|---|---|
| P1 | 설정만으로 근접(스테이징 go2joy 즉시): 브랜드 `#1570EF`·헤더 brand·모노그램 로고·#7 편집(Inter·r16·마스코트 아이콘)·CSS 애드온 ON + 말풍선 색 CSS·`headerTitle`은 P3 전까지 displayName "Trung tâm hỗ trợ"·오리진 추가 | 없음 |
| P2 | 런처: `style: bare`(G4) + 인사 말풍선(G5) | 위젯·embed.js·types·콘솔 |
| P3 | 헤더 `logo-title` + `headerTitle`(G6·G7) · 메시지 `avatar` 스타일 + 아바타 슬롯 + 발신자명 문구(G9·G11) | 위젯·API 문구·types·콘솔 |
| P4 | 첨부 아이콘 프리셋(G13) + CSS 훅 추가(`.st-header-control` `.st-attach` `.st-sender` 후속 칩 `.st-quick-reply` `.st-csat*`) + 패키지/스냅샷 동봉 + 매뉴얼 05 갱신 | 위젯·API·문서 |
| P5 | go2joy 적용(스테이징 → UAT 페이지 실측 → 프로덕션은 go2joy 프로덕션 테넌트 생성 후) + RPT | 설정 |

## 8. 연관 지점

- 타입: `packages/types/src/common/widget-theme.ts`(`WidgetLauncher` :79, `WidgetDesign` :127, `normalize*`), `widget-copy.ts`
- 위젯: `components/widget/Widget.tsx:156-185`(런처) · `WidgetPanel.tsx:124-163`(헤더) · `chat/MessageBubble.tsx`(말풍선·발신자명) · `chat/ChatTab.tsx:355,419,496,640`(고지·칩·첨부) · `hooks/useLauncherReport.ts` · `public/embed.js:346-397,523-539`(닫힘/열림 프레임)
- API: `domain/session/session.service.ts:619-634`(widgetCopy 조립) · `domain/tenant/widget-live.service.ts`(라이브 파일) · `widget-design.service.ts`(apply/export/import) · `tenant-asset/`(아이콘 자산)
- 콘솔: `domain/settings/SettingsPage.tsx:867`(테마 카드) · `WidgetDesignsCard.tsx`(편집기) · `DesignAssetsCard.tsx` · 문구 카드
- 운영 데이터: 스테이징 `tenants` id 4 · `widget_designs` id 7 · UAT 스니펫(HA 페이지 `<body>` 끝)

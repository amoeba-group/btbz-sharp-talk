# PLN-260916 — ivyusa 위젯 Figma 디자인 반영 계획 (테넌트 옵션으로 구현)

- 근거: REQ-260916-Ivyusa-Widget-Figma-Design · PLN-260910(커스텀 위젯·정제 CSS) · PLN-260817(탭 구성)
- UI 영향: **있음** — 콘솔 위젯 테마 카드(런처 모드), 커스텀 위젯 편집기(빠른 답장 스타일), 위젯(도킹 패널·선택 모드·카드형 빠른 답장), 임베드 스니펫. 와이어프레임 §4.

## 1. 단계

### P1 — 설정만으로 근접 (코드 없음, 스테이징 ivyusa에 즉시)
| 항목 | 값 |
|---|---|
| 테마 카드 | 브랜드색 `#2D5BE3`, 헤더 스타일 **흰색**, 로고 없음, 런처 위치 우 |
| 탭 구성 | 알림 · 채팅 (주문 탭 끔 → 알림 칩에 결제/배송/리뷰 포함) |
| 커스텀 위젯 "IVY Figma" | 폰트 Inter, 14px, 모서리 **크게(16)**, 패널 **380×720**, [사용함] |
| 시나리오 버튼 | My Orders / Product Help / Contact Support / How to become an Affiliate (4개, 6언어 라벨) |
| 위젯 문구 | 첫 방문 "안녕하세요! IVY Beauty입니다. 무엇을 도와드릴까요?"(ko/en) |
| 정제 CSS(애드온 ON) | `.st-tab` 활성 밑줄 검정, 알림 칩 선택 검정/흰 글자, `.st-quick-reply` 흰 배경·회색 외곽선, `.st-send` `#2D5BE3` |
| 결과 | Figma 대비 남는 차이 = G6·G7·G8·G9·G10·G11(코드) |

### P2 — 헤더 트리거 진입 (G6·G7·G9)
| 층 | 변경 |
|---|---|
| types | `WidgetTheme.launcher.mode: 'floating' \| 'trigger'`(기본 floating), `launcher.anchor: 'bottom-right' \| 'top-right'`, `launcher.offsetTop`(px, 0~200), `DESIGN_LIMITS.panel.height.max` 720→**760**, `PANEL_FRAME_PAD` 재계산 |
| embed.js | `mode='trigger'`: 런처 버튼 미생성, 프레임을 `top: offsetTop, right: 20`에 배치, `window.SharpTalk = { open, close, toggle, onUnread(cb) }` 공개 API; `cfg.trigger`(CSS 선택자)가 있으면 그 요소 클릭에 toggle 바인딩 + `data-sharptalk-badge` 요소에 미읽음 수 주입; 바깥 클릭·ESC로 닫기; 위젯→로더 `ivy:unread {count}` 메시지 |
| 위젯 | 세션 ensure 후 `GET /notifications/unread-count`를 로더에 postMessage; 트리거 모드에서 헤더의 언어 pill·X 숨김(설정 톱니 안에 언어 이동) |
| API | `session/ensure`·라이브 파일에 launcher.mode/anchor/offset 동봉(기존 theme 경로) |
| 콘솔 | 테마 카드 런처 절: **런처 모드** 라디오(플로팅 / 스토어 헤더 트리거) → 트리거면 선택자·상단 오프셋 입력 + 스니펫 미리보기에 `trigger`·배지 요소 안내 |
| 스니펫 | `SHARPTALK_WIDGET_CONFIG.trigger = '#st-bell'`, `<button id="st-bell">🔔<span data-sharptalk-badge></span></button>` 예시 |

### P3 — 알림 선택 모드·삭제 (G8) + 칩 정렬 (G11)
| 층 | 변경 |
|---|---|
| API | `DELETE /notifications/:id`, `DELETE /notifications`(body ids[] 또는 `all=true`) — 세션 고객 소유분만, 소프트 삭제 컬럼 `deleted_at`(SQL `260916-notifications-deleted-at.sql`), 목록·카운트에서 제외 |
| 위젯 | 알림 행 길게 누름/체크 아이콘 → 선택 모드(행 우측 체크 원, 선택 시 파란 체크) → 하단 고정 [선택 알림 삭제](채움) [전체 알림 삭제](외곽선, confirm) · 완료 토스트 · i18n 6언어 |
| tab-chips | 주문 탭 숨김 시 순서 `all · orders · shipping · event · review · inquiries`; 테마 옵션 `notificationChips.hideInquiries`(기본 false) |

### P4 — 빠른 답장 카드 스타일 (G10) + 상태 배지 색 (G12)
| 층 | 변경 |
|---|---|
| types | `WidgetDesign.quickReplyStyle: 'chip' \| 'card'`(기본 chip) |
| 위젯 | `ScenarioMenu` card 변형: 흰 배경·회색 외곽선·r12·좌측 lucide 아이콘(시나리오 코드→아이콘 매핑: orders→Package, product→HelpCircle, support→Headphones, affiliate→UserPlus, 기본 MessageCircle), 2열 그리드; 상태 배지 색 토큰(Confirmed 초록·In Transit 주황·Delivered 회색·Review 보라) 실측 후 부족분만 |
| 콘솔 | 커스텀 위젯 편집기에 "빠른 답장 스타일" 선택 |

### P5 — ivyusa 적용·검증·문서
- 스테이징 ivyusa: P1 설정 + P2~P4 옵션 켜기(커스텀 위젯 "IVY Figma" 사용함, 런처 트리거 모드) → 데모 스토어 페이지(`/widget/` 하네스)에 종 아이콘 트리거 예시 추가 → 로그인 고객·게스트 두 경우 캡처 → Figma 대조표.
- 프로덕션 ivyusa: 동일 설정(커스텀 위젯 패키지 이관) — 스토어 테마 헤더 삽입은 IVY 측.
- 매뉴얼 05 §3에 "스토어 헤더 트리거" 절, 임베드 SDK 가이드 갱신. TCR/RPT.

## 2. 사이드 임팩트
- 기본값 유지: `launcher.mode` 미설정=floating, `quickReplyStyle` 미설정=chip, 칩 순서는 주문 탭 숨김 테넌트에만 변경(문의 칩 유지). 다른 테넌트 무영향.
- 높이 상한 760: 로더 프레임 클램프 800→840, 뷰포트 900 미만이면 현행처럼 축소.
- 알림 소프트 삭제: 통계·미읽음 카운트 쿼리에 `deleted_at IS NULL` 추가(4곳), 고객 DSAR export는 삭제분 제외.
- 트리거 모드에서 로그인 리다이렉트 복귀(`ivy:reopen`)는 프레임 위치만 다르고 흐름 동일. 모바일(<424px)은 트리거 모드여도 전체 화면.
- 임베드 오리진·서명 계약 무변경. `SHARPTALK_WIDGET_CONFIG` 키 추가(`trigger`)만.

## 3. 리스크
- 스토어 테마 헤더 편집은 IVY 권한 — 배지 주입 실패 시에도 위젯 자체는 트리거 클릭으로 동작(배지는 선택).
- 바깥 클릭 닫기: 스토어 페이지 이벤트와 충돌 가능 → 프레임 밖 `pointerdown`만, 첫 열림 후 300ms 무시.
- Figma의 X 없는 헤더는 데스크톱 전용 — 모바일 전체 화면에서는 X 유지.

## 4. 와이어프레임

콘솔 설정 > 위젯 > 위젯 테마 카드(런처 절):
```
런처
  위치 [오른쪽 ▾]   크기 [md ▾]   아이콘 [채팅 ▾]
  모드 ( ) 플로팅 버튼 (기본)   (•) 스토어 헤더 트리거          ← 신규
        트리거 선택자 [#st-bell            ]  상단 오프셋 [72] px
        ⓘ 스토어 헤더에 아래 요소를 넣고 스니펫의 trigger에 선택자를 적으세요.
          <button id="st-bell" aria-label="Notifications">🔔<span data-sharptalk-badge></span></button>
```

스토어(데스크톱, 트리거 모드) — 헤더 아래 우측 도킹:
```
┌─ IVY beauty ───────────────────── [👤] [🛒 4] [🔔 3] ─┐
│                                  ┌────────────────────┐ │
│   MAD SHADE  BUY ONE GET ONE     │ Hi, Lisa         ⚙ │ │  380×760, r16, 그림자
│                                  │ Notifications ❸ Chat ❷│ │
│                                  │ [전체][결제][배송][이벤트][리뷰] │
│                                  │ 오늘 받은 알림          │ │
│                                  │ ◯ IVY-39891 Confirmed ●│ │
│                                  │   Hydrating Face Mask… │ │
│                                  │ ◯ 구독 혜택 … 쿠폰      ●│ │
│                                  │ 어제 알림              │ │
│                                  └────────────────────┘ │
└──────────────────────────────────────────────────────────┘
```

알림 선택 모드:
```
│ 오늘 받은 알림                       [취소] │
│ (✓) IVY-39891 Confirmed  Hydrating…        │
│ ( ) IVY-39891 Confirmed  Hydrating…        │
│ (✓) Mad Shade  Buy one Get One 50% OFF     │
│ ┌──────────────────────────────────────┐   │
│ │        선택 알림 삭제 (2)             │   │  채움 #2D5BE3
│ └──────────────────────────────────────┘   │
│ ┌──────────────────────────────────────┐   │
│ │        전체 알림 삭제                 │   │  외곽선
│ └──────────────────────────────────────┘   │
```

채팅 탭 빠른 답장 card 스타일:
```
│ 안녕하세요! IVY Beauty입니다. 무엇을 도와드릴까요? │
│ ┌ ▣ My Orders ┐ ┌ ☆ Product Help ┐              │  흰 배경, 회색 1px 외곽선, r12
│ ┌ 🎧 Contact Support ┐                           │
│ ┌ 👤+ How to become an Affiliate ┐               │
│ ⓘ AI 고지(축약)                                   │
│ [ Ask Anything                        ] (➤)      │  전송 원형 #2D5BE3
```

## 5. 승인 요청
P1(설정)→P2(헤더 트리거)→P3(선택 삭제·칩)→P4(카드 스타일)→P5(적용·문서) 순으로 진행해도 될지 확인 부탁드립니다. 조정 후보: (a) P3 삭제 기능을 "읽음 처리"로 대체(디자인의 삭제 버튼을 읽음 버튼으로), (b) P2를 먼저 하고 P3·P4는 후속 요구사항으로, (c) "AI 요약" 버튼의 용도 확인 후 별도 REQ.

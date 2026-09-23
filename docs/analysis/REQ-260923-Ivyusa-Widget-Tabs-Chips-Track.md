# REQ-260923 — ivyusa 위젯: 탭 2개(알림·채팅) + 하단 칩 5종 + 주문상세 Track → 배송사 페이지

- 요청(2026-09-23): "`https://ambshop-dev.myshopify.com/` 테넌트 ivyusa 커스텀위젯 UI 수정 —
  Figma `TalkTalk` node **345-17892** 참조하여 탭을 **알림과 채팅 2개**로 구성하고 하단에
  **전체 | 결제(주문) | 배송(주문) | 이벤트(알림) | 리뷰(본인 구매한 상품 - 리뷰작성페이지 이동버튼)**
  구성한다. 주문상세화면에서 **Track은 해당 주문건 배송한 배송사 페이지 이동**(예: DHL, FedEx 등)"
- Figma: `https://www.figma.com/design/Y3ql0jG7uicOMDCfQS5ApB/TalkTalk?node-id=345-17892`
  — 페이지 "1.Levising Logic & Design (IVY)", 프레임 `OrdersPanel` **380×730, 모서리 16**
- 원칙: **ivyusa 하드코딩 금지** — 탭·칩·링크는 전부 테넌트 설정/공용 규칙으로 표현(PLN-260916 원칙 승계).
- 관련: REQ/PLN-260916-Ivyusa-Widget-Figma-Design · PLN-260817-Widget-Tab-Config ·
  REQ/PLN-260920-Widget-Order-Detail-Redesign(+§7 read_products 후속, PR #559)

---

## 1. Figma 디자인 요약 (관찰 사실, 2026-09-23 캔버스 확인)

| 프레임 | 내용 |
|---|---|
| 탭 | **`Notifications (n)` · `Chat (n)`** 2개 — 헤더("알림센터"/"Hello, Lisa") 아래 |
| 칩 줄 | 탭 바로 아래(= 요청의 "하단") **`전체 · 결제 · 배송 · 이벤트 · 리뷰`** (en 프레임: `All · Payment · Delivery · Event · Review`). **문의(Inquiries) 칩 없음** |
| 결제 | 주문 행 목록: 박스 아이콘 · `IVY-39891` + 상태 배지(`Confirmed` 초록 / `In Transit` 주황) · `Hydrating Face Mask (10pcs) + 2 Others` · `10mins ago` · 미읽음 점. "오늘 받은 알림 / 어제 알림" 날짜 그룹 |
| 배송 | 주문별 카드: 번호 + 상태 배지 · 품목 요약 · 4단 스테퍼(Preparing→Processing→In Transit→Delivered) · 안내 문구 · **`Track Order` 버튼** |
| 이벤트 | 쿠폰/캠페인 알림 행(선물 아이콘·핑크 스파클 아이콘), 날짜 그룹 |
| 리뷰 (`05.Review`) | 행: 박스 아이콘 · `IVY-39875` + **보라 `Review` 배지** · `Rose Hip Facial Oil 30ml · $55.00` · **`★ 리뷰 쓰기`** 링크 · `4일 전` |
| 주문 상세 | (PLN-260920에서 반영 완료) 품목·할인·합계·연락처·`문의하기` 행 |

## 2. AS-IS (2026-09-23 실측)

### 2-1. 스토어 화면 — 스테이징 위젯(`shoptalk.amoeba.site/widget/embed.js`), 로그인(Test Customer)

```
┌ Hi, Test Customer            ⚙ ┐
│ Notifications(2) Orders(5) Chat │   ← 탭 3개가 렌더됨
├─────────────────────────────────┤
│ [Orders] Shipping Review Inquiries   ← Orders 탭의 칩 4개
│ 1005  The Multi-location…  [Paid]
│ 1001  Selling Plans Ski Wax [In transit] + 스테퍼
```

주문 상세 `#1001`: `Track` 행 = **위젯 안에서 스테퍼를 펼침**(외부 이동 없음).

### 2-2. 설정·데이터 (스테이징 DB, 2026-09-23)

| 항목 | 값 |
|---|---|
| `tenants(1 ivyusa).widget_tabs` | **`["notifications","chat"]`** (이미 2탭으로 저장) |
| `POST /session/ensure` 응답(shop=ambshop-dev) | `widgetTabs: ["notifications","chat"]` — **서버는 2탭을 준다** |
| 실제 렌더 | **3탭** ⚠️ → 클라이언트 측 불일치. 원인 미확정(§4 G1) |
| `fulfillments` tenant 1 | 7행 중 carrier+번호 보유 4행: `UPS`×2(`1Z999AA1…`), `An Post`, `Amazon Logistics` |
| `fulfillments.tracking_url` | **컬럼 없음** — Shopify 웹훅의 `tracking_url`을 버리고 있음 |
| `fulfillments.tenant_id` | 2026-09-22 생성 1행이 **NULL** (`applyFulfillment` 생성 경로가 tenant_id 미기록) |
| `products_cache` tenant 1 | 2,320건 전부 `ivyusa.com/products/{handle}` — **주문 상점(ambshop-dev)의 상품 id와 불일치**(주문 품목 `7388684222544` 등은 카탈로그에 없음) |
| `order_items` | `product_id`만 있음. **상품 URL/handle 없음** |
| 리뷰 | `POST /reviews`(위젯 내 폼, `order_item_id`) 존재. 리뷰 칩은 현재 **`review` 카테고리 알림 필터**(tenant 1에 1건) |

### 2-3. 코드 구조 (칩)

`tab-chips.ts` `chipsFor()` — 목록 탭이 하나(알림만)면 모든 칩을 흡수:
`All · Orders · Shipping · Event · Review · Inquiries` (6개). 목록 탭이 둘이면 Notifications=`All·Event`,
Orders=`Orders·Shipping·Review·Inquiries`. 이 흡수 세트는 **알림 탭만 켠 모든 테넌트 공용**.

## 3. TO-BE

| # | 요구 | TO-BE |
|---|---|---|
| R1 | 탭 2개 | `Notifications · Chat` — 설정은 이미 되어 있음. **실제로 2탭이 렌더되도록 불일치 해소** |
| R2 | 칩 5개 | 흡수 세트(알림 탭 단독)를 **`전체 · 결제 · 배송 · 이벤트 · 리뷰`** 로. `결제` = 기존 `orders` 칩(주문 목록)의 **라벨만 결제/Payment**로 |
| R3 | 문의 칩 | 디자인에 없음 → 흡수 세트에서 **기본 숨김, 테넌트가 이슈 워크플로를 쓰면 노출**(결정 D-2) |
| R4 | 리뷰 칩 | 알림 필터 → **본인 구매 품목 목록**(배송완료 주문의 품목). 행마다 `★ 리뷰 쓰기` → **상품 리뷰 작성 페이지로 이동**(새 창). 이미 작성한 품목은 `작성완료` 표시 |
| R5 | Track | 주문 상세 `Track` 행 → **배송사 추적 페이지로 이동**(새 창). 우선순위: Shopify가 준 `tracking_url` → 배송사 이름+송장번호로 만든 공용 URL → (둘 다 없으면) 현행 인라인 스테퍼 |
| R6 | 배송 칩 카드 | 카드의 `Track Order` 버튼도 R5와 **같은 규칙**(한 곳에서 계산) |

## 4. 갭 분석

| # | 갭 | 영향 | 해소 방향 |
|---|---|---|---|
| G1 | DB=2탭인데 스토어는 3탭 렌더 | R1이 "설정만으로" 안 됨 | P0: 임베드 경로 재현 → 원인 확정 후 최소 수정(FIX 문서). 서버 응답은 정상이므로 위젯 측(세션 재개·스토어 초기화·캐시된 번들) 순으로 추적 |
| G2 | `tracking_url` 미저장 | R5 1순위 불가 | `fulfillments.tracking_url` VARCHAR(1024) NULL 추가 + Shopify 웹훅 `tracking_url`/`tracking_urls[0]` 저장 |
| G3 | 배송사→URL 규칙 없음 | 과거 행(URL 없음) 추적 불가 | 공용 배송사 레지스트리(UPS·USPS·FedEx·DHL·An Post·Amazon Logistics·Canada Post·Royal Mail·Australia Post·Japan Post·CJ대한통운 등) — 이름 **정규화 후 전체 일치**(부분일치 금지, substring 함정 전례) |
| G4 | `TrackingResponse`에 URL 없음 | 위젯이 링크 불가 | 응답에 `trackingUrl: string \| null` 추가(서버가 G2→G3 순으로 해석) |
| G5 | `order_items`에 상품 URL 없음 + 카탈로그 불일치 | R4 이동 대상 없음 | GraphQL rich tier(`read_products`, #559로 확보)에 `product { handle onlineStoreUrl }` 추가 → `order_items.product_url` 저장. `onlineStoreUrl` 없으면 `https://{shop_domain}/products/{handle}` |
| G6 | 리뷰 대상 목록 API 없음 | R4 | `GET /orders/review-items` — 세션 고객의 배송완료 주문 품목 + `productUrl` + `reviewed` |
| G7 | 리뷰 "작성 페이지"가 상점마다 다름 | R4 링크 형식 | 테넌트 옵션 `widgetTheme.review.linkTemplate`(기본 `{productUrl}`; 예 `{productUrl}#judgeme_product_reviews`). URL 없으면 **위젯 내 기존 리뷰 폼으로 폴백** |
| G8 | `applyFulfillment` 생성 시 tenant_id 누락 | 테넌트 경계 위반(CLAUDE.md MUST) | 생성 시 `tenantId: order.tenantId` 기록 + NULL 행 백필 SQL |
| G9 | 주문당 fulfillment 1행만 유지(덮어쓰기) | 분할 배송 시 마지막 송장만 | 이번 범위 밖 — 기록만 |

## 5. 사용자 흐름

1. 헤더 벨 클릭 → 위젯(탭 **Notifications / Chat**) → 칩 `전체`
2. `결제` → 주문 목록 → 행 클릭 → 주문 상세 → **`Track` → 새 창에서 UPS 등 추적 페이지**
3. `배송` → 카드 `Track Order` → 같은 규칙으로 배송사 페이지(URL 없으면 주문 상세로)
4. `리뷰` → 구매 품목 목록 → `★ 리뷰 쓰기` → 새 창에서 상품 페이지(리뷰 영역)
5. `이벤트` → 쿠폰/캠페인 알림

## 6. 제약

- 스테이징 `DB_SYNCHRONIZE=false` → **SQL 선적용 필수**(`sql/` + `migrations:manifest`), PR에 `## Migration`.
- 위젯은 iframe(임베드)/WebView(`?mode=app`) 둘 다 — 외부 링크는 `target=_blank rel=noopener`, 앱 모드는 기존 채널 규약으로 전달.
- 스토어 테스트 주문의 배송사는 Shopify 테스트값(`UPS 1Z999AA1…`) — 실제 추적 결과는 "없음"으로 뜰 수 있음(링크 자체의 검증만 가능).
- Figma의 칩 명칭 `배송`/`Delivery` vs 현행 `Shipping` — 라벨은 i18n 값만 조정(키 불변).

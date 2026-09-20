# REQ-260920 — 위젯 주문 상세 화면을 Figma(TalkTalk 345-17800) 디자인으로 개편

- 요청(2026-09-20): "`https://ambshop-dev.myshopify.com/` 위젯 — 주문상세 화면을 Figma
  `TalkTalk` node **345-17800** 참조하여 화면 디자인 수정"
- 사용자 결정(2026-09-20, 타당성 보고 회신): **트래킹·리뷰는 유지** · **배송지/청구지 주소는
  Shopify PCD 승인 전까지 범위에서 제외**
- Figma: `https://www.figma.com/design/Y3ql0jG7uicOMDCfQS5ApB/TalkTalk?node-id=345-17800`
  — 페이지 "1.Levising Logic & Design (IVY)", 프레임 **379×870, 모서리 16, 흰 배경**
- 원칙: **ivyusa 하드코딩 금지.** 주문 상세는 모든 테넌트가 쓰는 공용 화면이므로, 레이아웃은
  전 테넌트 공통으로 개선하고 테넌트 차이는 기존 레버(브랜드색·커스텀 위젯·정제 CSS)로만 표현한다.
- 관련: REQ/PLN/RPT-260916-Ivyusa-Widget-Figma-Design · FIX-260920-Widget-Docked-Panel-Geometry ·
  GUIDE-260920-Ivyusa-Custom-Widget-Apply

---

## 1. Figma 디자인 요약 (관찰 사실)

| 영역 | 디자인 |
|---|---|
| 헤더 | 좌측 **← 뒤로**, **중앙 "주문 상세"** 굵게. 우측 컨트롤 없음. 하단 얇은 구분선 |
| 주문번호 | 본문 최상단 좌측 `IVY-39891` (배지·상태 표기 **없음**) |
| 품목 행 | **썸네일 48×48**(회색 배경·둥근 모서리) · 제목 최대 2줄 · 그 아래 회색 **옵션 텍스트**(`Burgundy / 6-8`) · 우측 가격 `$4.99`. **수량 표기 없음** |
| 할인 | 구분선 아래 **`Discount` / `-$4.99`** — 라벨·금액 모두 **빨강**, 굵게 |
| 합계 블록 | `Subtotal · 3 items` → `$55.00` / `Shipping` → `Free` / **`Total`(굵게)** → `USD $55.00` |
| 고객 정보 | 2열: 좌 **Contact information**(이름, 이메일 링크) · 우 **Billing address**(값 `-`) |
| 배송지 | **Shipping address** — 이름 / 도로명 / 시·주 / 우편번호 / 국가 / 전화 |
| 하단 | **`문의하기` 행 + 오른쪽 chevron(›)** — 전체 폭 1행, 버튼 아님 |

디자인에 **없는 것**: 상태 배지, 트래킹 스테퍼, 리뷰 쓰기, 수량.

## 2. AS-IS (2026-09-20 실측)

### 2-1. 화면 — `ambshop-dev.myshopify.com` 위젯, 로그인 상태, 주문 `#1005`

```
← Back
┌──────────────────────────────┐
│ #1005                 [Paid] │   ← 주문번호 + 상태 배지
│ Total             $729.95    │
└──────────────────────────────┘
Items
┌──────────────────────────────┐
│ The Multi-location Snowboard │   ← 썸네일 없음
│ x1                  $729.95  │   ← 수량 표기, 옵션 없음
└──────────────────────────────┘
[ 🚚 Track ]  [ 💬 Ask about this order ]   ← 하단 고정 2버튼
```

- 배송조회는 [Track] 토글 → `TrackingStepper`가 인라인으로 펼쳐짐.
- 리뷰 쓰기는 **배송완료 주문의 품목 행**에만 "⭐ 리뷰 쓰기" 링크로 노출(`ReviewForm`).
- 구현: `apps/widget/src/components/orders/OrderDetail.tsx`(165줄), `TrackingStepper.tsx`, `ReviewForm.tsx`.

### 2-2. 데이터 — 무엇이 있고 무엇이 없나

| 소스 | 보유 | 미보유 |
|---|---|---|
| `orders_cache` | `order_number` · `status_internal/ui` · **`total`** · `currency` · `ordered_at` | **subtotal · discount · shipping · 주소 · 이메일** |
| `order_items` | `title` · `option_text` · `qty` · `price` · `product_id` | **이미지 URL** |
| `products_cache` | `handle` · `title` · **`image_url`** · `price` · `product_url` | **외부(Shopify) 상품 id** — 주문 품목과 이을 키가 없음 |
| `customers` | `name` · `email`(암호화) · `phone`(암호화) | **주소** |

실측 카운트(스테이징 tenant 1):

```
order_items      : 8건  중 product_id 보유 2건 · option_text 보유 2건
products_cache   : 2,316건, image_url 보유 2,316건 (전량)
```

> 왜 2/8인가: 예약 동기화는 **GraphQL 경로**를 쓰는데 `lineItems` 선택 필드가 `title·quantity·
> 단가`뿐이다. 코드 주석이 이유를 명시한다 — "`variant`·`product`·`sku`는 **read_products**가
> 필요하고 이 앱은 요청하지 않는다. 함께 넣으면 쿼리 전체가 실패한다"
> (`shopify-admin.client.ts` `LINE_ITEMS_SELECTION`). `product_id`·`option_text`가 채워진 2건은
> REST/웹훅 경로로 들어온 주문이다. 현재 앱 스코프는
> `read_orders,read_customers,read_fulfillments,write_customer_data_erasure`(`shopify.app.toml`).

## 3. 갭 분석 — 화면만으로 되는 것 / 데이터가 필요한 것

| # | Figma 요소 | 판정 | 필요 작업 |
|---|---|---|---|
| G1 | ← + 중앙 "주문 상세" 헤더 | **화면만** | `OrderDetail.tsx` + i18n 6언어 키 |
| G2 | 주문번호 단독 행 | **화면만** | 표기 포맷 확인(§7 D2) |
| G3 | 품목 레이아웃(2줄 제목·옵션·우측 가격) | **화면만** | 수량은 유지하되 위치 조정(§7 D3) |
| G4 | **썸네일** | **데이터 필요** | 택1 — ⓐ `read_products` 스코프 추가 후 GraphQL에서 상품 이미지 수집(앱 스코프 변경 + 스토어 재설치) ⓑ `products_cache`에 외부 상품 id 컬럼 추가(공개 `/products.json`이 `id`를 이미 내려줌) → `order_items.product_id` 조인. **ⓑ만으로는 현재 커버리지 2/8** |
| G5 | **옵션 텍스트** | **데이터 필요** | G4-ⓐ와 동일 스코프로 해결(웹훅 경로는 이미 채움) |
| G6 | Discount / Subtotal / Shipping | **스키마 추가** | `orders_cache`에 4컬럼(소계·할인·배송비·품목수) + GraphQL 쿼리에 `subtotalPriceSet`·`totalDiscountsSet`·`totalShippingPriceSet` 추가(**read_orders 범위, 스코프 추가 불필요**) + REST 웹훅 매핑 + SQL 마이그레이션. 과거 주문은 재동기화 시 채워짐 |
| G7 | Contact information(이름·이메일) | **가능** | `customers`에서 조회해 상세 응답에 추가. 위젯 세션은 **고객 바인딩**이라 본인 정보 노출은 정책상 문제 없음 — 단 응답 신설이므로 로그 마스킹 확인 |
| G8 | Billing / Shipping address | **범위 제외(보류)** | Shopify **PCD 승인 범위 확인**이 선행. 승인 후 별도 REQ — 암호화 컬럼 + DSAR·`customers/redact` 삭제 경로까지 함께 설계 |
| G9 | 하단 "문의하기" 행 | **화면만** | 기존 [Ask about this order]를 행 형태로. **[Track]과 리뷰는 유지**(§4) |

## 4. TO-BE 화면 (Figma + 유지 결정 반영)

주소 블록은 이번 범위에서 빠지고(G8), 트래킹·리뷰는 남는다. 두 결정을 반영한 배치:

```
┌────────────────────────────────────────────┐
│  ←            주문 상세                     │  G1 중앙 타이틀
├────────────────────────────────────────────┤
│  IVY-39891                        [Paid]   │  G2 + 상태 배지(유지)
│                                            │
│  ┌────┐ Hydrating Face Mask        $4.99   │  G3/G4 썸네일 48
│  │img │ (10pcs)                            │
│  └────┘ 수량 1                              │
│  ┌────┐ Ultra Mini Portable Fan,   $4.99   │
│  │img │ Powerful Pocket-Sized…             │
│  └────┘ Burgundy / 6-8 · 수량 1             │  G5 옵션
│         ⭐ 리뷰 쓰기                         │  배송완료 품목만(유지)
│  ──────────────────────────────────────    │
│  Discount                         -$4.99   │  G6 빨강
│  ──────────────────────────────────────    │
│  Subtotal · 3 items               $55.00   │
│  Shipping                           Free   │
│  Total                       USD $55.00    │  굵게
│  ──────────────────────────────────────    │
│  Contact information                       │  G7
│  Hyein Kim                                 │
│  hykim4@ivyent.com                         │
│  ──────────────────────────────────────    │
│  🚚 배송 조회                          ›    │  유지(누르면 스테퍼 펼침)
│    ┌──────────────────────────────────┐    │
│    │ ●━━━━●━━━━○━━━━○                 │    │  TrackingStepper(기존)
│    └──────────────────────────────────┘    │
│  💬 문의하기                           ›    │  G9
└────────────────────────────────────────────┘
        (배송지/청구지 블록은 PCD 승인 후 G7 아래에 삽입)
```

- 하단 두 줄은 Figma의 "문의하기" 행 서식을 그대로 쓰되 **2행**으로 둔다 — 기능을 지우지 않으면서
  버튼 2개가 차지하던 고정 영역을 없앨 수 있다.
- 상태 배지는 Figma에 없지만 **유지**한다: 목록에서 배지를 보고 들어온 화면에서 배지가 사라지면
  같은 주문이 다른 주문처럼 보인다(FIX-Widget-OrderDetail 계열에서 이미 한 번 정리된 판단).

## 5. 사용자 흐름 (TO-BE)

1. 알림/주문 목록 → 주문 행 탭 → 주문 상세(스크롤 최상단, 헤더 "주문 상세")
2. 품목 확인 — 썸네일·옵션·가격, 배송완료면 품목별 [리뷰 쓰기]
3. 금액 확인 — 할인·소계·배송비·합계
4. 본인 연락처 확인(이름·이메일)
5. [배송 조회] → 스테퍼 인라인 확장(기존 동작) / [문의하기] → 채팅 탭으로 주문번호와 함께 이동(기존 동작)
6. ← → 목록 복귀

## 6. 범위

**포함**: G1·G2·G3·G6·G7·G9 + (G4·G5는 데이터 확보 방식 결정 후) · 트래킹/리뷰 유지 · i18n 6언어

**제외**: G8 배송지/청구지(PCD 승인 후 별도 REQ) · 주문 취소/반품 등 신규 기능 · 콘솔 측 변경

## 7. 제약·전제·미결

| 구분 | 내용 |
|---|---|
| C1 | **Shopify 스코프**: 썸네일·옵션(G4ⓐ/G5)은 `read_products` 추가 → 앱 스코프 변경 + **스토어 재설치** 필요. 금액 내역(G6)은 **현재 스코프로 가능** |
| C2 | **PCD**: 주소는 보호 고객 데이터. 승인 범위 확인 전 저장·표시 금지(이번 범위 제외 근거) |
| C3 | **PII**: G7으로 상세 응답에 이름·이메일이 새로 실린다. 저장은 이미 암호화(`customers`), 신규 노출 경로는 **본인 세션 한정** — 로그 마스킹·감사 대상 여부를 PLN에서 확정 |
| C4 | **패널 높이**: Figma 870px, 현재 커스텀 위젯 높이 상한 **760px**(ivyusa 설정 720). 상한을 올리기보다 **스크롤로 소화**를 기본안으로 제안 — 도킹 모드는 창 높이에 맞춰 더 줄어들기도 한다(FIX-260920) |
| C5 | 정제 CSS(`.st-*`) 훅 이름은 유지해야 기존 테넌트 CSS가 깨지지 않는다 |
| **D1** | **G4 방식 택1** — ⓐ 스코프 추가(신규 주문부터 정확) / ⓑ 카탈로그 조인(설치 변경 없음, 커버리지 낮음) / **ⓐ+ⓑ 병행(권장)** |
| **D2** | 주문번호 표기 — 실데이터는 `#1005`(Shopify order name). Figma의 `IVY-39891`처럼 **테넌트 접두어 포맷**이 필요한가? 필요하면 표시 규칙(설정값)으로 넣는다 |
| **D3** | 수량 표기 — Figma엔 없다. 유지(제안: 옵션 줄에 `· 수량 1`)할지 제거할지 |
| **D4** | 배송비 `Free` 문구 — 0원일 때만 `Free`, 미수집이면 행 자체를 숨길지 |

## 8. 단계 제안 (PLN에서 확정)

| 단계 | 내용 | 선행 |
|---|---|---|
| P1 | 화면 개편(G1·G2·G3·G9) + 트래킹/리뷰 재배치 + i18n | 없음 |
| P2 | 금액 내역(G6) — 컬럼 4개·동기화·마이그레이션 | 없음(현재 스코프) |
| P3 | 연락처(G7) | C3 판단 |
| P4 | 썸네일·옵션(G4·G5) | D1 결정, ⓐ면 재설치 |
| — | 주소(G8) | **PCD 승인** — 별도 REQ |

P1·P2는 병렬 가능하고, P4만 외부 승인/재설치에 묶인다. 즉 **디자인 반영 자체는 스코프 변경 없이
P1~P3까지 갈 수 있고**, 썸네일이 빠진 동안 품목 행은 현행처럼 텍스트만 그린다.

## 9. 연관

- 구현 지점: `apps/widget/src/components/orders/{OrderDetail,TrackingStepper,ReviewForm}.tsx`
- 데이터: `apps/api/src/domain/order/{order.mapper.ts,shopify-sync.service.ts,shopify-admin.client.ts}`,
  `entity/{order-cache,order-item}.entity.ts`, `apps/api/src/domain/product/product-sync.service.ts`
- 선행 문서: REQ/PLN/RPT-260916(위젯 Figma 1차), FIX-260920(도킹 지오메트리), GUIDE-260920(적용 가이드)

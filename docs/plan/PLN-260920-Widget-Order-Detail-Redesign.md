# PLN-260920 — 위젯 주문 상세 화면 개편 실행 계획

- 근거: REQ-260920-Widget-Order-Detail-Redesign (main `f072cd7`) · Figma `TalkTalk` node 345-17800
- 사용자 결정(2026-09-20): **D1 = ⓑ 카탈로그 조인**(Shopify 스코프 변경 없음) · **D2 = 주문번호 실데이터
  유지**(`#1005`) · **D3 = 수량 표시 유지** · **D4 = 배송비 0일 때만 `Free`**
- 유지 결정(REQ): 트래킹·리뷰·상태 배지 **유지** / 배송지·청구지(G8)는 **PCD 승인 전까지 제외**
- ⚠️ **PLN 승인 후 착수.** 이 문서는 구현 전 계획입니다.

---

## 1. D1=ⓑ 선택이 만드는 결과 (먼저 못 박을 것)

스코프를 늘리지 않으므로 **GraphQL 예약 동기화는 앞으로도 상품 id·옵션을 주지 않습니다**
(`read_products` 없이 `lineItems`에서 읽을 수 있는 건 제목·수량·단가뿐). 따라서:

| 항목 | ⓑ에서의 실제 동작 |
|---|---|
| 썸네일 | `products_cache`와 이어지는 품목만 표시. **못 이으면 회색 플레이스홀더**(레이아웃 유지) |
| 옵션 텍스트 | 웹훅/REST 경로로 들어온 주문만 값이 있음(현재 tenant 1 기준 8건 중 2건) → **값 없으면 줄 자체를 숨김** |
| 커버리지 개선 | 상품 id 조인만으로는 2/8이라, **정규화 제목 완전일치 폴백**을 함께 넣어 카탈로그(2,316건 전량 이미지 보유)와 잇는다 |

**제목 매칭은 완전일치만.** 부분일치는 쓰지 않습니다 — `fulfil`→`Unfulfilled`처럼 부분일치가
정반대 결과를 만든 전례가 있습니다(substring-status-matching 계열 사고). 정규화는 소문자화 +
연속 공백 1칸 + 앞뒤 공백 제거까지만 하고, 그래도 안 맞으면 플레이스홀더로 둡니다.

> 스코프를 추가하면(ⓐ) 신규 주문부터 옵션·이미지가 정확해집니다. 지금은 채택하지 않되,
> 나중에 ⓐ를 켜도 이번 구조(카탈로그 조인)는 폴백으로 그대로 살아남습니다.

## 2. 화면 설계 (ASCII 와이어프레임)

### 2-1. 데스크톱/도킹 패널 — 기본 상태 (380px 폭 기준)

```
┌──────────────────────────────────────────────┐
│  ←              주문 상세                     │  40px, 중앙 타이틀, 하단 1px 구분선
├──────────────────────────────────────────────┤
│                                              │
│  #1005                            [ Paid ]   │  주문번호(실데이터) + 상태 배지(유지)
│                                              │
│  ┌────┐  Hydrating Face Mask                 │  썸네일 48×48 r8, 회색 배경
│  │ img│  (10pcs)                     $4.99   │  제목 2줄 말줄임
│  └────┘  수량 1                               │  옵션 없으면 이 줄은 수량만
│                                              │
│  ┌────┐  Ultra Mini Portable Fan,            │
│  │ ▨  │  Powerful Pocket-Sized…      $4.99   │  ▨ = 플레이스홀더(매칭 실패)
│  └────┘  Burgundy / 6-8 · 수량 1              │  옵션 있으면 "옵션 · 수량 N"
│          ⭐ 리뷰 쓰기                          │  배송완료 주문의 품목만(유지)
│  ────────────────────────────────────────    │
│  Discount                          -$4.99    │  할인 > 0 일 때만, 빨강
│  ────────────────────────────────────────    │
│  Subtotal · 3 items                $55.00    │  소계 없으면 행 숨김
│  Shipping                            Free    │  0 → Free / >0 → 금액 / null → 행 숨김
│  Total                        USD $55.00     │  굵게, 통화 코드 병기
│  ────────────────────────────────────────    │
│  Contact information                         │
│  Hyein Kim                                   │
│  hykim4@ivyent.com                           │  mailto 링크
│  ────────────────────────────────────────    │
│  🚚  배송 조회                            ›   │  행 형태(기존 [Track] 대체)
│  💬  문의하기                             ›   │  행 형태(기존 [Ask] 대체)
└──────────────────────────────────────────────┘
        ↑ 패널 전체 세로 스크롤(C4: 상한 760 유지, 스크롤로 소화)
```

### 2-2. [배송 조회] 펼친 상태

```
│  🚚  배송 조회                            ⌄   │  토글(기존 showTrack 로직 그대로)
│  ┌──────────────────────────────────────┐    │
│  │  ●━━━━━●━━━━━○━━━━━○                  │    │  TrackingStepper(기존 컴포넌트)
│  │  준비   발송   배송중  완료             │    │
│  └──────────────────────────────────────┘    │
│  💬  문의하기                             ›   │
```

### 2-3. 리뷰 폼 열린 상태 / 데이터가 비었을 때

```
│  ┌────┐  Hydrating Face Mask                 │     [금액 블록 전체가 없을 때]
│  │ img│  (10pcs)                     $4.99   │     ────────────────────────
│  └────┘  수량 1                               │     Total          USD $55.00
│          ⭐ 리뷰 쓰기  ← 클릭                   │     ────────────────────────
│  ┌──────────────────────────────────────┐    │     (소계·할인·배송비 미수집 주문:
│  │ ★★★★☆   [ 리뷰를 입력하세요…        ] │    │      Total 한 줄만 남고 나머지는
│  │                     [취소] [ 등록 ]  │    │      숨김 — 빈 값 0원으로 오인 금지)
│  └──────────────────────────────────────┘    │
```

### 2-4. 좁은 화면(`?compact=1`, 풀스크린 시트)

구성은 동일하고 폭만 100%가 됩니다. 썸네일·행 높이·폰트는 그대로 두고, 금액 블록의
라벨/값 2열만 유지합니다(추가 반응형 분기 없음).

## 3. 단계별 실행

### P1 — 화면 개편 (스키마·스코프 무관, 단독 배포 가능)

| 파일 | 변경 |
|---|---|
| `apps/widget/src/components/orders/OrderDetail.tsx` | 헤더(← + 중앙 타이틀) · 주문번호 행 · 품목 행 재구성(썸네일 슬롯·옵션·수량·가격) · 금액 블록 자리 · 연락처 자리 · 하단 2행(배송 조회/문의하기). 기존 `st-*` 훅 이름 유지(C5) |
| `apps/widget/src/i18n/locales/*/translation.json` (6언어) | `orders.detailTitle`, `orders.subtotal`, `orders.discount`, `orders.shipping`, `orders.shippingFree`, `orders.contact`, `orders.trackRow`, `orders.askRow`, `orders.itemsCount` |
| — | `npm run i18n:check` 필수(키 누락 = 조용한 영어 폴백) |

금액·연락처·썸네일이 아직 없는 단계이므로, 해당 블록은 **값이 없으면 통째로 렌더하지 않습니다**
(P2~P4가 들어오면 자동으로 채워짐).

### P2 — 금액 내역 (스키마 추가, 현재 스코프로 가능)

```sql
-- sql/260920-orders-cache-money-breakdown.sql
ALTER TABLE orders_cache
  ADD COLUMN subtotal      DECIMAL(12,2) NULL AFTER total,
  ADD COLUMN discount_total DECIMAL(12,2) NULL AFTER subtotal,
  ADD COLUMN shipping_total DECIMAL(12,2) NULL AFTER discount_total,
  ADD COLUMN item_count     INT           NULL AFTER shipping_total;
```

| 파일 | 변경 |
|---|---|
| `sql/260920-orders-cache-money-breakdown.sql` + `sql/artefacts.tsv` + `docker/init-sql/01-schema.sql` | 컬럼 4개 (`migrations:manifest` 갱신 필수) |
| `entity/order-cache.entity.ts` | 4필드, 전부 `decimalTransformer`/int, **nullable에 명시 `type`**(union 타입만 주면 DataSource 초기화 실패 = 부팅사) |
| `shopify-admin.client.ts` | 주문 쿼리에 `subtotalPriceSet`·`totalDiscountsSet`·`totalShippingPriceSet` 추가(**read_orders 범위**) → DTO 매핑 |
| `shopify-sync.service.ts` | REST/웹훅 payload(`subtotal_price`·`total_discounts`·`total_shipping_price_set`)와 GraphQL 양쪽 매핑, `item_count` = 라인아이템 수량 합 |
| `order.mapper.ts` + `packages/types/src/api/widget.types.ts` | `OrderDetailResponse`에 `subtotal`·`discountTotal`·`shippingTotal`·`itemCount` 추가(**전부 optional/nullable — 추가형 변경**) |

과거 주문은 다음 동기화 때 채워집니다. **백필 스크립트는 만들지 않습니다**(동기화가 주기적으로
전량을 훑고, 값이 없으면 §2-3처럼 행을 숨기므로 사용자에게 잘못 보이지 않음).

### P3 — 연락처 (이름·이메일)

- `order.service`가 주문의 `customer_id`로 `customers`를 조회해 `contactName`·`contactEmail`을
  상세 응답에 추가. 복호화는 기존 `crypto.util` 경로 사용.
- **노출 범위**: 위젯 세션은 고객 바인딩(`session.customerId`)이므로 **자기 주문의 자기 정보**만
  나갑니다. 주문-세션 소유 검증은 기존 `detail()` 경로가 이미 수행(타 고객 주문 403).
- **로그**: 응답 본문에 PII가 새로 실리므로 요청/응답 로깅 경로에서 마스킹 확인(PII 마스킹 3종 중
  로그 축) — 콘솔 측 마스킹 정책(`CUSTOMER_PII_REVEAL`)과는 **다른 축**이며, 본인 열람이라
  감사 1행은 남기지 않습니다(사유: 모든 주문 조회가 감사 폭증을 만들고, 열람 주체=데이터 주체).

### P4 — 썸네일·옵션 (D1 = ⓑ)

| 파일 | 변경 |
|---|---|
| `sql/260920-products-cache-external-id.sql` | `products_cache.external_id VARCHAR(64) NULL` + `INDEX (tenant_id, external_id)` |
| `entity/product-cache.entity.ts` | `externalId` 필드(+ `@Index`) |
| `product-sync.service.ts` | `/products.json`의 `id`를 `external_id`로 저장(이미 응답에 들어옴 — 파싱만 추가). 기존 업서트 키는 `handle` 그대로 |
| `order.service.ts` | 상세 조회 시 품목 이미지 해석: ① `order_items.product_id` = `products_cache.external_id` 정확 조인 → ② 실패 시 **정규화 제목 완전일치** → ③ 실패 시 null |
| `order.mapper.ts` + `widget.types.ts` | `OrderItemResponse.imageUrl?: string \| null` |
| `OrderDetail.tsx` | 이미지 있으면 `<img>`, 없으면 회색 플레이스홀더(같은 48×48) |

이미지는 Shopify CDN 절대 URL이라 프록시·저장 없이 그대로 사용합니다(이미 카탈로그가 같은 방식).

## 4. 사이드 임팩트 분석

| 대상 | 영향 | 조치 |
|---|---|---|
| `NotificationsTab.tsx` | 주문 상세의 **유일한 진입점**(주문 탭 은퇴 후). 뒤로가기·스크롤 컨테이너를 공유 | P1에서 함께 확인. `onBack` 계약 불변 |
| **`apps/pwa/src/pages/OrderDetailPage.tsx`** | 같은 `GET /orders/:id`를 사용. 응답 필드가 **추가형**이라 깨지지 않음 | 이번 범위 밖(화면 미변경). PWA 반영은 별도 판단 — RPT에 남김 |
| `OrderList.tsx` / 목록 API | 변경 없음. 목록은 `total`만 씀 | 없음 |
| 모바일 SDK/WebView | 위젯 번들을 그대로 로드 → 화면 변경이 그대로 반영. `?mode=app`은 풀스크린 경로 | P1 후 앱 모드 1회 확인 |
| 정제 CSS(애드온) | `.st-*` 훅 이름 유지 시 무영향. **행 구조가 바뀌므로 간격 커스터마이즈는 달라질 수 있음** | 훅 이름 보존(C5), RPT에 고지 |
| 다른 커머스 프로바이더(Cafe24·Odoo·Haravan·Woo) | 금액 4필드는 **Shopify 동기화에만** 매핑. 나머지는 null → 행 숨김 | 회귀 없음. 후속으로 프로바이더별 매핑 추가 가능 |
| 스키마 | P2·P4 각각 SQL 1개 → **PR 본문에 `## Migration` 섹션 필수**, 스테이징/프로덕션 **선적용 후 코드 배포** | 배포 순서 준수 |

## 5. 테스트 계획 (TCR-260920에서 상세)

- **단위**: 금액 매핑(GraphQL/REST 양쪽, null·0·문자열 금액), `item_count` 합산, 이미지 해석 3단계
  (id 히트 / 제목 히트 / 미스), 정규화 제목이 **부분일치로는 안 잡히는지**(역검증), 배송비 0 → `Free`.
- **통합**: `GET /orders/:id` 응답 계약(추가 필드 nullable), 타 고객 주문 403 유지.
- **화면**: 값 조합 4종(전체 보유 / 금액만 / 이미지만 / 전부 없음)에서 레이아웃 붕괴 없음,
  배송완료 주문의 리뷰 링크, 배송 조회 토글, compact 풀스크린.
- **i18n**: `npm run i18n:check` 6언어.
- **실측**: 스테이징 `ambshop-dev` 실 주문으로 도킹 패널에서 스크롤·행 정렬 측정(FIX-260920 방식).

## 6. 산출물·순서

1. PLN 승인 → P1 구현 → PR(문서 없음, UI만) → 스테이징 배포 → 실측
2. P2 → SQL 선적용(스테이징) → 코드 PR(`## Migration` 포함) → 배포 → 프로덕션 SQL → 승격
3. P3 → PR(로그 마스킹 확인 포함)
4. P4 → SQL 선적용 → PR → 배포, 커버리지(이미지 해석 성공률) 실측 보고
5. TCR-260920 · RPT-260920 작성

P1·P2는 병렬 가능하지만, 검증을 단순하게 하려면 **P1 → P2 → P3 → P4 순차**를 권장합니다.

## 7. 보류·후속

- **G8 배송지/청구지**: Shopify PCD 승인 확인 후 별도 REQ. 승인 시 암호화 컬럼 + DSAR/`customers/redact`
  삭제 경로까지 함께 설계(이번 화면은 연락처 아래에 블록을 끼워 넣을 자리를 비워 둠).
- **D1-ⓐ(`read_products`)**: 옵션·이미지 정확도를 올리려면 나중에 스코프 추가 + 재설치. 이번 구조를
  그대로 두고 1차 소스만 바뀝니다.
- PWA 주문 상세 화면의 동일 개편 여부.

# RPT-260920 — 위젯 주문 상세 Figma 개편 실행 보고 (P1~P4)

- 근거: REQ-260920(`f072cd7`) · PLN-260920(`bf085d4`, 승인 2026-09-20) · TCR-260920
- PR: **#556** (squash → main `e31c061`) + 본 문서 PR
- Figma: `TalkTalk` node 345-17800 (379×870, 모서리 16)
- 결정 반영: D1=**ⓑ 카탈로그 조인**(Shopify 스코프 변경 없음) · D2=주문번호 실데이터 유지 ·
  D3=수량 표시 · D4=배송비 0일 때만 `Free` · 트래킹/리뷰/상태 배지 유지 · 주소는 PCD 승인까지 제외

## 1. 무엇이 바뀌었나

| 단계 | 변경 |
|---|---|
| **P1 화면** | ← + 중앙 "주문 상세" 헤더 · 품목 행(썸네일 48·2줄 제목·옵션·수량·우측 가격) · 금액 블록 · 하단 고정 버튼 2개 → **배송 조회 / 문의하기 행**(chevron, 배송 조회는 그 자리에서 스테퍼 펼침) · i18n 6언어 **7키 추가**(`orders.detail·track·itemCount`는 기존 키 재사용 — 계획의 9키보다 적다) |
| **P2 금액** | `orders_cache` +4컬럼(`subtotal·discount_total·shipping_total·item_qty`). Shopify GraphQL 쿼리에 `subtotalPriceSet·totalDiscountsSet·totalShippingPriceSet` 추가 — **read_orders 범위라 스코프 변경 없음**. 웹훅(REST)과 GraphQL을 같은 DTO 이름으로 모아 upsert 한 곳에서 읽는다 |
| **P3 연락처** | 상세 응답에 `contactName·contactEmail`. `detailForSession`이 이미 '세션=주문 주인'을 검증하므로 나가는 값은 **고객 본인 것뿐**이고, 복호화는 엔티티 transformer가 한다 |
| **P4 썸네일** | `products_cache.external_id`(공개 `/products.json`의 id) + 인덱스. 이미지 해석 ①id 정확 조인 ②**정규화 제목 완전일치** ③실패 시 null→플레이스홀더 |

## 2. 설계에서 붙든 것 3가지

1. **null ≠ 0.** 소계·배송비가 없으면 행을 숨긴다. 최소 웹훅이 기존 값을 덮지 않도록
   `값 ?? 캐시값`, 0(무료배송)은 진짜 값으로 통과. 매퍼는 `?? null`로 내려 JSON에서 키가
   사라지지 않게 한다.
2. **부분일치 금지.** 제목 폴백은 정규화(소문자·공백 1칸) 후 **완전일치만**. `LIKE '%Fan%'`는
   "Fan Cover"와 "Ultra Mini Portable Fan"을 무작위로 고른다 — `fulfil`→`Unfulfilled` 전례와
   같은 계열이라 역검증 테스트(U9)로 못 박았다.
3. **`itemQty` ≠ `itemCount`.** 상세는 수량 합, 목록 DTO의 `itemCount`는 행 수. 같은 이름으로
   두 뜻을 쓰지 않는다.

## 3. 파일

- API: `sql/260920-orders-cache-money-breakdown.sql` · `sql/260920-products-cache-external-id.sql` ·
  `sql/artefacts.tsv` · `docker/init-sql/01-schema.sql` ·
  `domain/order/{entity/order-cache.entity.ts, order.mapper.ts, order.service.ts, order.module.ts,
  shopify-admin.client.ts, shopify-sync.service.ts}` ·
  `domain/product/{entity/product-cache.entity.ts, product-sync.service.ts}`
- 계약: `packages/types/src/api/widget.types.ts`(전부 optional·nullable = 추가형)
- 위젯: `components/orders/OrderDetail.tsx` · `i18n/locales/*.ts`(6언어)
- 테스트: `order.mapper.spec.ts`(+4) · `shopify-sync.service.spec.ts`(+2) ·
  `order.service.itemimages.spec.ts`(신규 5)
- 문서: TCR/RPT-260920

## 4. 테스트 (TCR-260920)

api **1940/1940**(191 suites, 신규 11) · types 108/108 · widget 36/36 · `tsc` 4패키지 · 빌드 ·
`i18n:check` 6언어 complete.

스테이징 실측: 스키마 5컬럼 선적용 → 카탈로그 동기화 `synced 2289`(external_id 2,289/2,316) →
주문 전량 재동기화 `6건` → 금액 컬럼 6건 전부 적재(배송비 15.00·8.00·0.00 혼재) →
**실 고객 세션으로 `GET /orders/:id`** 확인:

```json
{ "orderNumber": "1005", "subtotal": 729.95, "discountTotal": 0, "shippingTotal": 0,
  "itemQty": 1, "contactName": "Test Customer", "contactEmail": "f***@gmail.com",
  "items": [{ "title": "The Multi-location Snowboard", "qty": 1, "imageUrl": null }] }
```

## 5. 배포 상태

| 항목 | 상태 |
|---|---|
| PR | **#556** → main `e31c061` |
| SQL staging | **선적용 완료** 2026-09-20 (코드 배포 전) |
| 코드 staging | 배포 완료 — api healthy, `successfully started` 1회, 엔티티 4필드 추가 후 정상 부팅 |
| SQL production | **선적용 완료** 2026-09-20 — `db_sharptalk`에 5컬럼 확인 후 코드 배포 |
| 코드 production | 배포 완료 2026-09-20 — `main:production` 승격(`0d1b68d`) → `check-migrations.sh` **82 적용·대기 0** → `deploy-self-hosted.sh`. api healthy·`successfully started` 1회·스키마 관련 에러 로그 0건 |

프로덕션 스모크(내용 기준): 위젯 번들에 `orders.detail`·`문의하기`·`Contact information`·
`Subtotal` 모두 존재. 번들 해시는 스테이징과 다르다 — `VITE_*`가 환경마다 인라인되기 때문이며,
같은 코드인지는 해시가 아니라 내용으로 확인해야 한다.

## 6. 잔여·후속

- **화면 육안 확인 1회 필요**: 도킹 모드에서 자동화 클릭이 교차 오리진 iframe이 아니라 페이지로
  전달돼(패널이 닫힘) 개편 화면 스크린샷을 남기지 못했다. 데이터 경로는 §4로 확인했다.
- **이 스토어에서는 썸네일이 플레이스홀더**: 주문 품목이 Shopify 데모 상품이라 IVY 카탈로그와
  같은 상품이 아니다(REQ §2-2 예고). 조인 키는 정상(TCR §2-4).
- 옵션 텍스트는 웹훅 경로 주문에만 존재(D1=ⓑ의 결과, PLN §1). 정확도를 올리려면 `read_products`
  스코프 추가(ⓐ) — 이번 구조는 그대로 두고 1차 소스만 바뀐다.
- **주소(G8)**: PCD 승인 후 별도 REQ. 화면은 연락처 아래에 자리를 비워 뒀다.
- PWA `OrderDetailPage` 동일 개편 여부 미결(응답 추가형이라 현재는 무해).
- 할인 > 0 실데이터 케이스 미확인(단위 테스트로만 검증).

# TCR-260920 — 위젯 주문 상세 개편 테스트 케이스·결과

- 근거: PLN-260920-Widget-Order-Detail-Redesign §5 · PR #556(main `e31c061`)
- 환경: 로컬(jest/tsc/빌드) + **스테이징 실측**(`shoptalk.amoeba.site`, 테넌트 ivyusa,
  스토어 `ambshop-dev.myshopify.com`, 실제 로그인 고객 세션)

## 1. 단위 — 신규 11건 (전부 통과)

| # | 케이스 | 기대 | 결과 |
|---|---|---|---|
| U1 | 매퍼: 금액 4필드가 값 그대로 실린다 | subtotal 55 · discount 4.99 · itemQty 3 · shipping **0** | PASS |
| U2 | 매퍼: 미수집 금액은 **null**(undefined 아님) | JSON에서 키가 사라지지 않음 | PASS |
| U3 | 매퍼: 연락처는 주인 고객만, 없으면 null | contactName/Email | PASS |
| U4 | 매퍼: 이미지가 **해당 라인에만** 붙는다 | 미매칭 라인은 null | PASS |
| U5 | 동기화: 문자열 금액 파싱 + 수량 **합계**(행 수 아님) | 2+1 → itemQty 3, shipping 0 유지 | PASS |
| U6 | 동기화: 최소 웹훅이 기존 내역을 덮지 않는다 | 캐시값 보존 | PASS |
| U7 | 이미지: `product_id` ↔ `external_id` 정확 조인 | 제목이 바뀌어도 매칭 | PASS |
| U8 | 이미지: 상품 id 없는 라인은 **정규화 제목**으로 | 대소문자·공백 차이 흡수 | PASS |
| U9 | 이미지: **부분일치 금지** — "Fan"이 "Ultra Mini Portable Fan"을 잡지 않는다 | 미매칭 | PASS |
| U10 | 이미지: 매칭 실패 시 빈 맵(플레이스홀더) | size 0 | PASS |
| U11 | 이미지: 테넌트 없으면 **쿼리 자체를 안 한다** | createQueryBuilder 미호출 | PASS |

회귀: api **1940/1940**(191 suites) · types 108/108 · widget 36/36 · `tsc` 4패키지 · 빌드 ·
`i18n:check` 6언어 complete.

> U5/U6에서 `OrderService` 생성자 중간 주입이 **위치 인자로 서비스를 만드는 기존 스펙 4건**을
> 깨뜨리는 것을 발견 → 주입을 맨 끝으로 옮겨 해결(이 저장소에서 두 번째 겪는 함정).

## 2. 통합 — 스테이징 실측

### 2-1. 스키마 선적용 (코드 배포 전)

```
orders_cache   : subtotal · discount_total · shipping_total · item_qty   ✅
products_cache : external_id (+ idx_prdc_tenant_ext)                      ✅
```

### 2-2. 동기화 결과

| 항목 | 결과 |
|---|---|
| 카탈로그 동기화 | `synced 2289` → `products_cache` 2,316건 중 **external_id 2,289건** |
| 주문 전량 재동기화 | `Synced 6 order(s) (initial full sync)` |
| 금액 컬럼 | 6건 전부 채워짐 — 예: `1006` total 744.95 / subtotal 729.95 / shipping **15.00** / qty 1, `1002` subtotal 24.95 / shipping **8.00**, 나머지 shipping **0.00** |

### 2-3. 실제 고객 세션으로 본 응답 (`GET /orders/:id`)

스토어 로그인 상태의 앱 프록시 신원으로 조회(이메일은 보고용 마스킹).

```json
{ "orderNumber": "1005", "total": 729.95,
  "subtotal": 729.95, "discountTotal": 0, "shippingTotal": 0, "itemQty": 1,
  "contactName": "Test Customer", "contactEmail": "f***@gmail.com",
  "items": [ { "title": "The Multi-location Snowboard", "qty": 1,
               "optionText": null, "imageUrl": null } ] }
```

렌더 규칙 대조: 할인 0 → **Discount 행 숨김**(>0일 때만) · 배송비 0 → **Free** ·
소계 존재 → `Subtotal · 1 item` · 옵션 null → 수량만 · 이미지 null → **플레이스홀더**.

### 2-4. 썸네일이 이 스토어에서 비어 있는 이유 (예상된 결과)

`ambshop-dev`의 주문 품목은 Shopify **데모 상품**("The Multi-location Snowboard" 등)이고,
`products_cache`에 있는 것은 IVY의 실제 카탈로그(2,316건)라 **애초에 같은 상품이 아니다**
(REQ §2-2에서 예고). 조인 키 자체는 살아 있음을 확인:

```
external_id 7465131966523  RED by KISS 1/4" Pencil Curling Iron  https://cdn.shopify.com/...
```

→ 카탈로그와 주문이 같은 스토어인 실제 테넌트에서는 매칭된다. 이 스토어에서는 플레이스홀더가
정상 동작이다.

## 3. 미수행 / 남은 확인

| 항목 | 사유 |
|---|---|
| **개편 화면 스크린샷(실 스토어)** | 도킹 모드에서 자동화 클릭이 교차 오리진 iframe이 아니라 페이지로 전달돼 패널이 닫힌다. 데이터 경로는 §2-3으로 확인했고, 화면은 사람 눈으로 1회 확인 필요 |
| 모바일 compact 실기기 | 풀스크린 시트 경로(변경 없음)지만 실기기 1회 권장 |
| PWA 주문 상세 | 같은 API를 쓰지만 화면은 이번 범위 밖(응답이 추가형이라 무해) |
| 할인 > 0 케이스 | 테스트 주문에 할인이 없어 실데이터로는 미확인(U1·U5에서 단위 검증) |

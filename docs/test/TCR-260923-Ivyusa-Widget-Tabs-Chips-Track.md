# TCR-260923 — ivyusa 위젯 탭·칩·리뷰·Track 테스트 케이스

- 근거: REQ/PLN-260923-Ivyusa-Widget-Tabs-Chips-Track · FIX-260923-Signed-In-Widget-Tenant-Config

## 1. 단위 테스트 (자동)

| # | 파일 | 케이스 | 결과 |
|---|---|---|---|
| U1 | `apps/widget/test/tab-chips.test.mjs` | 목록 탭 1개: `all·orders(Payment)·shipping·event·review` / Inquiries는 `issueFeed`일 때만 / 목록 탭 2개: 기존 분할 칩·`Orders` 라벨 불변 | ✅ 3/3 |
| U2 | `order/carrier-tracking.spec.ts` | 스테이징 실데이터 배송사(UPS·An Post·Amazon Logistics) URL / 대소문자·구두점·별칭 / **부분일치 거부**(`UPS Mail Innovations`, `Pups Express`) / 번호 URL 인코딩 / 저장 URL 스킴 검증(javascript:·data:·상대경로·1024자 초과 거부) | ✅ |
| U3 | `order/order.service.tracking.spec.ts` | `trackingUrl` 우선순위: 저장 URL → 배송사 규칙 → null / 저장된 비-http URL 미노출 / `applyFulfillment` 신규 행 tenant_id 기록 / 기존 NULL 행 수리 / 위험 URL 폐기 | ✅ |
| U4 | `order/shopify-webhook.service.spec.ts` | 웹훅 `tracking_url` 전달, 없으면 `tracking_urls[0]` | ✅ |
| U5 | `order/shopify-admin.client.lineitems.spec.ts` | rich tier가 `handle onlineStoreUrl` 요청 / `productUrl`: onlineStoreUrl 우선 → `https://{shop}/products/{handle}` → null / 비-http 무시 | ✅ |
| U6 | `order/order.service.reviewitems.spec.ts` | tenant+customer 스코프 / 배송완료 = 주문상태 OR 배송행 delivered / 세션 tenant 없을 때 고객에서 복구 / 주문 0건이면 품목 조회 생략 / 최신 주문 우선·`reviewed`는 본인 리뷰만 | ✅ |
| U7 | `session.service.spec.ts` · `session.mapper.spec.ts` | `issueFeed`: native/bridge=true, base=false / 응답 필드 포함 | ✅ |
| U8 | `packages/types/.../widget-theme-review-link.spec.ts` | 템플릿 정규화(선행 토큰·절대 URL·토큰 없음/스킴/길이 거부) / `normalizeDesign` 통과·불량값 격리 / `reviewLinkFor` 조립·인코딩·null 폴백 | ✅ |

전체: API **195 suites / 1,969 tests 통과**, types 116 통과, widget node 39 통과, `i18n:check` 6개 언어 complete,
`tsc`(api/web/widget) 오류 0, turbo build(api·web·widget) 성공.

## 2. 통합 시나리오

| # | 시나리오 | 기대 | 방법 |
|---|---|---|---|
| I1 | 로컬 API 부팅(엔티티 2컬럼 추가) | `Nest application successfully started` | ✅ :3099 부팅 |
| I2 | `GET /orders/review-items` 토큰 없음 | **401**(라우트가 `:id` ParseIntPipe에 먹히면 400) | ✅ 401 |
| I3 | `POST /session/ensure` | `issueFeed:false`, `widgetTabs` 유지 | ✅ |
| I4 | SQL 2건 로컬 적용 | 컬럼 생성, tenant_id NULL 0행 | ✅ (구 로컬 DB에 `image_url` 없어 `AFTER` 제거 — 컬럼 순서 비의존) |
| I5 | 스테이징: 로그인 쇼퍼 위젯 | **2탭**(Notifications·Chat) | 배포 후 RPT |
| I6 | 스테이징: 칩 | `All·Payment·Delivery·Event·Review` (ivyusa workflow_mode 확인) | 배포 후 RPT |
| I7 | 스테이징: 주문 상세 Track(#1001 UPS 1Z999AA1…) | 새 창 `ups.com/track?tracknum=…`, 행에 `UPS 1Z…` 표기 | 배포 후 RPT |
| I8 | 스테이징: 배송 칩 카드 `Track Order` | URL 있으면 배송사, 없으면 주문 상세 | 배포 후 RPT |
| I9 | 스테이징: 리뷰 칩 | 배송완료 품목 목록, `productUrl` 없는 품목은 위젯 폼(다음 동기화 뒤 링크로 전환) | 배포 후 RPT |

## 3. 엣지 케이스

| # | 케이스 | 처리 |
|---|---|---|
| E1 | 분할 배송(주문당 fulfillment 여러 건) | 현행대로 마지막 1건만(G9, 범위 밖) |
| E2 | 웹훅 `orders/updated`가 품목을 재작성 | 웹훅엔 URL이 없어 `product_url` NULL로 → 다음 동기화에서 복구, 그 사이 위젯 폼 폴백 |
| E3 | 동기화가 delivered 주문을 `shipping`으로 되돌림 | 리뷰 자격을 배송행 delivered로도 판정해 목록 누락 방지(배지 불일치 자체는 별건) |
| E4 | 테넌트 템플릿이 잘못됨 | 저장 시 null로 정규화 → 상품 페이지 |
| E5 | 스토어 로그아웃(게스트) | 리뷰·결제·배송 칩은 기존대로 로그인 안내 |
| E6 | 3탭 테넌트(go2joy·기본) | 칩 구성 불변(U1) — 단 `review` 칩은 목록으로 바뀜(알림 행은 해당 테넌트의 Orders 탭 외 노출 없음, PLN §3) |

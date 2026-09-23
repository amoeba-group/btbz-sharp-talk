# RPT-260923 — ivyusa 위젯 탭·칩 재구성 + 리뷰 칩 + Track 배송사 이동 실행 보고

- 근거: REQ/PLN-260923-Ivyusa-Widget-Tabs-Chips-Track (사용자 승인 2026-09-24 "진행", 권장안 D-1~D-5)
- 관련: FIX-260923-Signed-In-Widget-Tenant-Config · TCR-260923-Ivyusa-Widget-Tabs-Chips-Track

## 1. 배포 상태

| 항목 | 값 |
|---|---|
| PR | **#562** (본 구현, squash `41c5031`) · **#563** (리뷰 창 20/90 정정, squash `e9c1c9d`) |
| 스테이징 SQL | `260924-fulfillments-tracking-url.sql` ✅ · `260924-order-items-product-url.sql` ✅ (적용 전 스키마 백업 `~/backup-pre-260924-20260924-083215.sql`, tenant_id NULL fulfillment 1→0) |
| 스테이징 코드 | #562 → #563 순 배포, `Nest application successfully started`, API restarts=0 |
| 신규 라우트 | `GET /api/v1/orders/review-items` 무토큰 **401**(배포됨) |
| 프로덕션 | **미반영** — 별도 승인 필요(SQL 2건 동일 순서로 선적용) |
| init-sql | 미갱신 — 260920 컬럼과 마찬가지로 다음 정기 재생성 때 반영 |

## 2. 변경 내용

| 단계 | 내용 | 주요 파일 |
|---|---|---|
| P0 | 로그인 쇼퍼 위젯이 테넌트 탭 설정을 못 받던 결함 — `adoptTenantConfig()`로 두 ensure 경로 통일 | `widget/hooks/useSession.ts`, `useSessionProfile.ts` |
| P1 | 목록 탭 1개 칩 `전체·결제·배송·이벤트·리뷰`, 문의는 `issueFeed`(workflow_mode ≠ base)일 때만. en `Shipping`→`Delivery` | `tab-chips.ts`, `NotificationsTab.tsx`, `session.service.ts`/`mapper`, `widget.types.ts` |
| P2 | `fulfillments.tracking_url` 저장(웹훅 `tracking_url`/`tracking_urls[0]`, http(s)만) + 배송사 레지스트리(전체 일치) → `TrackingResponse.trackingUrl`. 주문상세 Track 행·배송 카드 버튼이 배송사 페이지 새 창, 없으면 기존 스테퍼. `applyFulfillment` tenant_id 기록 | `carrier-tracking.ts`, `order.service.ts`, `shopify-webhook.service.ts`, `OrderDetail.tsx`, `ShipmentList.tsx` |
| P3 | `GET /orders/review-items`(배송완료 = 주문상태 OR 배송행 delivered, 20건/90일, tenant+customer, `reviewed`) · `order_items.product_url`(GraphQL `handle onlineStoreUrl`) · `design.reviewLinkTemplate`(콘솔 위젯 디자인 입력칸) · 위젯 `ReviewItemList`(링크 없으면 위젯 폼) | `order.service.ts`, `shopify-admin.client.ts`, `shopify-sync.service.ts`, `widget-theme.ts`, `WidgetDesignsCard.tsx`, `ReviewItemList.tsx` |

PLN과 다르게 한 것:
- 배송사 레지스트리를 `packages/common`이 아니라 **API order 도메인**에 둠 — URL은 서버가 계산하고 위젯은 결과만 쓰므로 공유 필요 없음.
- D-3 창을 **10/30 → 20/90**으로 정정(#563) — "기존 주문 목록"은 결제 칩(20/90)이고 10/30은 채팅 카드 창. 30일 창에서는 배송완료된 실주문이 빠져 스테이징에서 빈 목록이 됐음.
- PLN §3의 "알림 행의 `리뷰 쓰기`도 같은 링크 규칙으로" 는 **미적용** — 알림 행은 여전히 위젯 폼을 연다(후속 후보).

## 3. 테스트 결과

- API 195 suites / 1,969 tests ✅ (신규: carrier-tracking, tracking, review-items, 웹훅·lineitems·session 보강) · types 116 ✅ · widget node 39 ✅ · CI #562/#563 통과
- `tsc` api/web/widget 0, turbo build ✅, `i18n:check` 6개 언어 complete, 로컬 부팅 ✅
- 스테이징 실측 (API, 테스트 고객 세션):

| 확인 | 결과 |
|---|---|
| `session/ensure` (ambshop-dev) | `widgetTabs ["notifications","chat"]`, `issueFeed false` (ivyusa workflow_mode=base) |
| 스토어 임베드, 로그인 상태 | **Notifications · Chat 2탭** 표시 ✅ (P0 해소 확인) |
| `#1001` tracking | `An Post 123123123` → `https://www.anpost.com/Post-Parcels/Track/History?item=123123123` ✅ |
| `#1005` tracking | 배송 없음 → `trackingUrl null` (인라인 스테퍼 유지) ✅ |
| review-items | `1001 Selling Plans Ski Wax`, `productUrl https://ambshop-dev.myshopify.com/products/selling-plans-ski-wax`(배포 후 예약 동기화가 채움), `reviewed false` ✅ |

**미완 실측**: 칩 줄·Track 새 창·리뷰 링크의 스토어 화면 클릭 확인. 자동화 브라우저로 패널 안을 클릭하면
패널이 닫혔고(부모 문서가 `pointerdown`을 받아 로더의 바깥 클릭 닫기가 동작), 이후 새 창은 스토어 비밀번호
페이지로 막혀 중단 — 실제 마우스 확인 필요. 서버 응답은 위 표대로 정상.

## 4. 발견한 별건 (이번 범위 밖)

1. **동기화가 배송완료 주문을 `shipping`으로 되돌림** — `mapStatus`는 delivered를 모르므로 예약 동기화마다
   웹훅이 올린 delivered가 In transit 배지로 돌아감(#1001: 배지 In transit, 스테퍼 4단계 완료). 리뷰 자격은
   배송행으로도 판정해 영향 없음. 배지 불일치 수정은 별도 FIX 후보.
2. **주문당 fulfillment 1행**(분할 배송 시 마지막 송장만) — REQ G9.
3. `ReviewForm` 제출 실패가 조용히 무시됨(`/* ignore */`) — UX 피드백 MUST 위반, 기존 코드.

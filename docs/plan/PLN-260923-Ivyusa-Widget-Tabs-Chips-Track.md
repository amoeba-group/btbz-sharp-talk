# PLN-260923 — ivyusa 위젯 탭·칩 재구성 + 리뷰 칩 + Track 배송사 이동 실행 계획

- 근거: REQ-260923-Ivyusa-Widget-Tabs-Chips-Track · Figma `TalkTalk` node 345-17892 (+`05.Review` 프레임)
- ⚠️ **PLN 승인 후 착수.** 아래 결정(D-1~D-5)에 회신 받은 뒤 구현합니다.

---

## 0. 결정 요청

| # | 질문 | 권장안 |
|---|---|---|
| D-1 | 리뷰 `★ 리뷰 쓰기`가 이동할 곳 | **상품 페이지**(`{productUrl}`) + 테넌트 옵션으로 앵커/리뷰앱 경로 지정. URL이 없는 품목은 **위젯 내 리뷰 폼 폴백**. ivyusa가 쓰는 리뷰 앱(Judge.me 등)이 있으면 알려주세요 → 템플릿 기본값으로 설정 |
| D-2 | `문의(Inquiries)` 칩 | 흡수 세트에서 **기본 숨김**, 이슈 워크플로를 쓰는 테넌트만 노출 (ivyusa = 숨김) |
| D-3 | 리뷰 대상 품목 범위 | **배송완료(delivered) 주문의 품목만**, 최근 창(20건/90일, 결제 칩 주문 목록과 동일 — 구현 중 정정: 10/30은 채팅 카드 창) |
| D-4 | Track URL이 전혀 없을 때(송장 미입력) | 현행대로 **위젯 안 스테퍼 펼침** 유지 |
| D-5 | 칩 라벨 `배송` en 표기 | Figma en 프레임의 **`Delivery`** 로 변경(현행 `Shipping`) — 6개 언어 동시 |

## 1. 단계 계획

### P0 — 3탭 렌더 원인 규명 (FIX, 코드 최소 수정)
- 서버 `/session/ensure`는 `["notifications","chat"]`인데 스토어 임베드는 3탭 → 위젯 로컬 하네스(`public/trigger-test.html`)
  와 스토어 실측으로 재현, `setTabLayout` 도달 여부부터 추적.
- 결과는 **FIX-260923-…** 로 기록(근본 원인·예방 패턴). 원인이 설정/배포 쪽이면 코드 변경 없이 종료.

### P1 — 칩 재구성 (위젯, 공용 규칙)
- `tab-chips.ts` 흡수 세트: `all · orders(라벨 결제/Payment) · shipping(라벨 배송/Delivery) · event · review` (+조건부 `inquiries`).
- 칩 라벨을 `ChipDef.labelKey`로 분리 — **목록 탭 2개 모드(go2joy 등)의 `Orders` 라벨은 불변**.
- `inquiries` 노출 조건: 세션 응답에 이미 오는 테넌트 설정(이슈 워크플로 여부)으로 판단 — 없으면 응답 필드 1개 추가.

### P2 — Track → 배송사 페이지 (API + 위젯)
- SQL `sql/260923_fulfillment_tracking_url.sql`: `fulfillments.tracking_url VARCHAR(1024) NULL` + **tenant_id NULL 행 백필**
  (`UPDATE fulfillments f JOIN orders_cache o … SET f.tenant_id=o.tenant_id WHERE f.tenant_id IS NULL`).
- 엔티티 `trackingUrl`(명시 `type: 'varchar'` — union 타입 부팅사 방지) · `tenantId`를 생성 시 기록.
- 웹훅 DTO에 `tracking_url`, `tracking_urls` 추가 → `applyFulfillment(…, trackingUrl)`. `http(s)`만 허용(그 외 스킴 폐기).
- `packages/common` 에 `carrier-tracking.ts`: 정규화(소문자·공백/구두점 제거) **전체 일치** 레지스트리 →
  URL 템플릿(`{number}` URL 인코딩). 단위 테스트: 부분일치 오인(`"UPS Mail Innovations"`≠`UPS`는 별도 키) 포함.
- `trackingForSession` 응답에 `trackingUrl` = 저장된 URL ?? 레지스트리 URL ?? null.
- 위젯: `OrderDetail` `Track` 행 — `trackingUrl` 있으면 **외부 링크 행(↗ 아이콘)**, 없으면 현행 펼침.
  `ShipmentList` `Track Order` 버튼도 같은 값 사용(이미 조회하는 tracking 쿼리 재사용 — 추가 요청 0).
- GA4 `trackingView`에 `outbound: true|false` 파라미터.

### P3 — 리뷰 칩 = 구매 품목 목록 (API + SQL + 위젯)
- SQL: `order_items.product_url VARCHAR(1024) NULL`.
- GraphQL rich tier `product { legacyResourceId handle onlineStoreUrl featuredImage { url } }` →
  `product_url = onlineStoreUrl ?? https://{shop_domain}/products/{handle}`. 기존 품목은 다음 동기화 창에서 채워짐.
- `GET /orders/review-items`(`@Public` + 세션 고객 게이트, tenant 스코프): 배송완료 주문 품목 ↦
  `{ orderItemId, orderNumber, title, price, currency, imageUrl, productUrl, reviewed, deliveredAt }`.
  `reviewed` = `reviews` 테이블 `order_item_id` 존재(1쿼리 IN).
- 테넌트 옵션 `widgetTheme.review.linkTemplate`(정규화기에 추가, `{productUrl}` 필수 토큰, http(s)만) — 콘솔 위젯 디자인 화면에 입력칸 1개.
- 위젯 `ReviewItemList.tsx`: 디자인 행 + `★ 리뷰 쓰기`(새 창) / URL 없음 → 기존 `ReviewForm` / `reviewed` → 회색 `작성완료`.

### P4 — ivyusa 스테이징 적용·검증
- SQL 선적용 → 배포 → 스토어(ambshop-dev) 실측: 2탭·5칩·Track 새 창 URL·리뷰 링크. 임베드 검증(미리보기 창 ≠ 임베드).
- 콘솔에서 ivyusa 리뷰 링크 템플릿 설정(D-1 회신값).

## 2. 화면 설계 (ASCII 와이어프레임)

### 2-1. 목록 (칩 `결제`)
```
┌──────────────────────────────────┐
│ Hi, Test Customer              ⚙ │
│  Notifications (2)  │  Chat (1)  │  ← 탭 2개
│ ─────────────────                │
│ (전체)(결제)(배송)(이벤트)(리뷰)  │  ← 칩 5개 (결제 선택)
├──────────────────────────────────┤
│ 1005                     [Paid]  │
│ The Multi-location Snowboard     │
│ Aug 20, 2026 · $729.95         › │
├──────────────────────────────────┤
│ 1001                [In transit] │
│ Selling Plans Ski Wax          › │
└──────────────────────────────────┘
```

### 2-2. 칩 `리뷰`
```
│ (전체)(결제)(배송)(이벤트)(리뷰●) │
├──────────────────────────────────┤
│ [📦] 1001  [Review]              │
│      Selling Plans Ski Wax · $24.95
│      ★ 리뷰 쓰기 ↗        4일 전  │  ← 새 창: 상품 페이지(리뷰 영역)
├──────────────────────────────────┤
│ [📦] 0998  [Review]              │
│      Rose Hip Facial Oil · $55.00 │
│      ✓ 작성완료            9일 전 │  ← 이미 작성
├──────────────────────────────────┤
│ (빈 상태) 리뷰를 남길 수 있는     │
│  배송완료 상품이 없습니다         │
```

### 2-3. 주문 상세 하단
```
│ Contact information              │
│ Test Customer / fremdung@…       │
├──────────────────────────────────┤
│ 🚚 Track · UPS 1Z999AA1…      ↗  │  ← trackingUrl 있음: 새 창 이동
├──────────────────────────────────┤
│ 💬 Contact us                  › │
└──────────────────────────────────┘
  (trackingUrl 없음 → 현행: 🚚 Track ⌄ 펼쳐서 스테퍼)
```

### 2-4. 칩 `배송` 카드
```
│ 1001                [In transit] │
│ Selling Plans Ski Wax            │
│ (1)──(2)──(3)──( 4 )             │
│   Your order is on the way!      │
│ [        Track Order ↗        ]  │  ← URL 있으면 배송사, 없으면 주문 상세
```

## 3. 부작용 분석

| 대상 | 영향 | 대응 |
|---|---|---|
| 알림 탭만 켠 다른 테넌트(DB상 ivyusa만 `["notifications","chat"]`; NULL=기본 3탭) | 흡수 세트 변경은 **2탭 테넌트 전체**에 적용 | 현재 해당 테넌트는 ivyusa 1곳 — 확인 후 진행. 3탭 테넌트(go2joy·기본)는 칩 불변 |
| `?reopen=orders` 딥링크 | 기존: 2탭이면 `shipping` 칩으로 착지 | 유지(키 불변) |
| 리뷰 알림(`review` 카테고리) | 리뷰 칩이 목록으로 바뀌어 알림 행은 `전체`에서만 보임 | 알림 행의 `리뷰 쓰기`도 동일 링크 규칙으로 통일 |
| 스키마 2컬럼 추가 | 구 코드 + 신 컬럼 = 안전 | SQL 선적용 후 배포, 롤백 = 코드 되돌림(컬럼 잔존 무해) |
| GraphQL 쿼리 필드 추가 | 스코프 부족 시 rich→basic 사다리(#559) 그대로 강등 | 강등 시 `product_url` NULL → 리뷰 폼 폴백 |
| Track 외부 이동 | 인앱 스테퍼 노출 감소 | URL 없는 주문은 현행 유지 |
| 프로덕션 | 이번은 스테이징만 | 프로덕션 반영은 별도 승인(SQL 동일) |

## 4. 테스트 (TCR 예고)
- 단위: 칩 세트(2탭/3탭/inquiries 조건) · 배송사 레지스트리(전체 일치, 부분일치 거부, 번호 인코딩, 스킴 거부) ·
  `trackingForSession` 우선순위 · review-items 테넌트/고객 경계(타 고객 품목 0건) · linkTemplate 정규화.
- 통합: 웹훅 페이로드(`tracking_url` 有/無) → 응답 `trackingUrl`.
- 실측: 스토어 임베드 2탭·5칩·링크 새 창, `npm run i18n:check`, API 부팅 로그 `successfully started`.

## 5. 산출물
REQ(본 근거) → PLN(본 문서) → 구현 PR(`## Migration` 포함) → TCR-260923 → RPT-260923 (+P0 결과 FIX-260923).

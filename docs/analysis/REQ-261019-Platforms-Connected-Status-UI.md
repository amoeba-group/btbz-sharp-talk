# REQ-261019 플랫폼 연동 화면 — 실제 연동된 플랫폼만 표시 + 자체 플랫폼 카드 분석서

- 작성일: 2026-10-19
- 요청: `https://shoptalk.amoeba.site/settings/platforms` 에서 **실제 연동된 플랫폼에만 "연동됨"이 표시**되어야
  한다. go2joy는 자체 플랫폼이라 Shopify·Cafe24·WooCommerce·Odoo·Haravan 어디에도 연동하지 않았는데
  **Shopify 카드가 "연결됨"으로 노출**된다. 화면은 (1) 지원 플랫폼을 버튼으로 보여주고, (2) 연동 설정이
  완료된 플랫폼만 연동 표시하며, (3) **자체 플랫폼 연동 카드**(예: go2joy)를 추가해야 한다. 현재 페이지 UI
  개선안도 함께 제시한다.
- 조사 방법: 스테이징 `integration_status`·`integration_credentials`·`tenants` 실측, **go2joy 마스터 계정으로
  설정 API 직접 호출**(`/tenants/me/shopify`, `/tenants/me/integrations/*`, `/tenants/me/credentials`), 코드 전수
  추적(페이지 → 타일 → 훅 → 컨트롤러 → 서비스 → 테이블), 선행 수정(FIX-260827) 범위 대조.
- 선행 문서: `FIX-260827-Integration-Status-Per-Tenant.md`(일반 플랫폼 per-tenant 전환), `PLN-260824-…`(설정 탭
  분리 B, 자체 개발 연동 D5), `PLN-260807-…`(Cafe24 OAuth P-A1).

## 1. 결론 요약

| # | 판정 | 내용 |
|---|---|---|
| R1 | **결함(버그)** | Shopify 카드의 "연결 상태"는 테넌트 구분이 없는 전역 `integration_status.shopify` 한 행을 읽는다. 이 행은 ivyusa의 자동 주문 동기화가 10분마다 `connected`로 갱신하므로, Shopify 자격증명이 **없는** go2joy에도 "연결됨 · 마지막 테스트 2026-10-19 11:48"이 뜬다. FIX-260827이 cafe24/woo/odoo/haravan만 per-tenant로 옮기고 Shopify는 "자체 흐름"이라며 남겨 둔 잔여 결함이다. |
| R2 | **갭(UI 설계)** | 화면이 "지원 플랫폼 5종을 전부 같은 크기의 카드로 나열"하는 구조라 연결 여부가 배지 한 개 차이로만 드러난다. Cafe24는 자격증명 카드와 OAuth 카드로 **두 번** 나오고, "자체 개발 연동" 카드는 웹훅 시크릿 입력란뿐이라 "우리 플랫폼이 무엇인지"를 등록·표시할 수 없다. |
| R3 | **갭(개념 부재)** | "자체 플랫폼"이라는 연동 유형이 데이터에 없다. go2joy는 `commerce_enabled=0`·`shop_domain=https://www.go2joy.vn`으로만 구분되며, 화면 어디에도 "Go2Joy 자체 플랫폼"이라는 표현이 없다. |
| R4 | 부수 | R1의 전역 행은 **타 테넌트의 동기화 결과 문자열**("Synced 0 order(s) updated since …")까지 go2joy 화면에 노출한다. 비밀값은 아니지만 교차 테넌트 정보 노출이다(§2 보안 규칙 "never leak cross-tenant data"). |

## 2. AS-IS — 실측 (스테이징 2026-10-19)

### 2.1 데이터

`integration_status`(전역, `tenant_id` 없음):

| id | name | status | last_sync_at | detail |
|---|---|---|---|---|
| 1 | shopify | connected | 2026-10-19 11:48:26 | Synced 0 order(s) updated since 2026-10-19T11:08:26Z ← **ivyusa 자동 동기화** |
| 2 | fulfillment | connected | — | Seeded (mock) |
| 3 | klaviyo | connected | — | Seeded (mock) |
| 4 | odoo | connected | 2026-08-28 | Synced 115 product(s) |
| 5 | google_drive | connected | — | Seeded (mock) |
| 7 | yotpo | connected | 2026-08-27 | Connected |
| 8 | haravan | connected | 2026-08-27 | Synced 27 order(s) |

`integration_credentials`(per-tenant) 중 go2joy(tenant 4): **`notion` 1건뿐**. Shopify·Cafe24·Woo·Odoo·Haravan 행 없음.
`tenants` 4: slug `go2joy`, `shop_domain=https://www.go2joy.vn`, `storefront_url` 동일, `commerce_enabled=0`, plan `enterprise`.

### 2.2 go2joy 마스터로 호출한 설정 API

```
GET /tenants/me/shopify
{"shopDomain":"https://www.go2joy.vn","credential":{"configured":false,"updatedAt":null},
 "integration":{"status":"connected","lastSyncAt":"2026-10-19T11:48:26.000Z",
                "detail":"Synced 0 order(s) updated since 2026-10-19T11:08:26.000Z"}}
GET /tenants/me/integrations/cafe24      → credential.configured=false, integration.status=null
GET /tenants/me/integrations/woocommerce → credential.configured=false, integration.status=null
GET /tenants/me/integrations             → [{provider:"notion", status:"connected"}]   (대시보드용, 정상)
```

자격증명은 **없다**(`configured=false`)고 답하면서 같은 응답에서 연결 상태는 **connected**라고 답한다.
이 모순이 그대로 Shopify 카드 배지가 된다.

### 2.3 코드 경로

| 플랫폼 | 타일 상태 소스 | per-tenant? |
|---|---|---|
| Shopify | `TenantService.getShopifyView()` → `integrationService.findByName('shopify')` = **전역 행** | ❌ |
| cafe24/woo/odoo/haravan | `EcommerceIntegrationService.getSettings()` → `integration_credentials(tenant, provider).status` | ✅ (FIX-260827) |
| Cafe24 OAuth 카드 | `useIntegration('cafe24')` → `status==='connected' \|\| configured` | ✅ (단, "저장=연결"로 완화됨) |
| 자체 개발 카드 | `useCredentials()` 중 `fulfillment` 행 유무 | ✅ (연결 상태 개념 없음) |

Shopify의 전역 쓰기 지점: `TenantService.recordShopifyTest()`(연결 테스트), `ShopifySyncService.record()`(수동·자동
주문 동기화, 웹훅 등록). 자동 동기화(`ScheduledShopifySyncService.runAll`)는 Shopify 자격증명이 있는 테넌트를
돌며 `syncOrders(tenantId)`를 호출하고, 그 결과를 **테넌트 구분 없이** 같은 행에 덮어쓴다. 증분 커서
(`since = last_sync_at − lookback`)도 이 전역 행을 읽는다(현재 Shopify 테넌트가 ivyusa 1곳이라 실해는 없음, §6).

### 2.4 사용자가 본 화면 (go2joy)

```
플랫폼 연동                                        [📖 연동 가이드]
쇼핑몰이 돌아가는 곳

┌ Shopify 연동 ───────[연결됨]┐ ┌ Cafe24 ──────────[미테스트]┐ ┌ WooCommerce ─────[미테스트]┐
│ your-store.myshopify.com   │ │ Admin API(OAuth…)로 연결  │ │ REST API consumer key…    │
│ 자격 증명: 미설정           │ │ 자격 증명: 미설정          │ │ 자격 증명: 미설정          │
│ 마지막 테스트: 10/19 11:48 │ │ 마지막 테스트: —          │ │ 마지막 테스트: —          │
│ [⚙ 설정]                   │ │ [⚙ 설정]                  │ │ [⚙ 설정]                  │
└────────────────────────────┘ └───────────────────────────┘ └───────────────────────────┘
┌ Odoo ─────────────[미테스트]┐ ┌ Haravan ─────────[미테스트]┐
│ … [⚙ 설정]                 │ │ … [⚙ 설정]                │
└────────────────────────────┘ └───────────────────────────┘

┌ Cafe24 (OAuth) ────────────────────────────────────────────┐   ← Cafe24 두 번째 카드
│ 상태 [연결 안 됨]   몰 ID [________].cafe24.com  [Cafe24 연결] │
└────────────────────────────────────────────────────────────┘
┌ 자체 개발 연동 ────────────────────────────────────────────┐   ← "플랫폼"이 아니라 웹훅 시크릿 폼
│ 웹훅 주소 [https://…/api/v1/webhooks/fulfillment] [복사]     │
│ 서명 시크릿 [••••••] [저장] [앱 공통 시크릿]                  │
└────────────────────────────────────────────────────────────┘
```

- Shopify 카드: 자격 증명 "미설정"인데 배지는 "연결됨", 마지막 테스트 시각은 ivyusa 것(R1·R4).
- 나머지 4장은 미설정인데도 "미테스트" 회색 배지로 연결 카드와 같은 크기·같은 무게(R2).
- Cafe24가 두 카드(R2). 자체 개발 카드는 go2joy처럼 주문이 없는 테넌트에게는 의미가 없고(`commerce_enabled=0`),
  "우리는 자체 플랫폼"이라는 사실을 적을 곳이 없다(R3).

## 3. 원인 판정

- **R1 근본 원인**: `integration_status`는 FR-047 시절의 **플랫폼 전역** 상태 테이블(이름 유니크, `tenant_id` 없음).
  FIX-260827이 일반 플랫폼을 `integration_credentials`로 옮기면서 Shopify는 `TenantService`의 별도 흐름이라는 이유로
  **읽기(`getShopifyView`)·쓰기(`recordShopifyTest`, `record`) 모두 전역에 남겼다**. 시드가 `shopify` 행을 mock
  `connected`로 만들고, ivyusa의 10분 주기 자동 동기화가 그 행을 계속 `connected`로 유지하므로 모든 테넌트의
  Shopify 카드가 항상 "연결됨"이다.
- **R2·R3**: 설정 탭 분리(PLN-260824 B)가 "카드를 옮기기만" 했고, 플랫폼 유형(외부 플랫폼 vs 자체 플랫폼)과
  연결 단계(미설정 → 설정됨 → 검증됨)를 화면 구조에 반영하지 않았다.

## 4. TO-BE

1. **연결 상태의 유일한 소스 = `integration_credentials(tenant, provider)`** — Shopify도 일반 플랫폼과 같은 규칙.
   자격증명이 없으면 상태 없음, 저장만 하면 `unknown`(미테스트), **연결 테스트 또는 동기화 성공**이 `connected`.
   전역 `integration_status`는 Shopify 읽기 경로에서 제거(어드민용 전역 집계로만 남김).
2. **화면을 두 영역으로 분리**:
   - **연결된 플랫폼** — 자격증명이 있는 플랫폼만 카드로. 배지는 `연결됨 / 오류 / 미테스트` 3종, 액션은
     `설정 · 연결 테스트 · 동기화`(플랫폼별로 가능한 것만). 하나도 없으면 안내 문구 + 아래 영역으로 유도.
   - **플랫폼 추가** — 지원 플랫폼을 **버튼(칩)** 으로 나열: Shopify · Cafe24 · WooCommerce · Odoo · Haravan ·
     **자체 플랫폼**. 이미 연결된 것은 목록에서 빠진다(또는 ✓ 표시 후 비활성). 클릭하면 해당 플랫폼의 설정
     모달이 열린다(Cafe24는 OAuth 연결 모달).
3. **자체 플랫폼 카드**: 플랫폼 이름(예: "Go2Joy")과 설명을 등록하면 "연결된 플랫폼"에 `등록됨` 배지로 나타난다.
   스토어 주소는 기본 설정의 `storefront_url`을 그대로 보여 준다. 주문 기능이 켜진 테넌트(`commerce_enabled=1`)
   에게만 기존 **주문 이행 웹훅(주소·서명 시크릿)** 블록을 카드 안에 보여 주고, go2joy처럼 꺼진 테넌트에게는
   "주문 기능 꺼짐 — 위젯 설치만으로 연동 완료(위젯 설정 → 임베드·SDK)" 한 줄로 대체한다.
4. Cafe24는 **한 항목**으로: "플랫폼 추가 → Cafe24"는 OAuth 연결 모달(몰 ID → Cafe24 동의 화면), 연결된 Cafe24
   카드의 "설정"은 기존 자격증명 모달(토큰 교체·테스트·동기화).

## 5. 갭 분석

| # | AS-IS | TO-BE | 변경 지점 |
|---|---|---|---|
| G1 | Shopify 상태 = 전역 행 | per-tenant cred 상태 | `TenantService.getShopifyView/recordShopifyTest`, `ShopifySyncService.record` |
| G2 | Shopify 저장 시 cred.status 유지(`unknown`) + 테스트는 전역 기록 | 테스트·동기화 성공 시 cred.status/detail/lastTestedAt 갱신 | 위와 동일, spec 갱신 |
| G3 | 지원 플랫폼 5장 동일 카드 | 연결된 카드 + 추가 버튼 두 영역 | `SettingsPlatformsPage`, `ProviderGrid` 분리 |
| G4 | Cafe24 카드 2장 | 추가 = OAuth 모달, 설정 = 자격증명 모달 | `Cafe24ConnectCard` → 모달화 |
| G5 | 자체 플랫폼 개념 없음 | provider `self`(이름·설명) + 등록됨 배지 | `INTEGRATION_PROVIDER.SELF`, `INTEGRATION_FIELDS.self`, 저장 게이트 예외 |
| G6 | 자체 개발 카드 = 웹훅 폼 상시 노출 | 자체 플랫폼 카드 내부, `commerce_enabled=1`일 때만 | `SelfDevelopmentCard` 흡수 |
| G7 | 타 테넌트 동기화 문자열 노출(R4) | G1로 함께 해소 | — |
| G8 | 대시보드 "연동 상태" 라벨에 `self` 없음 | `integration.self` 추가 | `dashboard.json` 6개 언어 |

## 6. 제약·전제

- **스키마 변경 없음**: 자체 플랫폼은 `integration_credentials`의 provider `self` 행(암호화 JSON에 이름·설명)으로
  표현한다. 일반 플랫폼도 비밀이 아닌 `mall_id`·`store_url`을 같은 방식으로 저장하므로 관례와 일치하고, 스테이징
  SQL 선적용이 필요 없다. `tenants.platform` 컬럼 신설은 어드민 집계가 필요해질 때 재검토.
- **fix-forward**: ivyusa Shopify cred(id 1)는 현재 `status=unknown`이다. 배포 직후 ivyusa 카드는 "미테스트"였다가
  다음 자동 동기화 틱(≤10분)에 `connected`로 바뀐다. 전역 행은 손대지 않는다.
- **자동 동기화 커서**가 전역 `integration_status.last_sync_at`인 점은 이번 범위 밖(Shopify 테넌트가 1곳이라 실해
  없음). 2곳 이상이 되면 `integration_credentials.last_synced_at` 컬럼으로 per-tenant화 — 별도 FIX 후보.
- 마케팅·헬프데스크 탭(`SettingsMarketingPage`)은 같은 `ProviderGrid`를 쓴다. 이번 변경은 플랫폼 탭만 재구성하고
  마케팅 탭은 현행 유지(구성 요소는 공유하되 레이아웃은 선택).
- `fulfillment` 자격증명 행은 스테이징에 0건 — 웹훅 블록을 자체 플랫폼 카드 안으로 옮겨도 기존 설정이 숨겨지는
  테넌트는 없다.

## 7. 사용자 플로우 (TO-BE)

1. go2joy 마스터가 설정 → 플랫폼 연동을 연다. "연결된 플랫폼"은 비어 있고(Shopify 사라짐) 안내 문구가 보인다.
2. "플랫폼 추가"에서 **자체 플랫폼**을 누른다 → 모달: 플랫폼 이름 `Go2Joy`, 설명 `호텔 파트너 어드민(자체 개발)` → 저장.
3. 성공 토스트. "연결된 플랫폼"에 `Go2Joy · 자체 플랫폼 [등록됨]` 카드가 생기고, 주문 기능이 꺼져 있으므로
   "위젯 설치만으로 연동 완료" 안내와 위젯 설정 링크가 보인다. "플랫폼 추가"에서 자체 플랫폼 버튼은 ✓로 바뀐다.
4. ivyusa 마스터는 같은 화면에서 `Shopify · ambshop-dev.myshopify.com [연결됨 · 11:58 동기화]` 카드 1장과
   추가 버튼 5개(Cafe24·Woo·Odoo·Haravan·자체 플랫폼)를 본다.
5. 대시보드 "연동 상태"에 go2joy는 `Notion`, `자체 플랫폼` 두 줄이 보인다.

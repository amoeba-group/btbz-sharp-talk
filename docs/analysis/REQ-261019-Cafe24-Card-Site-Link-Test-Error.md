# REQ-261019 플랫폼 연동 — Cafe24 기능 복원·플랫폼 사이트 바로가기·연결 테스트 오류 분석서

- 작성일: 2026-10-19 · 선행: `PLN-261019-Platforms-Connected-Status-UI.md`(#669~#676 배포)
- 요청(zhangbayo, `https://shoptalk.amoeba.site/settings/platforms`):
  1. Cafe24 연동 기능이 사라짐
  2. 연결된 플랫폼 카드에 **플랫폼 사이트 바로가기** 버튼 필요
  3. **연결 테스트**를 하면 오류 발생
- 조사: 스테이징 `tenants`·`integration_credentials`·`audit_logs` 실측, API 로그(13:00 재기동 이후), Cafe24 OAuth·토큰·
  프로브 코드 추적.

## 1. 결론 요약

| # | 판정 | 내용 |
|---|---|---|
| R1 | **결함(기존, 표면화)** | Cafe24 **OAuth** 연결은 자격증명을 `{mallId, refreshToken, scopes, refreshIssuedAt}`(camelCase, **액세스 토큰 없음** — 토큰 서비스가 매번 재발급)로 저장한다. 그런데 "연결 테스트"는 **수동 입력 스키마** `mall_id`/`access_token`을 읽는 일반 프로브라서 항상 "Required credentials are missing"을 내고, FIX-260827 규칙대로 **상태를 `error`로 기록**한다. zhangbayo(13:03:50)·tenant 3(13:06:09) 두 행이 이렇게 "오류"가 되었다. 이 불일치는 8/27부터 있었지만, 그때는 OAuth 카드가 `status \|\| configured`로 "연결됨"을 보여 줘 드러나지 않았다. |
| R2 | **회귀(PLN-261019)** | OAuth로 연결된 Cafe24의 **연결된 카드**가 일반 자격증명 모달(토큰 수동 입력)만 열고, 옛 Cafe24 (OAuth) 카드에 있던 **지금 동기화(주문)·상품 가져오기·재연결** 버튼이 사라졌다(`SYNCABLE`에 cafe24 없음, OAuth 모달은 "추가"에서만 열림). 카드 부제도 비어 있다(`fields.mall_id`가 camelCase `mallId`를 못 읽음). |
| R3 | **신규 요구** | 연결된 카드에서 해당 플랫폼의 관리자 화면(또는 스토어)으로 바로 가는 버튼이 없다. |

## 2. AS-IS — 실측 (스테이징 2026-10-19)

- `tenants` 16 = `zhangbayo`, `shop_domain=https://zhangbayomall.co.kr/`, `commerce_enabled=1`.
- `integration_credentials` id 14 = (16, cafe24): 11:5x `status=unknown` → 13:03:50 **`error`** (연결 테스트 직후). id 3 = (3, cafe24): 13:06:09 `error`. 두 행 모두 blob은 OAuth 형태(`mallId`·`refreshToken`).
- API 로그: `POST /tenants/me/integrations/cafe24/test -> 201` 4회(13:02~13:06). 응답 `ok:false, detail:"Required credentials are missing — fill in and save first"` → 토스트 빨강, 카드 배지 "오류".
- 자격증명 삭제·변경 쓰기 없음(DELETE 없음, 감사로그에 credential 액션 없음) — "사라짐"은 **데이터 손실이 아니라 화면 구성 변경**.

### 2.1 Cafe24 두 가지 연결 방식과 코드

| 방식 | 저장 형태 | 토큰 | 쓰는 곳 |
|---|---|---|---|
| OAuth(P-A1, 콘솔 "Cafe24 연결") | `Cafe24Credential` camelCase | refresh만 저장, access는 `Cafe24TokenService.refresh()`가 2h마다 재발급·캐시 | 주문 동기화, 상품 동기화, 고객 인증 |
| 수동(일반 자격증명 모달) | `INTEGRATION_FIELDS.cafe24` snake_case | `access_token` 직접 저장 | 일반 프로브(`probeCafe24`), 웹훅 시크릿 |

`EcommerceIntegrationService.getSettings/test`는 수동 형태만 안다. OAuth 형태를 만나면 `fields.mall_id=null`, 프로브 "missing".
`Cafe24Module`은 `TenantModule`을 import하므로 **TenantModule 쪽 일반 테스트에서 토큰 서비스를 호출하면 순환**이 생긴다
(OAuth 테스트는 Cafe24 모듈에 두어야 한다).

### 2.2 사용자가 본 화면 (zhangbayo)

```
연결된 플랫폼 (1)
┌ Cafe24 ──────────────────────────[오류]┐   ← 테스트 전엔 [미테스트]
│ Admin API(OAuth 액세스 토큰)로 …        │   ← 부제: 몰 ID 대신 설명 문구(mallId 못 읽음)
│ Required credentials are missing — …   │
│ 마지막 확인: 10/19 13:03                │
│ [⚙ 설정] [⚡ 연결 테스트]               │   ← 설정 = 토큰 수동 입력 모달, 동기화·재연결 없음
└────────────────────────────────────────┘
```

## 3. 원인 판정

- **R1**: 연결 방식이 둘인데 테스트 경로가 하나(수동용)뿐. 8/27 FIX-260827이 "테스트 성공만 연결됨"을 도입할 때
  OAuth Cafe24를 고려하지 않았고, OAuth 카드의 `status || configured` 완화가 그 구멍을 가렸다. PLN-261019 D2가 완화를
  제거하면서 드러났다.
- **R2**: PLN-261019 D6이 "추가 = OAuth 모달, 설정 = 자격증명 모달"로 단순화하면서 OAuth 연결 **이후**의 운영 액션
  (주문·상품 동기화, 재인가)을 빠뜨렸다. 측면 영향 분석에서 OAuth 테넌트(annehearts·tenant 3·zhangbayo)를 실측하지
  않은 누락.
- **R3**: 신규.

## 4. TO-BE

1. **Cafe24 카드는 연결 방식을 인식**한다. OAuth 연결이면 부제 `{mallId}.cafe24.com`, 액션은 **연결 테스트(OAuth용)·주문
   동기화·상품 가져오기·설정(재연결/수동 전환)**. 수동 연결이면 현행(자격증명 모달·일반 프로브).
2. **OAuth용 연결 테스트** = `Cafe24TokenService.getConnection()`으로 실제 액세스 토큰을 받아 `/admin/store`를 호출하고
   per-tenant 상태(`connected`/`error`·detail·lastTestedAt)를 기록. 일반 테스트가 OAuth 형태를 만나면 **상태를 덮어쓰지
   않고** "Cafe24 OAuth로 연결됨 — Cafe24 카드의 연결 테스트를 사용" 안내만 반환.
3. **플랫폼 사이트 바로가기**: 연결된 카드마다 `사이트 열기 ↗`(새 탭). 대상은 플랫폼 관리자 화면 우선:

   | 플랫폼 | 링크 | 근거 값 |
   |---|---|---|
   | Shopify | `https://admin.shopify.com/store/{handle}` | `shop_domain`의 `*.myshopify.com` 앞부분 |
   | Cafe24 | `https://eclogin.cafe24.com/Shop/?mall_id={mall}` | `mallId`/`mall_id` |
   | WooCommerce | `{store_url}/wp-admin/` | `store_url` |
   | Odoo | `{url}/web` | `url` |
   | Haravan | `https://{shop_domain}/admin` | `shop_domain` |
   | Klaviyo / Yotpo | `https://www.klaviyo.com/dashboard` / `https://my.yotpo.com/` | 고정 |
   | Gorgias | `https://{subdomain}.gorgias.com/app` | `subdomain` |
   | 자체 플랫폼 | `storefront_url` | 기본 설정 |

   값이 없으면 버튼을 숨긴다(빈 링크 금지).
4. 잘못 기록된 두 행(16·3)은 새 OAuth 테스트가 성공하면 자연히 `connected`가 된다. 배포 직후 운영자가 누르기 전까지
   "오류"가 남으므로 배포 시 `status='unknown', detail=NULL`로 되돌린다(데이터 정정 1회, RPT 기록).

## 5. 갭 분석

| # | AS-IS | TO-BE | 지점 |
|---|---|---|---|
| G1 | `getSettings('cafe24')`가 OAuth blob을 못 읽음 | `fields.mall_id`에 `mallId` 매핑 + `mode: 'oauth'\|'manual'` 응답 | `ecommerce-integration.service/mapper`, DTO |
| G2 | 일반 `test('cafe24')`가 OAuth blob에 `error` 기록 | OAuth 형태면 상태 불변 + 안내 반환 | `ecommerce-integration.service.test` |
| G3 | OAuth 테스트 없음 | `POST /tenants/me/cafe24/test` (Cafe24 모듈, 토큰 재발급 → `/admin/store`, per-tenant 기록) | `cafe24.controller/service` |
| G4 | 연결된 Cafe24 카드에 동기화·재연결 없음 | `Cafe24ConnectedCard`: 테스트·주문 동기화·상품 가져오기·설정(재연결 모달) | 콘솔 |
| G5 | 사이트 바로가기 없음 | `platformSiteUrl(connection)` + 카드 버튼 | 콘솔 |
| G6 | Cafe24 "설정" = 토큰 수동 모달 | OAuth면 Cafe24 모달(몰 ID 재연결 + "수동 입력" 링크), 수동이면 자격증명 모달 | 콘솔 |

## 6. 제약·전제

- 스키마 변경 없음. 신규 엔드포인트 1개(`POST /tenants/me/cafe24/test`, `INTEGRATION_CREDENTIALS_MANAGE`).
- OAuth 테스트는 refresh 토큰을 **소모·회전**한다(Cafe24는 매 refresh마다 회전). 기존 `Cafe24TokenService`의 단일 비행·
  회전 저장 로직을 그대로 타므로 추가 위험 없음. 2h 캐시가 있으면 네트워크 1회(`/admin/store`)만.
- 바로가기는 외부 링크(`target=_blank rel=noopener`). Shopify 핸들은 `*.myshopify.com`일 때만.
- 마케팅 탭도 같은 카드 컴포넌트라 바로가기가 함께 붙는다.

## 7. 사용자 플로우 (TO-BE, zhangbayo)

1. 플랫폼 연동 → 연결된 플랫폼에 `Cafe24 · zhangbayo.cafe24.com [미테스트]` 카드(정정 후).
2. **연결 테스트** → 토큰 재발급 → `/admin/store` 200 → 토스트 "Connected: {몰 이름}" → 배지 **연결됨**.
3. **주문 동기화** / **상품 가져오기** → 기존 Cafe24 엔드포인트 → 결과 토스트.
4. **사이트 열기 ↗** → 새 탭에 Cafe24 관리자 로그인(몰 ID 채워짐).
5. **설정** → Cafe24 모달: 몰 ID 재연결(OAuth) · "토큰 직접 입력"(수동 전환).

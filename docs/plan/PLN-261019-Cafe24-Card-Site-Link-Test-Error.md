# PLN-261019 플랫폼 연동 — Cafe24 카드 복원 · 플랫폼 사이트 바로가기 · OAuth 연결 테스트

- 작성일: 2026-10-19 · 근거: `REQ-261019-Cafe24-Card-Site-Link-Test-Error.md`
- 범위: API(Cafe24 OAuth 테스트 엔드포인트, 일반 설정/테스트의 OAuth 인식) + 콘솔(Cafe24 카드·모달, 바로가기 버튼)
- 스키마 변경: **없음** · 신규 오류 코드: 없음 · 데이터 정정: `integration_credentials` 2행 status 되돌림(§3)
- 승인 전에는 구현하지 않음

## 0. 설계 요약

| 결정 | 내용 | 이유 |
|---|---|---|
| D1 | Cafe24 설정 응답에 `mode: 'oauth' \| 'manual' \| null`을 추가하고, OAuth blob의 `mallId`를 `fields.mall_id`로 노출 | 카드가 연결 방식에 따라 액션을 바꾸고 몰 ID를 보여 주려면 서버가 형태를 판별해야 함 |
| D2 | OAuth 연결 테스트는 **Cafe24 모듈**의 `POST /tenants/me/cafe24/test` | `TenantModule`→`Cafe24Module` 순환 회피. 토큰 서비스(재발급·회전·단일 비행) 재사용 |
| D3 | 일반 `test('cafe24')`가 OAuth 형태를 만나면 **기록 없이** 안내만 반환 | 잘못된 경로가 상태를 오염시키지 않게 |
| D4 | `Cafe24ConnectedCard`: 테스트·주문 동기화·상품 가져오기·사이트 열기·설정. 설정 = OAuth면 Cafe24 모달(재연결 + 수동 전환), 수동이면 자격증명 모달 | 옛 OAuth 카드의 기능을 연결된 카드에 복원 |
| D5 | `platformSiteUrl()` 한 곳에서 플랫폼별 링크 생성, 값 없으면 버튼 숨김 | 빈 링크·추측 링크 금지 |
| D6 | 배포 시 `integration_credentials` id 3·14의 `status='unknown', detail=NULL, last_tested_at=NULL` | 잘못된 테스트가 남긴 "오류"를 지움(실제 연결은 바뀐 적 없음) |

## 1. 단계별 계획

### S1 — API (PR 1)

| # | 작업 | 파일 |
|---|---|---|
| B1 | `EcommerceIntegrationMapper.toSettings`: cafe24 + blob에 `mallId`&`refreshToken` → `mode='oauth'`, `fields.mall_id=mallId`, `secrets.access_token=false`; snake 형태 → `mode='manual'`; 없음 → `null`. 타 provider는 `mode` 생략 | `ecommerce-integration.mapper.ts`, `tenant.response.ts` |
| B2 | `EcommerceIntegrationService.test`: cafe24 OAuth 형태면 `{ok:false, detail:'Connected through Cafe24 OAuth — use the Cafe24 card's connection test'}` 반환, cred 미기록 | `ecommerce-integration.service.ts` |
| B3 | `Cafe24Controller.test` → `Cafe24SyncService.testConnection(tenantId)`: `tokenService.getConnection()` → null이면 `error` "not connected / refresh failed"; 있으면 `GET /api/v2/admin/store`(6s 타임아웃) → `connected`+`Connected: {shop_name}` / `error`+상태코드. 결과를 cred `status/detail/lastTestedAt`에 기록 | `cafe24.controller.ts`, `cafe24-sync.service.ts`(또는 token.service) |
| B4 | 스펙: mapper mode 3종, 일반 test OAuth 불변, OAuth test 성공/실패/미연결 | `*.spec.ts` |

### S2 — 콘솔 (PR 1 동승)

| # | 작업 | 파일 |
|---|---|---|
| W1 | `IntegrationSettings.mode` 타입, `PlatformConnection.mode`·`siteUrl` 추가, `platformSiteUrl(connection, storefrontUrl)` | `settings.service.ts`, `platform-connections.hooks.ts`, `platform-site-url.ts`(신규) |
| W2 | `Cafe24ConnectedCard`: 배지·몰 ID·액션 5종(아래 와이어프레임). `useTestCafe24`·기존 `syncCafe24`/`syncCafe24Products` 훅화(토스트) | `ConnectedPlatformCard.tsx`, `settings.hooks.ts` |
| W3 | 모든 연결 카드 `Shell`에 **사이트 열기 ↗** 버튼(링크 있을 때만) | `ConnectedPlatformCard.tsx` |
| W4 | `SettingsPlatformsPage`: cafe24 "설정" → mode가 oauth면 `Cafe24ConnectModal`(제목 "Cafe24 재연결"), manual이면 자격증명 모달 | `SettingsPlatformsPage.tsx`, `Cafe24ConnectModal.tsx`(`reconnect` prop) |
| W5 | i18n 6개 언어: `platforms.openSite`, `cafe24.oauth.reconnectTitle`, `cafe24.oauth.test`, `cafe24.oauth.mode.oauth/manual`, `integrations.cafe24.oauthTestHint` | `locales/*/settings.json` |

### S3 — 검증·배포·문서 (PR 2 = docs)

- API jest·typecheck·i18n:check·web build·CI.
- 스테이징: 데이터 정정(D6) → 배포 → zhangbayo 계정 없음 → **annehearts(tenant 2, cafe24 unknown)** 또는 스모크 계정으로
  OAuth 테스트 경로 실측이 불가하면 **tenant 16 행을 API로 테스트**할 수 있는 마스터 임시 계정 발급(기존 관례: 검증용
  사용자 invited 원복). 카드 액션 5종·바로가기 링크 대상 확인. 마케팅 탭 바로가기(Yotpo) 확인.
- TCR/RPT, 매뉴얼 Cafe24 단락 1줄.

## 2. UI 변경 — ASCII 와이어프레임

### 2.1 연결된 Cafe24 카드 (OAuth, TO-BE)

```
┌──────────────────────────────────────────────────────────────┐
│ ▣  Cafe24                                        [연결됨]    │
│    zhangbayo.cafe24.com · OAuth 연결                          │
│    Connected: 짱바요몰 · 마지막 확인 10/19 14:02               │
│                                                              │
│ [⚙ 설정] [⚡ 연결 테스트] [↻ 주문 동기화] [⇩ 상품 가져오기]     │
│ [↗ 사이트 열기]                                              │
└──────────────────────────────────────────────────────────────┘
```

수동 연결이면 부제 `… · 수동(토큰)`, 액션은 설정·연결 테스트·사이트 열기(동기화 버튼은 OAuth 토큰 서비스가 필요하므로 숨김 —
현행과 동일).

### 2.2 다른 연결 카드 — 바로가기 추가

```
┌ Shopify ────────────────────────────────[연결됨]┐
│ ambshop-dev.myshopify.com                        │
│ [⚙ 설정] [⚡ 연결 테스트] [↻ 지금 동기화] [↗ 사이트 열기] │
└──────────────────────────────────────────────────┘
┌ Go2Joy ─────────────────────────────────[등록됨]┐
│ 자체 플랫폼 · https://www.go2joy.vn              │
│ [⚙ 설정] [↗ 사이트 열기]                          │   ← storefront_url
└──────────────────────────────────────────────────┘
```

### 2.3 Cafe24 "설정" (OAuth 연결 상태)

```
┌ Cafe24 재연결 ─────────────────────────────────── ✕ ┐
│ 현재 zhangbayo.cafe24.com 이 OAuth로 연결되어 있습니다.  │
│ 권한 범위가 바뀌었거나 토큰이 만료되면 다시 연결하세요.   │
│ 몰 ID   [ zhangbayo        ].cafe24.com                 │
│                                    [닫기] [Cafe24 연결 →]│
│ 토큰이 이미 있다면 직접 입력                              │
└─────────────────────────────────────────────────────────┘
```

### 2.4 일반 자격증명 모달에서 OAuth Cafe24를 테스트한 경우 (D3)

토스트(빨강 아님, 정보): "Cafe24 OAuth로 연결되어 있습니다 — 연결 테스트는 Cafe24 카드에서 하세요." 상태 배지 변화 없음.

## 3. 측면 영향 분석

| 영역 | 영향 | 대응 |
|---|---|---|
| `GET /tenants/me/integrations/cafe24` | `mode` 필드 추가(타 provider 없음), `fields.mall_id`가 OAuth에서도 채워짐 | 응답 확장만, 기존 클라이언트 무영향 |
| 일반 테스트 `POST …/integrations/cafe24/test` | OAuth 형태는 더 이상 `error`를 쓰지 않음 | 수동 형태는 현행 |
| Cafe24 토큰 회전 | OAuth 테스트가 refresh를 호출(캐시 없을 때) → refresh 토큰 회전·저장 | 기존 동기화와 동일 경로(단일 비행) |
| `Cafe24TokenService.getConnection` 실패 | null → `error` "재연결 필요" 기록 | 재연결 모달로 유도 |
| 데이터 정정(D6) | id 3·14 status unknown | 실제 연결 불변, 다음 테스트/동기화가 상태 결정 |
| 마케팅 탭 | 바로가기 버튼이 Klaviyo·Yotpo·Gorgias 카드에도 생김 | 고정 링크/서브도메인 |
| 매뉴얼 | Cafe24 단락에 "OAuth 연결은 Cafe24 카드에서 테스트·동기화" 1줄 | S3 |

## 4. 제외·보류
- Cafe24 수동(토큰) 연결에 동기화 버튼 추가 — 토큰 서비스가 OAuth refresh 전제, 별도 검토.
- Shopify 연결 테스트가 전역 `integration_status`에 더 이상 기록되지 않는 어드민 집계 — 기존 보류 유지.

## 5. 승인 후 산출물
- PR 1(S1+S2), PR 2(TCR/RPT·매뉴얼), 스테이징·프로덕션 배포(SQL 없음, 데이터 정정 UPDATE 2행).

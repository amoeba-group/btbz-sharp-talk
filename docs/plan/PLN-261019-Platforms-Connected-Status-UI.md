# PLN-261019 플랫폼 연동 화면 — 연결된 플랫폼 / 플랫폼 추가 분리 + 자체 플랫폼 카드

- 작성일: 2026-10-19 · 근거: `REQ-261019-Platforms-Connected-Status-UI.md`
- 범위: 백엔드(Shopify per-tenant 상태, `self` provider) + 콘솔(`/settings/platforms` 재구성) + 대시보드 라벨
- 스키마 변경: **없음**(SQL 선적용 불필요) · 신규 오류 코드: 없음 · 마이그레이션 섹션: 해당 없음
- 승인 전에는 구현하지 않음

## 0. 설계 요약

| 결정 | 내용 | 이유 |
|---|---|---|
| D1 | Shopify 연결 상태를 **`integration_credentials(tenant,'shopify')`** 로 옮긴다. 읽기(`getShopifyView`)·쓰기(연결 테스트·주문 동기화·웹훅 등록 결과) 모두. 전역 `integration_status` 쓰기는 **동기화 커서용으로만** 남긴다. | 일반 플랫폼과 같은 규칙(FIX-260827). 전역 행이 교차 테넌트 "연결됨"의 원인. |
| D2 | "연결됨"의 정의를 한 줄로 통일: **자격증명 있음 AND (테스트 또는 동기화 성공)**. 저장만 = 미테스트. | 저장≠연결(FIX-260827 예방 패턴). Cafe24 OAuth 카드의 `status \|\| configured` 완화도 제거. |
| D3 | 화면을 **연결된 플랫폼(카드)** 과 **플랫폼 추가(버튼)** 두 영역으로 나눈다. 자격증명이 있는 플랫폼만 카드, 나머지는 버튼. | 요구사항 그대로. 미설정 플랫폼이 카드로 나열되지 않아 "어디에 연결돼 있나"가 한눈에 보인다. |
| D4 | 자체 플랫폼 = provider **`self`** 한 행(암호화 JSON `{platform_name, description}`), 저장 즉시 `connected`(표시는 **등록됨**). | 검증할 외부 API가 없으니 등록 자체가 완료. 스키마 변경 없이 기존 generic 저장·조회·대시보드 경로를 그대로 탄다. |
| D5 | 기존 "자체 개발 연동"(주문 이행 웹훅 주소·시크릿)은 **자체 플랫폼 카드 내부 블록**으로 옮기고 `commerce_enabled=1`일 때만 보인다. | go2joy처럼 주문이 없는 테넌트에게 웹훅 폼은 소음. 스테이징 `fulfillment` 행 0건이라 숨겨지는 기존 설정 없음. |
| D6 | Cafe24는 추가 = **OAuth 모달**, 설정 = 기존 자격증명 모달. 카드 2장 → 1항목. | 같은 플랫폼이 두 번 보이는 혼란 제거. OAuth 흐름(P-A1)은 그대로 재사용. |
| D7 | 마케팅·헬프데스크 탭은 **현행 유지**(`ProviderGrid` 그대로). | 요구 범위는 플랫폼 탭. 공용 컴포넌트는 분리만 하고 마케팅 탭 레이아웃은 건드리지 않는다. |

## 1. 단계별 계획

### S1 — 백엔드 (PR 1)

| # | 작업 | 파일 |
|---|---|---|
| B1 | `getShopifyView`: `integrationService.findByName` 제거 → `cred.status/detail/lastTestedAt` 를 `integration` 블록에 매핑(`toShopifySettings` 시그니처에서 전역 status 인자 삭제). cred 없음 → `status:null`. | `tenant.service.ts`, `tenant.mapper.ts` |
| B2 | `recordShopifyTest(tenantId, ok, detail)`: per-tenant cred `status/detail/lastTestedAt` 갱신(cred 없으면 기록 없이 결과만 반환). 전역 upsert 삭제. | `tenant.service.ts` |
| B3 | `ShopifySyncService.record(tenantId, ok, synced, detail)`: per-tenant cred 갱신 **추가**(성공=`connected`, 실패=`error`, `lastTestedAt=now`). 전역 upsert는 커서(`last_sync_at`) 용도로 유지. `registerWebhooks` 결과도 동일 경로. | `shopify-sync.service.ts` |
| B4 | `INTEGRATION_PROVIDER.SELF='self'`, `SELF_PLATFORM_FIELDS=[platform_name(required), description]`, `GENERIC_INTEGRATION_PROVIDERS`에 `self` 포함(ECOMMERCE/MARKETING/HELPDESK 목록에는 **미포함** → 동기화 스케줄러·프로브 대상 아님). | `packages/types/src/common/enum.types.ts`(+ 웹 미러 `integration-providers.ts`) |
| B5 | `EcommerceIntegrationService.save`: provider `self`면 저장 게이트 예외 → `status='connected'`, `detail='Registered'`, `lastTestedAt=now`. `test('self')` → `{ok:true, detail:'Self-hosted platform — nothing to probe'}`(프로브 호출 없음). | `ecommerce-integration.service.ts`, `ecommerce-probe.util.ts` |
| B6 | 스펙: `tenant.service` Shopify view/test, `shopify-sync.service.spec`(integrationService 목 31곳 → cred 목 추가), `ecommerce-integration.service.spec`(self 저장·테스트), 시드는 변경 없음. | `*.spec.ts` |

### S2 — 콘솔 (PR 1 동승)

| # | 작업 | 파일 |
|---|---|---|
| W1 | `SettingsPlatformsPage` 재구성: 상단 안내 + 연동 가이드 링크(유지) → **연결된 플랫폼** 섹션 → **플랫폼 추가** 섹션. | `SettingsPlatformsPage.tsx` |
| W2 | `usePlatformConnections()`: Shopify(`useShopifySettings`) + generic 4종(`useIntegration`) + self 를 모아 `{provider, configured, status, lastTestedAt, detail, subtitle}[]` 로 정규화. `configured` 기준으로 카드/버튼 분기. | `settings.hooks.ts`(신규 훅) |
| W3 | `ConnectedPlatformCard`: 아이콘·이름·부제(도메인/몰ID/플랫폼 이름)·배지(연결됨/오류/미테스트/등록됨)·마지막 확인 시각·상세 1줄·액션(`설정`, 가능하면 `연결 테스트`, `동기화`). self 카드는 D5 블록 포함. | `ConnectedPlatformCard.tsx`(신규), `ProviderTile.tsx`(유지, 마케팅 탭용) |
| W4 | `AddPlatformButtons`: 지원 플랫폼 6개 칩. 미설정 = 활성(클릭 → 모달), 설정됨 = ✓ + 비활성. | `AddPlatformButtons.tsx`(신규) |
| W5 | Cafe24 OAuth 모달: `Cafe24ConnectCard` 본문을 `Modal`로 감싸고 연결 결과 토스트(URL 파라미터 처리)는 페이지 레벨 유지. | `Cafe24ConnectModal.tsx`(이름 변경) |
| W6 | 자체 플랫폼 모달: `IntegrationConfigModal`을 `self`로 재사용(필드 2개, 테스트·동기화 버튼 숨김, 상태 라벨 `등록됨`). | `IntegrationConfigModal.tsx` 분기 최소화 |
| W7 | `SelfDevelopmentCard` → `FulfillmentWebhookBlock`으로 이름 변경, self 카드 안에서 `commerceEnabled` 조건부 렌더. | `SelfDevelopmentCard.tsx` |
| W8 | i18n 6개 언어: `platforms.connected.title/empty`, `platforms.add.title/hint`, `platforms.added`, `integrations.self.title/subtitle`, `integrations.fields.platform_name/description`, `integrations.state.registered`, `selfDev.noCommerceHint`; 대시보드 `integration.self`. `npm run i18n:check`. | `locales/*/settings.json`, `locales/*/dashboard.json` |
| W9 | 성공/실패 토스트: 자체 플랫폼 저장·Shopify 테스트는 기존 훅의 토스트 유지(§2 UX 규칙). | — |

### S3 — 검증·배포·문서 (PR 2 = docs)

- API jest 전체, `npm run typecheck`, `i18n:check`, web build.
- 스테이징 배포 후 실측: go2joy(Shopify 카드 **사라짐**, 자체 플랫폼 등록 → 등록됨 카드, 대시보드 `자체 플랫폼`),
  ivyusa(Shopify 카드 1장, 첫 틱 전 "미테스트" → 자동 동기화 후 "연결됨"), skyliving(tenant 5, odoo 카드 1장).
- TCR-261019 / RPT-261019 작성. 메모리 갱신.

## 2. UI 변경 — ASCII 와이어프레임

### 2.1 `/settings/platforms` 전체 (TO-BE, go2joy — 자체 플랫폼 등록 후)

```
설정 › [기본] [위젯] [플랫폼 연동] [마케팅·헬프데스크] [메신저] [기타] [동의 안내]

플랫폼 연동                                                      [📖 연동 가이드]
쇼핑몰이 돌아가는 곳. 연결된 플랫폼만 아래에 표시됩니다.

연결된 플랫폼 (1)
┌──────────────────────────────────────────────────────────────────────────────┐
│ ▣  Go2Joy                                                        [등록됨]    │
│    자체 플랫폼 · https://www.go2joy.vn                                        │
│    호텔 파트너 어드민(자체 개발)                                              │
│    ──────────────────────────────────────────────────────────────────────── │
│    주문 기능이 꺼져 있어 위젯 설치만으로 연동이 끝납니다.                      │
│    위젯 설치는 위젯 설정 → 임베드·SDK 에서 확인하세요.  [위젯 설정으로 →]       │
│                                                                              │
│    등록 2026-10-19 14:02                                        [⚙ 설정]      │
└──────────────────────────────────────────────────────────────────────────────┘

플랫폼 추가
지원 플랫폼 중 하나를 선택하면 연결 설정이 열립니다. 이미 연결된 플랫폼은 ✓ 로 표시됩니다.
[ 🛍 Shopify ] [ 🛍 Cafe24 ] [ 🛍 WooCommerce ] [ 🛍 Odoo ] [ 🛍 Haravan ] [ ✓ 자체 플랫폼 ]
```

### 2.2 같은 화면 — ivyusa (Shopify 연결, 주문 기능 켜짐)

```
연결된 플랫폼 (1)
┌──────────────────────────────────────────────────────────────────────────────┐
│ ▣  Shopify                                                       [연결됨]    │
│    ambshop-dev.myshopify.com                                                 │
│    Synced 0 order(s) updated since 2026-10-19T11:08:26Z · 마지막 확인 11:58 │
│                                             [⚙ 설정] [⟳ 연결 테스트] [↻ 동기화]│
└──────────────────────────────────────────────────────────────────────────────┘

플랫폼 추가
[ ✓ Shopify ] [ 🛍 Cafe24 ] [ 🛍 WooCommerce ] [ 🛍 Odoo ] [ 🛍 Haravan ] [ ▣ 자체 플랫폼 ]
```

### 2.3 빈 상태 (연결된 플랫폼 0건 — go2joy 배포 직후)

```
연결된 플랫폼 (0)
┌──────────────────────────────────────────────────────────────────────────────┐
│          아직 연결된 플랫폼이 없습니다.                                        │
│          아래 "플랫폼 추가"에서 사용 중인 플랫폼을 선택하세요.                   │
│          자체 개발 플랫폼이면 "자체 플랫폼"을 등록하면 됩니다.                   │
└──────────────────────────────────────────────────────────────────────────────┘
```

### 2.4 카드 배지·액션 규칙

| 상태 | 조건 | 배지 | 액션 |
|---|---|---|---|
| 연결됨 | configured && status=connected | 🟢 연결됨 | 설정 · 연결 테스트 · 동기화(지원 시) |
| 오류 | configured && status=error | 🔴 오류 + detail 1줄 | 설정 · 연결 테스트 |
| 미테스트 | configured && status∈{unknown,null} | ⚪ 미테스트 | 설정 · 연결 테스트 |
| 등록됨 | provider=self && configured | 🔵 등록됨 | 설정 |
| (없음) | !configured | 카드 없음 → "플랫폼 추가" 버튼 | 추가 |

### 2.5 자체 플랫폼 모달 (추가/설정 공용)

```
┌ 자체 플랫폼 ───────────────────────────────────────────── ✕ ┐
│ 직접 개발·운영하는 플랫폼입니다. 이름과 설명만 등록하면 됩니다. │
│                                                               │
│ 플랫폼 이름 *   [ Go2Joy                                  ]   │
│ 설명            [ 호텔 파트너 어드민(자체 개발)             ]   │
│ 스토어 주소     https://www.go2joy.vn  (기본 설정에서 변경)    │
│                                                               │
│ ─ 주문 이행 웹훅 (주문 기능이 켜진 경우에만 표시) ───────────── │
│ 웹훅 주소       [https://…/api/v1/webhooks/fulfillment] [복사] │
│ 서명 시크릿     [••••••••••]  [저장]   [앱 공통 시크릿]        │
│ ⚠ 저장하면 시크릿이 즉시 교체됩니다 …                          │
│                                                               │
│                                         [취소]   [저장]       │
└───────────────────────────────────────────────────────────────┘
```

### 2.6 Cafe24 추가 모달 (OAuth, 기존 카드 본문 이동)

```
┌ Cafe24 연결 ───────────────────────────────────────────── ✕ ┐
│ Cafe24 몰을 OAuth로 연결하면 주문과 상품을 가져올 수 있습니다.  │
│ 몰 ID   [ amoebaorder      ].cafe24.com                       │
│                                        [취소] [Cafe24 연결 →]  │
│ 토큰을 직접 입력하려면: 수동 입력                               │   ← 기존 자격증명 모달로 전환
└───────────────────────────────────────────────────────────────┘
```

Shopify·WooCommerce·Odoo·Haravan 추가 모달은 **현행 설정 모달 그대로**(변경 없음).

## 3. 측면 영향 분석

| 영역 | 영향 | 대응 |
|---|---|---|
| `GET /tenants/me/shopify` 응답 | `integration.status` 의미가 전역→per-tenant로 바뀜. 응답 **형태는 동일**(`ShopifyConfigModal` 무수정). | ivyusa는 첫 자동 동기화 틱까지 "미테스트"(≤10분). RPT에 명시. |
| 자동 동기화 커서 | 전역 `integration_status.last_sync_at` 유지(B3가 전역 쓰기를 남김). | 현행과 동일. 2테넌트 이상 시 per-tenant 커서 FIX 후보(REQ §6). |
| 어드민 `GET /integrations/status` | 전역 테이블 그대로. Shopify 테스트 결과는 더 이상 전역에 기록되지 않음(동기화 결과는 기록). | 어드민 화면은 현재 이 값을 쓰지 않음(웹에서 호출 0곳). |
| 대시보드 `GET /tenants/me/integrations` | `self` 행이 추가로 나타남(`등록됨`). | 라벨 `integration.self` 추가. |
| 기타 설정 탭 "저장된 자격증명" | `self` 행이 목록에 나타남(원시 뷰). | 자연스러움(모든 provider 나열). 삭제도 거기서 가능. |
| `ECOMMERCE_PROVIDERS` 사용처(동기화 스케줄러·프로브·`SYNCABLE`) | `self` 미포함이라 영향 없음. | 타입 테스트로 고정. |
| 웹훅 시크릿 리졸버 | provider `fulfillment` 그대로(블록만 이동). | 변경 없음. |
| 마케팅 탭 | `ProviderGrid`/`ProviderTile` 유지. | 변경 없음. |
| 메뉴 권한 | 탭 코드 `settings_platforms` 그대로. | 변경 없음. |
| 매뉴얼 `platform-integration.*.html` | 화면 구조 설명이 구버전이 됨. | S3에서 캡처 1장 + 문단 갱신(ko/en/vi), 범위 작음. |

## 4. 제외·보류

- `tenants.platform` 컬럼(어드민 집계용) — 스키마 변경 회피, 필요 시 별도 PLN.
- 전역 `integration_status` 시드 mock 행 정리 — 어드민 전용, 이번 범위 밖.
- ~~자동 동기화 커서 per-tenant화~~ → S1-후속(§6, FIX-261019-Shopify-Sync-Cursor-Per-Tenant).
- ~~마케팅·헬프데스크 탭의 동일 레이아웃 적용~~ → S4(§6).

## 6. 후속 (S1·S2 스테이징 검증 후 사용자 "계속 진행", 2026-10-19)

### S4 — 마케팅·헬프데스크 탭 동일 레이아웃

| # | 작업 | 파일 |
|---|---|---|
| W10 | `PlatformSections`(연결된 플랫폼 / 플랫폼 추가 두 영역) 추출 — 플랫폼 탭과 공유 | `PlatformSections.tsx`(신규), `SettingsPlatformsPage.tsx` |
| W11 | `usePlatformConnections(choices)`로 일반화(`useQueries`, Shopify는 요청 시만 조회) | `platform-connections.hooks.ts`, `settings.hooks.ts(useShopifySettings(enabled))` |
| W12 | `SettingsMarketingPage`: Klaviyo·Yotpo·Gorgias를 같은 구성으로. `ProviderGrid`·`ProviderTile` 삭제 | `SettingsMarketingPage.tsx` |
| W13 | i18n `platforms.emptyHintMarketing` 6개 언어 | `locales/*/settings.json` |

와이어프레임 (go2joy — 마케팅 연동 없음):

```
설정 › … [마케팅·헬프데스크] …
Klaviyo, Yotpo, Gorgias

연결된 플랫폼 (0)
┌──────────────────────────────────────────────────────────────┐
│          아직 연결된 플랫폼이 없습니다.                        │
│          아래 "플랫폼 추가"에서 사용 중인 서비스를 선택하세요.   │
└──────────────────────────────────────────────────────────────┘
플랫폼 추가
[ + Klaviyo ] [ + Yotpo ] [ + Gorgias ]
```

ivyusa(Yotpo 연결됨):

```
연결된 플랫폼 (1)
┌ Yotpo ─────────────────────────────────────[연결됨]┐
│ <app key>  Connected · 마지막 확인 8/27 06:11        │
│ [⚙ 설정] [⚡ 연결 테스트]                             │
└──────────────────────────────────────────────────────┘
플랫폼 추가
[ + Klaviyo ] [ ✓ Yotpo ] [ + Gorgias ]
```

### S1-후속 — Shopify 동기화 커서 per-tenant (FIX-261019)
`integration_credentials.last_synced_at` 1열(SQL 선적용) + `ShopifySyncService` 커서 읽기·쓰기 테넌트화, 전역
`integration_status` 쓰기 제거. 상세는 FIX 문서.

## 5. 승인 후 산출물

- PR 1: S1 + S2(코드·i18n·스펙) → CI → 스쿼시 머지 → 스테이징 배포(SQL 없음).
- PR 2: `TCR-261019-Platforms-Connected-Status-UI.md`, `RPT-261019-…`(배포 상태·실측), 매뉴얼 문단, 메모리.

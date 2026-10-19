# TCR-261019 플랫폼 연동 화면 — 연결된 플랫폼 / 플랫폼 추가 / 자체 플랫폼

- 작성일: 2026-10-19 · 근거: `PLN-261019-Platforms-Connected-Status-UI.md` · 구현 PR #669
- 환경: 로컬 jest/tsc, 스테이징 `https://shoptalk.amoeba.site`(go2joy tenant 4 마스터 스모크 계정, ivyusa tenant 1)

## 1. 단위 테스트 (jest, PR #669)

| ID | 스펙 | 케이스 | 결과 |
|---|---|---|---|
| U1 | `tenant.service.shopify-status.spec` | `getShopifyView`가 전역 `integration_status`를 읽지 않음(`findByName` 미호출) | ✅ |
| U2 | 〃 | 자격증명 없음 → `integration = {status:null,lastSyncAt:null,detail:null}`, `configured=false` | ✅ |
| U3 | 〃 | 저장만 된 자격증명 → `status='unknown'`, 자기 `updatedAt` | ✅ |
| U4 | 〃 | `recordShopifyOutcome(ok)` → cred `connected`/detail/lastTestedAt, 전역 upsert 미호출 | ✅ |
| U5 | 〃 | `recordShopifyOutcome(!ok)` → `error`, detail 255자 클램프 | ✅ |
| U6 | 〃 | 자격증명 없는 테넌트 → 아무 것도 쓰지 않음(미연동 ≠ 오류) | ✅ |
| U7 | `shopify-sync.service.spec` | 주문 동기화 성공 시 `tenantService.recordShopifyOutcome(7, true, detail)` 호출 | ✅ |
| U8 | `ecommerce-integration.service.self.spec` | `save('self')` → 즉시 `connected` + lastTestedAt + detail | ✅ |
| U9 | 〃 | 재저장도 `connected` 유지(unknown으로 리셋 안 함) | ✅ |
| U10 | 〃 | 일반 플랫폼(odoo) 저장은 여전히 `unknown`(게이트 불변) | ✅ |
| U11 | 〃 | `getSettings('self')` → fields `{platform_name, description}`, secrets `{}` | ✅ |
| U12 | 〃 | `test('self')`는 프로브를 부르지 않고 저장도 안 함, 미등록이면 `ok=false` | ✅ |
| U13 | 전체 | API jest 237 suites / 2,338 tests, `npm run typecheck` 9/9, `i18n:check` complete, web build | ✅ |

## 2. 통합 시나리오 (스테이징)

| ID | 시나리오 | 기대 | 결과 |
|---|---|---|---|
| I1 | 배포 검증 | 컨테이너 재생성·`successfully started`·`/api/v1/health` 200 | ✅ 12:18 재배포(api/web/widget/pwa 재생성, `successfully started` 1회, `/api/v1/health` 200) |
| I2 | go2joy `GET /tenants/me/shopify` | `credential.configured=false` **AND** `integration.status=null`(전역 행 미반영) | ✅ `credential.configured=false`, `integration={status:null,lastSyncAt:null,detail:null}` — ivyusa 동기화 후 재조회해도 null 유지(격리 실증) |
| I3 | go2joy `/settings/platforms` 초기 | "연결된 플랫폼 (0)" 빈 상태 안내, Shopify 카드 없음, 추가 칩 6개 전부 활성 | ✅ "연결된 플랫폼 (0)" 빈 상태 안내, Shopify 카드 없음, 칩 6개 활성 |
| I4 | go2joy 자체 플랫폼 등록 | 칩 "자체 플랫폼" → 모달(이름·설명, 테스트 버튼 없음) → 저장 토스트 → 카드 "Go2Joy · 자체 플랫폼 [등록됨]" + 주문 기능 꺼짐 안내 + 위젯 설정 링크, 칩 ✓ 비활성 | ✅ 모달(이름·설명, 테스트 버튼 없음, 상태 미설정) → 저장 → 모달 상태 "등록됨"·등록 시각 → 카드 "Go2Joy · 자체 플랫폼 · https://www.go2joy.vn [등록됨]" + 주문 기능 꺼짐 안내 + "위젯 설정으로" 링크, 칩 ✓ 비활성 |
| I5 | go2joy `GET /tenants/me/integrations` | `self` 행 `status=connected` 포함 → 대시보드 "자체 플랫폼" 라벨 | ✅ `[{notion, connected}, {self, connected, detail:"Registered — self-hosted platform, nothing to probe"}]` — 대시보드 행 라벨은 기존 결함(`it.name`→`integration.undefined`)으로 깨져 있어 PR 2에서 `provider` 읽기로 수정 |
| I6 | ivyusa `GET /tenants/me/shopify` | `configured=true`; 배포 직후 `status=unknown` → 자동 동기화 틱 후 `connected` + 자기 detail | ✅ 배포 직후 `status=unknown` → 수동 `POST /tenants/me/shopify/sync`(ok, 0건) 직후 `connected`, `lastSyncAt=12:19:29`, 자기 detail |
| I7 | ivyusa `/settings/platforms` | Shopify 카드 1장(연결됨 또는 미테스트), 칩 Shopify ✓, 나머지 활성 | ✅ "연결된 플랫폼 (1)" Shopify 카드(ambshop-dev.myshopify.com, 연결됨, 설정·연결 테스트·지금 동기화), 칩 Shopify ✓, 나머지 활성 |
| I8 | Cafe24 추가 칩 | OAuth 모달(몰 ID → Cafe24 연결 버튼), "직접 입력" → 자격증명 모달 전환 | ✅ 칩 Cafe24 → "Cafe24 연결" 모달(몰 ID, Cafe24 연결 버튼) → "토큰이 이미 있다면 직접 입력" → 자격증명 모달(몰 ID·클라이언트 ID/시크릿·액세스 토큰·연결 테스트) |
| I9 | 접근 로그 | 위 호출 전부 2xx, 예외 필터 ERROR 없음 | ✅ 12분 창 접근 로그: GET/PUT/POST 전부 200/201, `ERROR` 0건 |

### 2.1 실측 중 발견·수정 (PR 2)

| 항목 | 내용 |
|---|---|
| 좁은 창(≤640px) 카드 넘침 | 그리드 열 268px에 카드 316px — 그리드 아이템 `min-width:auto` → `ConnectedPlatformCard` 루트에 `min-w-0`. 데스크톱 폭에는 영향 없음 |
| 대시보드 연동 상태 라벨 | `/tenants/me/integrations` 응답 필드는 `provider`인데 `DashboardPage`가 `it.name`을 읽어 모든 행이 "integration.undefined"(FIX-260827 잔여). `provider` 우선 + 상태 배지 i18n(`integrationState.*`) |

## 3. 엣지 케이스

| ID | 케이스 | 처리 |
|---|---|---|
| E1 | 자체 플랫폼 이름 공백 | 모달 저장 버튼 비활성(required non-secret 검증) |
| E2 | `test('self')` 직접 호출 | 프로브 없음, 등록 상태 불변(E-code 없이 ok/false) |
| E3 | 자동 동기화 스케줄러 | `ECOMMERCE_PROVIDERS`에 `self` 미포함 → 대상 아님(`listShopifyTenantIds` 등 provider 고정) |
| E4 | Shopify 자격증명 삭제(기타 설정 탭) | cred 행 소멸 → 카드 사라지고 칩 활성화 |
| E5 | `commerce_enabled` 토글 | 자체 플랫폼 카드의 웹훅 블록 ↔ 안내 문구 즉시 전환(위젯 설정 쿼리 공유) |
| E6 | 마케팅 탭 | `ProviderGrid` 그대로 — 변경 없음 |

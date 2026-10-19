# RPT-261019 플랫폼 연동 화면 — 연결된 플랫폼 / 플랫폼 추가 / 자체 플랫폼 구현 보고

- 작성일: 2026-10-19 · 근거: `REQ-261019-Platforms-Connected-Status-UI.md`, `PLN-261019-…`, `TCR-261019-…`
- 요청: go2joy(자체 플랫폼)의 `/settings/platforms`에 Shopify "연결됨"이 뜨는 문제 → 실제 연동된 플랫폼만 표시, 지원 플랫폼은 버튼, 자체 플랫폼 카드 추가

## 1. 무엇이 바뀌었나

| 영역 | AS-IS | TO-BE |
|---|---|---|
| Shopify 연결 상태 | 전역 `integration_status.shopify` 1행(테넌트 구분 없음) — ivyusa 자동 동기화가 30분마다 `connected`로 유지 → 모든 테넌트에 "연결됨"+ivyusa 동기화 문구 | per-tenant `integration_credentials(tenant,'shopify')`.status/detail/last_tested_at. 자격증명 없음=표시 없음, 저장=미테스트, 테스트·동기화 성공=연결됨 |
| 상태 쓰기 | 연결 테스트·주문 동기화가 전역 행에만 기록 | 테넌트 행에 기록(`TenantService.recordShopifyOutcome`), 전역 행은 자동 동기화 커서(`last_sync_at`) 용도로만 유지 |
| 화면 구조 | 지원 플랫폼 5장 동일 카드 + Cafe24 OAuth 카드 + 자체 개발(웹훅) 카드 | **연결된 플랫폼**(자격증명 있는 것만 카드: 연결됨/오류/미테스트/등록됨, 설정·연결 테스트·동기화) + **플랫폼 추가**(칩 6개, 연결된 것은 ✓ 비활성) |
| 자체 플랫폼 | 개념 없음 | provider `self`(이름·설명) — 저장 즉시 등록됨, 프로브·동기화 대상 아님. 주문 이행 웹훅 블록은 카드 안에서 `commerce_enabled=1`일 때만, 꺼진 테넌트는 "위젯 설치만으로 연동 완료" 안내 + 위젯 설정 링크 |
| Cafe24 | 카드 2장 | 추가 = OAuth 모달(몰 ID → Cafe24 연결, "직접 입력" 링크), 설정 = 자격증명 모달 |
| 대시보드 연동 상태 | 모든 행 "integration.undefined"(응답 `provider` vs 코드 `name`) | `provider` 읽기 + 상태 배지 i18n, `self` 라벨 "자체 플랫폼" |

## 2. 파일

**PR #669 (코드)**
- API: `tenant/tenant.service.ts`(getShopifyView·recordShopifyOutcome), `tenant/tenant.mapper.ts`, `tenant/tenant.controller.ts`, `order/shopify-sync.service.ts`(record(tenantId…)), `tenant/ecommerce-integration.service.ts`(self 저장 게이트·test 예외)
- types: `packages/types/src/common/enum.types.ts`(`INTEGRATION_PROVIDER.SELF`, `SELF_PLATFORM_PROVIDER`, `INTEGRATION_FIELDS.self`)
- web: `settings/SettingsPlatformsPage.tsx`(재작성), 신규 `ConnectedPlatformCard.tsx`·`AddPlatformButtons.tsx`·`Cafe24ConnectModal.tsx`·`FulfillmentWebhookBlock.tsx`·`platform-connections.hooks.ts`, `IntegrationConfigModal.tsx`(self 분기), `integration-providers.ts`; 삭제 `SelfDevelopmentCard.tsx`·`Cafe24ConnectCard.tsx`
- i18n: `locales/{en,es,ko,vi,ja,zh}/settings.json`(platforms.*, integrations.shopify/self, fields·ph, state.registered, selfDev.webhookTitle, cafe24.oauth.modalTitle/manualEntry), `dashboard.json`(integration.self)
- 스펙: `tenant.service.shopify-status.spec.ts`(6), `ecommerce-integration.service.self.spec.ts`(6), `shopify-sync.service.spec.ts`(+1)
- 문서: REQ·PLN

**PR 2 (후속 수정 + 문서)**
- `ConnectedPlatformCard.tsx` 루트 `min-w-0`(좁은 창 넘침), `dashboard/DashboardPage.tsx`·`dashboard.service.ts`(provider 읽기·상태 라벨), `dashboard.json` 6개 언어 `integrationState.*`
- TCR·RPT

## 3. 테스트 결과
- API jest 237 suites / 2,338 tests ✅ · `npm run typecheck` 9/9 ✅ · `i18n:check` complete ✅ · web build ✅ · CI(PR #669) pass
- 스테이징 실측 I1~I9 전부 ✅ — TCR §2. 핵심: go2joy `GET /tenants/me/shopify` → `integration.status=null`(배포 전 `connected`+ivyusa 문구), ivyusa는 동기화 1회 후 `connected`.

## 4. 배포 상태

| 항목 | 상태 |
|---|---|
| PR #669 | main `4e60bcf9` (스쿼시) |
| 스테이징 | 2026-10-19 12:18 `deploy-staging.sh` — api/web/widget/pwa 재생성, health 200, 접근 로그 2xx·ERROR 0 |
| 마이그레이션 | 없음(스키마 변경 없음) |
| 스테이징 데이터 | go2joy `integration_credentials` provider `self` 1행 등록("Go2Joy / 호텔 파트너 어드민(자체 개발)") — 실사용 값이므로 유지 |
| PR #670 | main `37c3af21` — 12:33 스테이징 재배포(health 200), 대시보드 "자체 플랫폼 · 연결됨" 실측 ✅ |
| 프로덕션 | ✅ #669는 타 세션이 2026-10-19 21:23 KST `production` ff `7992e71..4e60bcf`로 반영(RPT-261019-Routing-Assignee-Groups 참조). #670·#672는 `production` ff `4e60bcf..e24b2c1` → `deploy-self-hosted.sh`(api/web 재생성, `successfully started`, ERROR 0, health 200, 번들 `DashboardPage` 청크에 `integrationState`·`SettingsPlatformsPage` 청크 확인). SQL 없음. #673(매뉴얼 HTML)은 머지 후 ff 예정 |

## 5. 운영 메모
- **fix-forward**: 배포 직후 Shopify 테넌트는 "미테스트"로 보이다가 다음 자동 동기화 틱(30분) 또는 수동 동기화·연결 테스트 후 "연결됨". ivyusa는 배포 직후 수동 동기화로 바로 전환함.
- 전역 `integration_status`·어드민 `GET /integrations/status`는 그대로(어드민 전용 집계). Shopify **연결 테스트** 결과는 더 이상 전역에 기록되지 않고, **동기화** 결과만 커서용으로 기록된다.
- 자체 플랫폼 행은 기타 설정 탭 "저장된 자격증명" 목록에도 `self`로 보이며 거기서 삭제 가능(삭제 시 카드 사라지고 칩 활성화).
- 매뉴얼 `platform-integration.{ko,en,vi}.html` 화면 구성 단락 갱신: PR #673.
- 보류: 자동 동기화 커서 per-tenant화(Shopify 테넌트 2곳 이상일 때), `tenants.platform` 컬럼(어드민 집계), 마케팅 탭 동일 레이아웃.

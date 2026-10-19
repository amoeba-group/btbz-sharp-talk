# FIX-261019 Shopify 자동 동기화 커서가 테넌트 간 공유되던 문제 (per-tenant 분리)

- 작성일: 2026-10-19 · 발견: PLN-261019-Platforms-Connected-Status-UI §3(보류 항목) → 사용자 "계속 진행"으로 착수
- 범위: API(`ShopifySyncService`, `TenantService`, `IntegrationCredential`), SQL 1열, 스펙

## 증상 (잠재)
Shopify 주문 증분 동기화의 "언제부터" 커서가 **프로바이더 전역** `integration_status.shopify.last_sync_at` 한 값이었다.
테넌트 A의 동기화가 끝나면 그 시각이 커서가 되고, 다음 틱에서 테넌트 B는 **자기 마지막 성공 시각이 아니라 A의
시각**부터 읽는다. B가 한동안 실패했거나 새로 연결된 경우 그 사이 갱신된 주문을 건너뛴다(10분 lookback만 완충).
현재 스테이징·프로덕션 모두 Shopify 테넌트가 ivyusa 1곳이라 실해는 없었고, 2곳째가 생기는 순간 발현한다.
실패한 실행도 전역 커서를 전진시켰다(`upsert`가 ok/error 모두 `last_sync_at=now`).

## 근본 원인
FR-047 시절의 `integration_status`는 플랫폼 전역 상태 테이블(이름 유니크, `tenant_id` 없음)인데, PERF-5가 증분
커서를 거기 얹었다. FIX-260827·PLN-261019로 **상태 표시**는 테넌트별로 옮겼지만 **커서**는 남아 있었다.

## 수정
- `integration_credentials.last_synced_at datetime NULL` 추가 — **이 테넌트의 마지막 성공 동기화 시작 시각**.
  `sql/261019-integration-credentials-last-synced.sql`(매니페스트 갱신).
- `ShopifySyncService.syncOrders`: `since = tenantService.getShopifySyncCursor(tenantId) − lookback`.
  성공 시 `recordShopifyOutcome(tenantId, true, detail, { syncedAt: startedAt })` — 커서는 **실행 시작 시각**
  (실행 중 갱신된 주문이 다음 창에 들어오도록). 실패·중단·연결 테스트는 커서를 움직이지 않는다.
- 전역 `integration_status` 쓰기 **완전 제거**(`ShopifySyncService`에서 `IntegrationService` 의존 삭제). 전역
  테이블과 어드민 `GET /integrations/status`는 그대로 남지만 Shopify는 더 이상 기록하지 않는다.
- 스펙: 커서 읽기(테넌트별·lookback), 실패 시 커서 불변, 테스트는 커서 불변, `getShopifySyncCursor` null/값.

## 영향
- 배포 후 첫 실행은 테넌트별 커서가 NULL이라 **전체 동기화 1회**(페이지 캡 `MAX_PAGES`로 상한). 이후 증분.
- 응답·화면 변화 없음. 스케줄러(`ScheduledShopifySyncService`) 무변경.
- 다른 커머스 동기화(cafe24/odoo/haravan/woo)는 전역 커서를 쓰지 않아 해당 없음.

## 마이그레이션
- SQL: `sql/261019-integration-credentials-last-synced.sql` — `ALTER TABLE integration_credentials ADD COLUMN last_synced_at datetime NULL;`
- 순서: 스테이징·프로덕션 **SQL 선적용 → 코드 배포**(구 코드는 추가 열을 무시, 신 코드+구 스키마는 500).
- 롤백: `DROP COLUMN last_synced_at` + 코드 되돌림.

## 예방 패턴
- 멀티테넌트에서 "마지막 실행 시각"류 커서는 **반드시 테넌트 축**에 둔다. provider-name 전역 키에 얹은 커서는 상태
  표시가 테넌트별로 바뀐 뒤에도 조용히 남는다 — 전역 테이블을 읽는 모든 호출(`findByName`)을 grep으로 전수 확인.
- 커서는 **성공한 실행의 시작 시각**으로만 전진. 실패 실행이 커서를 움직이면 미수신 데이터가 생긴다.

## 검증
- 단위: `shopify-sync.service.spec`(커서 창·실패 불변), `tenant.service.shopify-status.spec`(syncedAt 규칙·조회) ✅
- 스테이징: SQL 선적용 → 배포 → ivyusa 수동 동기화 → `integration_credentials.last_synced_at` 기록 확인(RPT 참조)

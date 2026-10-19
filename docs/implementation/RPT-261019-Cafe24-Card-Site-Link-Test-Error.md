# RPT-261019 Cafe24 카드 복원 · 플랫폼 사이트 바로가기 · OAuth 연결 테스트 — 구현 보고

- 근거: `REQ/PLN-261019-Cafe24-Card-Site-Link-Test-Error.md`(승인) · 테스트: `TCR-261019-Cafe24-Card-Site-Link-Test-Error.md`
- 구현 PR: **#677** (session/platforms-status → main, squash) · 문서 PR: 후속
- 스키마 변경 없음 · 데이터 정정 1회(스테이징만; 프로덕션은 대상 행 없음)

## 1. 무엇이 바뀌었나

| 영역 | 변경 |
|---|---|
| API | `GET /tenants/me/integrations/cafe24` 응답에 `mode: 'oauth' \| 'manual' \| null`, OAuth면 `fields.mall_id = mallId`(D1). 일반 `POST …/integrations/cafe24/test`는 OAuth blob이면 `{ok:false, skipped:true, detail}` 반환·**상태 미기록**(D3). 수동 토큰 저장 시 OAuth 키 제거(수동 전환). 신규 `POST /tenants/me/cafe24/test`(`Cafe24ConnectionTestService`, Cafe24 모듈): refresh 토큰으로 액세스 토큰 발급 → `/products?limit=1` → 실패 시 `/orders`(당일 1건) → `status/detail/last_tested_at`를 **partial update**로 기록(D2). |
| 콘솔 | `Cafe24ConnectedCard`(부제 `{mall}.cafe24.com · OAuth 연결/수동(토큰)`, 설정·연결 테스트·주문 동기화·상품 가져오기), 모든 연결 카드에 **사이트 열기 ↗**(`platformSiteUrl()`; Shopify admin·Cafe24 eclogin(mall_id)·Woo wp-admin·Odoo /web·Haravan /admin·Klaviyo·Yotpo·Gorgias app·자체=storefront_url; 값 없으면 숨김)(D4/D5). Cafe24 "설정"은 OAuth면 `Cafe24ConnectModal` 재연결 모드(제목·안내·몰 ID 프리필), 수동이면 자격증명 모달. 일반 테스트 `skipped` → info 토스트. i18n 6개 언어. |
| 데이터 | 스테이징 `integration_credentials` id 3·14 `status='unknown', detail=NULL, last_tested_at=NULL`(D6, 15:44 UTC). |

## 2. 파일
- API: `cafe24/cafe24-connection-test.service.ts`(신규)·`.spec.ts`(신규 7), `cafe24.controller.ts`(+`POST test`), `cafe24.module.ts`, `tenant/ecommerce-integration.mapper.ts`(`cafe24CredentialMode`), `ecommerce-integration.service.ts`, `ecommerce-integration.service.cafe24-mode.spec.ts`(신규 8), `dto/response/tenant.response.ts`
- 웹: `settings/ConnectedPlatformCard.tsx`(`Cafe24ConnectedCard`·`OpenSiteLink`), `platform-site-url.ts`(신규), `platform-connections.hooks.ts`(`fields`·`mode`), `SettingsPlatformsPage.tsx`, `Cafe24ConnectModal.tsx`(`reconnectMallId`), `settings.hooks.ts`(`useTestCafe24`·`useSyncCafe24Orders`·`useSyncCafe24Products`), `settings.service.ts`, `i18n/locales/{en,es,ko,vi,ja,zh}/settings.json`
- 문서: REQ·PLN·TCR·RPT, 매뉴얼 `platform-integration.{ko,en,vi}.html` 1줄

## 3. 테스트 결과
- 단위 18건 ✅(TCR §1), `jest src/domain/cafe24 src/domain/tenant` 162 ✅, API/웹 tsc ✅, 웹 build ✅, i18n:check ✅
- 스테이징 실측 I1~I14(TCR §2): UI·링크·모달·토스트·일반 테스트 가드·데이터 정정 전부 ✅. OAuth 테스트 "연결됨" 분기는 #679 배포 후 amoebaorder로 실측 ✅(§4-3).

## 4. 실측이 잡은 결함 2건 (머지 전 수정, TCR §2.1)
1. `/admin/store` 프로브 → 앱이 `mall.read_store`를 요청하지 않아 403. `/products?limit=1`(+`/orders` 폴백)로 교체.
2. **회전 토큰 덮어쓰기**: 테스트 서비스가 먼저 읽어 둔 `cred`를 `save()` → 프로브 중 토큰 서비스가 회전·저장한 refresh 토큰을 구 값으로 되돌림 → 다음 refresh 400. `repository.update({id}, {status, detail, lastTestedAt})`로 교체하고 `save()`를 throw하는 더블로 스펙 고정.
   - **영향**: 스테이징 **zhangbayo(tenant 16)의 Cafe24 refresh 토큰이 첫 실측(16:24 UTC)에서 소실**. 자동 동기화·테스트가 "token refresh failed — reconnect" 상태. **운영자가 카드 → 설정(Cafe24 재연결) → Cafe24 연결로 재인가해야 복구**(몰 관리자 로그인 필요). 프로덕션은 Cafe24 자격증명이 없어 무영향.
   - amoebaorder(tenant 3)는 refresh 정상·읽기 403(몰 권한 축소, 기존 상태) → 카드가 "re-authorise" 오류를 정확히 표시.

3. **재연결 후 구 액세스 토큰 사용(기존 결함, 후속 PR #679)**: `Cafe24TokenService` 캐시가 테넌트 id만으로 조회돼 콘솔 재연결 뒤에도 이전 grant 토큰을 ≤2h 사용. 사용자가 amoebaorder를 16:52 재인가했는데 테스트가 계속 403이던 원인. `sha256(secret_enc)` 지문으로 캐시 대조 → 배포 후 16:56 **`Connected: amoebaorder.cafe24.com (catalogue reachable)`** 실측(OAuth 테스트 성공 경로 확인). `FIX-261019-Cafe24-Access-Cache-Survives-Reconnect.md`.

## 5. 배포 상태
| 환경 | 상태 |
|---|---|
| 스테이징 | ✅ 완료. 브랜치 직접 배포 4회(6ddad7b5 16:23 → 95bad8ad 16:26 → 7b88f826 16:29 → ddc2652a 16:31 UTC; GitHub Actions 장애로 CI 큐 정체 → 서버에서 `session/platforms-status` 체크아웃 후 `deploy-staging.sh`). 머지 후 main으로 되돌려 재배포 — §6에 기록 |
| 프로덕션 | ✅ 완료(b0d35b07, 16:42 UTC) — §6. 후속 #678/#679/#680까지 전부 반영, 최종 main `7c821463`(17:11 UTC) — §6-1 |
| SQL | 없음. 데이터 정정은 스테이징만 |

## 6. 머지·최종 배포 기록
- **머지**: PR #677 squash → main `b0d35b07` (2026-10-19 16:39 UTC). CI: 첫 런(6ddad7b5)이 모든 단계 성공 후 30분간 닫히지 않음 → 빈 커밋 재트리거(01c1760d) → GitHub Actions `degraded_performance`로 큐 정체 → 헤드 커밋 ddc2652a 런 2m47s pass 후 `--admin` 머지.
- **스테이징(main)**: 서버 체크아웃 `session/platforms-status` → `main` 복귀, `git pull --ff-only` b0d35b07, `deploy-staging.sh` 16:41 UTC — api/web 컨테이너 8초, `successfully started`, ERROR 0, `/api/v1/health` 200, `POST /tenants/me/cafe24/test` 무인증 **401(=배포됨)**.
- **프로덕션**: `origin/main:production` ff(e653dee7→b0d35b07), 백업 `backups/20261019T164121Z`, `check-migrations.sh` OK(applied 102), `deploy-self-hosted.sh` 16:42 UTC — api/web 컨테이너 6~7초, `successfully started` 16:42:45, ERROR 0, `https://sharptalk.amoeba.site/api/v1/health` 200, `POST /tenants/me/cafe24/test` 무인증 **401(=배포됨)**, 콘솔 번들 `index-DMaG3Q3f.js`.
- 프로덕션 데이터 정정: 대상 없음(`integration_credentials` 0행).

### 6-1. 후속 PR 3건 배포 기록 (전부 2026-10-19 UTC, SQL 없음)
| PR | main | 내용 | 스테이징 | 프로덕션 |
|---|---|---|---|---|
| #678 | `dff61d9f` (16:47) | TCR/RPT 실측 기록 + 매뉴얼 Cafe24 카드 1줄 | 16:49 | 16:49:57 `successfully started`, health 200, `cafe24/test` 무인증 401 |
| #679 | `6ce14282` (17:00) | `Cafe24TokenService` 액세스 토큰 캐시에 `sha256(secret_enc)` 지문 — 재연결 뒤 구 토큰 ≤2h 사용 결함(`FIX-261019-Cafe24-Access-Cache-Survives-Reconnect`) | 17:01:58 | 17:03:07 `successfully started`, health 200, 401 |
| #680 | `7c821463` (17:09) | 수동(토큰) Cafe24 카드 "OAuth로 연결" 버튼 + 자격증명 모달 OAuth→수동 전환 경고 | 17:10:33 | 17:11:44 `successfully started`, ERROR 0, health 200, 번들 `platform-connections.hooks-Bb5XlqEf.js`에 `connectOAuth` 키 확인 |

- 매 배포 공통 검증: api/web 컨테이너 6~8초(healthy), `Nest application successfully started`, ERROR 0, `/api/v1/health` 200. 프로덕션은 `origin/main:production` ff → `deploy-self-hosted.sh`.
- #679·#680 CI는 정상 통과(17:00·17:10 success) — 16시대 GitHub Actions 장애는 해소됨.

### 6-2. 스테이징 Cafe24 자격증명 최종 스냅샷 (2026-10-19 22:27 UTC)
| id | 테넌트 | 모드 | status | detail | 비고 |
|---|---|---|---|---|---|
| 3 | amoebaorder | 수동(토큰) | error | `Cafe24 token invalid or expired` (17:04) | 사용자가 자격증명 모달에 토큰을 저장해 OAuth→수동 전환. **카드 "OAuth로 연결"(#680)로 복귀 필요**. 자동 동기화는 "store is not connected"로 건너뜀(기록 없음) |
| 4 | annehearts | OAuth | unknown | — | 자동 동기화 정상(21:40 주문 84건). status는 테스트 게이트라 "연결 테스트" 전까지 unknown — 설계대로 |
| 14 | zhangbayo | OAuth | error | `token refresh failed … reconnect the mall` (16:44) | §4-2 소실 건. **설정(Cafe24 재연결) → 동의 필요**. 자동 동기화 매 틱 400 경고 1줄(기록 없음) |

## 7. 남은 것
- 스테이징 zhangbayo Cafe24 재인가(운영자). 재인가 후 카드 "연결 테스트" → `Connected: zhangbayo.cafe24.com (catalogue reachable)` 기대.
- ~~amoebaorder 몰 권한 복구~~ → 사용자가 16:52 재인가, #679 후 연결됨 확인. 이후 17:04 수동 토큰 저장으로 다시 오류 → #680 "OAuth로 연결" 버튼으로 복귀(운영자 동의 필요, §6-2).
- 수동(토큰) Cafe24 연결의 동기화 버튼(PLN §4 보류 — 토큰 수명 2h라 비권장).
- (관찰) 자동 동기화 성공은 `last_synced_at`·status를 갱신하지 않음(Shopify만 `tenant.service` 커서 기록). 카드가 그 값을 표시하지 않아 사용자 영향 없음 — 표시가 필요해지면 그때 함께.

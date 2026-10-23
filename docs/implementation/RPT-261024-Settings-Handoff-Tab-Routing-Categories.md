# RPT-261024 — 설정: 상담원 연결 탭 분리 · 배정 규칙 지역 → 카테고리 + 카테고리 관리

- REQ: `docs/analysis/REQ-261024-Settings-Handoff-Tab-Routing-Categories.md`
- PLN: `docs/plan/PLN-261024-Settings-Handoff-Tab-Routing-Categories.md` (D1~D6 권장안 승인, 2026-10-24)
- TCR: `docs/test/TCR-261024-Settings-Handoff-Tab-Routing-Categories.md`

## 1. 변경 내용

| 항목 | 결과 |
|---|---|
| 탭 분리 | `/settings/handoff` [상담원 연결] 탭(2번째). 제공 판정은 `settings_basic` 공유(D1). 기본 설정에서 카드 제거 |
| 카테고리 저장소 | 새 테이블 `routing_categories(tenant_id, code, name NULL, sort_order)`, UNIQUE(tenant_id, code) (D3) |
| 기본 카테고리 | 지역을 쓰던 테넌트에만 north~south 5개, name NULL(언어별 기본 이름 표시) (D4) |
| API | `GET /routing-categories`(@Auth, 사용처 포함), `POST`·`PATCH`(일괄)·`DELETE /:id`(`AI_SETTINGS_MANAGE`). 감사 `routing_category.created/updated/deleted` |
| 오류 코드 | E5107 사용 중(사용처 details), E5108 중복, E5109 없음/다른 테넌트 |
| 검증 교체 | 팀·라벨 `regions`, 기업 `region` 필터: `@IsIn(REGION_CODES)`를 테넌트 카테고리 검증으로 |
| 화면 | 규칙 칩·카테고리별 후보·팀/라벨 담당 범위·기업 지역 필터가 테넌트 목록을 따름. [카테고리 관리] 모달 |
| 문구 | 6개 언어 배정 관련 "지역"을 "카테고리"로, 팀·라벨 "담당 지역"을 "담당 범위"로. 기업 "지역" 칸은 유지(D5) |
| 삭제 | 사용 중이면 거부하고 규칙·팀·라벨 이름과 기업 수를 안내(D6) |
| 라우팅 매칭 | **변경 없음**(`handoff-router.service.ts` 무수정) |

## 2. 파일
- **SQL**: `sql/261024-routing-categories.sql`, `sql/artefacts.tsv`
- **API**
  - 새 모듈 `apps/api/src/domain/routing-category/`: entity, request DTO, service(+spec), controller, module
  - 수정
    - `app.module.ts`
    - `global/constant/error-code.constant.ts`
    - `user/user.service.ts`(`checkScope`, 마지막 위치에 `@Optional` 주입)
    - `user/user.module.ts`
    - `user/dto/request/unit.request.ts`
    - `company/dto/request/company.request.ts`
    - `user/user.service.units.spec.ts`
- **Web**
  - 새 파일
    - `domain/routing-categories/`: service, hooks(`useCategoryName`), `RoutingCategoriesModal.tsx`
    - `domain/settings/SettingsHandoffPage.tsx`
  - 수정
    - `SettingsBasicPage.tsx`
    - `SettingsLayout.tsx`
    - `router/AppRouter.tsx`
    - `ai-settings/HandoffSection.tsx`
    - `ai-settings/RoutingRulesEditor.tsx`
    - `users/RegionScopeEditor.tsx`
    - `customers/CompaniesPanel.tsx`
    - i18n `nav`, `aiSetting`, `users` ×6개 언어(사용하지 않게 된 `users.region.*` 제거)

## 3. 테스트
- api jest 257 suites / 2,587 tests 통과. 신규 6건.
- api·web tsc, i18n:check, radius:check 통과
- CI 통과
- 로컬 실부팅, 실 HTTP 13개 시나리오, 콘솔 화면 9항목 확인(TCR)
- 실측 중 수정 2건: 변경이 없는데 켜지던 [변경 저장], 추가 토스트에 코드가 나오던 문제

## 4. 배포

| 환경 | SQL | 코드 | 확인 |
|---|---|---|---|
| 스테이징 | 10/24 02:32 적용. 백업 `~/backups/staging/20261024-0232-pre-routing-categories.sql`. go2joy(테넌트 4)에 5행, 다른 테넌트 0행 | `2524bcc1` ff 후 `deploy-staging.sh` | `successfully started`, ERROR 0, `/routing-categories` 401, health 200, 번들에 `SettingsHandoffPage`·`routing-categories` |
| 프로덕션 | 적용. 백업 `~/backups/sharptalk-production/20261024-0035-pre-routing-categories.sql.gz`. 0행(지역 사용 테넌트 없음) | `production` ea6be2bc..2524bcc1, `deploy-self-hosted.sh` | `successfully started`, ERROR 0, 401, health 200, 번들 확인 |

- PR #727(squash `2524bcc1`)
- 롤백: 코드를 되돌린 뒤 `DROP TABLE routing_categories;` (기존 테이블은 변경 없음)

## 5. 후속
- 매뉴얼(`apps/web/public/manual/` user-manual·knowledge-ai·quick-setup 등 ko/en/vi)에 "기본 설정 탭의 상담원 연결 카드", "7개 탭" 문구가 남아 있다. 별도로 갱신한다.
- 프로덕션에 go2joy를 이관하면 카테고리 5개를 같은 SQL로 다시 투입한다. SQL은 멱등이라 다시 실행하면 된다. 아니면 콘솔에서 직접 추가한다.

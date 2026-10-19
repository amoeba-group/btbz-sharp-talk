# RPT-261019 — 사용자 팀(Unit) · 테넌트별 라벨/팀 관리 · 배정 규칙 고객정보 조건

- 근거: [REQ](../analysis/REQ-261019-Users-Unit-Labels-Routing-Conditions.md) · [PLN](../plan/PLN-261019-Users-Unit-Labels-Routing-Conditions.md)(승인 2026-10-19) · [TCR](../test/TCR-261019-Users-Unit-Labels-Routing-Conditions.md)
- 결정 확정: D1 1인 1팀 · D2 언어별 기본 이름 + KO 아닌 테넌트 라벨 영어화 백필 · D3 `Counsels` 표기 · D4 코드 불변·삭제 없음 · D5/D6 조건 8종·미지 필드=불일치 · D7 팀 단위 담당자 **제외**(후속)

## 1. 배포 상태

| 항목 | 값 |
|---|---|
| PR-A (P1~P3) | [#664](https://github.com/amoeba-group/btbz-sharp-talk/pull/664) → main `8d429d1` |
| PR-B (P4) | [#665](https://github.com/amoeba-group/btbz-sharp-talk/pull/665) → main `cdef289` |
| 스테이징 SQL | `sql/261019-units.sql` 2026-10-19 16:38 선적용(utf8mb4), 백업 `~/backup-pre-units-20261019-163807.sql` + `job_labels_bak_261019`(48행) |
| 스테이징 배포 | 2026-10-19 18:44 `cdef289`, 컨테이너 재생성, `successfully started`, 스키마 오류 0, `/api/v1/units` 401 |
| 프로덕션 | **미적용** — 별도 지시 시 `sql/261019-units.sql` 선적용 → 배포(한국 프로덕션엔 go2joy 테넌트 없음 → go2joy INSERT는 no-op) |

## 2. 변경 요약

### 백엔드
- `units` 엔티티/테이블 + `users.unit_id`(NULL 허용, bigintTransformer, 명시 type). `UnitController`(`GET/POST/PATCH /units`, `LABEL_EDIT`, 메뉴 users) · `PATCH /users/:id/unit`(`LABEL_ASSIGN`) · 초대 `unit_id?` · `UserResponse.unitId/unitName`(팀 1회 조회) · E2005 `UNIT_NOT_FOUND` · 감사 `unit.created/unit.renamed/user.unit_changed`.
- `default-org.ts`: 라벨·팀 기본 이름을 테넌트 언어(KO/그 외)로 한 곳에서 결정. `tenant.service`(생성 2경로)·`seed.runner` 공용. 라벨·팀 코드 `^[a-z0-9_]{1,24}$`.
- 배정 규칙: `RoutingRule.conditions[{field, values}]`, `matchRoutingRule` 조건 AND·카탈로그 op·미지 필드 불일치+warn, `describeConditions` 로그, `needsCustomerTier`. `chat.service.routingContext()`로 인계 2경로 통합.
- `@sharptalk/types` `common/routing-condition.ts`(필드 8종, enum 값, 헬퍼).

### 콘솔
- `/users`: 팀 열, 편집·초대 모달 팀 `Select`, master 전용 `LabelsUnitsModal`(라벨/팀 탭, 인라인 이름 변경, 추가, 권한 배지·안내, 토스트). `users.json` 6언어 +17키.
- 인계 섹션: deny 라벨 Select·규칙 업무 칩 → 테넌트 라벨(i18n 폴백). 규칙 카드 고객 정보 행(조건 추가/칩/쉼표/제거), 언어 칩=테넌트 제공 언어. `aiSetting.json` `handoff.routing.customer.*` 6언어.

### 파일
`apps/api/src/domain/user/{entity/unit.entity.ts, unit.controller.ts, default-org.ts, dto/request/unit.request.ts, user.service.units.spec.ts}`(신규) · `user.{entity,service,controller,module}.ts` · `dto/{request/user.request,request/job-label.request,response/user.response}.ts` · `tenant/{tenant.service,tenant.module}.ts` · `database/seed.runner.ts` · `global/constant/error-code.constant.ts` · `ai-engine/{handoff-router.service(+spec), entity/tenant-ai-config.entity}.ts` · `chat/chat.service.ts` · `packages/types/src/{index,common/routing-condition}.ts` · `apps/web/src/domain/users/{LabelsUnitsModal.tsx(신규), UsersPage.tsx, users.service.ts, users.hooks.ts}` · `apps/web/src/domain/ai-settings/{HandoffSection,RoutingRulesEditor,ai-settings.service}.ts(x)` · locales 6×2 · `sql/261019-units.sql` · `sql/artefacts.tsv`

## 3. 테스트 결과
- API jest 234 suites / 2,319 통과(신규 units 5 · routing 조건 6). `npm run typecheck` 통과 · `npm run i18n:check` complete · CI #664/#665 pass.
- 로컬: 부팅 + synchronize DDL == SQL DDL · curl 스모크 10건 · 콘솔 실측 8건(TCR §3).
- 스테이징 SQL 결과: units 16테넌트×3 + go2joy 4 = 52행, 라벨 영어화 45행(zhangbayo KO 제외), 백업 2중.

## 4. PLN 대비 차이
- 조건 저장 형식은 `{field, values}`(PLN의 `op` 미저장): op는 카탈로그가 필드별로 고정하므로 저장하면 드리프트만 생김.
- 스테이징 콘솔 **클릭 실측(S-03·S-04)은 미수행** — 스테이징 로그인은 자동화 범위 밖. 배포 증빙은 스웨거 경로·웹 번들 문자열·DB 행으로 대체. 사용자 확인 절차: `/users` → [라벨·팀 관리] 팀 탭(go2joy는 7종) → 편집 모달 팀 저장 → `/settings/basic` 규칙 추가 → 고객 정보 조건 저장 후 새로고침.

## 5. 남은 일
1. 프로덕션 반영(지시 시): SQL 선적용 → 배포 → 라벨 이름 영어화 영향 테넌트 공지(ivyusa 등).
2. `docker/init-sql/01-schema.sql` 재생성 — 261019 마이그레이션 3건(csat·widget_languages·units) 뒤처짐.
3. D7 규칙 담당자 팀 단위 선택(go2joy 지역 팀과 결합) — 후속 REQ.
4. `users.hooks.ts` 기존 토스트 영어 하드코딩(초대·갱신) — 기존 결함, i18n화 후속.

# RPT-261019 — 배정 규칙 담당자 팀×라벨 그룹 배정 + 담당자 목록 정렬 + 라벨/팀 관리 바로가기

- 근거: [REQ](../analysis/REQ-261019-Routing-Assignee-Groups.md) · [PLN](../plan/PLN-261019-Routing-Assignee-Groups.md)(승인 2026-10-19) · [TCR](../test/TCR-261019-Routing-Assignee-Groups.md)
- 결정 확정: D1 인계 시점 동적 해석 · D2 팀 AND 라벨 · D3 active만 + 상담 라벨 미보유 ⚠ · D4 0명=다음 규칙 · D5 후보 상태 필터 결함 동시 수정

## 1. 배포 상태

| 항목 | 값 |
|---|---|
| PR | [#667](https://github.com/amoeba-group/btbz-sharp-talk/pull/667) → main `13752ca` |
| 마이그레이션 | 없음(JSON 컬럼) |
| 스테이징 배포 | 2026-10-19 `13752ca`, api/web/nginx 재생성, `successfully started`, 오류 로그 0, `/api/v1/units` 401, 웹 번들에 `routing.assignee.*`·`assigneeLabelCodes`·`manage=1` 포함 |
| 프로덕션 | ✅ 2026-10-19 21:23 KST — 백업 `~/backups/sharptalk-production/20261019-2123` → SQL 3건 선적용(`261019-conv-csat-survey`·`261019-tenant-widget-languages`·`261019-units`; ivyusa 팀 CS/MKT/Management 생성, 라벨 상담/회계/운영 → Counsels/Accountant/Operation, 백업 `job_labels_bak_261019`) → `production` ff `7992e71..4e60bcf`(#647~#669) → `check-migrations` OK → `deploy-self-hosted.sh`. API healthy, `successfully started`, ERROR 0, `/api/v1/units` 401, 콘솔 청크 `SettingsBasicPage`에 `assigneeUnitIds`·`manage=1`, `UsersPage`에 `unitName` |

## 2. 변경 요약

- **타입** `packages/types/src/common/routing-assignee.ts`: `AssigneeGroupSelector`·`resolveAssigneeGroup`(active, 팀 AND 라벨, id 문자열 비교)·`hasAssigneeGroup`. 콘솔 미리보기와 서버가 같은 함수.
- **규칙** `RoutingRule.assigneeUnitIds?`·`assigneeLabelCodes?`. 유효 = 개인 1명 이상 또는 그룹 선택자.
- **판정** `matchRoutingRules`(조건 일치 규칙을 순서대로 전부) + `HandoffRouterService.route()`가 규칙마다 `RoutingAssigneeService.resolve`(테넌트 active 사용자 + 라벨 코드, 라벨 미선택 시 링크 조인 생략)로 그룹을 풀어 개인과 합집합. 0명이면 warn 후 다음 규칙 → 기본 담당자. 로그 `explicit n, group(unit:…×label:…) m → k agent(s)`. `ai-engine.module`에 User/JobLabel/UserJobLabel 리포지토리만 등록(모듈 순환 없음), resolver는 `@Optional`.
- **콘솔 규칙 카드** 담당자 행: [전체/팀별/라벨별] 보기(복수 라벨 사용자는 각 라벨 아래), 그룹 배정 팀 칩·라벨 칩 + "지금 N명" 미리보기(0명 경고·⚠ 상담 라벨 없음), 개인 지정, "라벨·팀 관리 →"(master → `/users?manage=1`). 후보 = `status === 'active'`.
- **`/users`** 편집·초대 모달 푸터 "라벨·팀 관리 →"(master) → 관리 모달, `?manage=1` 자동 오픈 후 쿼리 제거.
- **i18n** `aiSetting.handoff.routing.assignee.*` 13키 · `users.manageLink` 6언어.

### 파일
`packages/types/src/common/routing-assignee.ts(+spec)` · `packages/types/src/index.ts` · `apps/api/src/domain/ai-engine/{routing-assignee.service.ts(+spec), handoff-router.service.ts(+spec), ai-engine.module.ts, entity/tenant-ai-config.entity.ts}` · `apps/web/src/domain/ai-settings/{RoutingRulesEditor.tsx, HandoffSection.tsx, ai-settings.service.ts}` · `apps/web/src/domain/users/UsersPage.tsx` · locales 6×2

## 3. 테스트 결과
- jest: types 4 · API 235 suites / 2,326 통과(신규 7). typecheck · i18n:check 통과. CI pass.
- 로컬 실측: 그룹 South Center × Counsels → "지금 1명" → 저장 → DB `assigneeUnitIds:[5], assigneeLabelCodes:["consult"]`; 그룹 전용 규칙 + 언어 es 조건으로 ES 세션 escalate → `handoff routed by rule #1 (… language=es, explicit 0, group(unit:5×label:consult) 1 → 1 agent(s))`; `/users?manage=1`·편집 모달 링크 전환 확인.
- 스테이징 콘솔 클릭 실측(go2joy North 팀 그룹)은 사용자 확인 — 로그인 자동화 범위 밖.

## 4. PLN 대비 차이
- 없음. 담당자 후보 필터 결함(G5)은 함께 수정.

## 5. 남은 일
1. ~~프로덕션 반영~~ 완료(10/19 21:23, #664/#665/#667 포함).
2. `docker/init-sql/01-schema.sql` 재생성(261019 마이그레이션 3건 뒤처짐).
3. 기본 담당자(규칙 밖 `assigneeUserIds`)와 미수락 재알림 리드도 그룹 선택이 필요하면 후속 REQ.

# PLN-261019 — 배정 규칙 담당자: 팀·직무 라벨 조합 배정 + 라벨/팀 관리 바로가기

- 근거: [REQ-261019-Routing-Assignee-Groups](../analysis/REQ-261019-Routing-Assignee-Groups.md)
- 기준: main `cdef289` · 승인 후 `feature/261019-routing-assignee-groups`, PR 1개
- 상태: **승인 대기**

## 1. 단계

### P1 — 타입·판정·해석 (backend)
| 항목 | 내용 |
|---|---|
| 타입 | `packages/types/src/common/routing-assignee.ts`: `AssigneeGroupSelector {unitIds, labelCodes}` + 순수 함수 `resolveAssigneeGroup(users[{id,status,unitId,labelCodes}], selector) → ids`(팀 AND 라벨, active만). 콘솔 미리보기와 서버가 같은 함수 사용 |
| 엔티티 | `RoutingRule.assigneeUnitIds?: number[]`, `assigneeLabelCodes?: string[]`(JSON) |
| 판정 | `handoff-router.service`: `matchRoutingRules(rules, ctx)` — 조건이 맞는 규칙을 **순서대로 전부** 반환(개인 또는 그룹 선택자가 있는 규칙만). `route()`는 순서대로 `resolveRuleAssignees` → 1명 이상이면 채택, 0명이면 warn 후 다음 |
| 해석 | `RoutingAssigneeService`(ai-engine, 신규): 테넌트 active 사용자 + `user_job_labels`→코드 + `units` 소속을 한 번 읽어 `resolveAssigneeGroup` 적용, 개인 지정과 합집합. `ai-engine.module` forFeature에 `User, Unit, JobLabel, UserJobLabel` 추가(리포지토리만, 모듈 import 없음). bigint PK는 String() 비교 |
| 로그 | 라우팅 로그에 `assignees=explicit 1 + group(unit:north×label:consult) 3` |
| 테스트 | `routing-assignee.spec`(순수 함수 6: 팀만·라벨만·교집합·비활성 제외·빈 선택자·문자열 id), `handoff-router.spec`(그룹 0명 → 다음 규칙/폴백, 개인∪그룹) |

### P2 — 콘솔 담당자 행 (web)
| 항목 | 내용 |
|---|---|
| 후보 | `agents = users.filter(status === 'active')`(consult 조건은 보기용 ⚠로 이동, G5 수정) · `useUnits()`·`useJobLabels()` |
| 보기 | [전체]/[팀별]/[라벨별] 세그먼트 → 그룹 헤더(팀명·라벨명, 없음=`—`) 아래 사람 칩 |
| 그룹 배정 | 팀 칩 + 담당자 라벨 칩 → 미리보기 "지금 N명: a@…" (`resolveAssigneeGroup` 딥 import), consult 없는 멤버 ⚠ |
| 직렬화 | `HandoffSection`: `assigneeUnitIds`(Number)·`assigneeLabelCodes` 저장/복원; 유효성 "개인 또는 그룹 1개 이상" |
| 링크 | 행 우측 "라벨·팀 관리 →" → `/users?manage=1`(master만) |
| i18n | `aiSetting.json handoff.routing.assignee.{view,viewAll,byUnit,byLabel,group,units,labels,preview,previewNone,noConsult,manageLink,needOne}` 6언어 |

### P3 — 사용자 편집 바로가기 (web)
- `UsersPage`: 편집·초대 모달 푸터 좌측 "라벨·팀 관리 →"(master) → 모달 닫고 `LabelsUnitsModal` 오픈. `?manage=1` 진입 시 자동 오픈(열면 쿼리 제거). `users.json manageLink` 6언어.

### P4 — 검증·문서
- jest 전체 · typecheck · i18n:check · 로컬 콘솔 실측(보기 토글·그룹 미리보기·저장 라운드트립·편집 모달 링크·`?manage=1`) · 로컬 인계 로그로 그룹 해석 확인(규칙 그룹만 지정 → 알림 대상 n명).
- 스테이징 배포(SQL 없음) → 부팅·`routingRules` 저장 회귀 → TCR/RPT.

## 2. 사이드 임팩트

| 대상 | 영향 | 대응 |
|---|---|---|
| 기존 규칙(개인만) | `assigneeUserIds`만 있는 규칙은 해석 결과 동일 | 스펙 "개인만 규칙은 현행과 동일" |
| 담당자 후보 필터 수정(G5) | 정지·초대 중 사용자가 후보에서 사라짐; 이미 저장된 id는 "목록에 없음 ×" 칩으로 계속 보임(현행 동작) | 변경 없음 |
| `agent-alert.resolveTargets` | 입력(`targetUserIds`)이 그룹 해석 결과로 커질 뿐 | 변경 없음 |
| `ai-engine.module` 리포지토리 추가 | 부팅 영향 없음(기존 엔티티) | 부팅 확인 |
| 인계 지연 | 그룹 선택자 있는 규칙만 쿼리 3개 추가(ms 단위) | 로그로 확인 |

## 3. 리스크
- 그룹이 0명으로 풀리는 규칙(팀 전원 정지)은 조용히 폴백 → warn 로그 + 콘솔 미리보기 "지금 0명 — 폴백됩니다" 경고.
- 라벨만 고른 그룹에 상담 라벨 없는 사용자가 섞이면 라이브챗 처리 불가 → ⚠ 표시로 인지시키되 막지 않음(D3).

## 4. 와이어프레임

### 4-1. 규칙 카드 담당자 행 (`/settings/basic` 상담원 인계)
```
┌ #1 [북부 · 예약                 ] [접속 중인 상담원 중 가장 한가한 1명 ▾] ↑ ↓ 삭제 ┐
│ 지역      (북부)● (중부) (남부)                                                   │
│ 업무      [키워드…                ] (Counsels)● (Accountant) (Operation)           │
│ 고객 정보  언어 (EN)(VI)● …   [+ 조건 추가 ▾]                                      │
│ ─────────────────────────────────────────────────────────────────────────────── │
│ 담당자    보기 [전체] [팀별]● [라벨별]                         라벨·팀 관리 →      │
│           그룹 배정  팀   (CS) (MKT) (Management) (North)● (North Center) (South) … │
│                      라벨 (Counsels)● (Accountant) (Operation) (QA)                │
│                      ⓘ 지금 3명: n1@go2joy.vn · n2@… · n3@… (인계 시점에 다시 계산)  │
│           개인 지정  ▸ North (3)   (n1@…) (n2@…) (n3@…)                            │
│                      ▸ South (2)   (s1@…) (s2@…⚠)                                 │
│                      ▸ — (1)       (ops@…)                                        │
│           ⚠ 개인 또는 그룹을 하나 이상 고르세요 — 담당자 없는 규칙은 저장되지 않습니다   │
└─────────────────────────────────────────────────────────────────────────────────┘
```
[전체] 보기는 평면 칩, [라벨별]은 라벨 헤더(복수 라벨 사용자는 각 그룹에 표시). ⚠ = 상담 라벨 없음.

### 4-2. 사용자 편집 모달 푸터
```
┌ 사용자 편집 ────────────────────────────────┐
│ 직급 / 직무 라벨 / 팀 / 상태 (현행)            │
│                                             │
│ 라벨·팀 관리 →              [취소] [저장]     │   ← 좌측 링크(master만)
└─────────────────────────────────────────────┘
```
클릭 → 편집 모달 닫힘 → 라벨·팀 관리 모달. `/users?manage=1` 진입 시 관리 모달 자동 오픈.

## 5. 마이그레이션
없음(JSON 컬럼). PR 본문 `## Migration: 없음`.

## 6. 승인 요청
1. D1 인계 시점 동적 해석
2. D2 팀 AND 라벨(교집합), 하나만 고르면 그것만
3. D3 그룹 자격 = active만, 상담 라벨 미보유는 ⚠ 표시(차단 안 함)
4. D4 그룹 0명 → 다음 규칙/기본 담당자
5. D5 담당자 후보 상태 필터 결함을 함께 수정

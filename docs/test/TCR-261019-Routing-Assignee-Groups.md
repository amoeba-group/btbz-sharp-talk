# TCR-261019 — 배정 규칙 담당자 팀×라벨 그룹 배정 + 라벨/팀 관리 바로가기

- 근거: [PLN-261019-Routing-Assignee-Groups](../plan/PLN-261019-Routing-Assignee-Groups.md)
- 환경: 로컬(synchronize, 시드 ivyusa: dev@ = master, 팀 South Center(id 5), 라벨 consult/accounting/operations/qa) · 스테이징

## 1. 단위 테스트(jest)

| ID | 스펙 | 케이스 | 결과 |
|---|---|---|---|
| U-01 | `types/routing-assignee.spec` | 팀만: active 멤버, id 문자열/숫자 동일 | 통과 |
| U-02 | 〃 | 라벨만: 선택 라벨 중 하나 보유, 대소문자 무시 | 통과 |
| U-03 | 〃 | 팀 AND 라벨 교집합, 불일치 조합=[] | 통과 |
| U-04 | 〃 | 빈 선택자는 그룹 아님(`hasAssigneeGroup` false, 해석 []) | 통과 |
| U-05 | `routing-assignee.service.spec` | bigint 문자열 PK·숫자 링크 컬럼 조인, 교집합/팀만/라벨만 → 숫자 id | 통과 |
| U-06 | 〃 | `where {tenantId, status:'active'}`만 조회, 라벨 미선택 시 링크 조인 생략 | 통과 |
| U-07 | `handoff-router.service.spec` | 그룹 규칙 → resolver 호출(unitIds·labelCodes) → 멤버 호출 | 통과 |
| U-08 | 〃 | 그룹 0명 → warn → 다음 일치 규칙 | 통과 |
| U-09 | 〃 | 개인 ∪ 그룹 중복 제거 | 통과 |
| U-10 | 〃 | 개인·그룹 모두 없는 규칙은 불일치 → 기본 담당자 | 통과 |
| U-11 | 〃 | resolver 미주입(위치 인자 스펙) 시 그룹 규칙 건너뜀·개인 규칙 정상 | 통과 |
| 전체 | API jest | 235 suites · 2,326 tests | 통과 |

## 2. 통합(로컬 API)

| ID | 시나리오 | 기대 | 결과 |
|---|---|---|---|
| I-01 | 규칙 #1 = 그룹 전용(팀 5 × consult, 개인 0) + 조건 언어 es | — | DB 반영 |
| I-02 | ES 세션 `session/ensure` → consent → `chat/message` → `chat/escalate` | 라우팅 로그에 그룹 해석 | `handoff routed by rule #1 (tenant 1, region -, language=es, explicit 0, group(unit:5×label:consult) 1 → 1 agent(s))` |
| I-03 | 부팅 | ai-engine.module 리포지토리 추가 후 `successfully started` | 통과 |

## 3. 콘솔 실측(로컬, 한국어)

| ID | 화면 | 확인 | 결과 |
|---|---|---|---|
| C-01 | 규칙 카드 담당자 행 | 보기 [전체][팀별][라벨별], 그룹 배정 팀 칩 5종·라벨 칩 4종, 개인 지정, "라벨·팀 관리 →" | 통과 |
| C-02 | 팀별 보기 | `▸ South Center (1)` 헤더 아래 dev@ 칩; 초대 중(invited) 사용자는 후보에서 제외 | 통과 |
| C-03 | 그룹 South Center + Counsels | "지금 1명: dev@amoeba.group" | 통과 |
| C-04 | 저장 → DB | `assigneeUserIds:[1]`, `assigneeUnitIds:[5]`, `assigneeLabelCodes:["consult"]` | 통과 |
| C-05 | `/users?manage=1` | 관리 모달 자동 오픈, URL `?manage` 제거 | 통과 |
| C-06 | 사용자 편집 모달 푸터 "라벨·팀 관리 →" | 편집 모달 닫히고 관리 모달 | 통과 |
| C-07 | `npm run i18n:check` | 6언어 complete | 통과 |

## 4. 스테이징

| ID | 항목 | 결과 |
|---|---|---|
| S-01 | 배포 후 부팅·스키마 오류 0·웹 번들 문구 | 통과 — `13752ca`, api/web/nginx 재생성, `successfully started`, 오류 0, 번들에 `routing.assignee.*`·`assigneeLabelCodes`·`manage=1` |
| S-02 | go2joy 규칙에서 North 팀 × Counsels 그룹 미리보기·저장 | 콘솔 클릭은 사용자 확인 |

## 5. 엣지 케이스

| 케이스 | 처리 |
|---|---|
| 그룹 멤버 전원 정지 | 해석 0명 → warn → 다음 규칙/기본 담당자. 콘솔 미리보기 "지금은 해당자가 없습니다" 경고 |
| 라벨만 고른 그룹에 상담 라벨 없는 사용자 | 포함(D3) + ⚠ 표시 |
| 저장된 개인 id가 비활성·삭제됨 | "#id ×" 칩으로 계속 표시·제거 가능(현행) |
| 구버전 API + 그룹 전용 규칙 | `assigneeUserIds` 비어 있어 건너뜀 → 기본 담당자(안전 측) |
| 팀 삭제 없음 | 팀 id는 항상 유효; 팀원 0명이면 위 0명 처리 |

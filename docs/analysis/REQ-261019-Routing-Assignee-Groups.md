# REQ-261019 — 배정 규칙 담당자: 팀·직무 라벨 조합 배정 + 라벨/팀 관리 바로가기

- 요청(2026-10-19): `/settings/basic` 상담원 인계 › 규칙 추가에서
  1. **고객 조건과 담당자(Agents) 조건을 매핑** — 현재 담당자는 사람 목록만 나열. 등록된 담당자 목록을 **팀(Unit)·직무 라벨로 정렬**해 보고, **팀×라벨 조합으로 배정**하거나 **특정 사람**으로도 지정할 수 있어야 함.
  2. **라벨·팀 추가/수정 화면 경로를 사용자 편집(Edit user) 하단에 노출** — 변경 화면으로 바로 이동.
- 조사 기준: main `cdef289`(PR #664/#665 머지 후) · 스테이징 테넌트 4(go2joy, 팀 7종)
- 선행: [PLN-261019-Users-Unit-Labels-Routing-Conditions](../plan/PLN-261019-Users-Unit-Labels-Routing-Conditions.md) D7 "규칙 담당자에 팀 단위 선택"을 후속으로 남겼던 항목 — 이번 요구가 그것(+라벨 축).

## 1. AS-IS

| 영역 | 현재 |
|---|---|
| 규칙 담당자 저장 | `RoutingRule.assigneeUserIds: number[]`만. 사람 id의 정적 목록 — 팀에 사람이 늘어도 규칙은 그대로 |
| 콘솔 담당자 행 | `RoutingRulesEditor` "담당자": `agents` 칩 나열(이메일). `agents = users.filter(labelCodes∋consult && status !== 'inactive')` — ⚠️ 상태 값은 invited/active/suspended라 `'inactive'` 비교는 항상 참 → **정지(suspended)·초대 중 사용자도 담당자 후보로 노출** |
| 사용자 데이터 | `GET /users` 응답에 이미 `unitId/unitName`(PR #664)·`labelCodes` 있음 → 콘솔 정렬·그룹화에 추가 API 불필요 |
| 판정 | `matchRoutingRule`: 담당자가 0명인 규칙은 건너뜀. `route()` → `targetUserIds` → `chat.service` → 알림 payload → `agent-alert.resolveTargets`(least_loaded = 접속·부하 기준 1명 / broadcast = 전원) |
| 서버 측 사용자·라벨 조회 | `agent-alert.service`는 이미 `labelRepo`·`userLabelRepo`로 라벨 보유자를 찾음(`pickLabelAgent`). `ai-engine.module`은 User/Unit/JobLabel 리포지토리 미등록 |
| 사용자 편집 모달 | 직급·직무 라벨·팀·상태 + [취소][저장]. 라벨·팀 관리 모달은 페이지 헤더 버튼에서만 열림(master) |

## 2. TO-BE

### 2-1. 담당자 = 개인 ∪ (팀 × 라벨) 그룹
- `RoutingRule`에 `assigneeUnitIds?: number[]`, `assigneeLabelCodes?: string[]` 추가(`assigneeUserIds`는 유지).
- **그룹 멤버** = 테넌트의 **활성(active)** 사용자 중 (팀 선택이 있으면 그 팀 소속) **AND** (라벨 선택이 있으면 그 라벨 보유). 팀만/라벨만 골라도 됨.
- **최종 담당자** = 개인 지정 ∪ 그룹 멤버. **인계 시점에 계산**(동적) — 팀원이 바뀌면 규칙 수정 없이 반영.
- 규칙 유효 조건: 개인 1명 이상 **또는** 그룹 선택자 1개 이상. 그룹이 그 시점에 0명으로 풀리면 그 규칙은 건너뛰고(warn) 다음 규칙 → 없으면 기본 담당자(현행 폴백).
- 배정 방식(least_loaded/broadcast)은 그대로 최종 담당자 집합에 적용.

### 2-2. 콘솔 담당자 행 재구성
- **보기**: [전체] [팀별] [라벨별] 토글 → 사람 칩을 팀/라벨 헤더 아래로 그룹화(정렬).
- **그룹 배정**: 팀 칩(테넌트 units) + 담당자 라벨 칩(테넌트 job_labels) → 아래 "지금 N명: a@, b@ …" 미리보기(콘솔이 `users` 데이터로 서버와 같은 규칙으로 계산).
- **개인 지정**: 기존 사람 칩.
- 담당자 후보 = `status === 'active'`로 수정(정지·초대 중 제외). 그룹 미리보기에서 상담(consult) 라벨 없는 멤버는 ⚠ 표시(라이브챗 처리 불가).
- 행 우측에 **라벨·팀 관리 →** 링크(`/users?manage=1`, master).

### 2-3. 사용자 편집 모달 바로가기
- 모달 푸터 좌측에 **라벨·팀 관리 →** 링크(master만). 클릭 시 편집 모달 닫고 관리 모달 열기(같은 페이지). `/users?manage=1`로 진입하면 관리 모달 자동 오픈(인계 섹션 링크용).

## 3. 갭 분석

| # | 갭 | 판정 | 필요한 것 |
|---|---|---|---|
| G1 | 규칙 저장 형식 | JSON 필드 추가 | `assigneeUnitIds`·`assigneeLabelCodes`(스키마 변경 없음) |
| G2 | 서버 그룹 해석 | 신규 | `RoutingAssigneeService`(ai-engine): users(active, tenant) + units + user_job_labels 조회 → id 집합. `ai-engine.module` forFeature에 User/Unit/JobLabel/UserJobLabel 추가(모듈 import 없음 → 순환 없음) |
| G3 | 판정 흐름 | 변경 | `matchRoutingRules`(순서대로 전부) + `route()`에서 해석 결과가 0명이면 다음 규칙 |
| G4 | 콘솔 UI | 신규 | 보기 토글·그룹 칩·미리보기·링크 |
| G5 | 담당자 후보 필터 결함 | 수정 | `status === 'active'` |
| G6 | 편집 모달 링크·쿼리 오픈 | 신규 | `UsersPage` `?manage=1` 처리 |
| G7 | i18n | 6언어 | `handoff.routing.assignee.*`, users `manageLink` |

## 4. 결정 필요 사항

| # | 항목 | 제안 | 대안 |
|---|---|---|---|
| D1 | 그룹 해석 시점 | **인계 시점 동적**(팀 변동 자동 반영) | 저장 시 사람 id로 펼침(정적, 현행과 동일 구조·변동 미반영) |
| D2 | 팀×라벨 결합 | 팀 AND 라벨(둘 다 고르면 교집합), 하나만 고르면 그것만 | OR(합집합) |
| D3 | 그룹 멤버 자격 | `status=active`만. 상담 라벨 미보유자는 포함하되 콘솔에서 ⚠ 표시 | consult 라벨 강제(라벨만 고른 "회계 팀 배정" 같은 조합이 불가능해짐) |
| D4 | 그룹 0명 | 규칙 건너뜀 + warn → 다음 규칙/기본 담당자 | 규칙 매칭으로 보고 전원 broadcast(아무도 없음) |
| D5 | 담당자 후보 상태 필터 결함(G5) | 이번에 같이 수정 | 별도 FIX |

## 5. 사용자 흐름
1. go2joy 마스터가 규칙 "북부 예약" → 지역 북부 → 담당자: [팀별] 보기로 North 팀원 확인 → 그룹 배정 팀 **North** + 라벨 **Counsels** → "지금 3명" 미리보기 → 저장.
2. North 팀에 신입이 들어오면(사용자 편집 팀=North) 규칙 수정 없이 다음 인계부터 4명 중 least_loaded.
3. 특정 인물 전담이 필요하면 개인 지정 칩만 고름(현행).
4. 사용자 편집 중 라벨이 없으면 푸터 "라벨·팀 관리 →"로 바로 추가 후 돌아와 체크.

## 6. 제약
- JSON 컬럼만 변경 — SQL 없음. 구버전 API는 새 필드를 무시하므로 그룹만 지정한 규칙은 구버전에서 "담당자 없음=건너뜀" → API 먼저 배포(동일 스크립트면 해당 없음).
- 그룹 해석은 인계당 쿼리 3개(users·units·user_job_labels, 테넌트 범위) — 규칙에 그룹 선택자가 있을 때만 실행.
- 콘솔 미리보기와 서버 해석 규칙은 같은 순수 함수 형태로 두어 어긋나지 않게 함(types 패키지 `resolveAssigneeGroup`).

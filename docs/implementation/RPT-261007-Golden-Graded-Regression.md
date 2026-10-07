# RPT-261007 — FAQ 회귀 테스트 자동 채점 (R7)

- [PLN-261007-Golden-Graded-Regression](../plan/PLN-261007-Golden-Graded-Regression.md)(승인: D1 질문별 독립 채점 · D2 수동 실행)

## 1. 변경 (PR #611 `3a5232a`)
| 영역 | 내용 |
|---|---|
| 스키마 | `golden_questions.expected/forbidden`, `golden_runs.ai_agent_id/pass_count/fail_count`, `golden_run_items.verdict/failed_checks` (`sql/261008-golden-graded.sql`) |
| 채점 | `gradeAnswer` — 기대 사실 포함 여부(대소문자·마크다운 굵게 무시) + 기본 금지어 `▇▇▇`·`[PHONE]`·`[EMAIL]`·`[ADDR]`·`[CARD]`·`[ORDER]`. 기대 사실 없으면 판정 없음(기존 동작) |
| 실행 | 에이전트 지정(`knowledge.ask` aiAgentId), 상한 20→60, **콘솔 실행은 백그라운드**(프록시 타임아웃 회피, 화면 5초 폴링). 코칭 apply-verified는 동기 유지 |
| 일괄 등록 | `POST /ai-coach/golden/questions/bulk` TSV — 같은 문구는 기대 사실·언어만 갱신 |
| 비교 | 회귀(통과→실패) 우선 정렬, `regressed/improved/targetFailedChecks` |
| 화면 | AI 설정 › 회귀 검증: 에이전트 선택·기대 사실 표시/편집·일괄 등록 모달·통과/실패 집계·실행 중 표시, 6개 언어 |
| PLN 대비 | 에이전트는 질문 단위가 아니라 **실행 단위**(와이어프레임의 단일 선택과 동일) |

## 2. 테스트
- 신규 12건, API 220 suites / 2169 tests, web build, i18n:check, 로컬 실부팅
- **스테이징 E2E(ivyusa, dev@)**: 테스트 3문항 일괄 등록 → 실행 요청 **159ms 응답(백그라운드)** → 완료 `pass 2 · fail 1`(일부러 넣은 없는 사실이 `missing: …`로 보고됨). 기존 3문항 활성 상태 복원, 테스트 문항 삭제. 실행 #9("E2E graded")는 이력에 남음

## 3. go2joy 세트 등록 (S5, 스테이징 — 콘솔 계정이 없어 SQL)
- 44문항 + 기대 사실(FAQ 원문의 숫자·링크·메뉴명 등 원문에 그대로 있는 용어만, 질문당 1~4개). FAQ 미작성 G3·H2·I14는 판정 없음
- ⚠️ **처리 중 실수와 정정**: go2joy에는 이미 회귀 질문 20개(10/06 등록, KO 언어, 실행 2회)가 있었는데 확인 없이 44개를 넣어 64개(상한 60 초과)가 됐다.
  → 승인된 일괄 등록 규칙대로 정정했다: 문구가 같은 **15개는 기존 질문에 기대 사실·언어(VI)만 넣고** 중복 삽입분을 삭제 → **총 49개(41개 채점, 활성 49)**
- 문구가 달라 매칭되지 않은 기존 5개(#14·15·20·22·23, KO, D4·D3·G1·I6·I4의 유사 문구)는 손대지 않았다 — 정리 여부는 운영자 판단

## 4. 배포
| 항목 | 상태 |
|---|---|
| 스키마 | 스테이징·프로덕션 **선적용 완료** |
| 스테이징 | ✅ 2026-10-07 23:26 KST |
| 프로덕션 | ✅ 2026-10-07 23:31 KST — `production` ff `12aa2f3..3a5232a`, `check-migrations` OK, 부팅 정상(ERROR 0) |

## 5. 후속
- go2joy 세트 첫 채점 실행(콘솔 › AI 설정 › 회귀 검증 › 에이전트 "Hotel Partner" › 지금 실행) — go2joy 콘솔 로그인 필요
- 기존 KO 5문항 정리(삭제 또는 VI 전환 + 기대 사실)
- 배포 전 자동 실행(D2 후속), 실행 중 API 재시작 시 'running'으로 남는 실행 정리

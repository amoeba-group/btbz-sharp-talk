# RPT-260929 — AI 대화 맥락 기억 (요청 사항·고객 답변 이어가기)

- 요구: [REQ-260929](../analysis/REQ-260929-AI-Conversation-Memory.md) · 계획: [PLN-260929](../plan/PLN-260929-AI-Conversation-Memory.md)(2026-09-29 승인, D1~D4 권장안) · 테스트: [TCR-260929](../test/TCR-260929-AI-Conversation-Memory.md)

## 1. 무엇이 바뀌었나

모든 AI 호출(답변·비질문 답변·의도 분류)이 **현재 발화 한 줄만** 받던 구조를, 같은 대화의 최근 턴을 함께 받도록 바꿨다.
위젯·메신저(릴레이/이메일)·콘솔 미리보기가 모두 `handleUserMessage()`를 지나므로 전 채널·전 테넌트에 적용된다.

| 단계 | 내용 |
|---|---|
| S1 | `conversation-history.util.ts` 신설 — 최근 12메시지/6,000자, 전부 `scrubPii`, system 제외, 상담원 `[Agent]` 접두, 선행 assistant 제거, 동일 역할 병합. 턴당 조회 1회를 분류·답변·재사용 판단이 공유 |
| S2 | `rag.answer(…, history)` — 이력 + 대화 규칙(다시 묻지 말 것 / 짧은 답은 직전 질문의 답 / 가게 사실=CONTEXT, 고객 정보=대화 / PII 토큰 의미) |
| S3 | `answerWithoutKnowledge(…, history)` |
| S4 | `classifyIntent(…, recent)` — 직전 4메시지를 system 참고 블록으로 |
| S5 | 답변 재사용: AI가 이미 말한 대화에선 **조회·후보 저장 모두 안 함**(구현 중 추가 발견: 맥락 의존 답변이 후보로 저장되면 다른 대화의 첫 질문에 재생될 수 있었다) |
| S6 | out_of_scope → `rag.groundingConfidence()`(검색만, LLM 0회) ≥ 0.45면 RAG 경로 |
| S7 | 모더레이션 후 `[PHONE]/[EMAIL]/[ADDR]/[CARD]/[ORDER]` → 세션 언어 표현(6개 언어, 원문 복원 없음) |

## 2. 파일

| 파일 | 변경 |
|---|---|
| `apps/api/src/domain/chat/conversation-history.util.ts` | 신규 |
| `apps/api/src/domain/chat/chat.service.ts` | 이력 조회·전달, S5 재사용 게이트, S6 `overrideOutOfScope`, S7 치환 |
| `apps/api/src/domain/chat/rag.service.ts` | `answer`/`answerWithoutKnowledge`/`classifyIntent` 선택 인자, `groundingConfidence` |
| `…/conversation-history.util.spec.ts` · `…/rag-conversation-memory.spec.ts` · `…/chat.service.memory.spec.ts` | 신규 스펙 33케이스 |
| `docs/analysis/REQ-…` · `docs/plan/PLN-…` · `docs/test/TCR-…` · 본 문서 | 문서 |

## 3. 테스트 결과

- 단위: 신규 33케이스 + API 전체 **200 suites / 2017 tests 통과**, `tsc` 통과, CI 통과
- 스테이징 실측(대화 652 원문 재생 → 대화 654): PLN §4 판정 5종 **전부 통과** — 상세 TCR §2
- 회귀(ivyusa EN, 대화 656): 후속 질문 맥락 유지 ✅. 첫 턴 반품정책 미답변은 기존 현상(변경 전과 동일한 호출) — TCR §3

## 4. 운영 설정 (D2-A)

- 스테이징 tenant 5(skyliving) `tenant_ai_config.handoff_config.denyRules`에 1건 추가(2026-09-29, SQL `JSON_SET`):
  키워드 `예약 진행`·`예약진행`·`예약 확정`·`예약확정`·`진행해 주세요`·`진행해주세요`, `mode=answer_then_handoff`, `type=other`, `label=consult`.
  재실측(대화 655): "예약 진행" → 대화 `waiting`, 상담원 호출 확인.
  ⚠️ 콘솔이 아닌 SQL로 넣었으므로 AI 설정 리비전 이력에는 남지 않는다. 콘솔 "AI 설정 > 인계"에서 확인·수정할 수 있다.
  skyliving에는 이슈 애드온이 없어 이슈 행은 생성되지 않는다(대기열 알림만).
- 프로덕션에는 미적용(테넌트 이관 시 함께 설정).

## 5. 배포 상태

| 항목 | 상태 |
|---|---|
| PR | #570 (squash, `f351986`) |
| 스키마 | 변경 없음 (SQL 0건) |
| 스테이징 | ✅ 2026-09-29 14:23 배포 — 컨테이너 재생성, 부팅 로그 `Nest application successfully started`, `dist/domain/chat/conversation-history.util.js` 존재, `/health` ok |
| 프로덕션 | ⏳ 대기 (`production` 브랜치 머지 후 `scripts/deploy-self-hosted.sh`) |

## 6. 후속 후보

1. 검색어에 직전 AI 발화를 포함 — "예약 진행"처럼 주제어 없는 확정 발화가 `low_confidence`로 떨어지지 않게 한다(TCR §3).
2. ivyusa "return policy"가 `product_inquiry`로 분류되어 상품 그룹으로 검색되는 기존 현상 점검.
3. G7 B/C안 — 확정 요청을 요약과 함께 넘기거나 구조화된 접수 목록을 만든다(별도 REQ).

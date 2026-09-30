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
| S8 (추가, #572) | 검색어 = 고객 2턴 + **AI 직전 1턴** + 현재 (`retrievalQuery`, 스크럽된 이력에서 파생 → 턴당 DB 조회 1회 감소) |
| S9 (추가, #572) | `RagService.rankWithPreference` — 그룹 선호 가산(0.002 ≈ RRF 인접 간격 7배)이 다른 그룹을 전부 밀어내지 않게 편향 없는 상위 3건 보존 |

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
- S8/S9 재실측(#572 배포 후):
  - skyliving 대화 657: "예약 진행" → AI가 예약 요약으로 접수 확인 → deny 규칙 핸드오프(`policy`) → `waiting`·escalated. **목표 흐름 그대로** 동작
  - ivyusa 콘솔 `/knowledge/ask` "What is your return policy?" `group=product`: 변경 전 출처 0건·conf 0.95 "정보 없음" → 변경 후 `Returns & Exchanges` 인용, 정상 답변.
    > ⚠️ **정정(2026-09-30, [FIX-260930](../bug-fix/FIX-260930-Env-Blank-Numbers.md) §5)**: "변경 전" 측정의 conf 0.95는 Voyage 임베딩 실패 → 스텁 폴백 → 개수 기반 신뢰도 경로였다. 그룹 가산만의 효과가 아니었고, 그 사례의 근본 수정은 FIX-260930 D2다. S9는 원리가 유효해 유지한다. "How do I start a return?"도 `2.2.3 How to Request a Return` 인용

## 4. 운영 설정 (D2-A)

- 스테이징 tenant 5(skyliving) `tenant_ai_config.handoff_config.denyRules`에 1건 추가(2026-09-29, SQL `JSON_SET`):
  키워드 `예약 진행`·`예약진행`·`예약 확정`·`예약확정`·`진행해 주세요`·`진행해주세요`, `mode=answer_then_handoff`, `type=other`, `label=consult`.
  재실측(대화 655): "예약 진행" → 대화 `waiting`, 상담원 호출 확인.
  콘솔 "AI 설정 > 인계"에서 확인·수정할 수 있다. (정정 2026-09-30: AI 설정 리비전 이력은 페르소나·응답 규칙·시나리오만 기록하고
  `handoff_config`는 **콘솔 저장 경로에서도 기록되지 않는다**(`ai-config.service.ts` `upsertConfig` → `revisions.record`).
  콘솔 저장이 인계 설정에 대해 추가로 하는 일도 없어서(무효화하는 캐시는 페르소나용이고 인계 설정은 매 턴 DB에서 읽는다) SQL 입력과 동등하다.)
  skyliving에는 이슈 애드온이 없어 이슈 행은 생성되지 않는다(대기열 알림만).
- 프로덕션에는 미적용(테넌트 이관 시 함께 설정).

## 5. 배포 상태

| 항목 | 상태 |
|---|---|
| PR | #570 (squash, `f351986`) |
| 스키마 | 변경 없음 (SQL 0건) |
| 스테이징 | ✅ 2026-09-29 14:23 배포 — 컨테이너 재생성, 부팅 로그 `Nest application successfully started`, `dist/domain/chat/conversation-history.util.js` 존재, `/health` ok |
| PR (추가) | #572 (squash, `6de28cd`) — S8/S9 |
| 스테이징 (추가) | ✅ 2026-09-29 #572 배포 — 컨테이너 재생성, 부팅 로그, dist에 `UNBIASED_RESERVE` 확인 |
| 프로덕션 | ✅ 2026-09-29 15:01 — `production` fast-forward `1d3de70..6de28cd`(#569~#572), `check-migrations.sh` OK(스키마 변경 없음), `deploy-self-hosted.sh` → api/web/widget 재생성, 부팅 로그 `successfully started`, dist에 신규 코드 확인, `https://sharptalk.amoeba.site/api/v1/health` ok. 프로덕션은 테넌트 ivyusa 1개·최근 24h 대화 0건이라 실트래픽 스모크는 없음 |

## 6. 후속 후보

1. ~~검색어에 직전 AI 발화 포함~~ → S8 완료. ~~ivyusa return policy 오검색~~ → S9 완료(분류 자체는 여전히 `product_inquiry`. 정책 라벨 추가는 UI·i18n까지 번져 보류).
2. Voyage 유사도 임계(`RAG_MIN_SIMILARITY` 0.5): "How do I start a return?"처럼 정답 문서를 찾고 답도 맞는데 conf 0.2로 계산돼, 채팅에서는 `low_confidence` 핸드오프가 난다. 임계 재조정 점검 후보.
3. 프로덕션 skyliving 이관 시 D2-A 인계 규칙을 함께 설정한다.
4. G7 B/C안 — 확정 요청을 요약과 함께 넘기거나 구조화된 접수 목록을 만든다(별도 REQ).

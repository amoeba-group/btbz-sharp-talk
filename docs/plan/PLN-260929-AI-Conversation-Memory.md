# PLN-260929 — AI 대화 맥락 기억 (요청 사항·고객 답변 이어가기)

- 근거: [REQ-260929-AI-Conversation-Memory](../analysis/REQ-260929-AI-Conversation-Memory.md)
- 범위: G1~G6 (P0/P1). G7(확정 요청 전달)은 §6 결정 항목.
- **UI 영향 없음** — 백엔드(`apps/api`) 전용. 콘솔·위젯 화면 변경 0, i18n 키 추가 0.
  (G7에서 옵션 B/C를 채택하면 그때 별도 PLN에 와이어프레임을 붙인다.)
- **스키마 변경 없음** — SQL 0건, 엔티티 변경 0건 → `## Migration` 불필요.

---

## 1. 설계 요약

```
handleUserMessage(turn N)
  ├─ history = conversationTurns(conversationId, before=userTurn.id)   ← 신규(1회 조회, 턴 내 재사용)
  │     최근 12메시지/6,000자, user→user · ai/agent→assistant · system 제외
  │     전부 scrubPii · 선행 assistant 제거 · 동일 역할 연속 병합
  ├─ classifyIntent(egressText, history.slice(-4))                      ← G3
  ├─ nonQuestion?  → out_of_scope면 KB 근거 확인(G6) → 근거 있으면 RAG로
  │                → answerWithoutKnowledge(..., history)               ← G2
  ├─ answerReuse   → history에 AI 턴이 있으면 건너뜀                    ← G5
  └─ rag.answer(..., { history })                                        ← G1
        system += MEMORY_RULES (다시 묻지 말 것 · 토큰 의미)            ← G1/G4
        messages = [...history, { user: query }]
  moderation (변경 없음) → persist → 응답 후처리: 남은 PII 토큰 → 현지화 표현  ← G4 안전망
```

---

## 2. 단계별 작업

### S1 — 대화 이력 빌더 (G1~G3 공통 토대)

- 파일: `apps/api/src/domain/chat/conversation-history.util.ts` (신규, 순수 함수) + `chat.service.ts`에 조회 메서드
- `chat.service.ts` `private async conversationTurns(conversationId, beforeId): Promise<AiMessage[]>`
  - `msgRepo.find({ where: { conversationId, id: LessThan(beforeId), senderType: In([USER, AI, AGENT]) }, order: id DESC, take: 12, select: id/senderType/body })`
  - 한 번 조회해서 분류·답변·재사용 판단에 **같은 배열을 재사용**한다(턴당 추가 쿼리 1회).
- `buildHistory(rows, { maxChars: 6000 })` (순수 함수, 단위 테스트 대상)
  - `scrubPii(body).text` — **이력도 AI 제공자로 나가므로 필수**
  - 역할: `user`→`user`, `ai`·`agent`→`assistant`. 상담원 발화는 앞에 `[Agent] `를 붙여 AI 자신의 말과 구분한다
  - 뒤에서부터 글자 예산을 채우고, 예산을 넘는 오래된 턴은 버린다. 1턴이 예산을 넘으면 앞부분을 잘라 넣는다
  - 선두가 `assistant`이면 제거(Anthropic 첫 메시지 `user` 규칙). 동일 역할 연속은 `\n`으로 병합
  - 빈 본문(첨부만 있는 턴)은 제외
  - 끝이 `user`로 끝나면 그대로 둔다 — 호출부가 현재 발화를 `user`로 덧붙이므로 병합 규칙이 처리한다
- 상수: `HISTORY_MESSAGES = 12`, `HISTORY_CHARS = 6000`, `INTENT_HISTORY_MESSAGES = 4`

### S2 — RAG 답변에 이력 전달 (G1, G4)

- `rag.service.ts` `answer()`에 **선택 인자** `history?: AiMessage[]`를 맨 뒤에 추가한다.
  콘솔 호출부(`knowledge.service`·`board-review`)는 넘기지 않으므로 동작이 바뀌지 않는다.
- `messages: [...(history ?? []), { role: 'user', content: query }]` — 연속 user 병합 적용
- system 프롬프트에 규칙 블록을 추가한다(이력이 있을 때만 — 콘솔 단발 질의 프롬프트는 불변):
  ```
  Conversation rules:
  - Earlier messages in this conversation are shown above. Continue from them.
  - Never ask again for information the customer already gave. Confirm what you
    have and ask only for what is still missing.
  - If you asked a question and the customer's message answers it, treat it as
    that answer even when it is short (e.g. "2", "wall-mounted", "go ahead").
  - Tokens like [PHONE], [EMAIL], [ADDR], [CARD], [ORDER] mean the customer DID
    provide that detail; it is hidden from you for privacy. Treat it as received,
    never print the token, refer to it naturally ("the phone number you gave").
  ```
- `Answer ONLY from the context` 규칙과의 관계를 명시한다: **정책·가격·사실은 CONTEXT에서만** 가져오고,
  **고객이 대화에서 준 정보(이름·일시·수량)는 대화에서** 가져온다. 이 문장을 `sourceRule`에 덧붙인다.
  빠뜨리면 모델이 "고객 이름은 CONTEXT에 없다"며 여전히 다시 묻는다.
- `chat.service.ts` 810행 호출부가 S1의 이력을 넘긴다.

### S3 — 비질문 분기에 이력 전달 (G2)

- `answerWithoutKnowledge(tenantId, kind, query, language, aiAgentId, history?)`에 선택 인자를 추가하고, 같은 규칙 블록을 넣는다.
- 효과: 분류가 틀려 이 분기로 떨어져도 모델이 직전 질문을 보고 답한다. "이해 못했어요"가 나오지 않는다.

### S4 — 의도 분류에 직전 맥락 (G3)

- `classifyIntent(tenantId, query, recent?: AiMessage[])` — 최근 4메시지를 **참고 블록으로** system에 넣는다.
  messages 배열에 넣지 않는 이유는 분류 대상이 현재 발화 하나임을 흐리지 않기 위해서다.
  ```
  Recent conversation (context only — classify ONLY the final shopper message):
  ASSISTANT: …  / SHOPPER: …
  If the shopper's message answers a question the assistant just asked, classify
  it by the conversation topic — never unintelligible, smalltalk or out_of_scope.
  ```
- 스텁 어댑터(`stub.adapter.ts`)는 마지막 user 메시지만 보므로 영향 없음(확인 대상).

### S5 — 답변 재사용 조건 축소 (G5)

- `chat.service.ts` 재사용 판단에 조건을 하나 추가한다: **이력에 AI/상담원 턴이 있으면 재사용하지 않는다.**
  대화의 첫 질문(맥락이 필요 없는 자기완결 질문)에서만 재생한다.
- 트레이드오프: 재사용 적중률이 떨어진다. 배포 전후 `answer_reuse` 적중 수를 TCR에 기록한다.
  → 대안은 §6 D3.

### S6 — out_of_scope 판정 시 KB 근거 확인 (G6)

- `nonQuestion === 'out_of_scope'`일 때만 `rag.retrieve()`(임베딩 1회, LLM 0회)로 상위 근거를 확인한다.
  `confidence ≥ ESCALATION_CONFIDENCE`이면 비질문 분기를 버리고 일반 RAG 경로로 진행한다.
- smalltalk·unintelligible은 지금처럼 검색 전에 분기한다. 인사말이 KB를 검색하면 역효과가 난다(PLN-260813 P2).
- 로그 한 줄로 기록한다: `out_of_scope overridden by KB (score …) conversation=…` — 오분류를 추적하기 위해서다.

### S7 — PII 토큰 출력 안전망 (G4)

- 모더레이션 **이후** 저장 직전에, 응답에 남은 `[PHONE]|[EMAIL]|[ADDR]|[CARD]|[ORDER]`를 세션 언어의
  자연어(ko: "말씀하신 연락처", en: "the phone number you provided" …)로 치환하는 순수 함수를 둔다.
  RAG·비질문 두 경로 모두 적용한다.
- 치환 표현은 백엔드 대화 문자열로 `session.language` 6개 언어를 제공한다. 기존 `sysMsg`/`AGENT_OFFER_COPY`와
  같은 방식이며 위젯 i18n은 아니다.
- **원문 PII 복원은 하지 않는다**(최소화 원칙 유지, 구현도 단순하다).

---

## 3. 부작용·영향 분석

| 영역 | 영향 | 대응 |
|---|---|---|
| 토큰 비용 | 턴당 입력 +1.5~3k 토큰(상한 6,000자). 첫 턴은 0 | 상한 상수화. TCR에서 `ai_usage` 전후 평균 비교 |
| 지연 | 입력 증가로 약간 증가, 쿼리 +1 | 인덱스 `messages(conversation_id)` 기존. 측정 후 기록 |
| 프롬프트 주입 | 이전 고객 발화가 모델 입력으로 누적된다 | 고객 턴은 계속 `user` 역할(시스템 권한 없음). 출력 모더레이션 유지 |
| 모순 전파 | 과거 AI 오답(예: 17685 "범위 밖")이 이력에 남아 모델이 따라갈 수 있다 | 규칙: "정책·사실은 CONTEXT 우선". 과거 AI 발화는 사실 근거가 아님을 명시 |
| 핸드오프 후 복귀 | 상담원 대화가 이력에 들어간다 | `[Agent]` 접두로 구분. 대기열(queued) 중에는 AI가 답하지 않으므로 무관 |
| 콘솔 미리보기(/ai-setting) | 같은 `handleUserMessage` 경로 → 미리보기도 맥락을 기억(의도된 개선) | 없음 |
| 메신저 채널(릴레이/이메일) | 같은 경로 → 동일 개선. 이메일은 인용 제거된 본문이 저장돼 있음 | 없음 |
| 콘솔 KB 질의·보드 시뮬레이션 | 선택 인자 미전달 → **불변** | 기존 스펙 통과로 확인 |
| 답변 재사용 | 적중률 하락(S5) | D3 결정 |
| 검색어(FIX-260806 A2) | 불변(고객 발화 2개×200자) | 필요 시 후속 튜닝 |

---

## 4. 테스트 계획 (TCR에서 상세화)

- 단위(`conversation-history.util.spec.ts`): 역할 매핑·system 제외·선행 assistant 제거·연속 병합·
  글자 예산 자르기·PII 치환·빈 본문 제외·`[Agent]` 접두
- 단위(`rag.service.spec.ts`): 이력 있을 때 `messages` 순서·규칙 블록 포함, 없을 때 프롬프트 **불변**(콘솔 회귀 방지)
- 단위(`chat.service.*.spec.ts`): 재사용 건너뜀(이력에 AI 턴), out_of_scope + KB 근거 → RAG 경로, 토큰 안전망
- 픽스처 id는 **문자열 bigint**로 둔다(메모리: bigint-pk-string-test-fixtures)
- **실측(스테이징, 필수)**: 대화 652의 고객 발화 9개를 **원문 그대로** 새 세션에 재생한다(skyliving 위젯).
  바꿔 쓴 문장으로 테스트하면 버그가 통과한다(메모리: denylist-answer-then-handoff).
  판정 기준: ① 17698 이후 이름·연락처·주소·일시를 재요청하지 않는다 ② "1. 김익용"에 "이해 못함"이 나오지 않는다
  ③ "예약 진행"에 5개 항목을 재요청하지 않는다 ④ 응답에 `[PHONE]`이 없다 ⑤ 첫 턴 "에어콘 청소 예약"이 거절되지 않는다
- 회귀: ivyusa(쇼핑몰) 대표 시나리오 3종(주문조회·반품·상품추천) 재생 — 첫 턴 응답 품질 동일

---

## 5. 배포

- SQL 없음. 표준 절차: PR → squash 머지 → 스테이징 배포 → 부팅 로그 `successfully started` 확인 → §4 실측
- 프로덕션(`sharptalk.amoeba.site`)은 스테이징 실측 통과 후 별도 진행
- 롤백: 코드 revert만으로 완결된다(상태 없음)

---

## 6. 결정 필요 항목

**D1. 이력 예산** — 권장: 최근 12메시지 / 6,000자. (크게 하면 긴 상담의 초반 정보까지 기억하지만 비용이 늘어난다.)

**D2. G7 확정 요청 전달** — "예약 진행" 같은 확정을 사람에게 어떻게 넘길지.
- **A. 운영 설정으로 즉시 대응(코드 0)** — skyliving에 deny-list 규칙을 키워드 `예약 진행`·`예약 확정`·`진행해 주세요`로
  `answer_then_handoff` 모드(유형 booking)로 등록한다. 매칭은 부분 문자열(`handoff-router.service.ts` `denyMatch`)이라
  `예약` 단독 키워드는 모든 예약 문의를 넘기므로 쓰지 않는다. AI는 접수 안내를 하고, 대화는 상담원 큐로 가서 알림이 뜬다.
  **권장: 이번 배포와 함께 적용**
- B. AI가 확정을 감지하면 요약(서비스·수량·일시, PII는 원문 대화 참조)과 함께 핸드오프 — 백엔드 추가, 별도 REQ
- C. 구조화된 "요청 접수" 엔티티 + 콘솔 목록 — UI 포함, 별도 REQ/PLN(와이어프레임)

**D3. 답변 재사용 조건** — 권장: 이력에 AI 턴이 있으면 재사용 안 함(S5). 대안: 발화 길이·자기완결성 휴리스틱(오판 위험이 있어 비권장).

**D4. S6(out_of_scope KB 확인) 포함 여부** — 권장: 포함. 임베딩 1회로 비쇼핑 업종 테넌트(skyliving·go2joy)의 본업 거절을 막는다.

> 승인 후 S1→S7 순으로 구현한다. 예상 변경 파일: `chat.service.ts`, `rag.service.ts`,
> `conversation-history.util.ts`(신규), 스펙 3~4개. 승인 전에는 구현하지 않는다.

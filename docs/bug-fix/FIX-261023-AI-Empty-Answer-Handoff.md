# FIX-261023 AI 빈 답변이 "모더레이션 차단" 인계로 바뀜

- 근거: REQ/PLN/TCR-261023-AI-Empty-Answer-Handoff
- 발생: go2joy(tenant 4) 대화 888, 2026-10-23 11:09 KST — HA 호텔 직원 "View today's bookings"

## 1. 증상

고객에게 "I couldn't find a confident answer in our help content…" 인계 안내가 나갔으나, 콘솔 지식조회는 같은 질문에
지식 문서를 인용한 정상 답변을 생성했다.

## 2. 근본 원인

1. `chat_answer` 호출은 성공했지만 `CITED:` 줄을 뗀 보이는 본문이 비었다(일시적; 같은 입력 3회 재실행 모두 정상).
2. `rag.answer`가 빈 본문에 정상 confidence를 붙여 반환 — 빈 답변 검사가 어디에도 없었다.
3. 모더레이션 context 규칙이 빈 본문으로 분류기 호출 → Anthropic 400 `user messages must have non-empty content`
   → stub 폴백 → fail-safe 차단.
4. 인계 사유 `moderation_blocked`, 고객 문구 "지식 없음", 엔진 상태 `unreachable` — 셋 다 사실과 다르게 기록.
   같은 유형: tenant 3 Zalo 그룹 대화 812, 10/13~14 40건.

## 3. 수정

| # | 파일 | 내용 |
|---|---|---|
| F1 | `chat/rag.service.ts` | `answer`·`answerWithoutKnowledge` 빈 본문 1회 재시도, 재시도도 비면 `confidence 0` → 기존 low_confidence 인계 |
| F2 | `moderation/moderation.service.ts` | 빈 본문은 규칙·분류기 없이 `delivered`(로그 1행 유지) — 400·거짓 차단·거짓 엔진 장애 제거 |
| F3 | `ai/adapters/anthropic.adapter.ts` | 빈 응답 시 `stop_reason`·출력 토큰·블록 유형 경고 로그(본문·키 미기록) |

스키마·UI·i18n 변경 없음.

## 4. 예방 패턴

- **"모델 호출 성공 ≠ 답변 있음."** LLM 출력을 후처리(표시 줄 제거·번역)한 뒤에는 빈 결과를 명시적으로 판정한다.
- **fail-safe 앞에는 입력 유효성.** 검사 대상이 없는 입력으로 외부 분류기를 부르면, 우리 요청 오류가 "위반"과
  "엔진 장애"로 둔갑한다. 판정할 것이 없으면 판정하지 않는다.
- 인계 사유 문구가 사실과 다를 때는 사유 기록(`retrieval_trace.reason`)과 엔진 상태를 같이 대조한다.

## 5. 배포

| 환경 | PR / 커밋 | 상태 |
|---|---|---|
| 스테이징 | — | 진행 예정 |
| 프로덕션 | — | 대기 |

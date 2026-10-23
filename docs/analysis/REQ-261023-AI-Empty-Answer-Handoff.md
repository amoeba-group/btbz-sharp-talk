# REQ-261023 AI 빈 답변이 "모더레이션 차단" 인계로 바뀌는 문제

- 작성일: 2026-10-23
- 요청 유형: [요구사항] — 원인 규명 + 개선
- 대상: https://shoptalk.amoeba.site/live-chat?c=888 (go2joy, tenant 4)

## 0. 요구사항 원문

> HA 로그인 호텔직원이 View today's bookings 버튼으로 질문하였으나 처음에는
> "I couldn't find a confident answer in our help content, so I'm forwarding this to our support team…"
> 이렇게 답변을 하였고, 샵톡어드민 지식조회에서는 지식을 참조한 답변을 생성 — 이 차이의 원인을 찾아내고 개선한다

## 1. 사실 관계 (스테이징 DB·엔진 상태로 확인)

| 시각 (KST) | 기록 | 내용 |
|---|---|---|
| 11:09:29 | msg 20777 user | "How to check in a guest" |
| 11:09:38 | msg 20778 ai | 정상 답변 (conf 0.56, Video 21 인용) |
| 11:09:48 | msg 20779 user | "View today's bookings" (intent `other` 0.85, 일반 RAG 경로) |
| 11:09:51.964 | moderation_logs 8047 | `author=ai`, **excerpt = 빈 문자열**, rule 없음, `block / blocked` |
| 11:09:51.979 | msg 20780 system | 인계 안내문, `retrieval_trace.reason = "moderation_blocked"` |
| 11:09:52 | ai_engines id 5 (go2joy) | `last_error_reason=unreachable`, `Anthropic API error 400: messages.0: user messages must have non-empty content` |
| 오늘 집계 | ai_usage_daily | `chat_answer` 실패 0 · `moderation` **stub 1 / failures 1** |

**고객이 본 문구는 "지식이 부족하다"였지만, 실제 인계 사유는 low_confidence가 아니라 `moderation_blocked`이다.**

## 2. 원인 (사슬)

1. **RAG 답변 본문이 비었다.** `chat_answer` 호출은 성공(실패 0)했으나, 모델 출력에서 `CITED:` 표시 줄을
   떼어 낸 뒤 보이는 본문이 빈 문자열이었다(모델이 빈 응답 또는 `CITED:` 줄만 반환). 일시적 현상 —
   같은 입력(이력 2턴·CALLER·이전 대화 887·에이전트 10)으로 스테이징 컨테이너에서 3회 재실행하면
   3회 모두 정상 답변(conf 0.76, 문서 2620·3601 인용)이 나온다. API 컨테이너가 11:14에 재생성되어
   당시 원문 로그는 남아 있지 않고, 어댑터가 `stop_reason`을 기록하지 않아 원문 형태는 확정할 수 없다.
2. **빈 본문을 검사하는 곳이 없다.** `rag.answer`는 빈 `text`에 정상 confidence(≈0.76)를 붙여 그대로 돌려주고,
   `chat.service`는 이를 모더레이션에 넘긴다.
3. **모더레이션이 빈 본문으로 LLM을 부른다.** go2joy에 `context` 규칙(id 21)이 있어 `contextFlagged('')`가
   빈 user 메시지로 Anthropic을 호출 → **400** → 게이트웨이 stub 폴백(`degraded`) → fail-safe **차단**.
4. **결과의 오기록 3중.**
   - 인계 사유 `moderation_blocked` — 정책 위반이 아닌데 차단으로 기록
   - 고객 문구 "지식에서 확신 있는 답을 못 찾음" — 지식은 있었음
   - 엔진 상태 `unreachable` — 엔진은 정상, 우리가 잘못된 요청을 보냄 (콘솔 AI 엔진 화면에 거짓 장애 표시)

## 3. 콘솔 지식조회와 차이가 난 이유

지식조회는 같은 지식·같은 RAG 함수를 쓴다(이력·CALLER·이전 대화만 없음). 재현 결과 위젯 경로도 같은 입력에서
정상 답변을 낸다. 즉 **지식·검색·프롬프트의 차이가 아니라, 한 번 나온 빈 출력을 시스템이 재시도·식별하지 못하고
"차단"으로 바꾼 것**이 차이의 원인이다.

## 4. 같은 유형의 과거 발생

| 테넌트 | 기간 | 건수 | 비고 |
|---|---|---|---|
| 3 | 10/13~10/14 | 40 | zalo 그룹 대화 812, 빈 excerpt 차단 — 플랫폼 엔진에 같은 400 기록(10/14 02:15) |
| 4 | 10/23 | 1 | 본 건 |

## 5. TO-BE

- 빈 답변은 **한 번 재시도**하고, 그래도 비면 "답 없음"(confidence 0 → 기존 low_confidence 인계)으로 처리한다.
- 빈 본문은 모더레이션 LLM에 보내지 않는다 (400·거짓 차단·거짓 엔진 장애 제거).
- 빈 출력이 나오면 `stop_reason`·출력 토큰 수를 로그에 남겨 다음 발생 시 형태를 확정할 수 있게 한다.

## 6. 제약

- 모더레이션 fail-safe(FR-069)는 유지 — 내용이 있는 메시지의 분류 실패는 계속 차단.
- 재시도 비용: 빈 출력일 때만 1회 추가 호출.
- 스키마 변경 없음, UI 변경 없음.

# PLN-261023 AI 빈 답변 재시도·식별 (모더레이션 오차단 제거)

- 작성일: 2026-10-23 · 근거: REQ-261023-AI-Empty-Answer-Handoff
- 상태: 승인 대기
- **UI 영향 없음** (백엔드 전용) · 스키마 변경 없음 · 마이그레이션 없음 · 신규 에러코드 없음

## 0. 승인 필요 결정

| # | 결정 | 제안 |
|---|---|---|
| D1 | 빈 답변 재시도 횟수 | **1회** — 재현상 일시적 현상, 2회 이상은 비용 대비 이득 없음 |
| D2 | 재시도 후에도 비면 | **confidence 0 → 기존 low_confidence 인계** (고객 문구 기존 그대로, 사유가 사실과 일치) |
| D3 | 모더레이션에 빈 본문 | **LLM 호출 없이 통과(delivered, 빈 문자열)** — 빈 문자열은 위반할 내용이 없음. 발송 여부는 호출자가 결정(아래 S1·S3이 막음) |

## 1. 단계별 계획

### S1. RAG — 빈 본문 재시도 (`rag.service.ts` `answer`)
- `splitCitedMarker` 후 `visible.trim()`이 비고 `degraded`가 아니면 같은 요청으로 1회 재호출.
- 재시도도 비면 `{ text: '', confidence: 0, citations: [] }` 반환 + `logger.warn('answer empty after retry …')`.
- `answerWithoutKnowledge`는 이미 `!drafted` → 인계 처리가 있으므로 동일 재시도만 적용(빈 출력 1회 재호출).

### S2. 모더레이션 — 빈 본문 단락 (`moderation.service.ts`)
- `moderate()` 첫머리: `!input.text.trim()` → 규칙·분류기 없이 `DELIVERED / pass`로 finalize(로그 1행 유지).
- 효과: 빈 user 메시지 400 제거 → 엔진 상태 거짓 `unreachable` 제거.

### S3. 채팅 — 빈 답변 방어선 (`chat.service.ts`)
- RAG 결과가 빈 본문이면(재시도 후) 모더레이션 전에 low_confidence 경로로 보낸다(S1이 confidence 0을 주므로
  기존 분기로 자연히 흐르게 순서 확인; 빈 본문이 고객에게 발송되는 경로가 없음을 테스트로 고정).

### S4. 진단 — 어댑터 (`anthropic.adapter.ts`)
- 응답 본문이 비면 `logger.warn('Anthropic empty text: stop_reason=… output_tokens=… blocks=…')` (본문·키 미기록).

### S5. 검증·문서
- 단위 테스트: RAG 빈 출력→재시도 성공 / 재시도도 빈 → conf 0; 모더레이션 빈 본문→LLM 미호출·delivered;
  채팅 빈 답변→`low_confidence` 인계(‘moderation_blocked’ 아님).
- `npm run typecheck`, api 테스트, 실부팅 확인.
- 스테이징 재현 스크립트로 정상 경로 무회귀 확인.
- TCR-261023 → FIX-261023-AI-Empty-Answer-Handoff(예방 패턴) → 스테이징·프로덕션 배포.

## 2. 부작용·영향

| 영역 | 영향 | 대응 |
|---|---|---|
| 정상 답변 | 무변경 (본문 있으면 재시도 없음) | 기존 테스트 유지 |
| 비용 | 빈 출력 시 1회 추가 호출 | 발생 빈도 극히 낮음(스테이징 41건/2주, 대부분 그룹 대화 1건) |
| 모더레이션 FR-069 | 내용 있는 메시지는 기존과 동일(분류 실패=차단) | 빈 문자열만 예외 |
| 인계 통계 | 같은 유형이 `moderation_blocked` 대신 `low_confidence`로 집계 | 사실과 일치하는 방향 |
| 엔진 상태 화면 | 거짓 `unreachable` 사라짐 | — |
| 위젯·콘솔 UI | 없음 | — |

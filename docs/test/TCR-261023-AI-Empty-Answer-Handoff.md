# TCR-261023 AI 빈 답변 재시도·식별

- 근거: REQ/PLN-261023-AI-Empty-Answer-Handoff (승인 2026-10-23, D1 1회 재시도 · D2 low_confidence 인계 · D3 빈 본문 통과)

## 1. 단위 테스트

| # | 파일 | 케이스 | 결과 |
|---|---|---|---|
| U1 | `chat/rag-empty-answer.spec.ts` | `CITED:` 줄만 온 응답 → 1회 재시도, 재시도 본문 전달·confidence 유지 | PASS |
| U2 | 〃 | 재시도도 빈 응답 → `text ''`, `confidence 0`, 인용 없음 | PASS |
| U3 | 〃 | 본문 있는 응답 → 재시도 없음(호출 1회) | PASS |
| U4 | 〃 | `answerWithoutKnowledge` 빈 응답 → 1회 재시도 | PASS |
| U5 | `moderation/moderation.empty.spec.ts` | `''`·공백만 → 분류기 미호출·`delivered`·로그 1행 | PASS |
| U6 | 〃 | 내용 있는 본문 + 분류기 실패 → `blocked` (FR-069 유지) | PASS |
| U7 | `chat/chat.service.queued.spec.ts` | 빈 답변(conf 0) → system 인계, 사유 `low_confidence`, AI 메시지 저장 없음 | PASS |

## 2. 회귀

- `npm run typecheck` 9/9 · api jest **256 suites / 2,573 tests PASS**
- 로컬 실부팅 `Nest application successfully started` (DB_SYNCHRONIZE=false)

## 3. 스테이징 시나리오

| # | 시나리오 | 기대 |
|---|---|---|
| S1 | 대화 888 입력(이력·CALLER·이전 대화) 재실행 | 정상 답변, 재시도 로그 없음 |
| S2 | tenant 4 `moderate('')` | 분류기 미호출, `ai_engines` 5 `last_error_at` 불변 |
| S3 | 배포 후 신규 `moderation_blocked` 빈 excerpt 행 | 0건 |

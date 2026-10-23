# TCR-261023 라이브챗 — 고객·상담원 메시지 각각 번역

- 근거: PLN-261023-LiveChat-Bidirectional-Translation (D1 제외 · D2 노출 · D3 콘솔 전용)

## 1. 단위 테스트 (`apps/api/src/domain/agent/agent.service.pin.spec.ts`)

| # | 케이스 | 기대 | 결과 |
|---|---|---|---|
| U1 | 고객 메시지 번역 | 프롬프트 "customer message"(기존 문구·캐시 호환) | PASS |
| U2 | 상담원·AI 메시지 번역 | 프롬프트 "support reply"+마크다운 보존, `feature=agent_translate`, `msgtr:{id}:{lang}` 24h 캐시 | PASS |
| U3 | system 메시지 번역 | E5003 400, LLM 미호출 | PASS |
| U4 | 기존 회귀(6개 언어 외 거부·테넌트 격리 404·캐시 히트·게이트웨이 실패 E5055) | 불변 | PASS |

`npx jest src/domain/agent` — 17 suites / 132 tests 통과.

## 2. 통합 시나리오 (로컬: API :3099 `DB_SYNCHRONIZE=false` + web :5183, 스텁 AI)

| # | 시나리오 | 기대 | 결과 |
|---|---|---|---|
| I1 | `POST /agent/messages/77/translate` (user) | 200 | PASS |
| I2 | `POST /agent/messages/78/translate` (ai) | 200 | PASS |
| I3 | `POST /agent/messages/68/translate` (system) | 400 E5003 | PASS |
| I4 | 종료 대화 AI 버블 호버 → 번역 아이콘(버블 왼쪽) → 6개 언어 팝오버 → 한국어 | 우측 정렬 서브버블 "한국어 번역" | PASS (화면 확인) |
| I5 | **AI 자동응답 중 대화(conv 2)** | 고객 버블 = 번역만, 지식·답글·이슈 숨김 / AI 버블 = 번역 | PASS (DOM 확인) |
| I6 | 실부팅 | `Nest application successfully started` | PASS |

## 3. 엣지

- 상담원(agent) 버블: 로컬 데이터에 agent 메시지 없음 — AI와 같은 `outbound` 분기 코드라 스테이징에서 육안 확인 예정.
- 번역 결과 문면: 로컬은 스텁 어댑터라 번역 품질은 미검증 — 스테이징 실 LLM으로 확인 예정.
- 대화 전환 시 번역 초기화: 기존 per-thread 리셋 그대로(변경 없음).
- 고객 노출 없음: 번역은 컴포넌트 상태·Redis 캐시만, 메시지 행·위젯 경로 무변경.

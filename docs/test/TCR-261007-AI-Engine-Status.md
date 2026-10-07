# TCR-261007 — AI 엔진 사용 상태 · 플랫폼 엔진 선택 · 크레딧 부족 안내

- 근거: [REQ](../analysis/REQ-261007-AI-Engine-Status.md) · [PLN](../plan/PLN-261007-AI-Engine-Status.md) · 대상 커밋 `7905ef3`(PR #594)

## 1. 단위 (신규 5개 스위트, 32건 — 전부 통과)

| 스펙 | 케이스 |
|---|---|
| `engine-health.spec.ts` | 분류 7종(go2joy 원문 credit, OpenAI insufficient_quota, 401, not configured, 404, 429, URL 파싱 실패) · credit 우선 · 상태 판정(stub/disabled/no_key 우선, unknown, 실패>성공이면 사유, 성공 후 복구, 미지 사유→unreachable) · 오류 요약(Anthropic type/message, OpenAI code, 원문 폴백 200자) |
| `ai-gateway.health.spec.ts` | 실패 → `degraded:true` + 실패 사유 기록 · 성공 60초 스로틀 · 실패 직후 첫 성공 즉시 기록 |
| `rag-degraded.spec.ts` | answer → 텍스트·인용 비움, 신뢰도 0 · 비질문 답변 '' · 분류 fallback |
| `moderation.degraded.spec.ts` | 컨텍스트 분류기·재작성이 스텁이면 BLOCKED |
| `ai-setting.select.spec.ts` | 자기 엔진·허용된 플랫폼 엔진 → 6개 기능 적용 · 타 테넌트(404)·닫힌 플랫폼(400)·스텁(400)·비활성(400)·없는 id(404) 거부 · 기능별 지정도 동일 규칙 |

- API 전체 213 suites / 2117 tests, api·web tsc·build, `i18n:check` 통과
- 로컬 실부팅 `Nest application successfully started`(엔티티 변경 후)

## 2. 통합 — 스테이징 (2026-10-07 09:31 KST 배포 후)

| # | 시나리오 | 결과 |
|---|---|---|
| 1 | SQL 선적용 후 배포, 신규 라우트 | `GET /tenants/me/ai-engines/status`·`POST /ai-engines/2/test` → 401(배포됨), 부팅 로그 정상 |
| 2 | 테넌트 상태 API (ivyusa) | 6개 기능 모두 `Anthropic Claude (platform)`, 배포 직후 `unknown` |
| 3 | 실호출 1회(콘솔 KB 질의) 후 상태 | 엔진 2 `last_ok_at` 기록 → `health=ok`, rag 오늘 1/0 |
| 4 | 닫힌 플랫폼 엔진 일괄 적용 | 400 (D1) |
| 5 | 스텁 일괄 적용 | 400 |
| 6 | endpoint에 이메일로 엔진 생성 | 400 (S8) |
| 7 | go2joy 엔진 5 상태 | 키 없음(D3로 비움) → `no_key`. 이후 go2joy 대화는 스텁 문구 대신 핸드오프(D4) — 배포 후 go2joy 트래픽 0건이라 실대화 미관찰 |

## 3. 미검증 / 사람 확인 필요

- **화면 확인**: 스테이징 콘솔 로그인이 필요해 자동화로 확인하지 못했다(비로컬 호스트 비밀번호 입력 불가).
  `/settings/basic` AI 엔진 카드와 `/admin/ai-engines`(어드민 MFA) 화면 확인을 사람이 해야 한다.
- **실제 크레딧 부족 응답의 화면 표시**: 분류는 원문으로 단위 검증했다. 실계정 재현은 go2joy 키가 없어 불가.
- **어드민 연결 테스트 실호출**: 어드민 로그인(MFA) 필요.

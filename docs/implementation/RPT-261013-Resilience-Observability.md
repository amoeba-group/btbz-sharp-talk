# RPT-261013 — Resilience and observability (stream s5b)

- Basis: [PLN-261012](../plan/PLN-261012-Go2Joy-Stage1-Gap-Closure.md) **SG-83** (observability, ops alerting) and **SG-84** (timeouts, retry, breaker, degradation), REQ-261012 D-19.
- Tests: [TCR-261013-Resilience-Observability](../test/TCR-261013-Resilience-Observability.md). Operator guide: [GUIDE-261013-Observability-Alerting](../guide/GUIDE-261013-Observability-Alerting.md).
- Branch `feature/go2joy-s5b-resilience-observability`, base `test/go2joy-integration` f7266697. **Not pushed, not deployed.**

## 1. Result

| Item | Status |
|---|---|
| SG-84 timeouts on Anthropic, OpenAI, Voyage, Qdrant (+ reuse index) | done, local E2E verified (stand-in provider) |
| SG-84 bounded retry (completion: network/5xx/429 once; embeddings with jitter) | done |
| SG-84 per-engine circuit breaker + Voyage query breaker + Qdrant search breaker, `degraded:true` contract kept, moderation still fails safe | done, local E2E verified |
| SG-84 vector leg down: keyword answer at a capped confidence, hand off when nothing/noise, guest gate unchanged, degradation in the retrieval trace | done, local E2E verified |
| SG-84 distinct localized outage notice (6 languages) + reason `engine_unavailable` + console alarm copy | done |
| SG-84 widget Retry / Talk to an agent after a failed send | done, verified in a real browser |
| SG-83 `/metrics` (Prometheus text, token, bounded labels) | done, verified over real HTTP |
| SG-83 readiness DB + Redis + Qdrant + AI summary | done, verified |
| SG-83 generic ops alerting (webhook/email, dedupe, resolved notices, watchdog, retention + golden gate + backup hook) | done, webhook path verified locally |
| SG-83 error tracking (webhook sink, optional Sentry adapter) | done; **Sentry only against a stand-in** |
| Docs: guide, CONFIG.md, env examples | done |

## 2. What changed

| Area | Files |
|---|---|
| Resilience primitives | `infrastructure/resilience/resilience.ts` (timeout, retry, typed errors), `circuit-breaker.ts` |
| Adapters / gateway | `adapters/{anthropic,openai,voyage}.adapter.ts` (deadline over the body read, `ProviderHttpError`), `ai-adapter.interface.ts` (`timeoutMs`), `ai-gateway.service.ts` (breakers, retry, metrics, `breakerSnapshots()`, test seam `hooks`), `qdrant.service.ts` / `reuse-qdrant.service.ts` (deadline; search breaker, `probe()`) |
| Vector-down rule | `domain/chat/rag-degraded-confidence.util.ts` (new), `rag.service.ts` (`confidence(…, queries?)`, `vectorDegradedReason`, `engineDegraded` / `vectorDegraded` on `RagAnswer`, classifier timeout) |
| Outage copy | `chat.service.ts` (`SYSTEM_MESSAGES.engineUnavailable` x6, `EscalationReason`, 4 branch reasons, trace field, `@ObserveChatTurn`), `moderation.service.ts` (`failsafe` flag), `agent-alert.service.ts` (reason label, handoff/alert metrics), web `EscalationAlarm.tsx` + `livechat.json` x6 |
| Observability | `infrastructure/observability/` — `metrics.registry.ts`, `app-metrics.ts` (catalogue), `http-metrics.middleware.ts`, `metrics-collector.service.ts`, `observability.controller.ts`, `observability.module.ts`, `ops-token.ts`, `readiness.service.ts`, `ops-alert.service.ts`, `ops-watchdog.service.ts`, `error-reporter.ts`; `redis.service.ts` (`ping`), `all-exception.filter.ts`, `retention.service.ts`, `database/golden-gate.ts`, `app.module.ts`, `main.ts` |
| Error codes | `error-code.constant.ts`: E5120 `OPS_TOKEN_INVALID`, E5121 `OPS_ALERT_KIND_INVALID`, E5122 `READINESS_FAILED`, E5123 `OPS_ALERT_NOT_DELIVERED` (**E5124 unused, free**) |
| Widget | `components/chat/send-failure.ts` (pure helpers), `hooks/useChat.ts` (retry, failure bubble, hand-off lookup, error handling), `ChatTab.tsx`, `lib/api-client.ts` (`timeoutMs`), `services/chatService.ts`, `lib/types.ts` |
| Docs / config | `docs/guide/GUIDE-261013-…`, `CONFIG.md` §4.2b, `deploy/profiles/SharpTalk-VN-Go2Joy/.env…example`, `docker/self-hosted/.env.self-hosted.example` |

63 files, about 6.6k lines added (most of it tests and docs).

## 3. Phase 0 findings (where an engine / vector failure surfaces)

Traced `ChatService.handleUserMessage` -> `classifyIntent` -> retrieval -> `rag.answer` -> moderation.

| Place | Before | Now |
|---|---|---|
| `classifyIntent` degraded | silently falls back to `product_inquiry`, `fallback:true`; no deadline beyond the provider's | same fallback; 10 s classifier deadline; breaker skips a dead engine |
| `answerWithoutKnowledge` degraded (small talk / out of scope) | `''` -> `low_confidence` handoff -> "couldn't find a confident answer" | `engine_unavailable` -> outage notice |
| `rag.answer` degraded | confidence 0 -> `low_confidence` -> wrong notice | `engineDegraded` -> `engine_unavailable` -> outage notice |
| moderation fail-safe (engine degraded / any error) | `moderation_blocked` -> same wrong notice | `failsafe` flag -> `engine_unavailable` (block unchanged) |
| Voyage/Qdrant failure | sentinel 0.2 -> **every** turn handed off, even FULLTEXT hits | keyword answer at <= 0.55 when lexically grounded; else hand off; trace records it |
| guest gate / out-of-scope override on vector failure | 0.2 -> sign-in prompt | **unchanged by design** (`VECTOR_DOWN_GROUNDING_CONFIDENCE`) |
| `ai.embed` | swallowed Voyage errors, no deadline (batch-only retry) | deadline, retry with jitter, live-query breaker |
| Global exception filter | logged only non-HTTP errors; a handled 5xx left no trace | logs and reports every 5xx |
| `ai_engines` health columns / credit mail | exist | **extended, not duplicated**: readiness reads them, the breaker sits next to them; the Korean credit mail is untouched |
| `/health/ready` | admin DB ping | unchanged; new token route adds Redis/Qdrant/AI |

## 4. Deviations from the plan / brief

- **Watchdog instead of alert calls at failure sites.** Adapters, gateway and vector clients only bump counters; `OpsWatchdogService` reads them (and breaker state, and a readiness probe) every 30 s. It keeps constructors other streams edit untouched and allows rate rules. Cost: up to one interval of alert latency; a breaker that opens and closes inside one tick is not alerted (the failure-rate rule still sees it).
- **Two tokens**: `METRICS_TOKEN` (read: `/metrics`, readiness) and `OPS_ALERT_TOKEN` (write: alert hook) — a scraper credential should not be able to raise alerts.
- **Readiness is a new route** (`/health/readiness`), not a change to `/health/ready`; Docker healthchecks were not changed (liveness must not depend on Qdrant).
- **Breaker scope**: live paths only. KB document embeddings and Qdrant writes are never short-circuited (skipping them would write stub vectors into the shared collection).
- **Vector-down confidence is gated on lexical evidence**, not only capped: a bare "cap 0.55 whenever documents exist" would re-open FIX-260930 D2.
- Added reason `engine_unavailable` (not in the brief) so alerts, metrics and the console say "outage", not "no knowledge"; touches `EscalationAlarm` + 6 console locale files.
- Widget `/chat/message` gets a 120 s client deadline (there was none); failure bubble survives the poll (it used to be wiped within 5 s).
- Docs in English (REQ/PLN are Vietnamese, older RPT/TCR Korean).
- Env keys also appended to the self-hosted template so `npm run env:check` sees them (it already failed on two other streams' keys; `METRICS_TOKEN`/`OPS_ALERT_TOKEN` show as "not read" because they are read through a variable name).

## 5. Migration / deploy

- **No schema change, no SQL, no entity change.** Nothing to apply before deploying code; nothing for `migrations:manifest`.
- **Deploy state: not deployed anywhere.**
- Order when it ships: set `METRICS_TOKEN` / `OPS_ALERT_TOKEN` / `OPS_ALERT_EMAIL` or `OPS_ALERT_WEBHOOK_URL` in the Go2Joy env, deploy, verify `/api/v1/health` (liveness) and then `/api/v1/health/readiness` with the token, point Prometheus (if any) at the container port. Without any of these variables the behaviour change is limited to provider deadlines, retries, the breaker, the keyword fallback and the outage notice.
- Kill switches: `AI_BREAKER_ENABLED=0`, `RAG_DEGRADED_CONFIDENCE_CAP=0.2`, `OPS_WATCHDOG_INTERVAL_SEC=0`.

## 6. VERIFIED vs NOT VERIFIED

**Verified:** all unit/integration tests (269 new API, 13 new widget; full API run = 3 known baseline failures only), typecheck of api/web/widget, i18n check, 13 mutation proofs, a real boot, a real HTTP smoke of `/metrics`, readiness and the hook (auth contract, content type, exposition), a full local chain (healthy -> hang -> breaker -> outage notice -> recovery -> RESOLVED; Voyage 401 -> keyword answer at 0.55 with the trace), webhook delivery of ops alerts, and a real-browser run of the widget failure bubble (found and fixed one bug).

**Not verified:** real Anthropic/OpenAI success and 5xx behaviour; Prometheus rules; Sentry (adapter only against a stand-in); SMTP delivery of ops alerts; multi-instance Redis cooldown; "Talk to an agent" tapped from a failure bubble in the browser; the console alarm copy visually; the `golden:gate` CLI ops-alert call (typechecked, not run); the DB-pool gauge on a live pool (its first shape guess was wrong in the live boot, corrected from the mysql2 source and unit-tested, not re-checked live); behaviour under real load.

## 7. Open follow-ups and cross-stream risks

- Other outbound clients still have no deadline (messenger adapters, Cafe24, Haravan, Shopify admin, the Slack escalation webhook). Worth one sweep with `runWithTimeout`.
- `AiCreditAlertService` still mails in Korean to `AI_ALERT_EMAIL ?? dev@amoeba.group` and `golden-gate.ts` mails `AI_ALERT_EMAIL ?? dev@amoeba.group` — SG-81 should remove those defaults; the new ops channel has none.
- Widget Retry after a server-side-persisted failure can duplicate the question in the transcript (no idempotency key on `/chat/message`).
- The stub embedder fallback for KB **document** embeddings can still write stub vectors into the Voyage collection when Voyage fails (pre-existing); a stricter policy (fail the write) is a product decision.
- **Merge hot spots** (small hunks, all appended): `chat.service.ts` (import, `SYSTEM_MESSAGES`, `EscalationReason`, `@ObserveChatTurn`, four handoff reasons, trace field, `markTurnOutcome`), `rag.service.ts` (`confidence`, `answer`, `classifyIntent`), `agent-alert.service.ts`, `retention.service.ts` (trailing optional constructor param — s5a may also append one), `app.module.ts`, `main.ts` (prefix exclude + filter ctor), `error-code.constant.ts` (end of object), `CONFIG.md`, both env examples, web `livechat.json` x6, widget `useChat.ts` / `ChatTab.tsx` / `types.ts`.
- **s2a (gate refactor)**: use `VECTOR_DOWN_GROUNDING_CONFIDENCE` in `rag-degraded-confidence.util.ts` as the single definition of "vector down" for the gate; `groundingConfidence()` must keep calling `confidence()` without queries.
- `main.ts` now passes the reporter to `AllExceptionFilter`; any stream that constructs the filter elsewhere keeps working (parameter optional).

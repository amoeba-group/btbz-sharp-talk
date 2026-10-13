# TCR-261013 — Resilience and observability (stream s5b)

- Basis: [PLN-261012](../plan/PLN-261012-Go2Joy-Stage1-Gap-Closure.md) SG-83 / SG-84, REQ-261012 D-19. Guide: [GUIDE-261013-Observability-Alerting](../guide/GUIDE-261013-Observability-Alerting.md).
- Branch `feature/go2joy-s5b-resilience-observability`; nothing pushed or deployed.

## 1. Unit and integration cases

Each row names the spec file under `apps/api/src` (or `apps/widget/test`). "Proof" = the production code was temporarily broken, the spec run,
and the listed number of tests failed (then restored) — see section 3.

| ID | Spec | Case | Result | Proof |
|---|---|---|---|---|
| R1 | `infrastructure/resilience/resilience.spec` | `runWithTimeout` aborts a stalled operation at the deadline and raises `AiTimeoutError` (not a generic abort); clears its timer on success | pass | 4 fail |
| R2 | same | transient classification: network blip, 5xx, 429 retry; timeout, 4xx, out-of-credit 429 and a Voyage batch 429 already retried do not | pass | |
| R3 | same | `retryWithJitter`: bounded, full-jitter windows capped, `retryOn` respected, 0 jitter allowed | pass | |
| R4 | same | `failureReason` is a bounded vocabulary; deadline env defaults/floors | pass | |
| B1 | `infrastructure/resilience/circuit-breaker.spec` | closed -> open after N **consecutive** failures; success resets the streak | pass | 12 fail |
| B2 | same | open window elapsed -> half-open, exactly ONE probe; success closes; failure re-opens a FULL new window; a lost probe cannot wedge it; a straggler does not extend the window | pass | |
| B3 | same | `isEngineFailure`: timeout/network/5xx/429/auth/credit/missing key count; a plain 400/404/422 does not | pass | |
| G1 | `external/ai/ai-gateway.resilience.spec` | REAL `AnthropicAdapter` + a fetch that never answers: aborted at the deadline, call surfaces `degraded: true`, metric `status=timeout` | pass | 4 fail |
| G2 | same | a timeout is not retried; a 5xx is retried once and returns the real answer; retry is bounded; a 400 is not retried | pass | |
| G3 | same | breaker opens after N failures: next call makes no network call, still returns stub text with `degraded: true`, is metered as a failure of the intended engine, does not rewrite engine health | pass | 12 fail |
| G4 | same | half-open probe closes it; failed probe re-opens it; 400s never open it; `AI_BREAKER_ENABLED=0` disables it; per-engine isolation | pass | |
| G5 | same | **moderation stays fail-safe**: a context rule + open breaker -> `BLOCKED` (the stub's "not flagged" does not stand in) | pass | |
| G6 | same | embeddings: Voyage timeout -> stub; transient query failure retried once; live-query breaker skips a dead Voyage; **document embeddings are never short-circuited**; document batch retries a timeout | pass | |
| G7 | same | `VoyageAdapter`: stalled request aborted at the per-request deadline; typed HTTP error keeps the old message | pass | |
| Q1 | `external/vector/qdrant.service.resilience.spec` | hung search aborted at the deadline; breaker stops searching after N failures but KB writes still go through; `probe()` bypasses the breaker; bounded operation labels | pass | |
| V1 | `chat/rag-degraded-confidence.util.spec` | distinctive terms (en, vi syllables, ko bigrams, bounded); coverage; **keyword noise (FIX-260930 D2) is withheld**, a document containing the question's words earns the capped 0.55, no documents = 0.2, no query = strict sentinel, per-line coverage for follow-ups, env knobs | pass | 6 fail |
| V2 | `chat/rag-vector-down.spec` | `answer()` with the vector leg down (`qdrant_error` / `embedding_fallback`): delivered at <= 0.55 with the reason in the result and a metric; nothing found -> 0.2; noise -> 0.2; healthy turn untouched; Qdrant switched off by config is not "degraded"; engine outage -> `engineDegraded`; order floor kept; cap 0.2 restores the old behaviour | pass | |
| V3 | same | **guest gate unchanged**: `groundingConfidence` (guest scope and plain) stays 0.2 even when `answer()` trusts the same chunk | pass | 1 fail |
| O1 | `chat/chat.service.engine-outage.spec` | engine degraded -> outage notice + still a handoff, reason `engine_unavailable`, trace carries the reason; knowledge missing -> ordinary notice, `low_confidence` (unchanged); moderation fail-safe -> outage; a real moderation block keeps its reason; small-talk the engine could not write -> outage | pass | 1 fail |
| O2 | same | delivered keyword-only answer records `vectorProvider: degraded` + reason in the retrieval trace; healthy answer has none; turn outcome metric (`handoff`, `answered`, `refused`) | pass | |
| O3 | same | six languages have a distinct outage copy different from the missing-knowledge copy; EN/VI wording | pass | |
| M1 | `moderation/moderation.failsafe.spec` | fail-safe block carries `failsafe: engine_degraded` / `error`; a fired rule does not; healthy pass counted | pass | 1 fail |
| X1 | `observability/metrics.registry.spec` | valid text exposition: HELP/TYPE, labels, cumulative histogram buckets + `+Inf`/`_sum`/`_count`, escaping, bad names rejected, no empty blocks, label value cap, **series cap** with drop counter, collectors survive a throwing one | pass | |
| X2 | `observability/observability.controller.spec` (real HTTP) | `/metrics`: token unset -> 404; wrong/missing -> 401 `E5120`; token in query string refused; 200 with `text/plain; version=0.0.4`, `Cache-Control: no-store`, every sample line well-formed, no tenant/session/email text; `/api/v1/ops/metrics` reachable, `/api/v1/metrics` is 404 | pass | 5 fail |
| X3 | same | readiness: 404/401 like metrics; 200 with per-dependency report; 503 + `E5122` with the full report when a required dependency is down | pass | |
| X4 | same | ops-alert hook: 404 when unset, the READ token cannot raise alerts, fixed titles per kind, dedupe still 2xx, no channel -> 503 `E5123`, validation 400, custom key | pass | |
| X5 | same | `HttpMetricsMiddleware` over HTTP: counts by route group and status class; unmatched path / ids / query string never appear | pass | |
| X6 | `observability/metrics-collector.service.spec` | worst breaker state per component; open-conversation gauge (one grouped query, 30 s cache); DB pool defensive (real TypeORM shape); process gauges; collectors registered/removed with the module; `routeGroupOf`; turn-outcome derivation; `safeLabel` | pass | |
| D1 | `observability/readiness.service.spec` | each dependency reported separately with latency; DB down -> `down`; Redis/Qdrant down -> `degraded`; `READINESS_REQUIRED`; Qdrant not configured -> `skipped`; open Qdrant breaker -> degraded; AI summary from health columns + breakers, no keys/endpoints/tenant ids; **per-dependency deadline** (a hung Redis reported down at 200 ms while DB still reported); gauge | pass | 1 fail |
| A1 | `observability/ops-alert.service.spec` | **no built-in recipient** (unconfigured, nothing sent); mail to every address in English, no Korean/Amoeba text; webhook JSON with `text`/`content`; one channel failing does not lose the alert; never throws; webhook URL not logged | pass | |
| A2 | same | **dedupe / cooldown** with injected time: once, suppressed inside 30 min, again after, different key independent, env cooldown, 0 = off, Redis-shared claim, in-process fallback; RESOLVED notice once + re-arm; detail redacted/capped | pass | 4 fail |
| A3 | `observability/ops-watchdog.service.spec` | breaker open/half-open/Qdrant breaker -> critical alert, closing -> resolved; **LLM failure rate** over the window with minimum calls, breaker-skipped calls excluded, resolve, window forgets, configurable; vector failures (skipped excluded); dependencies need consecutive failures, resolve, severities, `OPS_WATCHDOG_SKIP`; a failing probe cannot crash a tick; ticks do not stack; interval 0 / CLI = no timer | pass | |
| A4 | `privacy/retention.service.opsalert.spec` | a failed scheduled purge raises a critical ops alert; success does not; a manual purge failure still throws; works without the alert service | pass | |
| A5 | `agent/agent-alert.service.metrics.spec` | handoffs counted by reason once per NEW escalation (replay not counted); Slack/email deliveries by result; unconfigured mailer is not a failure; alert text names an engine outage | pass | |
| E1 | `observability/error-reporter.spec` | scrub: emails, phones, keys, JWTs, URL queries, `password=`/`token:` pairs; stack truncated and scrubbed; path normalised without query; fingerprints stable | pass | 5 fail |
| E2 | same | **rate limit**: same fingerprint once per window with the swallowed count carried, global per-minute cap, bucket refills; inert with no sink; a throwing sink is counted not propagated; `uncaughtExceptionMonitor` (not `uncaughtException`); webhook sink posts the scrubbed event | pass | 1 fail |
| E3 | same | Sentry adapter against a **stand-in** (not the real SDK): inert when not installed; activates only with DSN + package; `beforeSend` scrubs and strips request data/user; fingerprint + path-only context forwarded | pass | |
| E4 | same | exception filter hook: reports unhandled 500 and **handled 5xx**, not 4xx; a throwing reporter cannot change the response; works with no reporter | pass | |
| W1 | `apps/widget/test/send-failure.test.mjs` | failure classification; Retry + Talk-to-an-agent chips for network/server, agent only for a refusal or nothing to resend; **failure bubble survives a reconcile when the send never reached the server** (the case found in the browser run), dropped when a NEWER reply exists; retry replaces the bubble; send deadline generous | pass | 1 fail |

## 2. Totals

| Suite | Result |
|---|---|
| New API specs (17 suites) | **269 passed** |
| Full `npx jest` in `apps/api` | 2,747 passed, **3 failed = the known Windows baseline** (`heic-conversion`, `embed-loader`, `board-attachment`); 261 suites |
| `tsc -p tsconfig.check.json` (api, web, widget) | clean |
| Widget `node --test test/*.test.mjs` | 74 passed (13 new) |
| `npm run i18n:check` | complete for es/ko/vi/ja/zh |
| Real boot against scratch DB `scratch_s5b` (port 3025) | `Nest application successfully started`; scratch DB dropped afterwards |

## 3. Proof that the tests fail without the fix

Mutation harness: for each behaviour, one expression in production code was replaced, the spec run, the code restored.

| Behaviour broken | Failed tests |
|---|---|
| deadline timer no longer aborts | 4 |
| breaker never opens | 12 |
| vector-down never answers from keywords | 6 |
| coverage gate removed (noise answered) | 6 |
| `groundingConfidence` loosened by an outage (guest gate) | 1 |
| outage reason replaced by `low_confidence` | 1 |
| moderation fail-safe cause lost | 1 |
| `/metrics` token check removed | 5 |
| alert cooldown removed | 4 |
| error-reporter PII scrub removed | 5 |
| error-reporter rate limit removed | 1 |
| readiness deadline removed | 1 |
| widget keep-failure-bubble disabled | 1 |

## 4. Local end-to-end (real API, real MySQL/Redis/Qdrant, stand-in LLM provider)

A throwaway stand-in for the Anthropic Messages API (ok / hang / 529 modes) was pointed at by the seeded engine of the scratch tenant.

| Step | Observation |
|---|---|
| A. healthy | answered, `confidence 0.95`; metrics: `llm_calls ok`, `moderation delivered`, breaker 0 |
| B. provider hangs (1.5 s deadline, breaker threshold 3) | first turn 5 s (three timeouts), **outage notice** + handoff; next three turns ~300 ms each, same notice; `breaker_open` x3 per feature, `moderation_failsafe_blocks{engine_degraded}` 4, `handoffs{engine_unavailable}` 4, breaker gauge 2, readiness `degraded` with `breaker: open`, **webhook received the CRITICAL ops alert**, repeats suppressed (14) |
| C. provider recovers | after the window one probe: `open -> half_open -> closed`, question answered, **RESOLVED notice sent** |
| D. Voyage unreachable (real 401), engine healthy | keyword answer at **0.55**, trace `vectorProvider: degraded, vectorDegraded: embedding_fallback` in `messages.retrieval_trace`; an ungroundable question -> the ordinary "no confident answer" handoff (not the outage notice); embedding breaker opened after 3 failures |
| E. ops hook | `POST /api/v1/internal/ops-alert` with the right token -> webhook delivered, repeat deduped; read token -> 401 `E5120` |
| F. widget in a real browser (Vite dev + the API) | API stopped, message sent -> "Sorry, that didn't go through" with **Retry** and **Talk to an agent**; API restarted -> the bubble **survived the next poll**; Retry -> answered. (Found and fixed the bubble-dropped-on-poll bug in this run.) |

## 5. Not verified

- "Talk to an agent" tapped from a failure bubble in the browser (logic covered by code and unit tests only); the console `EscalationAlarm` copy for `engine_unavailable` was type-checked and i18n-checked, not viewed.
- Prometheus rules (guide) never loaded into a Prometheus; the Sentry adapter never run against the real SDK or a real Sentry; SMTP delivery of ops alerts (webhook delivery was verified locally, email path only against a double).
- The `golden:gate` CLI ops-alert call (typechecked only) and the `db_pool_connections` gauge on a live pool (corrected after the live boot showed no series; unit-tested against the mysql2 pool shape, not re-checked live).
- Behaviour with several API instances sharing Redis (cooldown claim covered by a double only).
- Real Anthropic/OpenAI/Voyage success and 5xx behaviour: only a stand-in provider and the real Voyage 401 were exercised.

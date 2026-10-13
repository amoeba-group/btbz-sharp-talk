# GUIDE-261013 — Observability, alerting and graceful degradation

- Scope: PLN-261012 **SG-83** (metrics, readiness, ops alerts, error tracking) and **SG-84** (timeouts,
  retry, circuit breaker, keyword fallback, outage notice). Audience: whoever runs the API for a tenant
  (for Go2Joy: CS/SA and the host operator).
- Everything here is **off or inert by default**. With none of the variables below set the API behaves as
  it did before, except that provider calls now have deadlines and a dead engine is skipped instead of
  waited on.
- Variable reference: [CONFIG.md §4.2b](../../CONFIG.md). Code map at the end.

## 1. The operations surface

| Endpoint | Auth | Purpose |
|---|---|---|
| `GET /metrics` (also `GET /api/v1/ops/metrics`) | `Authorization: Bearer $METRICS_TOKEN` | Prometheus text exposition 0.0.4 |
| `GET /api/v1/health/readiness` | `Authorization: Bearer $METRICS_TOKEN` | DB + Redis + Qdrant + AI-engine summary, per-dependency status |
| `POST /api/v1/internal/ops-alert` | `Authorization: Bearer $OPS_ALERT_TOKEN` | script hook for failures the API cannot see (backup, restore, deploy) |
| `GET /api/v1/health` | none | **unchanged** liveness (compose/nginx healthchecks keep using it) |
| `GET /api/v1/health/ready` | admin JWT | **unchanged** admin DB probe |

Auth contract (same for all three token endpoints):

- token variable **unset or blank -> 404**, as if the route did not exist;
- missing or wrong bearer -> **401** with error code `E5120` (and a server-side warning — never the value);
- the token is **never accepted in the query string** (it would land in access logs);
- the read token (`METRICS_TOKEN`) cannot raise alerts; the write token (`OPS_ALERT_TOKEN`) is separate.

`/metrics` is served at the root (Prometheus convention) and is **not** part of the public API. Scrape the
API container's port directly on the internal network; do not publish it through the edge nginx. Where a
proxy only forwards `/api/`, use `/api/v1/ops/metrics`. Use tokens of at least 16 random characters
(`openssl rand -hex 24`); shorter ones log a boot warning.

```bash
# scrape by hand
curl -s -H "Authorization: Bearer $METRICS_TOKEN" http://api:3000/metrics | head
# readiness (HTTP 503 + E5122 when a REQUIRED dependency is down; the body always has the full report)
curl -s -H "Authorization: Bearer $METRICS_TOKEN" http://api:3000/api/v1/health/readiness
```

## 2. Metrics

All names are prefixed `sharptalk_`. **No tenant id, user id, session id, URL or free text is ever a label**;
every label value is chosen by code from a small set, capped at 300 series per metric (a refusal is counted in
`sharptalk_metrics_series_dropped_total`).

| Metric | Type | Labels | Meaning |
|---|---|---|---|
| `http_requests_total` | counter | `route_group`, `method`, `status_class` | requests by first path segment of the matched route (`chat`, `agent`…); unmatched paths are `unmatched` |
| `http_request_duration_seconds` | histogram | `route_group` | latency (buckets 10 ms … 60 s) |
| `chat_turns_total` | counter | `outcome` | `answered`, `handoff`, `refused` (polite out-of-scope reply), `needs_auth`, `draft`, `silent` (a person owns the thread), `notice`, `error` |
| `handoffs_total` | counter | `reason` | `low_confidence`, `moderation_blocked`, `user_request`, `policy`, `engine_unavailable` — counted once per NEW escalation |
| `llm_calls_total` | counter | `feature`, `provider`, `status` | `ok`, `error`, `timeout`, `breaker_open` (skipped, no network call) |
| `llm_call_duration_seconds` | histogram | `provider` | per call, including its retry |
| `llm_retries_total` | counter | `provider` | completions/embeddings retried after a transient failure |
| `embedding_failures_total` | counter | `provider`, `reason` | `timeout`, `network`, `rate_limit`, `server_error`, `auth`, `credit`, `rejected`, `breaker_open` |
| `qdrant_failures_total` | counter | `operation` | `search`, `search_skipped`, `upsert`, `delete`, `set_active`, `ensure`, `probe` |
| `vector_degraded_turns_total` | counter | `reason`, `result` | turns answered while the vector leg was down: `embedding_fallback` / `qdrant_error`; `fulltext_answer` (answered from keywords) or `withheld` (handed off) |
| `moderation_decisions_total` | counter | `scope`, `decision` | `delivered`, `edited`, `blocked` |
| `moderation_failsafe_blocks_total` | counter | `cause` | blocked because the moderation path failed (`engine_degraded`, `error`) — FR-069 fail-safe |
| `alert_sends_total` | counter | `channel`, `result` | escalation alerts: `slack`/`email` x `ok`/`failed`/`unconfigured` |
| `ops_alerts_total` | counter | `kind`, `result` | operational alerts: `sent`, `suppressed`, `failed`, `unconfigured` |
| `circuit_breaker_state` | gauge | `component` | worst state per component: 0 closed, 1 half-open, **2 open** (`anthropic`, `openai`, `embedding`, `qdrant`) |
| `circuit_breaker_transitions_total` | counter | `component`, `to` | state changes |
| `error_reports_total` | counter | `sink`, `result` | `sent`, `failed`, `deduped`, `rate_limited` |
| `conversations_open` | gauge | `status` | `waiting` = queued for a person, `agent`, `ai_active` (cached 30 s) |
| `db_pool_connections` | gauge | `state` | `total`, `in_use` (when the driver exposes it) |
| `dependency_up` | gauge | `dependency` | last readiness probe: `db`, `redis`, `qdrant` (1 up or not configured, 0 down) |
| `process_uptime_seconds`, `process_resident_memory_bytes`, `process_heap_used_bytes` | gauge | — | process health |

### Example Prometheus config and rules

```yaml
scrape_configs:
  - job_name: sharptalk-api
    metrics_path: /metrics
    authorization: { type: Bearer, credentials_file: /etc/prometheus/sharptalk-metrics-token }
    static_configs: [{ targets: ['api:3000'] }]

groups:
  - name: sharptalk
    rules:
      - alert: SharpTalkEngineBreakerOpen
        expr: max by (component) (sharptalk_circuit_breaker_state) == 2
        for: 1m
        labels: { severity: critical }
        annotations: { summary: "AI circuit breaker open for {{ $labels.component }} — customers get stub fallbacks / hand-offs" }

      - alert: SharpTalkLlmFailureRate
        expr: |
          sum by (provider) (rate(sharptalk_llm_calls_total{status=~"error|timeout"}[5m]))
            / sum by (provider) (rate(sharptalk_llm_calls_total{status=~"ok|error|timeout"}[5m])) > 0.5
          and sum by (provider) (increase(sharptalk_llm_calls_total{status=~"ok|error|timeout"}[5m])) >= 10
        for: 2m
        labels: { severity: critical }

      - alert: SharpTalkVectorBackendDown
        expr: |
          sum(increase(sharptalk_qdrant_failures_total{operation!="search_skipped"}[5m]))
            + sum(increase(sharptalk_embedding_failures_total{reason!="breaker_open"}[5m])) >= 5
        for: 2m
        labels: { severity: warning }

      - alert: SharpTalkHandoffQueueGrowing
        expr: sharptalk_conversations_open{status="waiting"} > 10
        for: 10m
        labels: { severity: warning }
        annotations: { summary: "More than 10 conversations queued for a person for 10 minutes" }

      - alert: SharpTalkEngineOutageHandoffs
        expr: increase(sharptalk_handoffs_total{reason="engine_unavailable"}[10m]) > 3
        labels: { severity: critical }

      - alert: SharpTalkServerErrors
        expr: sum(rate(sharptalk_http_requests_total{status_class="5xx"}[5m])) > 0.1
        for: 5m
        labels: { severity: warning }

      - alert: SharpTalkDependencyDown
        expr: sharptalk_dependency_up == 0
        for: 2m
        labels: { severity: critical }
```

These Prometheus rules are examples written against the metric catalogue above; they have not been loaded into a
real Prometheus (none was available when this was built). The built-in watchdog (section 4) covers the same
ground without Prometheus.

## 3. Graceful degradation (SG-84)

### What happens when something fails

| Failure | Customer sees | Handoff? | Recorded as |
|---|---|---|---|
| LLM engine down / breaker open | **"Our assistant is temporarily unavailable … a person will help you right here"** (6 languages) | yes | reason `engine_unavailable`, `handoffs_total{reason="engine_unavailable"}` |
| Moderation path failed (engine degraded, DB…) | same outage notice (the message is blocked — fail-safe, FR-069) | yes | `engine_unavailable`, `moderation_failsafe_blocks_total` |
| Knowledge genuinely missing | "I couldn't find a confident answer in our help content" (unchanged) | yes | `low_confidence` |
| A moderation rule fires | unchanged notice | yes | `moderation_blocked` |
| Vector leg down (Voyage/Qdrant), keywords found the answer | **a normal answer** (confidence capped at 0.55, never replayed from the reuse cache) | no | trace `vectorProvider: "degraded"` + `vectorDegraded` reason |
| Vector leg down, nothing / only noise found | "no confident answer" notice | yes | `low_confidence`, `vector_degraded_turns_total{result="withheld"}` |
| Widget cannot reach the API | "Sorry, that didn't go through" with **Retry** and **Talk to an agent** chips | — | — |

### Timeouts, retry, breaker

- Every provider call has a deadline covering the body read: `AI_REQUEST_TIMEOUT_MS` (25 s), the intent classifier
  `AI_CLASSIFY_TIMEOUT_MS` (10 s), `EMBED_REQUEST_TIMEOUT_MS` (8 s), `QDRANT_REQUEST_TIMEOUT_MS` (5 s).
  A chat turn makes up to three model calls (classify, answer, moderate), so the worst case is bounded by their sum.
- A completion is retried **once**, only on a dropped connection, 5xx or 429 (never on a timeout, a 4xx, or an
  out-of-credit 429). Embeddings retry with full jitter (query 1x, document batches 2x, also on timeout).
- **Breaker per engine** (and one for Voyage embeddings, one for Qdrant search): after `AI_BREAKER_FAILURE_THRESHOLD` (5)
  consecutive *engine-level* failures (timeout, network, 5xx, 429, auth, credit) the engine is skipped for
  `AI_BREAKER_OPEN_SEC` (30 s); then exactly one probe call decides (success closes, failure re-opens). A plain 400
  (one malformed prompt) never counts. Skipped calls return the same `degraded: true` stub result as before, so
  moderation still blocks and RAG still withholds the text. KB document embeddings (writes) are never short-circuited.
- Local proof: with a hung provider the first turn took about 5 s (three 1.5 s timeouts, which opened the breaker); the next
  turns answered the outage notice in about 300 ms; after the window one probe closed the breaker.

### Vector leg down: the confidence rule

`RagService.confidence` used to return 0.2 whenever Voyage was configured and the vector leg did not run (FIX-260930
D2: it had scored six unrelated products at 0.95). That handed off **every** turn, including those keywords answered. Now:

1. no documents -> 0.2 (hand off);
2. documents exist -> the best share of the question's distinctive words found in any one document's title/category/body
   (stopwords dropped; CJK split into bigrams; for a follow-up each line of the context-enriched query is weighed alone);
3. coverage below `RAG_DEGRADED_MIN_COVERAGE` (0.6) -> 0.2 (hand off: the keyword noise case);
4. else confidence = `RAG_DEGRADED_CONFIDENCE_CAP` (0.55): above the 0.45 handoff bar, below the 0.75 reuse bar.

`groundingConfidence()` (the **guest gate** and the out-of-scope override) is deliberately **not** loosened: with the
vector leg down a signed-out visitor is asked to sign in rather than answered from keyword guesses. The constant
`VECTOR_DOWN_GROUNDING_CONFIDENCE` is the single place that behaviour is defined (for the wave-2 gate refactor).
Switch the whole feature off with `RAG_DEGRADED_CONFIDENCE_CAP=0.2`.

## 4. Ops alerts (SG-83)

Targets: `OPS_ALERT_EMAIL` (comma-separated; needs `SMTP_HOST`) and/or `OPS_ALERT_WEBHOOK_URL`. **No built-in recipient.**
With neither set, alerts are logged and counted only (`ops_alerts_total{result="unconfigured"}`) and one boot-time
warning says so. English text, no customer data, secrets and PII scrubbed, detail capped at 800 characters.
The webhook body is JSON with `text` and `content` (readable line, Slack/Teams/Discord incoming webhooks work as is)
plus `key`, `kind`, `severity`, `title`, `detail`, `timestamp`.

Dedupe: one alert per **key** per `OPS_ALERT_COOLDOWN_SEC` (30 min; shared through Redis when available), and a single
`RESOLVED` notice when the condition clears (which also re-arms the key).

The watchdog (`OPS_WATCHDOG_INTERVAL_SEC`, 30 s) evaluates these rules from the counters above:

| Key | Fires when | Severity |
|---|---|---|
| `breaker:<engine>` | a circuit breaker is open or probing | critical |
| `llm_failure_rate:<provider>` | failed/total >= `OPS_LLM_FAILURE_RATE` (0.5) over `OPS_LLM_WINDOW_SEC` (300 s) with >= `OPS_LLM_MIN_CALLS` (10) calls; breaker-skipped calls are not counted | critical |
| `vector_backend` | >= `OPS_VECTOR_FAILURES` (5) Qdrant/embedding failures in the window | warning |
| `dependency:db` / `redis` / `qdrant` | `OPS_DEP_FAILURES` (2) consecutive failed probes (db critical, others warning); `OPS_WATCHDOG_SKIP` excludes one | critical / warning |
| `retention_purge_failed` | the scheduled retention purge throws | critical |
| `golden_gate_failed` | the post-deploy `golden:gate` CLI reports a failure | warning |
| `backup_failed`, `restore_failed`, `deploy_failed`, `custom:<title>` | a script calls the hook | critical (default) |

Backup failure hook (the API cannot observe a cron job; the job tells it). `curl -f` makes the script notice when the alert
went nowhere (HTTP 503 + `E5123` = no channel configured or every channel failed; 201 = delivered or deduped):

```bash
curl -fsS -X POST "$API_URL/api/v1/internal/ops-alert" \
  -H "Authorization: Bearer $OPS_ALERT_TOKEN" -H 'content-type: application/json' \
  -d "{\"kind\":\"backup_failed\",\"detail\":\"$(tail -n 3 /var/log/backup.log | tr '\n' ' ')\"}" \
  || echo "ALERT NOT DELIVERED" >&2
```

The existing AI-credit mail (`AiCreditAlertService`, Korean text, `AI_ALERT_EMAIL`, default `dev@amoeba.group`) is unchanged;
removing that Amoeba default belongs to SG-81. Engine credit exhaustion is *also* visible through the generic path: the failing
calls open the breaker and raise `breaker:<engine>`.

## 5. Readiness

`GET /api/v1/health/readiness` returns, per dependency, `status` (`up`/`down`/`degraded`/`skipped`), `latencyMs` and a short
`detail`; every check has its own deadline (`READINESS_CHECK_TIMEOUT_MS`, 2 s) so one hung dependency cannot hang the probe.
The AI summary is computed from the engines' recorded health columns and breaker state — **it makes no provider call**.

Overall `status`: `down` (HTTP 503, `E5122`) only when a **required** dependency is down (`READINESS_REQUIRED`, default `db`:
chat still works on keywords without Qdrant, and on the stub without an engine); `degraded` when anything is down or impaired
(an open breaker, an engine whose last call failed); else `ok`. The Docker healthchecks were **not** changed: they use the
liveness route, which must stay cheap and must not fail because Qdrant restarted. Point an external monitor at the readiness route.

## 6. Error tracking

`ErrorReporterService` receives every **5xx** (handled or not) from the global exception filter and process crashes
(`uncaughtExceptionMonitor` — observes without changing Node's crash behaviour). 4xx are not reported. Handled 5xx now also
leave a log line (previously a `BusinessException` with a 5xx status left no trace at all).

- Webhook sink: `ERROR_WEBHOOK_URL`. Event = name, scrubbed message (<= 500 chars), stack truncated to 12 frames / 3,000 chars,
  fingerprint, method, **normalised path without query** (`/orders/:id`), status, request id. Rate limits: the same fingerprint at most
  once per `ERROR_REPORT_DEDUPE_SEC` (60 s, the count swallowed rides on the next event) and at most `ERROR_REPORT_MAX_PER_MIN` (20).
- Scrubbing: emails, phones, cards, order refs (the shared PII scrubber), provider/bearer keys, JWTs, URL query strings,
  `password=`/`token:`/`api_key=` pairs.
- **Sentry: "Sentry-compatible via adapter", not tested against a real Sentry.** With `SENTRY_DSN` set *and* `@sentry/node`
  installed in the image, the adapter calls `Sentry.init` (`sendDefaultPii: false`, no tracing, a `beforeSend` that scrubs exception
  text and strips request bodies/cookies/users) and `captureException` with the stable fingerprint. The package is not a dependency of
  this repo; if the DSN is set without it, the API logs one warning and stays inert. It was exercised only against a stand-in with that surface.

## 7. Runbook

- **Breaker open alert.** Open `/api/v1/health/readiness` (which engine, which health: `credit`, `auth`, `rate_limit`, `unreachable`),
  check the provider status page and account credit, then the console › AI engines. Nothing to restart: after `AI_BREAKER_OPEN_SEC` one
  probe closes the breaker by itself and a RESOLVED notice follows. Meanwhile customers are handed to people with the outage notice.
- **Vector backend alert.** `docker ps` for Qdrant, `curl $QDRANT_URL/collections`; check `VOYAGE_API_KEY` and quota
  (`embedding_failures_total{reason}` says `auth`, `rate_limit`, `timeout`…). Answers continue on keywords at a capped confidence.
- **Dependency down.** The `dependency:*` alert carries the probe's reason. DB down takes the API down; Redis down only loses caching and
  the shared alert cooldown.
- **Too many alerts / none arrive.** `ops_alerts_total{result}` shows `suppressed` (cooldown), `failed` (channel error — check SMTP and the
  webhook URL; the URL is never logged) or `unconfigured`.

## 8. Not verified, known limits

- Prometheus rules above, the Sentry adapter against the real SDK, and SMTP delivery were not run against real systems.
- The ops-alert cooldown is per process when Redis is down; RESOLVED notices are per process (single API instance assumed).
- Other outbound HTTP clients (messenger adapters, Cafe24, Shopify admin, Slack escalation webhook) still have no deadline; only the AI, embedding
  and Qdrant paths and the new ops sinks do.
- A widget Retry after a failure that the server had in fact persisted can leave the question twice in the transcript.

## 9. Code map

`apps/api/src/infrastructure/resilience/` (timeout, retry, breaker) · `infrastructure/external/ai/ai-gateway.service.ts` (breaker, retry, embed) ·
`infrastructure/observability/` (registry, metric catalogue, `/metrics`, readiness, watchdog, ops alerts, error reporter) ·
`domain/chat/rag-degraded-confidence.util.ts` (vector-down rule) · `domain/chat/chat.service.ts` (`engineUnavailable` copy, reason) ·
`apps/widget/src/components/chat/send-failure.ts` (Retry / Talk to an agent).

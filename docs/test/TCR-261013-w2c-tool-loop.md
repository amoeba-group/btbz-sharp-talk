# TCR-261013 — Partner data tools mode: native tool-calling loop (SG-33, stream w2c)

- Date: 2026-10-13 · Plan: `docs/plan/PLN-261012-Go2Joy-Stage1-Gap-Closure.md` §3.4 SG-33 · Branch `feature/go2joy-s7-tool-loop` (base `test/go2joy-integration` `5f9ebc3e`) · Report: `docs/implementation/RPT-261013-w2c-tool-loop.md` · Guide: `docs/guide/GUIDE-261013-Partner-Data-Tools-Mode.md`
- **Scope of verification.** There is no live provider. Everything below was verified against **a local fake of the Anthropic Messages API** (`http.createServer`, real HTTP, strict about the tool_use / tool_result pairing rules the real API enforces with a 400), against a **fake OpenAI Chat Completions server** (inline in its spec) and, for the partner side, the mock partner client. **Nothing was run against Anthropic, OpenAI or Go2Joy.**
- Default is unchanged: prefetch. Tools mode needs `PARTNER_DATA_MODE=tools` or a tenant override, an engine whose `capabilities` include `tools`, and the existing `PARTNER_DATA_ENABLED` + tenant switch.

## 1. Unit / integration (jest, `apps/api`)

| # | Group | Spec | Cases | Result |
|---|---|---|---:|---|
| T1 | **Wire compatibility.** String-content, no-tools requests are byte-identical on the wire for Anthropic and OpenAI (literal bodies captured from the adapters BEFORE the change), result shape unchanged (`toStrictEqual`), stub answers as before and never returns a tool use for a tools request unless a test scripted it | `adapters/adapter-wire.snapshot.spec.ts` | 4 | PASS |
| T2 | **Anthropic adapter, real HTTP vs the fake.** `tools[].input_schema` last in the body; empty `tools` = none; tool turn as `tool_use`/`tool_result` blocks (`is_error` only when set); parallel `tool_use` parsing; stop-reason mapping (6 values); non-object input flagged; strict-fake 400 on unpaired tool_use surfaced as `ProviderHttpError`; 5xx; deadline kept with tools | `adapters/anthropic.adapter.tools.spec.ts` | 15 | PASS |
| T3 | **OpenAI adapter parity** vs a fake: function `tools` after `temperature`, tool turn → `tool_calls` + one `role:'tool'` message per result (`ERROR:` prefix), null content with tool_calls, arguments JSON-string parsing, non-JSON / non-object arguments flagged, finish-reason mapping | `adapters/openai.adapter.tools.spec.ts` | 11 | PASS |
| T4 | **Stub**: no tool support by default; script is a plain instance field (marker text in a prompt does nothing); scripted tool uses; a request without tools ignores the script (the degraded path); block messages flattened | `adapters/stub.adapter.tools.spec.ts` | 7 | PASS |
| T5 | **Gateway.** `toolSupport` (adapter AND `tools` capability; reasons `no_engine`/`adapter_unsupported`/`capability_missing`; parsing tolerant of spacing/case, `toolset` ≠ `tools`; pure routing); a tools request to a non-tool engine is **refused** (not sent, not metered, not answered by the stub, `degraded+toolsRefused`); plain requests unaffected; adapter gets `tools`, plain request has no `tools` key; transient failure retried once; **provider error mid-loop → stub called WITHOUT tools, a stub scripted to call a tool returns none**; open breaker degrades a tools request without touching the provider; real adapter body unchanged through the gateway | `ai-gateway.tools.spec.ts` | 15 | PASS |
| T6 | **Loop runner** (scripted gateway): completes with no tool use; result fed back as neutral blocks; token sums; calls run in order one at a time; **first abort cancels the rest and no further model call**; a throwing tool aborts; retryable failure → error result and continue; unparseable provider arguments never executed; iteration limit (last iteration's calls not run); call cap across iterations and checked before executing; time budget (model call capped by what is left; overrunning tool ends the loop; spent budget stops before the next call); env defaults/overrides/floors/blank; unsupported engine → no model call; **degraded response aborts, its text and tokens unused**; refused tools request → `tools_unsupported`; gateway throw → `engine_error`; `max_tokens`/refusal not a finished thought; tool uses on a non-`tool_use` stop, without id, with duplicate id → never executed | `domain/ai-engine/tool-loop.service.spec.ts` | 19 | PASS |
| T7 | **Tools derived from the registry**: one tool per topic, provider-safe names; name↔topic mapping (hostile names → null); per topic: schema keys == `TopicDef.params` exactly, each property mirrors its `ParamSpec`, closed object (no oneOf/required), **no hotel/tenant/partner handle in a key or in any prose**, description for the topic and every parameter; no stale help text; least privilege per role == registry allow-list; derivation (synthetic topic) not transcription | `domain/partner-data/partner-tools.spec.ts` | 27 | PASS |
| T8 | **Mode selection**: `PARTNER_DATA_MODE` (typo ≠ tools), `PARTNER_TOOLS_ENABLED` only permits, stored value parsing, tenant override both directions, kill switch reads no DB, unreadable override = server default, cache incl. "no override", settings read/write (override, effective mode, engine support), audit with previous value, controller needs ≥ 1 field and keeps the switch-only client working, `looksLikePartnerQuestion` (11 positive, 7 negative, superset of the detector) | `domain/partner-data/partner-mode.spec.ts` | 33 | PASS |
| T9 | **Step, end to end through the real chain** (step → loop → gateway → Anthropic adapter → fake server; data service → registry → mock client): single call; two sequential calls (second chosen after the first result); parallel `tool_use` in one response answered in ONE user turn in order; identical call fetched once; token accounting 220/23 across 2 iterations and per-call metering under a ≤ 32-char label; lookup-log row per call with `mode='tool'`; planning model sees only the PII-scrubbed text; first request offers closed tools, no hotel anywhere; **limits** (iteration cutoff, cap env, call cap in one response and across iterations, wall-clock for a hung tool and for a hung model call); **safety** (8 hotel-ish argument spellings → refusal, nothing requested, no retry; hotel in a value; customer naming another hotel; unknown tool; receptionist not offered settlement and refused server-side when the model asks anyway; invalid args corrected; unknown key named without value; booking lookup form; non-object args); **failures** (partner 5xx → notice+hand-off and remaining calls cancelled; unusable reply; wrong-hotel echo); **engine** (degraded mid-loop → prefetch, stub never handed tools; first-call failure; hint-only + engine down → null; `max_tokens` cut-off; tool use with `end_turn`; missing/duplicate id; stub / no engine / no capability / unknown provider → zero model calls); no-lookup cases; gates (guest, unsigned, expired, tenant `identity.expired`, stale + how-to not hijacked, env/tenant off); mode selection; **number verification on the union**; metrics counter; planner prompt; collaborator throwing never costs an answer | `domain/partner-data/partner-data.step.tools.spec.ts` | 63 | PASS |
| T10 | **ChatService** (`handleUserMessage`) with the real step: planning picks lookups, ONE `rag.answer` fed the union block, **one moderation of the final text with protect = ids/amounts of BOTH results**, evidence on the trace (never in `citations`, never in the reply), `partnerMode`/`partnerToolLoop` on the trace; **reuse bypassed at both sites** for a tool turn and for a tools→prefetch fallback; control: a how-to where the model chose no lookup keeps reuse; planner reads scrubbed history; invented amount withheld (notice + hand-off, never persisted), figure from either result accepted; iteration limit → notice + hand-off, no generation, no moderation; model naming a hotel → refusal; pilot-denied, guest, expired claims, tenant on prefetch → no model call | `domain/chat/chat.service.partner-tools.spec.ts` | 14 | PASS |
| T11 | Existing specs adjusted for the additive contract: settings response gained 4 fields; lookup-log rows gained `mode` | `partner-settings.spec.ts`, `partner-lookup-log.service.spec.ts` | 13 / 9 | PASS |

New/changed spec cases: 230 (208 new: 4+15+11+7+15+19+27+33+63+14, plus the two touched specs' 22), all passing; the partner/AI/chat/infrastructure neighbourhood (106 suites, 1481 cases at the time) stayed green.

## 2. Mutation proof — each safety property removed, a spec must fail

One edit per run, the relevant specs run, the file restored (`scratchpad/w2c/mutate.js`, not committed). **20 / 20 caught.**

| # | Property removed | Failing cases |
|---|---|---:|
| M1 | role allow-list not enforced server-side (`resolve` skips the role check) | 2 |
| M2 | hotel-ish argument keys not recognised by the shared validator | 8 |
| M3 | a hotel argument becomes a correctable error instead of refusing the turn | 9 |
| M4 | the loop ignores a degraded (stub) response | 5 |
| M5 | the gateway's degraded fallback hands the stub the tools | 1 |
| M6 | the engine `tools` capability is not enforced | 3 |
| M7 | the gateway no longer refuses a tools request to a non-tool engine | 3 |
| M8 | iteration limit not enforced | 3 |
| M9 | per-turn tool-call cap not enforced | 3 |
| M10 | tool calls of a `max_tokens`-truncated response are executed | 3 |
| M11 | the planning model sees the RAW customer text | 1 |
| M12 | block / number check covers only the first tool result | 5 |
| M13 | moderation protect list covers only the first tool result | 1 |
| M14 | answer reuse not bypassed for a turn that ran a tool | 2 |
| M15 | kill switch `PARTNER_TOOLS_ENABLED=0` ignored | 2 |
| M16 | tools mode consulted before the signed-identity gate (unsigned reaches the loop) | 1 |
| M17 | a limit abort answered from partial data instead of failing the turn | 6 |
| M18 | identical calls re-executed (no idempotent dedupe) | 1 |
| M19 | an unknown tool name executed as a topic | 2 |
| M20 | tools not filtered by the registry roles | 3 |

## 3. Real boot and HTTP smoke (scratch DB `scratch_w2c`, port 3033, seeded `ivyusa`, fake Anthropic engine row)

| # | Scenario | Result |
|---|---|---|
| L1 | Boot after entity changes (`partner_lookup_logs.mode` NOT NULL DEFAULT 'prefetch', `tenants.partner_data_mode` NULL, explicit `type`) — also proves Nest DI of `PartnerToolsService`/`ToolLoopService` into the step | `Nest application successfully started`; `SHOW COLUMNS`: `mode varchar(8) NO prefetch`, `partner_data_mode varchar(8) YES NULL` |
| L2 | Console API: default `GET /partner-data/settings` → `dataMode:null, effectiveMode:prefetch, toolsAllowed:true, toolsSupport:{supported:true}` (engine row declares `tools`); `PUT {}` → 400; `PUT {data_mode:'ai'}` → 400; `PUT {enabled:true,data_mode:'tools'}` → effective mode `tools` | as expected |
| L3 | Widget path: ensure → consent → **signed identify v2** (manager 1721) → `POST /chat/message` "rates for a Saturday AND settlement for September" | reply `ai`: "giá qua đêm Deluxe là 475.000 ₫. Còn phải thu 40.725.000 ₫." — 2 planning calls + 1 generation call at the fake; trace `answeredFrom=partner_data`, `partnerMode=tools`, `partnerToolLoop {completed, iterations 2, toolCalls 2, tokensIn 220, tokensOut 23}`, `partnerEvidence` topics `rates`,`settlement`, `citations` = KB only |
| L4 | Model scripted to pass `hotelSn` (`BADHOTEL …`) | refusal notice (vi) "chỉ tra cứu được dữ liệu của khách sạn bạn đang đăng nhập", no hand-off, 1 planning call, 0 generation; trace `partner_param_rejected / E5104 / toolError hotel_param`; log row `tool | bookings | rejected | E5104 | hotel_param | rejectedKeys[0]=hotelSn` |
| L5 | Receptionist asks settlement | role-denied notice, **0 calls to the fake** (prefetch refusal); log row `prefetch | settlement | denied | E5101` |
| L6 | How-to ("how do I cancel a booking in the app?") | 1 planning call (model: no lookup), ordinary answer path (1 generation call), no `partnerEvidence` |
| L7 | Engine row WITHOUT `tools`: `GET settings` → `toolsSupport {supported:false, reason:capability_missing}`; same question | 0 planning calls; prefetch answered (425.000 ₫ — today's rate, because the detector cannot read "thứ bảy"); trace `partnerMode=prefetch, partnerToolsFallback=tools_unsupported`; log row `tool | tool_loop | error | E5143 | tools_unsupported`, then `prefetch` rows |
| L8 | Tenant set to `prefetch` | 0 planning calls; trace has no `partnerMode`; `PUT {data_mode:'inherit'}` → `dataMode:null` |
| L9 | `audit_logs` | `partner_data.mode_changed` rows with `from`/`to`, `serverMode`, `toolsAllowed`; a UI save that changed only the method wrote no `partner_data.enabled` row |
| L10 | `ai_usage_daily` | planning calls metered under `partner_tool_loop` (function `rag`) with per-call tokens |
| L11 | Console card (vite on 5193 → API 3033, Settings → Etc, English): radio group renders (Server default (Standard) / Standard / AI-assisted); selecting AI-assisted + Save → `PUT /partner-data/settings` 200, tenant row `partner_data_mode='tools'`; with the engine row's `tools` removed the card shows the amber "…cannot run lookup tools yet (its capabilities need “tools”), so the standard lookup is used", saved choice stays selected, Save disabled | verified via DOM reads (the browser pane would not render screenshots, so no visual check) |

Cleanup after the smoke: API, vite and the fake provider stopped; `DROP DATABASE scratch_w2c`; the DB user's grant on it revoked. `db_sharptalk` untouched.

## 4. Static checks and full runs

| Check | Result |
|---|---|
| `tsc -p tsconfig.check.json --noEmit` api / web / widget | 0 / 0 / 0 errors |
| jest `apps/api` (final full run) | **4204 pass, 3 fail** of 4207 (340 suites; 337 pass; base was 3994 pass / 4 baseline fails of 3998). The 3 failing suites are the known Windows baselines: `embed/embed-loader.spec.ts`, `attachment/heic-conversion.spec.ts`, `board/board-attachment.service.spec.ts` |
| `npm run i18n:check` | es, ko, vi, ja, zh complete (10 new keys per language) |
| `npm run migrations:manifest` + `git diff --ignore-space-at-eol --stat sql/artefacts.tsv` | only the 2 rows of `261018-partner-lookup-mode.sql` added |
| `npm run initsql:check` | OK — 213 manifest artefacts exist in `docker/init-sql/01-schema.sql` |
| `npm run env:check` | still fails as at base (14 keys missing from the self-hosted template, incl. other streams' `PARTNER_*`); this stream's 6 new keys were added to the template, leaving 8 pre-existing gaps (not this stream's) |
| web helper (`partner-data-patch.ts`) | no web test runner: pure logic checked ad hoc (transpiled + 14 assertions: only changed fields are sent; warning only when tools would not actually run) |

## 5. Not verified / known limits

- **Real Anthropic**: parallel tool use behaviour, the exact `stop_reason` set, error shapes for mispaired tool results, whether a given model follows the planner prompt and passes valid arguments, latency and cost. The fake models the documented protocol, not the service.
- **Real OpenAI / OpenAI-compatible endpoints**: tool calling is mapped and tested against a fake only; that is why the engine row must declare `tools`.
- **Go2Joy's API** under tools-mode bursts (up to 4 sequential GETs per question) and its rate limits.
- Planner quality on Vietnamese/Korean questions and relative-date resolution ("next Saturday") — the prompt gives today's date and weekday; correctness depends on the model.
- Console: only English, only via DOM reads; the other five languages are checked by `i18n:check` (keys present), not read on screen.
- `PARTNER_TOOLS_ENABLED` / limits were verified in specs, not by restarting the real API with them.
- No concurrent-load test; the loop adds ≥ 1 model round trip per partner-related message.

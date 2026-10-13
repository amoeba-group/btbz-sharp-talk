# RPT-261013 — Partner data tools mode: native tool-calling loop (SG-33, stream w2c)

- Date: 2026-10-13 · Plan: `docs/plan/PLN-261012-Go2Joy-Stage1-Gap-Closure.md` §3.4 (SG-33, "phase 2" of SG-30/31/32) · Tests: `docs/test/TCR-261013-w2c-tool-loop.md` · Guide: `docs/guide/GUIDE-261013-Partner-Data-Tools-Mode.md`
- Branch `feature/go2joy-s7-tool-loop` (base `test/go2joy-integration` `5f9ebc3e`) · **not pushed, not deployed, no PR.**
- ⚠️ **No live provider was available.** Everything was verified against a local fake of the Anthropic Messages API (real HTTP, strict about tool-result pairing), a fake OpenAI Chat Completions server and the partner mock. **Real Anthropic / OpenAI / Go2Joy behaviour was NOT verified** (§7).
- **Default is unchanged: prefetch.** Tools mode is opt-in per server (`PARTNER_DATA_MODE=tools`) or per tenant, needs an engine that declares the `tools` capability, and falls back to prefetch whenever it cannot run.

## 1. Result in one paragraph

A signed-in hotel user's partner question can now be answered in a mode where **the model chooses the read-only lookups** through native tool calling (multi-topic or loosely worded questions), with **no weakening of any safety property of prefetch**: the model's calls go through the same `PartnerDataService.resolve` (hotel only from the branded `PartnerCtx`, shared closed-parameter validator that rejects hotel-ish keys, server-side role allow-list, projection/PII minimisation, server-computed money); the loop only *gathers* — its results become the same `PARTNER_DATA` block prefetch builds and the existing generation → single moderation (protect list = union) → number verification (union) → reuse bypass → evidence recording run on it unchanged. The model's own words during the loop never reach a customer. Cost: at least one extra model call per partner-related message.

## 2. PHASE 0 — what I verified, and what the plan/brief did not say

Verified against the code (symbols, not line numbers):
- Anthropic parsing was `content.map(c => c.text ?? '')` and `stop_reason` was ignored — a `tool_use` reply read as an empty string. ✔
- `ai_engines.capabilities` (default `chat,rag,summary,assist,moderation`) is stored and never read anywhere. ✔ It has **no** `tools` token by default and **no console field** (platform-admin `PATCH /ai-engines/:id` / SQL only).
- `ai-usage.service` meters once per gateway call (`feature.slice(0,32)`); the gateway meters in `complete()` and in the degraded fallback. ✔
- Moderation call sites: main answer path (`handleUserMessage`), the no-knowledge path, and `KnowledgeService.ask` (goldens). Tools mode only touches the main path, which runs moderation exactly once. ✔
- Prefetch seam: `PartnerDataStep.prepare` → `AnswerOpts.partnerData` → `rag.answer`; chat bypasses reuse at both sites on `partner` truthy. ✔

Found beyond the brief (each handled):
1. **Widening `AiMessage.content` to `string | blocks` would break** `conversation-history.util` (string ops on `m.content`) → tool turns use a separate `AiBlockMessage`; `AiMessage` is untouched.
2. **The OpenAI adapter spec asserts the exact result object (`toEqual`)** → `toolUses`/`stopReason` are only added when the request carried `tools`; a plain request gets exactly the previous shape (also for Anthropic).
3. **`PartnerGoldenService` builds the step positionally with 3 args and a flag stub that only has `serverEnabled/isEnabled`** → the loop collaborator is an optional trailing constructor param; goldens stay prefetch (deterministic) and the flag stub is never asked for a mode.
4. `prepare()` dereferenced `intent.topics[0].topic` in two refusal branches → would throw for a tools-mode turn the lexicon could not pin to a topic; guarded. A hint-only turn with **stale claims is not hijacked** by the "sign in again" notice (returns null; the chat's own identity gates decide).
5. `handles()` (the out-of-scope override) had to be widened too, or a question the lexicon does not know would be labelled "out of scope" before the step sees it.
6. The planning model must receive **scrubbed** text: `prepare` got the raw message only. `ChatService` now also passes `modelText: egressText` and `history` (both optional, read only in tools mode).
7. **The detector cannot resolve "thứ bảy" / relative dates** it has no word for (it priced *today* — seen in the smoke: 425.000 ₫ vs the model's 475.000 ₫ for the Saturday). A real benefit of tools mode, and a real risk if the model computes a wrong date (§6).
8. `partner-settings.spec.ts` asserts the exact settings response → the extended contract updated it (four new fields).
9. Specs are not type-checked by `tsc` (excluded, jest `isolatedModules`), so my spec files were type-checked once with a temporary untracked config.

## 3. Exact contract changes and why they are backward compatible

`infrastructure/external/ai/ai-adapter.interface.ts`
- `AiMessage { role; content: string }` — **unchanged**.
- New `AiContentBlock` (`text` | `tool_use {id,name,input}` | `tool_result {toolUseId,content,isError?}`), `AiBlockMessage {role:'user'|'assistant'; content: AiContentBlock[]}`, `AiRequestMessage = AiMessage | AiBlockMessage`, `AiToolDef {name, description, inputSchema}`, `AiToolUse {id,name,input,inputError?}`, `AiStopReason`.
- `AiCompletionRequest.messages: AiRequestMessage[]` (widening — every existing `AiMessage[]` caller still type-checks); new optional `tools?`.
- `AiCompletionResult` gained optional `toolUses?`, `stopReason?`, `toolsRefused?`.
- `AiAdapter.supportsTools?` (absent = no): an adapter written before tools existed is never handed tools.

Why compatible: a request **without** `tools` serialises byte-identically (Anthropic `{model,max_tokens,system,messages}`, OpenAI `{model,messages,max_completion_tokens[,temperature]}`; `tools` is appended last and only when asked) and returns a result of exactly the previous shape. Pinned by `adapter-wire.snapshot.spec.ts` whose literals were captured from the adapters **before** the change.

Provider mapping — Anthropic: `tools[].input_schema`, assistant turn = text + `tool_use` blocks, one user turn with all `tool_result` blocks (tool_result first), `is_error`; response `tool_use` blocks and `stop_reason` (`end_turn|stop_sequence`→`end_turn`, `tool_use`, `max_tokens`, `refusal`, else `other`). OpenAI: function `tools`, assistant `tool_calls` (arguments as JSON string), one `role:'tool'` message per result (errors prefixed `ERROR:`), null content with tool_calls, `finish_reason` mapping; unparseable arguments → `inputError`, never executed. Stub: scripted tool calls through a **test-only instance field** (`toolScript`); not an env var, not a marker in a prompt, so no customer text can switch it on; `supportsTools` is false without it.

Gateway (`ai-gateway.service.ts`): `GatewayRequest.tools?`; new `toolSupport(tenantId, fn)` = adapter `supportsTools` **and** the engine row's `capabilities` contains `tools` (first enforcement of that column, for tools only); `complete()` **refuses** a tools request to a non-tool engine (`degraded:true, toolsRefused:true`, nothing sent, nothing metered, not answered by the stub); the degraded→stub fallback is called **without** `tools`, so the stub can never invent a tool call; s5b's per-call timeout / one transient retry / breaker are untouched and apply to every loop iteration. A tools request is retried once like any completion (idempotent — no tool ran yet).

## 4. Design

**Where the loop lives.** A generic `domain/ai-engine/tool-loop.service.ts` (`ToolLoopService`: mechanics + limits, knows nothing about hotels) and a partner binding `domain/partner-data/partner-tools.service.ts` (`PartnerToolsService`: executes calls through `resolve`, builds sections/evidence/protect list, maps the loop's outcome). `PartnerDataStep` owns the collaborator, so **`chat.service.ts` changes by two lines** (`modelText`/`history` into `prepare`; `partner.trace` into the persisted trace).

**Why the loop gathers instead of answering.** The alternative — using the loop's final text as the answer — would need persona, KB grounding, language, confidence, citations and footer duplicated or bypassed, and would create a second moderation/verification seam. Gathering and then calling the existing `rag.answer` keeps one seam and makes every downstream invariant (moderation once, protect list, number check on the union, reuse bypass, evidence, confidence floor) hold by construction. Trade-off: ≥ 1 extra model call per partner turn (typically two planning calls + the answer).

**Tools** are derived from the `TopicRegistry` (`partner-tools.ts`): one `lookup_<topic>` per topic, schema = the topic's closed `ParamSpec`s with `additionalProperties:false`, no hotel property or hotel prose, offered only for roles the topic allows — and the server re-enforces the role on every call.

**Activation.** `PARTNER_DATA_ENABLED` + tenant flag + signed identity + claims check + no foreign hotel named, then the mode (`PARTNER_TOOLS_ENABLED` kill switch → tenant override `tenants.partner_data_mode` → `PARTNER_DATA_MODE`). Tools mode also takes a message the detector cannot pin to a topic when it *talks about* one (`looksLikePartnerQuestion`, words only; a how-to costs one planning call and ends as an ordinary turn).

**Failure policy** (one table; full list in the guide §5):

| Situation | Outcome |
|---|---|
| engine cannot do tools / failed or degraded mid-loop / response truncated or malformed / model chose no valid lookup | `fallback` → prefetch (or an ordinary turn when the detector found nothing); logged E5143 |
| model passes a hotel-ish argument | **abort**, the prefetch refusal notice (E5104), no hand-off |
| role may not read the topic (also if the model asks for a tool it was not offered) | **abort**, role-denied notice (E5101) |
| invalid arguments / unknown tool | error result, the model may correct within the limits |
| partner down / unusable reply / throttled | **abort**, "confirm later" + hand-off (E5100/5105/5108); first failure cancels the rest |
| iteration / call / time limit | **fail**, "confirm later" + hand-off (E5142) — a lookup that did not finish is never answered from part of its data |

Limits: 3 model calls, 4 tool calls per turn, 20 s wall clock (each model call's deadline is cut to what is left), planner output 512 tokens — all env-tunable (`PARTNER_TOOLS_*`). Calls run **sequentially** in the model's order. Identical calls are fetched once.

**Observability.** `retrieval_trace`: `partnerEvidence[]`, `partnerMode`, `partnerToolLoop {…tokens…}`, `partnerToolsFallback`; `partner_lookup_logs.mode='tool'` per call + `tool_loop` rows for loop events; usage metered per planning call under `partner_tool_loop`; metric `sharptalk_partner_tool_loops_total{outcome,reason}`; audit `partner_data.mode_changed`.

## 5. Files

Commits (all end with the `Co-Authored-By` line):
- `c262e22e` feat(ai): native tool-calling contract in the adapters and gateway
- `e127fdb2` feat(ai-engine): generic bounded model<->tools loop runner
- `d9967d91` feat(partner-data): optional model-driven lookups via native tool calling
- `ebd1e3d0` feat(web): choose the partner lookup method in the partner-data card
- `f0b5f849` test(partner-data): metrics, planner prompt, lookup-log mode; guard the tools collaborator
- `46414af6` docs: guide, TCR, RPT, call-rate note in the API-REQ (plus this SHA list, in a follow-up docs commit)

Backend: `ai-adapter.interface.ts`, `adapters/{anthropic,openai,stub}.adapter.ts`, `ai-gateway.service.ts`, `domain/ai-engine/tool-loop.service.ts`, `domain/partner-data/{partner-tools.ts, partner-tools.service.ts, partner-data.step.ts, partner-flag.service.ts, partner-settings.service.ts, partner-data.controller.ts, partner-data.constants.ts, partner-data.service.ts (mode in meta), partner-lookup-log.service.ts, partner-intent.util.ts (looksLikePartnerQuestion), partner-data.module.ts, dto/*, partner-data.mapper.ts}`, entities `partner-lookup-log.entity.ts` / `tenant.entity.ts`, `error-code.constant.ts` (E5142–E5144), `app-metrics.ts` (+1 counter), `chat.service.ts` (+2 hunks).
Web: `PartnerDataCard.tsx`, `partner-data.service.ts`, `partner-data.hooks.ts`, new `partner-data-patch.ts`, six `settings.json`.
Schema/config: `sql/261018-partner-lookup-mode.sql`, `sql/artefacts.tsv`, `docker/init-sql/01-schema.sql`, `CONFIG.md`, both env examples.
Tests/support: 10 new spec files + 2 adjusted (TCR §1), `infrastructure/external/ai/testing/fake-anthropic.server.ts`, `domain/partner-data/testing/tools-harness.ts`.
Docs: this RPT, the TCR, `GUIDE-261013-Partner-Data-Tools-Mode.md`, a call-rate note in `API-REQ-Go2Joy-Partner-Data.md`.

Console UI (wireframe, English):

```
┌ Partner data lookup ─────────────────────────── [Sample data (mock)] ┐
│ Let the assistant answer a signed-in hotel user's questions …         │
│ [x] Look up the hotel's live data when a signed-in user asks          │
│ How lookups are made                                                  │
│  (•) Server default (Standard)                                        │
│  ( ) Standard — the server fetches the data a keyword detector names… │
│  ( ) AI-assisted — the assistant chooses which read-only lookups …    │
│ ┌──────────────────────────────────────────────────────────────────┐  │
│ │ ⚠ The AI engine that answers customers cannot run lookup tools   │  │  (only when the
│ │   yet (its capabilities need "tools"), so the standard is used.  │  │   choice would fall back)
│ └──────────────────────────────────────────────────────────────────┘  │
│                                                          [ Save ]     │
│ ──────────────────────────────────────────────────────────────────── │
│ Connection   Go2Joy partner data API …                                │
└───────────────────────────────────────────────────────────────────────┘
```
Only changed fields are sent on Save; success toast reuses `partnerData.saved`, errors stay until dismissed.

## 6. Migration, config and deploy state

**Deploy state: not deployed, not pushed, no PR.** `## Migration` (for the future PR):
- SQL: `sql/261018-partner-lookup-mode.sql` — `partner_lookup_logs.mode VARCHAR(8) NOT NULL DEFAULT 'prefetch'`, `tenants.partner_data_mode VARCHAR(8) NULL`. Additive, no `AFTER`; guard each ALTER with `SHOW COLUMNS … LIKE`. Rollback: drop both columns (statements in the file).
- **Apply to the target DB BEFORE the code** (staging runs `DB_SYNCHRONIZE=false`; old code + new columns is safe, new code + old schema 500s). `init-sql` synced; `initsql:check` OK; manifest regenerated (+2 rows).
- [ ] dev `db_sharptalk` · [ ] staging `shoptalk.amoeba.site` · [ ] production (TBD) — none applied. A scratch DB (`scratch_w2c`) got both columns via `DB_SYNCHRONIZE=true`; it has been dropped.
- Env (all optional, documented in `CONFIG.md` + both templates): `PARTNER_DATA_MODE`, `PARTNER_TOOLS_ENABLED`, `PARTNER_TOOLS_MAX_ITERATIONS`, `PARTNER_TOOLS_MAX_CALLS`, `PARTNER_TOOLS_BUDGET_MS`, `PARTNER_TOOLS_MAX_TOKENS`.
- **Order to enable for a pilot tenant:** apply SQL → deploy → platform admin adds `tools` to the answering engine's `capabilities` → tenant master picks *AI-assisted* → watch `partner_lookup_logs` / traces. Rollback: pick Standard, or `PARTNER_TOOLS_ENABLED=0`.

## 7. VERIFIED vs NOT VERIFIED

**VERIFIED** (local; numbers in the TCR): `tsc` api/web/widget 0 errors; API jest 4204 pass / 3 known-baseline fails (of 4207); 230 new/changed cases; 20/20 mutations of safety properties caught; real boot with the new columns and DI wiring; HTTP smoke with signed identify through `/chat/message` against the fake engine (tools answer, hotel argument refused, role denied, how-to untouched, capability fallback, prefetch mode, audit, usage); console card driven via DOM reads; `i18n:check`, `initsql:check`, manifest.

**NOT VERIFIED**: real Anthropic (parallel `tool_use`, exact `stop_reason`/error shapes, whether a given model follows the planner prompt and emits valid arguments, latency, cost); real OpenAI / OpenAI-compatible tool calling; Go2Joy's API under up to 4 sequential GETs per question; planner quality in Vietnamese/Korean and relative-date resolution; visual rendering of the console card and its non-English text; `PARTNER_TOOLS_*` limits via a restarted real API (specs only); behaviour under load.

## 8. Deviations from the plan

- PLN SG-33 says "OpenAI parity"; done by mapping (not by refusing), but the engine row must additionally declare `tools` — the column is enforced for tools only.
- The model does **not** write the final answer (§4) — a deliberate narrowing of the brief's "or runs the loop … then continues with the final text" to the lower-risk reading.
- Added (asked for in the brief, "extend carefully"): per-tenant override column, console selector, kill switch env, a metric counter.
- `partner-settings.spec.ts` / `partner-lookup-log.service.spec.ts` (s4's) were adjusted for the additive contract.

## 9. Follow-ups and cross-stream risks

Follow-ups: validate on staging with the real engine and compare with prefetch on the golden set (goldens deliberately stay prefetch); console field for engine `capabilities`; refusal-analytics reason for the limit case (SG-50 vocabulary reuses `partner_unavailable`); optional hybrid (skip the planning call when the detector's parameters are complete); agree rate limits with Go2Joy for ≤ 4 GETs per turn; the self-hosted env template has 8 pre-existing `env:check` gaps from other streams (`PARTNER_API_*`, `IDENTIFY_REPLAY_GUARD`, `IDENTITY_MAX_AGE_HOURS` …).

Merge-conflict watch (append-style hunks): `error-code.constant.ts` (E5142–E5144 appended at the end, next to w2a's E5135–E5139 / w2b's E5140–E5141), `app-metrics.ts` (one counter appended), `tenant.entity.ts` + `docker/init-sql/01-schema.sql` (new column beside `partner_data_enabled`), `sql/artefacts.tsv` (regenerate), six `settings.json` (keys appended inside `partnerData`), `CONFIG.md` and the two env templates (blocks inserted next to the partner-data block), `chat.service.ts` (two small hunks at the prepare call and the trace spread).

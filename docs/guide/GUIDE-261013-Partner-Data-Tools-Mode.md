# GUIDE-261013 — Partner data: tools mode (model-driven lookups, SG-33)

PLN-261012 §3.4 SG-33 · phase 2 of the partner-data feature (SG-30/31/32). Branch `feature/go2joy-s7-tool-loop`.
Not deployed. **Verified only against a local fake of the Anthropic Messages API — never against Anthropic, OpenAI or Go2Joy** (see §8).

## 1. What it is, in one paragraph

Partner data answers a signed-in hotel user's questions about THEIR hotel's policies, rates, bookings and settlement from the
Go2Joy partner API. By default (**prefetch**) a deterministic keyword detector decides which lookups a message needs and
the server fetches them *before* the model runs. In **tools mode** the model decides which read-only lookups it needs through
native tool calling — useful for questions that span several topics or are phrased in a way the lexicon does not know
(example: "Giá phòng Deluxe qua đêm **thứ bảy**" — the detector has no word for "thứ bảy" and would price *today*; the model
resolves it to a date). Everything that makes prefetch safe is unchanged: the model can only call lookups the server offers, with
the closed parameters of each topic, for the hotel that signed in.

**Default stays prefetch.** Nothing runs in tools mode until `PARTNER_DATA_MODE=tools` or a tenant opts in, and tools mode degrades
to prefetch whenever the AI engine cannot do it.

## 2. How a turn runs in tools mode

```
customer message ── (pilot gate, consent, guest gate, identity expiry: unchanged, all BEFORE this)
   └─ PartnerDataStep.prepare            flags (env + tenant) → signed, unexpired claims → no other hotel named
        └─ mode = tools?  ── no ──────────────────────────────────────────────► prefetch (today's path)
              │ yes
              ▼
        PartnerToolsService.run  ── engine can't do tools? ──────────────────► prefetch   (E5143 row)
              │
              ▼   ≤ 3 model calls, ≤ 4 tool calls, ≤ 20 s (env)
        ┌── planning model call (tools = lookup_policies/rates/bookings/settlement, role-filtered)
        │       └─ tool_use ► PartnerDataService.resolve(ctx, topic, args)   ← the SAME entry point as prefetch
        │                        role allow-list · closed-param validator (hotel-ish key = refusal) · fetch with the hotel
        │                        from PartnerCtx ONLY · echo check · field whitelist/PII minimisation · server-side money
        └── tool_result ► next planning call … until the model stops asking
              │
              ▼
        the results become the same PARTNER_DATA block prefetch builds  (+ evidence, + moderation protect list)
              │
              ▼   existing, unchanged: rag.answer (persona, KB, language) → ONE moderation of the final text
                  → number verification against the union of all tool results → reuse bypass → trace/evidence
```

The planning model **never writes the answer**. Its words during the loop are discarded; the customer only ever reads the text
produced by the normal grounded generation step, which goes through moderation and number verification like any partner answer.
(Price of that design: a tools-mode turn costs **at least one extra model call** — usually two planning calls plus the answer.)

### What the model is offered

One tool per registered topic, **derived from the `TopicRegistry`** (`partner-tools.ts`), never written beside it:

| Tool | Parameters (closed set, from the topic) | Roles offered |
|---|---|---|
| `lookup_policies` | `type` | manager, receptionist, internal |
| `lookup_rates` | `roomType`, `rateType`, `date` | manager, receptionist, internal |
| `lookup_bookings` | `bookingCode` **or** `checkInFrom`+`checkInTo` (+ `status`, `page`, `size`) | manager, receptionist, internal |
| `lookup_settlement` | `period`, `status`, `page`, `size` | manager, internal |

There is **no hotel parameter** in any schema, and the tool prose never says "hotel": the hotel is fixed by the server from the
signed identity (`PartnerCtx`). Offering a role fewer tools is a convenience for the model; the **role allow-list is enforced
server-side on every call** regardless.

## 3. Switching it on

| Setting | Where | Default | Meaning |
|---|---|---|---|
| `PARTNER_DATA_ENABLED` + tenant switch | env + Settings → Etc | off | unchanged — both must be on for ANY partner lookup |
| `PARTNER_DATA_MODE` | env | `prefetch` | `prefetch` \| `tools`: default for tenants without an override. Anything but `tools` is `prefetch` |
| Lookup method | Settings → Etc → *Partner data lookup* (`PUT /partner-data/settings {data_mode}`) | server default | tenant override: Standard / AI-assisted / Server default. Audited (`partner_data.mode_changed`) |
| `PARTNER_TOOLS_ENABLED` | env | on | **kill switch**: `0` forces every tenant to prefetch immediately, whatever they chose |
| `PARTNER_TOOLS_MAX_ITERATIONS` / `_MAX_CALLS` / `_BUDGET_MS` / `_MAX_TOKENS` | env | 3 / 4 / 20000 / 512 | limits per customer turn (see CONFIG.md) |
| Engine capability `tools` | `ai_engines.capabilities` (platform admin: `PATCH /ai-engines/:id {"capabilities":"chat,rag,summary,assist,moderation,tools"}`, or SQL) | absent | the engine that answers customers (function `rag`) must DECLARE tools. The column existed but was never enforced; for tools it now is |

Schema: `sql/261018-partner-lookup-mode.sql` adds `partner_lookup_logs.mode` and `tenants.partner_data_mode` (apply BEFORE the
code on staging/production, which run `DB_SYNCHRONIZE=false`; old code + new columns is safe).

Enabling for a pilot tenant: (1) apply the SQL; (2) add `tools` to the Anthropic engine's capabilities; (3) set the tenant's lookup
method to *AI-assisted* (the card warns if the engine cannot run tools); (4) watch the lookup logs and `retrieval_trace` (§6).
Rolling back: set the tenant back to Standard — or `PARTNER_TOOLS_ENABLED=0` for everyone.

## 4. When to use it, and when not

Use it for tenants whose users ask free-form or multi-part questions (rates for a weekend and the settlement for last month;
"how many bookings do I have next week and what's the cancellation fee"), where recall of the keyword detector is the limit.

Stay on prefetch when: cost or latency matters more than recall (tools mode adds ≥ 1 model round trip, typically 1–3 s);
the engine is a custom OpenAI-compatible endpoint nobody has exercised with tool calls; or the partner API's rate limit is tight —
a tools-mode turn can issue up to `PARTNER_TOOLS_MAX_CALLS` (4) lookups, against the proposed 20 requests/min/hotel.

## 5. What happens when something goes wrong

| Situation | Outcome for the customer | Logged as |
|---|---|---|
| Engine cannot do tools (stub, no engine, no `tools` capability, adapter without support) | prefetch answers as usual | `partner_lookup_logs` `tool_loop` / E5143 `tools_unsupported`; trace `partnerToolsFallback` |
| Engine fails or degrades to the stub mid-loop, response cut off by `max_tokens`, malformed tool use | loop aborted, **nothing the stub says is read as a tool call or a fact**; prefetch answers | E5143 `engine_degraded` / `truncated_response` / `malformed_response` |
| Model chooses no lookup | detected topic → prefetch fetches it (never less than the default mode); no topic → an ordinary turn | none (normal) |
| Model passes a hotel / property / tenant argument | refusal notice "I can only look up data for the hotel you are signed in with", no hand-off | row `rejected` E5104 `hotel_param` (keys only), mode `tool` |
| Role may not read the topic (prefetch) / model asks for a tool its role was not offered | the same role-denied notice as prefetch, no hand-off | row `denied` E5101 |
| Invalid arguments / unknown tool name | the model gets an error result and may correct itself within the limits | row `rejected` E5104 / E5144 |
| Partner down, unusable reply, throttled | "we will confirm" notice **+ hand-off** (same as prefetch); first failure cancels the turn's remaining calls | row `error` E5100/E5105/E5108 |
| Iteration / call / time limit reached | "we will confirm" notice + hand-off — a lookup that did not finish is never answered from part of its data | E5142 `iteration_limit` / `tool_call_limit` / `time_budget` |
| Figure in the final text that no tool result contains | answer withheld, "we will confirm" + hand-off | row `unverified` E5107, mode `tool` |

Guests, unsigned (v1) identities, expired claims and tenants with the lookup off never reach a tool call: the flags, the signed
identity and the claims check run before the mode is even consulted, and the pilot gate / guest gate run earlier still in `ChatService`.

## 6. Observability

- **Message trace** (`messages.retrieval_trace`): `partnerEvidence[]` (one entry per tool result — never in `citations`),
  `partnerMode: 'tools'`, `partnerToolLoop {status, reason?, iterations, toolCalls, tokensIn, tokensOut, elapsedMs}`;
  on a fallback `partnerMode: 'prefetch'` + `partnerToolsFallback: <reason>`.
- **`partner_lookup_logs`**: one row per tool call with the prefetch fields plus `mode='tool'`; loop-level events use topic `tool_loop`.
  `SELECT mode, status, COUNT(*) FROM partner_lookup_logs GROUP BY 1,2` is the first dashboard.
- **AI usage**: each planning call is metered like any gateway call under feature `partner_tool_loop` (function `rag`) —
  the AI usage summary (grouped by feature) shows the cost of tools mode separately from `chat_answer`.
- **Metrics**: `sharptalk_partner_tool_loops_total{outcome="data|failed|fallback", reason}`; engine calls also appear in `sharptalk_llm_calls_total{feature="partner_tool_loop"}`.
- **Audit**: `partner_data.mode_changed` (from → to) when a tenant changes the method.

## 7. Risks and known limits

- **Extra cost and latency** on every message that talks about a partner topic (a loose word list gates it — `looksLikePartnerQuestion`
  — so greetings and unrelated questions never cost a planning call; a how-to such as "how do I cancel a booking" does, and the model is
  expected to answer "no lookup").
- **The model picks the arguments.** A wrong date (for example "next Saturday") yields a correct-looking answer for the wrong date.
  The planner is told today's date and weekday in the hotel's time zone and the data rows carry their dates, but this
  is a quality risk, not a safety one. Lookup logs record the validated parameters, so a wrong date is visible after the fact.
- **Prompt injection through partner text.** Free text from the partner (policy `note`) is capped and cleaned and is wrapped as
  "data, not instructions". A model that obeys it still cannot widen scope: hotel-ish arguments are refused, roles are enforced, calls are
  capped. Worst case is a refused or degraded turn for that hotel's own chat.
- **PII.** The planning model sees the PII-scrubbed copy of the customer turn and history (a booking code that looks like a card
  number may be masked and therefore not passed as an argument) and the same projected, whitelisted tool results the answer step sees;
  results travel to the provider twice (planning and answering).
- **Sequential execution.** Calls of one response run one after another (determinism, rate limits, first-failure cancellation); with a slow partner
  API four calls can take long, bounded by `PARTNER_TOOLS_BUDGET_MS`.
- **Reuse is bypassed** for every turn that carries partner data (as in prefetch); a how-to turn where the model chose no lookup stays eligible.
- **Engine switching mid-turn** (the routing row changes between calls) is handled by the gateway refusing a tools request to a non-tool engine.
- The `tools` capability is read from a comma list on the engine row; there is no console field for it yet (platform admin API / SQL only).

## 8. Verified vs not verified

**Verified (local):** real `AnthropicAdapter`, `OpenAiAdapter`, gateway, loop, step, data service and topic registry driven through a
**fake Anthropic Messages API server** (real HTTP; enforces tool_use/tool_result pairing, tool-name and schema rules) and fake OpenAI/Chat-Completions
servers — single call, sequential calls, parallel tool_use, limits, hotel arguments, role denial, invalid arguments, partner 5xx/timeout,
degraded engine mid-loop, truncated/malformed responses, non-tool engines, wire snapshot of plain requests, token accounting, reuse bypass,
single moderation with the union protect list, number verification against the union; plus a real boot and an HTTP smoke on a scratch
database (seeded tenant, signed identify, the fake engine registered in `ai_engines`). Safety properties are pinned by mutation tests
(20 of 20 broken variants fail a spec). See `docs/test/TCR-261013-w2c-tool-loop.md`.

**NOT verified:** behaviour of the real Anthropic API (parallel tool use, `stop_reason` values, error shapes for tool pairing, whether a
given model follows the planner prompt and passes valid arguments, latency, cost); the real OpenAI / OpenAI-compatible tool-calling
shape; Go2Joy's real partner API under tools-mode burst patterns; model quality on Vietnamese / Korean planner prompts; the
console card in languages other than English and in a visible browser window (checked structurally, not by eye).
Before enabling for real users: run a handful of real questions against the staging engine with the lookup logs open and
compare tools mode with prefetch.

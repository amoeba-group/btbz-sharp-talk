# RPT-261013 — Pilot analytics by hotel / role / day + transcript export (SG-52, w2b)

- Basis: PLN-261012 §3.5 SG-52 · REQ-261012 §3.6 · wireframe W7. Tests: [TCR-261013-w2b-analytics-pilot](../test/TCR-261013-w2b-analytics-pilot.md)
- Branch: `feature/go2joy-s6-analytics-pilot` (base = `test/go2joy-integration` 5f9ebc3e). **Not deployed, not pushed, no PR yet.**

## 1. Summary

Go2Joy's two-week pilot is judged on numbers by hotel and by role, and graded by hand on transcripts. This stream adds both, plus four follow-ups wave 1 left behind.

| Area | What exists now |
|------|-----------------|
| `GET /analytics/pilot?group=hotel\|role\|day&from=&to=` | Read-only, tenant-scoped, same gate as the other statistics lenses (`analytics.read` + Statistics screen). Per group row and for the total: conversations; **AI-only resolved**; hand-offs with a count by reason; refusals by reason (guest-gate prompts and `role_manager_only` broken out); avg confidence and no-source rate; moderation blocked / edited; partner lookups (ok / denied / rejected / unavailable / unverified, by topic); CSAT (rated, avg); distinct signed-in users and guest sessions (counts only); P50 / P95 / max of answer time, total and per stage; **adoption** (hotels active vs the active pilot list, the silent hotels named). Legacy conversations without stamps form an `unknown` group; NULL or oddly-shaped trace JSON never fails a query |
| `GET /analytics/pilot/conversations.csv` | One row per conversation for manual grading. **master / director only** on top of `analytics.read`; audit row `analytics.pilot_export` (counts and window only). UTF-8 **with BOM**, stable column order, CSV-injection guard, transcript PII-scrubbed, 5,000-row cap with a truncation record + `X-Export-*` headers, streamed one page at a time with back-pressure |
| Console › Statistics › **Pilot** | Group selector, results + operations tables, adoption line "Active 9 / pilot list 12" with a drill-down of silent hotels, answer time by stage, definitions on the screen, export button (master / director), loading / empty / error / too-long-range states, toasts, i18n ×6 |
| Follow-up (a) | The five partner refusal reasons the partner step really stores are now members of the closed `REFUSAL_REASON` set (16 members); `PARTNER_REFUSAL_REASON` is derived from it; a notice-only partner refusal now carries `agentId` too |
| Follow-up (b) | `partner_lookup_logs` is purged with the conversation retention window |
| Follow-up (c) | `sharptalk_chat_turn_stage_duration_seconds{stage}` histograms on `/metrics`, fed from the same persisted turn latency |
| Follow-up (d) | Decision: analytics never read `customers`; see §6 |
| Schema | one additive index `conversations (tenant_id, created_at)` (EXPLAIN-driven, §5) |

### The definition that matters (full text: header of `analytics-pilot.util.ts`)

- **handed off** = escalated (the flag a hand-back never clears) **or** an agent wrote **or** `agent_id` set **or** a hand-off notice stored.
- **AI-only resolved** = not handed off **and** at least one knowledge-grounded AI answer (numeric `confidence` on an AI turn). It does **not** reuse `aiResolutionRate`, which scores an agent-closed thread as resolved.
- **refused** / **no answer** = the rest (sign-in or permission notices only / nothing grounded said). The four outcomes partition the conversations in every row and in the total.

## 2. Commits

| SHA | Subject |
|-----|---------|
| `f59f20b7` | feat(refusal): fold the partner-data refusal reasons into REFUSAL_REASON |
| `38d6c4c7` | feat(privacy): purge partner_lookup_logs with the conversation retention window |
| `fbae1f18` | feat(metrics): per-stage chat-turn latency histograms on /metrics |
| `13431bf3` | feat(analytics): pilot analytics by hotel/role/day + CSV export for manual grading (+ migration, init-sql, manifest) |
| `8b69683c` | feat(console): Statistics > Pilot tab (+ shared bounds in packages/types, locales ×6) |
| (docs) | docs: TCR/RPT-261013-w2b-analytics-pilot |

## 3. Files

- **New API** `apps/api/src/domain/analytics/`: `analytics-pilot.util.ts` (definitions, window, grouping, accumulation, adoption — pure), `analytics-pilot-csv.util.ts` (escaping, BOM, injection guard, scrub, transcript, row), `analytics-pilot-stream.util.ts` (back-pressure pipe), `analytics-pilot.queries.ts` (all SQL, raw and parameterised), `analytics-pilot.service.ts`, `analytics-pilot.controller.ts` (separate controller: `analytics.controller.ts` untouched), `analytics-pilot.mapper.ts`, `dto/request/analytics-pilot.request.ts`, `testing/pilot-fixtures.ts`, specs ×6 (one opt-in real-SQL spec).
- **API, small hunks**: `analytics.module.ts` (providers + `TenantPilotHotel`), `chat.service.ts` (import; two `observeTurnLatency(...)` wraps; the notice-only partner refusal trace — ≈ 12 changed lines), `privacy/retention.service.ts` (+ `privacy.module.ts`), `partner-data.constants.ts`, `observability/app-metrics.ts` + `metrics.registry.ts`, `chat/entity/conversation.entity.ts` (+1 `@Index`), `error-code.constant.ts` (E5140–E5141 appended at the end).
- **SQL**: `sql/261018-analytics-pilot-indexes.sql`, `sql/artefacts.tsv` (+1 line), `docker/init-sql/01-schema.sql` (+1 key).
- **types**: `common/pilot-analytics.ts` (+ spec; shared by API and console), `refusal-reason.ts` (+ spec pin), `index.ts`.
- **Console** `apps/web/src/domain/statistics/`: `PilotSection.tsx` (new), `StatisticsPage.tsx` (+ tab), `statistics.service.ts`, `statistics.hooks.ts`; `i18n/locales/{en,es,ko,vi,ja,zh}/statistics.json` (`section.pilot` + a `pilot` block appended at the end).

## 4. API contract

```
GET /api/v1/analytics/pilot?group=hotel|role|day (default hotel) &from=&to= &hotel_sn= &role=
  -> { group, window:{from,to,days,timezone}, rows:[PilotRow], totals:PilotRow, adoption,
       meta:{scanned,truncated,maxConversations,rowsTotal,rowsShown,defaultWindowDays,
             maxWindowDays,exportMaxRows,unrecordedReasons} }
GET /api/v1/analytics/pilot/conversations.csv?from=&to= &hotel_sn= &role=
  -> text/csv; charset=utf-8, attachment, X-Export-Rows, X-Export-Truncated
```
Window: default the last 14 days; maximum 92 days — beyond it **E5141** (never a silent clamp, so a 92-day number cannot be read as 120); unreadable / inverted / unknown group **E5140**. At most 50,000 conversations are scanned (the oldest of the window; `meta.truncated`), group rows are capped at 500, day grouping uses the tenant time zone (UTC when unset).
CSV columns, in order: `conversation_id, started_at, hotel_sn, role, ai_agent_id, language, outcome (ai_only|handoff|refused|no_answer), handoff_reason, refusals, csat, message_count, avg_confidence, transcript`. The brief's list plus `refusals` and `avg_confidence` (both help the grader).

## 5. Query plan and the one index

Measured on MySQL 8 with 100,000 conversations per tenant (details and the table in the TCR §5).

- The window read of `conversations` shows `type=ref key=idx_conv_tenant rows=99,498 Using filesort`: the whole tenant history is read for a two-week question, because `(tenant_id, hotel_sn, created_at)` cannot serve a date window without a hotel. → `idx_conv_tenant_created (tenant_id, created_at)` (range, no filesort): window read 526 → 254 ms, 14-day report 607 → 527 ms, 92-day (50k rows) 2.77 → 2.56 s. The gain is modest at 100k rows but it is the term that grows with history, and the other statistics lenses use the same predicate.
- `moderation_logs`: **no index**. The first EXPLAIN picked `idx_modlog_tenant` (99,626 rows, 7.2 s over 75 statements) because of stale statistics right after a bulk load; after `ANALYZE TABLE` it uses `idx_modlog_conv` (1,000 rows, 0.5 s) with or without a composite index. If a backfill ever leaves a deployment in that state: `ANALYZE TABLE moderation_logs;`.
- Day view was ≈ 2× slower than hotel view until a per-zone `Intl.DateTimeFormat` cache replaced a formatter built per conversation (405 ms now).

## 6. Follow-up decisions

- **(a)** `partner_role_denied`, `partner_claims_stale`, `partner_param_rejected`, `partner_unavailable`, `partner_unverified` — derived from the traces of `domain/partner-data`. Classification for analytics: the first three are notices (refusals); `unavailable` / `unverified` come with a hand-off and are counted as hand-off reasons. The `REFUSAL_REASON` pin and a new `partner-data.constants.spec.ts` (every error code E5100–E5108 + unknown maps to a member) keep the sets honest. A spec now forces every future member to be classified (hand-off XOR refusal).
- **(b)** `RetentionService` gets an optional **trailing** `@Optional()` repository (positional specs keep working); window = the conversation window; a failing delete is logged and never swallows the `retention.purge` audit row. Plain `DELETE … WHERE created_at < ?` (the table is one row per partner question, small; a batched delete was not needed). Verified on the real boot with rows aged 800 and 400 days.
- **(c)** `observeTurnLatency(buildTurnLatency(...))` at the two places the trace is built (answer + small-talk); null stages are not observed; ms → s; buckets have edges on the NFR-001 targets (2 s and 6 s). **Limitation (see §8):** refusals and hand-off notices persist no latency, so neither the histograms nor the P50/P95 here include those paths.
- **(d)** `EmbedService.identify` upserts a `customers` row (and `last_claims` with the `hotelSn`) for **any** signed hotel, listed or not — the pilot gate sits in chat. Decision: **the analytics do not exclude them because they never see them**: every figure starts from a conversation (the gate runs before one is created), distinct users come from sessions that produced a conversation, and "active" means a conversation — a hotel that signed in and never chatted is *silent* (covered by a test). Not changed (per brief). The residual issue is privacy footprint: non-pilot hotels leave customer rows. The opt-in `CUSTOMER_RETENTION_DAYS` anonymises aged ones; gating the upsert by the allowlist is the real fix (§8).

## 7. Deploy state and `## Migration`

| Environment | SQL | Code |
|-------------|-----|------|
| local | verified on scratch DBs (applied the real file, boot, SQL spec, volume run), then dropped | not deployed |
| staging | ⬜ not applied | ⬜ |
| production | ⬜ | ⬜ |

1. **Order: SQL before code** (staging runs `DB_SYNCHRONIZE=false`). The index is additive and online (InnoDB in-place): old code + new index is safe; new code + no index still works, only slower on a big tenant.
2. Apply `sql/261018-analytics-pilot-indexes.sql`. Idempotence: run only if `SHOW INDEX FROM conversations WHERE Key_name = 'idx_conv_tenant_created'` is empty (a re-run fails with "Duplicate key name"). No `AFTER`.
3. Rollback: `ALTER TABLE conversations DROP INDEX idx_conv_tenant_created;`
4. Check: `npm run migrations:manifest` then `git diff --ignore-space-at-eol --stat sql/artefacts.tsv` (one new line); `node scripts/check-migrations.mjs --json` against the target DB; `node scripts/check-initsql-drift.mjs`. New routes after deploy: `GET /api/v1/analytics/pilot` → 401 = deployed, 404 = not deployed.
5. No new environment variable. Everything is read-only; a tenant that never opens the tab pays nothing. The partner-log purge and the histograms run on the existing scheduler / `/metrics`.

## 8. Deviations from the PLN / brief, and risks

1. **"AI-only resolved" is stricter than the brief's literal "no escalation and no human-agent message"**: it also requires a grounded answer, otherwise a visitor who was only told to sign in would be counted as resolved by the AI. The table therefore has a **Refused / no answer** column, so AI-only + handed-off + refused + no-answer = conversations (the wireframe's 71% + 29% only sums to 100% when that column is zero).
2. **`pilot_denied` and `consent` cannot be counted**: those turns are neither stored nor sent anywhere (a log line only). The API returns `meta.unrecordedReasons` and the screen says so instead of printing 0. Counting them needs a persisted record or a metric labelled by reason (suggested: a counter in `PilotService` / the consent gate).
3. **Latency percentiles cover AI answer turns only** (small-talk and knowledge answers): refusal and hand-off turns persist no `latencyMs`. P95 therefore describes the answers the AI gave, not the whole conversation experience; NFR-001 "first answer ≤ 2 s" is only approximated by the `total` stage. Persisting latency on refusal/hand-off traces would close it.
4. **Separate controller** (`AnalyticsPilotController`) instead of new routes in `analytics.controller.ts`, to leave the shared file untouched.
5. **Scan cap**: past 50,000 conversations the numbers cover the **oldest** ones in the window (flagged `meta.truncated`; the screen warns). Adoption stays exact (its own distinct query).
6. **Index scope**: only `conversations`; `moderation_logs` deliberately not (§5).
7. **Console has no unit-test runner**: pure logic lives in `packages/types` (20 tests); the component was verified in the browser, not by tests.
8. **Strings are drafts**: the six locales were written here; Vietnamese is natural but none was reviewed by a native speaker.
9. **Doc language**: English (earlier RPTs mix Korean and Vietnamese).

## 9. VERIFIED / NOT VERIFIED

**Verified** (numbers in the TCR): tsc ×3 clean; API jest 4,191 passed (+197) with only the three known Windows baseline suites failing; types 407 (+21); common 64; widget 152; i18n complete; manifest +1 line and init-sql drift OK; real boot `successfully started` with both routes mapped; real SQL on MySQL 8 (8 cases, hostile JSON, tenant isolation, parameterisation); volume run with EXPLAIN; HTTP rank matrix, errors, CSV bytes (BOM, UTF-8, scrub, headers), audit row; real chat turns → `/metrics` histogram equal to the persisted latency; real retention purge of partner logs; browser: tab, group switch, drill-down, export + toasts, too-long range, empty, error + retry, Vietnamese; 21 mutation proofs (20 unit + 1 SQL).

**Not verified**: Excel/Sheets opening the CSV; staging/production data and volumes beyond the synthetic 100k per tenant; the saved file on disk after the browser download; the console as a manager; moderation rows produced by a live blocked answer (seeded rows used); native review of the translations; the Anthropic/Voyage path (stub engine only).

## 10. Open follow-ups

1. Gate `EmbedService.identify`'s customer upsert by the pilot allowlist (or purge non-pilot customers) — privacy footprint (§6 d).
2. Persist latency on refusal / hand-off traces, and record `pilot_denied` / `consent` turns (or a counter by reason), to complete SG-52/SG-53.
3. Add "hotels that **signed in** but never chatted" to adoption — `audit_logs` already holds `embed.identify_ok` with the hashed user and `hotelSn`; a cheap, richer silent-hotel signal.
4. 👍/👎 per answer is P3 (not part of this stream).
5. The opt-in SQL spec drops every table of the scratch DB it is pointed at (guarded: the database name must contain `scratch`); wire it into the coordinator's integration run if wanted.

## 11. Cross-stream conflict risks (for the integration merge)

- `chat.service.ts`: three small hunks (import line, two `latencyMs` wraps, the partner-notice trace) — w2c (tool loop) edits the same file.
- `error-code.constant.ts`: E5140–E5141 appended at the end — w2a appends E5135–E5139 at the same spot (trivial textual conflict).
- `packages/types/src/common/refusal-reason.ts` and its spec pin: w2a (access tiers) may add members — the pin list and the analytics classification spec (`REFUSAL_ONLY_REASONS` / `HANDOFF_REASONS`) must both be updated for any new member (the spec fails otherwise, by design).
- `conversation.entity.ts`, `docker/init-sql/01-schema.sql`, `sql/artefacts.tsv`: one appended line each.
- `statistics.json` ×6: `section.pilot` and a trailing `pilot` block.
- `retention.service.ts`: the new trailing constructor parameter comes after `optIn`; a later stream appending another must keep the order.

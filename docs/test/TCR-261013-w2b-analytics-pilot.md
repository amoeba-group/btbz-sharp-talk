# TCR-261013 — Pilot analytics (SG-52) + wave-1 follow-ups (w2b)

- Basis: PLN-261012 §3.5 SG-52 · REQ-261012 §3.6 · wireframe W7. Report: [RPT-261013-w2b-analytics-pilot](../implementation/RPT-261013-w2b-analytics-pilot.md)
- Branch: `feature/go2joy-s6-analytics-pilot` (base = `test/go2joy-integration` 5f9ebc3e). **Not deployed, not pushed.**
- Result: every case below passed. Mutation proofs: 21 / 21 reverted fixes turn their spec red.

## 1. Environment

| Item | Value |
|------|-------|
| Unit / integration | jest 29 (`apps/api`, `packages/types`, `packages/common`), node:test (`apps/widget`) |
| Real SQL | MySQL 8 (container `sharptalk_mysql`), scratch databases `scratch_w2b_sql` (SQL spec) and `scratch_w2b` (API boot) — both dropped afterwards, grants revoked |
| Boot | `DB_NAME=scratch_w2b DB_SYNCHRONIZE=true PORT=3032 ts-node` → `Nest application successfully started`, routes `GET /api/v1/analytics/pilot` and `/pilot/conversations.csv` mapped |
| UI | Vite dev server (port 5175) against the API on 3032, driven in the browser pane; seeded login of the scratch DB only |

## 2. Definitions under test (the numbers mean exactly this)

`analytics-pilot.util.ts` carries the contract in its header. The four outcomes partition the conversations: **AI-only resolved + handed off + refused + no answer = conversations**, per row and in total (tested for every grouping, in unit tests and on real rows).

| Term | Definition |
|------|------------|
| handed off | `escalated = 1` (a hand-back to the AI never clears it) **or** an agent message exists **or** `agent_id` is set **or** a hand-off-class notice is stored |
| AI-only resolved | not handed off **and** at least one AI turn with a numeric `confidence` (a knowledge-grounded answer). Deliberately NOT `aiResolutionRate` (`resolution.util`), which counts agent-closed threads as resolved |
| refused | not handed off, no grounded answer, at least one refusal notice stored |
| no answer | none of the above (small talk only, or still waiting) |
| hand-off reason | first hand-off-class stored reason; legacy escalation words mapped; fallback = reason on the `agent_alerts` row; else `unknown` |
| refusals | per turn, closed vocabulary, hand-off-class reasons excluded |
| answer / avg confidence / no-source | per AI answer; no-source = the answer cited no document (same rule as the question statistics) |

## 3. Unit cases (jest, no database)

### 3.1 `analytics-pilot.util.spec.ts` — 69 cases
| ID | Case |
|----|------|
| U-01 | AI answered and nobody touched it → AI-only resolved |
| U-02 | **Agent-closed thread is NOT AI-only** even though `resolution.util` scores it resolved |
| U-03 | A human message alone (escalated = 0, no `agent_id`) is a hand-off |
| U-04 | Escalation alone is a hand-off (customer waiting, nobody replied) |
| U-05 | Hand-back to the AI (agent_id cleared, `escalated` stays 1, agent message stays) does not erase the hand-off |
| U-06 | Stored hand-off notice counts even if the flag was lost |
| U-07 | Sign-in prompt = refused, not hand-off, not resolved; small talk only = no answer; a later grounded answer wins over an earlier refusal (prompt still counted) |
| U-08 | Hand-off reason: first by message order; partner causes kept apart; notice-only partner refusal is a refusal; alert fallback maps legacy `moderation_blocked`; non-hand-off alert word → `unknown`; stored notice beats alert |
| U-09 | **Vocabulary pin**: every `REFUSAL_REASON` member is classified exactly once (hand-off-class XOR refusal-only) — a new member forces a decision; the five partner reasons split notice vs hand-off as the partner step behaves; `consent`/`pilot_denied` declared unrecorded |
| U-10 | `normalizeStoredReason`: case/space, legacy words, unknown word → `other` (free text cannot split a chart), non-string/blank → null |
| U-11 | Window: default 14 days; only `to`; only `from`; exactly 92 days allowed, 93 refused `too_long` (no silent clamp); inverted/empty/future-from invalid |
| U-12 | Grouping: stamp = key; missing stamp = `unknown` (never an error); hotel serials exact (`HN1` ≠ `hn1`); day drawn in tenant time zone (20:00 UTC = tomorrow in Ho Chi Minh); unusable zone → UTC |
| U-13 | Accumulation: partition invariant; hand-offs per conversation vs refusals per turn; avg confidence / no-source per answer; null (not 0/NaN) when empty; CSAT avg+count; moderation sums; distinct users once per customer, guests as sessions, **no id in the row**; partner totals/outcomes/topics; finalize copies |
| U-14 | Percentiles per group: nearest-rank P50/P95/max per stage; a stage that did not run is absent (replayed answer ≠ instant retrieval); legacy rows → nulls; negative/NaN/∞ ignored; `parseLatencySample` accepts driver strings |
| U-15 | Row order: hotel/role by volume (unknown last on ties), day chronological |
| U-16 | Adoption math: "active 9 / list 12" + silent names; off-list hotels counted separately (never inflate adoption); empty list; exact serial compare; duplicates; names capped at 200 but counted fully, natural order |

### 3.2 `analytics-pilot-csv.util.spec.ts` — 43 cases
| ID | Case |
|----|------|
| C-01 | Escaping: comma, quote (doubled), LF, CR; plain bare; null/NaN empty; Vietnamese/Korean/emoji intact; CRLF records round-trip through an RFC-4180 reader |
| C-02 | **CSV injection**: `= + - @ TAB CR` prefixes get an apostrophe; numbers never; transcript lines start with a label |
| C-03 | UTF-8 **BOM** exactly once (bytes EF BB BF); **column order pinned**; every row has the header's width |
| C-04 | Row fields in order (`refusals` sorted → byte-identical re-exports); legacy row → empty cells, no `null`/`undefined`/`NaN`; **no customer/session id in the row** |
| C-05 | Truncation record: same width as the header, `#truncated` in the first cell |
| C-06 | **PII scrub** (11 kinds): email, VN mobile spaced 4-3-3 and unspaced, intl number, KR mobile, card, 9+ digit id, booking code, dated code, `#order`; URL query/fragment dropped, path kept; formatted money / rates / counts / ISO dates KEPT (grading needs them); idempotent |
| C-07 | Transcript layout: label + machine note (AI confidence, system reason), scrubbing of every sender, one line per turn, per-message cap with ellipsis, message-count cap with "N more", total cap < 32 767 (Excel cell limit), unknown sender capped, note cannot inject text |

### 3.3 `analytics-pilot-stream.util.spec.ts` — 7 cases
In-order write + `end`; **back-pressure** (does not pull the next chunk until `drain`); client hang-up during a full buffer does not wait forever; generator stopped on abort; **mid-file failure destroys the socket** (a failed download, not a short file that looks complete); empty chunks skipped; no listener leak.

### 3.4 `analytics-pilot.service.spec.ts` — 38 cases
Grouping & totals (hotel with `unknown`, role, day in tenant zone, bad zone, empty window, legacy rows with no facts at all, moderation/partner/CSAT/latency landing on the right group) · caps (cap + 1 read, `truncated` past the cap, exactly the cap not truncated, chunks of ≤ 1,000 ids, group-row cap 500 with `rowsTotal`, alert table asked only for escalations without a stored reason) · validation (14-day default, bare `to` includes the whole day, E5141 and no query, exactly 92 allowed, E5140 ×5 incl. hostile 200-char filter, trimmed filters) · adoption (repository list, exact when the main read is capped, tenant that never configured the pilot, **identify does not make a hotel active**) · tenant isolation (every scoped query gets the caller's tenant; message queries only see ids returned by the tenant-scoped conversation read) · mapper (camelCase, ISO window, `unrecordedReasons`, no customer/session/conversation id) · CSV export (cap + 1 plan without writing, exactly-cap has no trailer, validation before any byte, BOM+header first and pages of 200, trailer only when capped, scrubbed transcript + verdict, empty transcript row, no latency query).

### 3.5 `analytics-pilot.controller.spec.ts` — 17 cases
**Permissions with the real `AuthorizationGuard` against the real decorators**: report = manager and above; staff none; **CSV = master/director only** (manager refused); platform admin refused on both; `RequireMenu('statistics')` on both; capability is `analytics.read` (no new permission). Behaviour: DTO snake→camel, tenant from the principal, admin refused even if the guard were bypassed, CSV headers (`Content-Type`, `Content-Disposition`, `X-Export-Rows`, `X-Export-Truncated`, `Access-Control-Expose-Headers`), **audit row `analytics.pilot_export` = counts + window + booleans only** (no hotel serial, no content), nothing written/audited when the request is refused, mid-file failure → socket destroyed + audit `error`, hang-up → `aborted`, audit-write failure never fails the download.

### 3.6 Follow-ups
| ID | Spec | Cases |
|----|------|-------|
| F-a1 | `refusal-reason.spec.ts` (types) | pin updated to 16 members; the five partner reasons are valid refusal reasons |
| F-a2 | `partner-data.constants.spec.ts` | `PARTNER_REFUSAL_REASON` is exactly the five stored strings, all in `REFUSAL_REASON`; every error code the step can meet (E5100–E5108 + unknown) maps to a reason inside the closed set |
| F-a3 | `chat.service.partner-data.spec.ts` (+1) | a notice-only partner refusal carries the speaking `agentId` like every other stored refusal |
| F-b | `retention.service.spec.ts` (+5) | partner log purged at the **conversation** cutoff (30 d with `CONVERSATION_LOG_RETENTION_DAYS=30`, 365 by default); count in result and audit row; positional specs that predate the repository keep working (0, untouched); a failing delete never swallows the audit row |
| F-c1 | `app-metrics.turn-latency.spec.ts` | returns the same object; five stages observed once, ms → seconds; null stage not observed; NaN/∞/negative ignored; bucket edges on 2 s and 6 s (NFR-001); never throws; cardinality = 5 series |
| F-c2 | `chat.service.latency.spec.ts` (+3) | knowledge answer observes all five stages (retrieve 120 ms / generate 940 ms → 0.12 / 0.94 s); replayed answer skips retrieve/generate; small-talk reply observed |
| F-d | `analytics-pilot.service.spec.ts` | "identify does not make a hotel active": a listed hotel that signed in (customer row exists) but never chatted is silent; the report never reads `customers` |
| G | `pilot-analytics.spec.ts` (types, 20) / `error-code.constant.spec.ts` (3) | shared bounds/groups pinned, DST-proof range days (92 allowed, 93 not, "last 90 days" fits), percent/top-reasons helpers; **error codes unique** and E5140/E5141 pinned |

## 4. Real SQL on MySQL 8 — `analytics-pilot.queries.sql.spec.ts` (opt-in, 8 cases + 1 volume case)

Hand-built dataset (tenants 7 and 8, preview session, out-of-window and cross-tenant conversations, NULL traces, JSON `null` literal, array, scalar, string `confidence`, `reason` of the wrong type, legacy escalation with only an alert, partner logs, moderation rows incl. `delivered`):

| ID | Result |
|----|--------|
| S-01 | By hotel: exact counts for `1721` / `2204` / `unknown`; preview, out-of-window and other-tenant rows absent; handoff reasons incl. legacy alert fallback → `moderation`; refusals per turn; `answers` counts only numeric confidence (string `"0.9"` not counted); noSource; moderation blocked/edited (the `delivered` row and the other tenant's row not counted); partner totals/topics (`rates,bookings` splits); latency P50 and null retrieve not a 0 ms sample; distinct users/guest sessions |
| S-02 | By role; by day in `Asia/Ho_Chi_Minh` (03:00 UTC = 10:00 local) |
| S-03 | Partition invariant holds for hotel, role, day (rows and totals) |
| S-04 | Adoption: listed 3, active 2, silent `3099`; paused hotel and the other tenant's list excluded |
| S-05 | Hotel/role filter |
| S-06 | Export: 6 rows, correct outcome/reason/transcript, no other-tenant or preview text |
| S-07 | Hostile JSON of every shape never fails a statement |
| S-08 | **All statements parameterised** (no tenant/id/filter in the SQL text); `1721' OR 1=1 --` filter matches nothing |

Mutation of the SQL (drop the conversation query's tenant filter) → 4 of these fail.

## 5. Volume and EXPLAIN (synthetic: 200,000 conversations = 100,000 per tenant, 478,571 messages, 200,000 moderation logs, partner logs and alerts)

| Measurement (ms) | No new index, stale stats | No new index, fresh stats | With `idx_conv_tenant_created` |
|---|---:|---:|---:|
| report hotel, 14 days (7,784 conversations) | 1,445 | 607 | **527** |
| report role, 14 days | 1,287 | 546 | 405 |
| report day, 14 days | 1,926 | 1,257 (before formatter cache) | **405** |
| report hotel, 92 days (50,000 = cap, truncated) | 7,467 | 2,766 | **2,560** |
| CSV, 5,000 rows (truncated), 808,746 chars, largest chunk 36,664 | 2,591 | 331 | 340 |
| conversation window read (2 calls) | 746 | 526 | 254 |

- **Conversations window read**: EXPLAIN = `type=ref key=idx_conv_tenant rows=99,498 Using where; Using filesort` (the whole tenant history is read to answer a window). The existing `(tenant_id, hotel_sn, created_at)` index cannot serve a date window without a hotel. → migration `sql/261018-analytics-pilot-indexes.sql` adds `idx_conv_tenant_created (tenant_id, created_at)`; plan becomes a range with no filesort. The index is declared on the entity, added to `docker/init-sql/01-schema.sql` and to the artefact manifest.
- **`moderation_logs`**: the first EXPLAIN chose `idx_modlog_tenant` (99,626 rows) and the 75 statements cost 7.2 s — but that was **stale statistics after a bulk load**; after `ANALYZE TABLE` the optimizer uses `idx_modlog_conv` (1,000 rows) and the same statements cost 0.5 s, with or without a candidate composite index. **No index added**; the migration file documents running `ANALYZE TABLE moderation_logs` if a backfill ever leaves a deployment in that state.
- Message queries: `idx_msg_conv` range (≈ 12–30 ms per 1,000-id chunk); partner/alert queries ≈ 2–10 ms per chunk.
- Day view was ≈ 2× slower than hotel before a per-zone `Intl.DateTimeFormat` cache (a formatter was built per conversation); fixed.

## 6. HTTP on the real boot (scratch DB, 360 smoke conversations, 12-hotel pilot list)

| ID | Case | Result |
|----|------|--------|
| H-01 | `GET /analytics/pilot?group=hotel` (master) | 200 in ≈ 60 ms: 360 conversations, 71% AI-only (255), hand-off 17% (60), adoption 9 / 12, silent `1709 1710 1711`, unrecorded `consent`, `pilot_denied` |
| H-02 | `group=region` / 2026-01-01..10-01 / from after to | 400 `E5140` / 400 `E5141` / 400 `E5140` |
| H-03 | no token | 401 on both routes |
| H-04 | **rank matrix** (JWT of each rank) | manager 200 / CSV 403 · staff 403 / 403 · director 200 / 200 · master 200 / 200 · platform admin 403 / 403 |
| H-05 | CSV (master) | 200, chunked, `X-Export-Rows: 327`, `X-Export-Truncated: false`, BOM `EF BB BF`, 328 records, Vietnamese intact (`Hoa hồng hiện tại là 15%`), `[EMAIL]` / `[PHONE]` in place of the seeded address and number, **no leaked address/number/booking code**; one `audit_logs` row `analytics.pilot_export`, metadata `{rows, truncated, aborted, hotelFilter, roleFilter}` |
| H-06 | 3 real widget chat turns, then `/metrics` | `sharptalk_chat_turn_stage_duration_seconds` histogram present, `total` count 3 in bucket `le=0.25`, equal to the persisted `retrieval_trace.latencyMs.total` (133 / 124 / 158 ms) |
| H-07 | The same 3 turns in the report | land in the `unknown` hotel group with `latency.total.p50 = 133` |
| H-08 | `POST /privacy/retention/purge` (admin) after inserting two partner log rows aged 800 and 400 days | `partnerLookupLogs: 2` deleted, recent rows kept, `retention.purge` audit row carries `partnerLookupLogs: 2` |

## 7. Console in the browser (Vite + real API)

| ID | Case | Result |
|----|------|--------|
| B-01 | Statistics › **Pilot** tab | renders title, group buttons Hotel / Role / Day, export button (+ hint), adoption card "Active 9 / pilot list 12", results table with an "All" row first, operations table, stage latency table, definitions `<details>`, "not recorded" note |
| B-02 | "On the list but never chatted: 3 · Show these hotels" | expands to `1709 1710 1711` |
| B-03 | Group by Day | header becomes "Day", rows by date |
| B-04 | Export (master) | `OPTIONS` 204 + `GET …/conversations.csv` 200; button shows "Exporting…"; success toast "The CSV was downloaded." |
| B-05 | Custom range 2026-06-01.. (> 92 days) | warning "The pilot view reads at most 92 days at a time", the query is held (`enabled: false`; the screen shows only the warning, the network log of that state was not captured) (the export button is `disabled` for this state in the code; the disabled look was not separately observed) |
| B-06 | Future range (no data) | adoption "Active 0 / pilot list 12" with all 12 silent, table "No conversations in this range." |
| B-07 | Inverted range | server `E5140` → localised error "The request is not valid…" + **Try again** button |
| B-08 | Export with the inverted range | **sticky error toast** "The export could not be created. Please try again." with a dismiss button |
| B-09 | Language Vietnamese | tab, columns, adoption line, reasons all in Vietnamese ("Đã hoạt động 9 / danh sách thí điểm 12") |

## 8. Mutation proofs (each fix reverted, its spec must go red, file restored)

| ID | Reverted fix | Spec | Result |
|----|--------------|------|--------|
| M1 | human-message test dropped from "handed off" | util | 1 failed |
| M1b | `escalated` flag ignored (hand-back erases hand-off) | util | 5 failed |
| M2 | window cap off by one | util | 1 failed |
| M3 | CSV without BOM | csv | 2 failed |
| M4 | formula guard removed | csv | 6 failed |
| M5 | phone-like scrub removed | csv | 1 failed |
| M5b | shared `scrubPii` skipped | csv | 4 failed |
| M6 | null stage observed as 0 | app-metrics | 1 failed |
| M6b | histogram not fed from `chat.service` | chat latency | 2 failed |
| M7 | partner log not purged | retention | 3 failed |
| M8 | notice-only partner refusal loses `agentId` | chat partner-data | 1 failed |
| M9 | tenant forgotten on the moderation query | service | 1 failed |
| M10 | `REFUSAL_REASON` loses a partner member | types | 2 failed |
| M11 | CSV no longer needs master/director | controller | 2 failed |
| M12 | export leaves no audit row | controller | 2 failed |
| M13 | truncation record never appended | service | 1 failed |
| M14 | adoption compares serials case-insensitively | util | 1 failed |
| M15 | null stage counted as a 0 ms sample | util | 2 failed |
| M16 | back-pressure ignored | stream | 2 failed |
| M17 | mid-file failure no longer destroys the socket | stream | 1 failed |
| M18 | conversations query without the tenant filter | real SQL | 4 failed |

## 9. Gates

| Gate | Result |
|------|--------|
| `tsc -p tsconfig.check.json` api / web / widget | 0 errors ×3 |
| `jest` (apps/api, full) | 335 suites passed; 3 failed = known Windows baselines (`embed-loader`, `heic-conversion`, `board-attachment`, 3 tests); **4,191 passed** (baseline 3,994 → +197), 9 skipped (the opt-in SQL spec) |
| `jest` packages/types | 18 suites, **407** passed (baseline 386 → +21) |
| `jest -c jest.check.config.js` packages/common | 64 passed |
| widget `node --test` | 152 / 152 (untouched) |
| `npm run i18n:check` | es / ko / vi / ja / zh complete |
| `npm run migrations:manifest` + diff | one new line (`261018-analytics-pilot-indexes.sql index conversations idx_conv_tenant_created`); `check-initsql-drift` OK (212 artefacts) |

## 10. Not verified (explicitly)

- Opening the CSV in real Excel / Sheets (BOM bytes and UTF-8 round-trip verified in Node and over HTTP, not in Excel).
- Volume beyond the synthetic 100k conversations per tenant; staging / production data and statistics.
- The browser's file save on disk (the request returned 200 and the success toast showed; the saved file was not opened).
- UI as a manager (hidden export button): the rule is `rank === master || director`; the server refusal for a manager was verified over HTTP only.
- Moderation rows are seeded rows (shape from the entity), not produced by a real blocked answer in this run.
- Native-speaker review of the ko / ja / zh / es / vi strings (drafted here).

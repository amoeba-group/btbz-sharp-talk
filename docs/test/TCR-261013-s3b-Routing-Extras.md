# TCR-261013 — s3b: routing extras (unclaimed sweep, re-route, queue visibility, strict region mode, hotel→province CSV, per-team hours)

- Branch `feature/go2joy-s3b-routing-more` (base `f7266697`), PLN-261012 §3.3 SG-63, SG-64, SG-66, SG-67 + SG-65 leftovers.
- RPT: `docs/implementation/RPT-261013-s3b-Routing-Extras.md`. Everything below ran LOCALLY; nothing is deployed.
- Style: unit cases are real regression tests (in-memory tables via `apps/api/src/domain/agent/testing/fake-table.ts`, injected clocks). "Mutation" = the guarded line was temporarily broken and the test was seen to fail, then restored.

## 1. Unit cases (new: 232 API + 28 types)

| Area | Spec (count) | What it pins |
|---|---|---|
| Sweep timing / de-dupe / cap (SG-63) | `agent/unclaimed-plan.util.spec.ts` (17) | first page exactly at N min, boundary counts; later pages measured from the PREVIOUS page (never every tick); cap; a 2 h simulated wait pages at 5/10/15 min only; strict stays in region until the widening delay, then crosses; cap raised so a long widening still gets its crossing page; `0` = never; env parsing (blank = default, `0` = off, bounds) |
| Sweep service (SG-63) | `agent/unclaimed-sweep.service.spec.ts` (14) | runs the real query shape against rows with a manual clock: waiting+unclaimed only, off-hours email threads and legacy rows (no `escalated_at`) skipped, tenant gate, two instances at the same instant page once (conditional UPDATE), claimed-in-between is not paged, system audit, a failed page does not stop the pass, policy read failure skips the tenant, `ALERT_UNCLAIMED_MINUTES=0` touches nothing |
| Alert fan-out (SG-63/65/67) | `agent/agent-alert.service.routing-extras.spec.ts` (40) | strict ladder (label+region, label+nationwide, region assignees, region-scoped broadcast; NEVER the other region; suspended skipped; prefer unchanged); region fence on the feed (south agent / north agent / nationwide / other tenant); alert carries team, region, hint, partner; de-dupe still guards the at-least-once bus, re-route bypass settles + raises fresh (also when settling fails); `settle`; `pageUnclaimed` (broadcast, supersedes, UNCLAIMED text with Waiting/Team/Region/Partner lines, regional webhook, cross-region page reaches the other channel + shared one); staff region/status change re-points pinned alerts (fits / nationwide / claimed / suspended / strict); event wiring |
| Re-route + counters (SG-64/66) | `agent/agent-routing.service.spec.ts` (24) | moves to new team, WAITING, owner released (assignment `transferred`), clock + unclaimed counters reset, alert raised with `supersede`, new team's label/region, internal note + audit, region keep/set/clear, hint handling, AI-held thread allowed; refusals untouched: ended (E5125), unknown team/region (E5126), team routing off (E5129), other tenant (404); **authz** through the real `AuthorizationGuard` on `rerouteConversation` (staff+CS label yes, sales-admin yes, other label no, manager/master yes, platform admin no, "assign" still manager+); `queueCounts` aggregation + tenant/channel fence |
| Alert lifecycle (REQ D-20) | `agent/agent.service.alert-lifecycle.spec.ts` (8) | hand-back clears team/region/hint/escalated_at/pages and settles alerts; accept/assign ack them; end supersedes; refused hand-back changes nothing; escalate → accept → hand-back → escalate pages again |
| Queue filters / rows (SG-65/66) | `agent/agent-console.routing-extras.spec.ts` (10) | `unmapped` filter, `mine` resolved from the caller's `users.region` server-side (nationwide → all), row/alert JSON fields |
| Hand-off bookkeeping (SG-63/65/67) | `chat/chat.service.routing-extras.spec.ts` (21) | `escalated_at` stamped by the first hand-off only (repeat keeps original, preview never), hint persisted (bounded) for an unmapped province, `regionMode` on the event, region looked up BEFORE the route decision and route called with `{region, supportType}`, regional mailbox + per-team hours end to end through the REAL router, reply-channel check uses the thread's own team/region |
| Router (SG-67) | `ai-engine/handoff-router.service.routing-extras.spec.ts` (30) | hotel table keyed by the SIGNED hotelSn only (unsigned / name / code ignored), signed province wins, per-tenant 60 s cache incl. negative + invalidation + bound, per-team hours, regional mailbox, `routingPolicy` defaults (re-alert ON only where an alert can be pinned) |
| Config (SG-67) | `ai-engine/handoff-config.routing-extras.spec.ts` (42) | Slack host allow-list incl. look-alike hosts/userinfo/port/query; webhook sealed (random IV), never in clear, returned masked, mask echo keeps the stored one, cleared removes; `mode`, `widenAfterMinutes`, team hours (tz/clock/days/breaks), `emailByRegion`, `unclaimedAlerts` validation (E5095/E5128, details name the row); config with none of the extras stored as the same object |
| Hotel CSV (SG-67) | `ai-engine/hotel-province.service.spec.ts` (21) | header spellings/BOM/quotes, malformed rows with row numbers + machine codes, repeats vs conflicts, case-insensitive hotel_sn; dry run stores nothing and lists unmapped provinces; replace-all in ONE transaction (failure keeps the old table), tenant fenced, any malformed row refuses the upload, empty file refused, `clear`, UTF-8 check |
| Users event (SG-65b) | `user/user.service.routing-event.spec.ts` (5) | region / status change publishes `user.routing_changed` after the save |
| Console helpers (SG-65/66/67) | `packages/types/src/common/routing-console.spec.ts` (28) | team chips ("All teams 14 · CS 9 · Business 5"), region options + default `mine`, wait formatting ("07:42"), overdue, unclaimed summary, error-detail line for the toast, business-hours draft round trip |

Regression: all pre-existing suites touched by the change still pass (agent 19, chat 33, ai-engine 12, user 3 suites unchanged expectations; see §3).

## 2. Mutation evidence (key tests fail without the fix)

31 targeted mutations, each run against the specs above and restored: **31/31 caught** (2 were first found weak — the two-instance race test shared row objects by reference, and the de-dupe-bypass test passed through the settle step alone — and were strengthened, commit `b03ca7bf`).

Sweep: re-page every tick · no cap · page slot not taken conditionally (two instances double-page) · tenant gate removed · email threads paged. Alert: de-dupe bypass ignored · strict ladder treated as prefer · assignee not region-filtered · feed not fenced by region · region change keeps stale pin · settle closes nothing. Agent: hand-back leaves stale team/region · accept does not settle. Re-route: ended allowed · team not validated · no bypass · authorisation requires "assign". Chat: `escalated_at` overwritten on every hand-off · hint not persisted · route decided before region known. Router: table read for UNSIGNED claims · table beats a signed province · team hours ignored · regional mailbox ignored · cache never invalidated. CSV/config: malformed rows do not refuse · replace-all not transactional · webhook stored in clear · webhook returned unmasked · any webhook host accepted. Users: region change not published.

## 3. Suite numbers

| Check | Result |
|---|---|
| `tsc -p tsconfig.check.json` api / web / widget | 0 errors ×3 |
| API jest (full) | 255 suites, 2,713 tests: 2,710 pass; 3 fail = the known Windows baseline (`embed-loader`, `heic-conversion`, `board-attachment.service`), none mine |
| packages/types jest | 13 suites, 290 pass (28 new) |
| packages/common jest (`jest.check.config.js`) | 2 suites, 64 pass |
| widget `node --test test/*.test.mjs` | 61 pass |
| `npm run i18n:check` | es/ko/vi/ja/zh complete |
| `npm run migrations:manifest` + `git diff --ignore-space-at-eol sql/artefacts.tsv` | only the 6 new artefact rows (committed) |
| `vite build` (web) | builds (25 s) |

## 3b. Schema equivalence

Three databases, same `information_schema.columns` for `conversations(escalated_at, unclaimed_pages, unclaimed_paged_at, support_region_hint)`, `agent_alerts(target_region)`, `hotel_provinces`: (a) TypeORM synchronize at API boot, (b) base `docker/init-sql/01-schema.sql` + the three new SQL files applied in order, (c) the updated `docker/init-sql/01-schema.sql` — identical md5.

## 4. Real boot (scratch DB `scratch_s3b`, port 3027)

`DB_SYNCHRONIZE=true` boot → `Nest application successfully started`, `UnclaimedSweepService` log line, `HotelProvinceController` routes mapped; `SHOW COLUMNS` shows the new columns; scratch DB dropped afterwards (and the dangling grant revoked). `db_sharptalk` untouched.

## 5. HTTP smoke (38 checks, all pass) — sweep interval 5 s, wait limit 1 min for the run

Seeded scratch logins (staff north / south / sales-admin, `must_change_password=0` in the scratch DB only). Config: team routing + strict regions + widen 2 min.
1. E5095 with `details` naming `categories[0].provinces…`; E5128 for a bad team time zone.
2. Webhook: saved, returned masked, stored `enc:v1:…` (not in clear), masked echo keeps it, omission removes it.
3. CSV: dry run (3 rows, 1 unmapped, nothing stored); malformed upload refused (E5127, nothing stored); real upload replaces; summary count; staff cannot read/upload (403).
4. Hotel signed with no province → region from the hotel table (south) → alert to an online south agent, never the north one; a signed province wins over the table; an unlisted signed province persists the hint.
5. Strict: only a north agent online for a south hotel → region-scoped broadcast (`target_region=south`), hidden from the north agent, shown to the south agent; alert row carries team/region/partner.
6. Counters (`/agent/sessions/counts`), `support_region=mine`, `support_region=unmapped` (hint + age).
7. Re-route by a STAFF user with the CS label: waiting for Business, counters reset, old alert `superseded` + fresh `rerouted` alert, internal note, audit row; unknown team E5126; ended thread E5125.
8. Sweep: one UNCLAIMED page after the limit, region-scoped; no re-page ~11 s later; system audit; accept settles the alerts; hand-back clears team/region/`escalated_at`.
9. Moving a north agent to the south re-points the alert pinned to them (strict → region-scoped broadcast).

## 6. Browser smoke (Browser pane against the Vite dev server on :5127 + the scratch API)

Logged in as the scratch south staff user, then the seeded Master. The pane is only ~468 px wide (single column, layout not judged); text/DOM and screenshots were read.
- Alarm modal shows Team / Region (or "? (unlisted: Tp Quy Nhơn)") / Hotel / live "Waiting mm:ss" (red once past the limit) / "Alert for: South team only"; the UNCLAIMED and "handed over to your team" reasons appeared from the real sweep and re-route; the strict widening reached the south user after the 2-minute delay.
- Live chat: team chips with counts, "⚠ 3 unclaimed · oldest 11:06", region select with counts defaulting to "My region (South)", per-row team/region/⚠ Waiting badges, header Team/Region/Waiting, "Hand over to…" dialog (current team preselected, team + region selects) → handed over to Business (DB: waiting/business/counters 0, rerouted alert, note).
- Tenant Settings › Agent handoff (Master): re-alert select, strict mode + widen 2 + regional mailbox loaded from the saved config, hotel table card — bad CSV preview lists localized problems and disables "Replace the table"; good CSV preview + replace → toast "Hotel table updated: 4 hotels." and the DB rows (UTF-8); saving an over-long province shows the toast "The region table was not saved: categories[0].provinces entries are at most 80 characters"; a per-team hours toggle saved through the UI is stored on the option.

## 7. NOT verified

Real Slack/email delivery (no webhook/SMTP configured; the call path is unit-tested with a mocked `fetch`); a real two-instance race (unit-level only); wide-screen layout and mobile; the other five languages rendered in the UI (parity checked by `i18n:check` only); the re-route success toast text (code path + DB state verified, the transient toast was not captured); native file-picker (CSV set through a `DataTransfer`); performance at production volume; behaviour against real Go2Joy identify claims; anything on staging.

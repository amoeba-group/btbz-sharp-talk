# RPT-261013 — s3b: routing extras (SG-63 unclaimed sweep · SG-64 re-route · SG-66 queue visibility · SG-67 strict mode / hotel CSV / per-team hours · SG-65 leftovers)

- PLN: `docs/plan/PLN-261012-Go2Joy-Stage1-Gap-Closure.md` §3.3 · REQ D-10, D-20 · Test report: `docs/test/TCR-261013-s3b-Routing-Extras.md`
- Branch `feature/go2joy-s3b-routing-more`, base `test/go2joy-integration` `f7266697`. **Deploy state: NOT deployed, nothing pushed.**

## 1. Result

| ID | Delivered |
|---|---|
| SG-63 | `UnclaimedSweepService`: every `ALERT_UNCLAIMED_SWEEP_SEC` (30) finds WAITING, unclaimed, widget/messenger (not off-hours-email) conversations older than `ALERT_UNCLAIMED_MINUTES` (5; `0` = off), raises a FRESH broadcast alert (old open ones `superseded`) and posts "UNCLAIMED — Waiting N min (reminder k of m)" with Team/Region/Partner lines to Slack + email. De-dupe + cap (`ALERT_UNCLAIMED_MAX_PAGES`, 3) live on the row (`unclaimed_pages`, `unclaimed_paged_at`), taken with a conditional UPDATE → safe across restarts/instances. `conversations.escalated_at` is stamped by the first hand-off (`markWaiting`), reset by a re-route, cleared by hand-back. |
| SG-64 | `PATCH /agent/conversations/:id/routing {support_type, region?}` (`CONVERSATION_HANDLE`, so STAFF with the CS label may; "assign" stays manager+): validated against the tenant's team options (E5126), refused when ended (E5125) or team routing off (E5129); releases the holder, WAITING for the new team, ladder re-run, fresh alert with the de-dupe bypassed, audit `agent.conversation_rerouted`, internal thread note "Routed to Business Support (South) by <name>". `GET /agent/routing-options`. Hand-back now clears team/region/hint/clock; accept/assign/end settle the open alerts (so a later escalation is no longer swallowed by the de-dupe — REQ D-20). Console: "Hand over to…" dialog + toast saying who was alerted. |
| SG-66 | `GET /agent/sessions/counts` (per team, per region incl. none/unlisted, unclaimed, oldest wait, caller region); `support_region=mine|unmapped`; rows carry `escalatedAt` + hint; alert rows carry team/region/hint/partner/`targetRegion`. Console: team chips with counts, unclaimed summary, region select with counts defaulting to "My region", live waiting badge (amber ⚠ past the limit), alarm modal lines. |
| SG-65 | (a) `conversations.support_region_hint` persisted for an unmapped signed province → "?" badge (province in the tooltip) + `unmapped` filter. (b) staff region/status change publishes `user.routing_changed`; pending alerts pinned to them for the other region (or when suspended) are re-pointed by re-running the ladder without them (claimed/ended conversations → alerts settled). (c) api-client keeps the error `details`; the config-save toast reads "The region table was not saved: categories[0].provinces entries are at most 80 characters" (E5095/E5128). |
| SG-67 | (a) `regionRouting.mode: prefer|strict` (absent = prefer = today). Strict ladder: online label+region → online label+nationwide → configured assignees that are active AND of the region/nationwide → REGION-SCOPED broadcast (`agent_alerts.target_region`); the feed returns NULL-scope rows + the caller's region (all rows for staff with no region); the only cross-region path is the sweep's timed widening (`widenAfterMinutes`). Regional off-hours mailbox (`offHours.emailByRegion`) and regional Slack webhook (`regionRouting.slackByRegion`, sealed AES-256-GCM, `hooks.slack.com` only, returned masked). (b) `hotel_provinces` + `POST /ai-config/hotel-provinces/import?dry_run=` (`AI_SETTINGS_MANAGE`): dry-run report, transactional replace-all, any malformed row refuses the upload, explicit clear; `regionLookup` falls back to it ONLY by the SIGNED hotelSn, signed province wins, per-tenant 60 s cache; console card under the region table. (c) `teamRouting.options[].businessHours` overrides the shared hours per team (`route(tenant, lang, {region, supportType})`); console editor shared with the tenant hours (`BusinessHoursEditor`). |

## 2. Migration — apply BEFORE deploying the code (staging runs `DB_SYNCHRONIZE=false`)

Order (independent, any order is fine; all additive):
1. `sql/261017-conversation-escalated-at.sql` — `conversations.escalated_at`, `unclaimed_pages` (tinyint unsigned NOT NULL DEFAULT 0), `unclaimed_paged_at`, `support_region_hint` (four statements, one per column).
2. `sql/261017-agent-alerts-target-region.sql` — `agent_alerts.target_region varchar(16) NULL`.
3. `sql/261017-hotel-provinces.sql` — `CREATE TABLE IF NOT EXISTS hotel_provinces` (unique `(tenant_id, hotel_sn)`).

No `AFTER`; each file has an idempotence guard note and a rollback comment. `docker/init-sql/01-schema.sql` and `sql/artefacts.tsv` are synced; the three schema sources (entity sync, base + SQL, new init-sql) were compared and are identical. Old code ignores the new columns, so apply-then-deploy is safe.
`## Migration` for the PR: SQL paths above · per-env apply checkboxes (staging / production) · rollback = the DROP statements in each file (hotel table: DROP TABLE).
Note: conversations that were already WAITING at deploy have `escalated_at = NULL` — they show no age and are NOT swept (no burst of pages on deploy). Optional backfill if wanted: `UPDATE conversations SET escalated_at = created_at WHERE status='waiting' AND escalated_at IS NULL`.

## 3. Configuration / defaults

New env (CONFIG.md §4.2 and the Go2Joy example): `ALERT_UNCLAIMED_MINUTES` (5, 0 = off), `ALERT_UNCLAIMED_MAX_PAGES` (3, max 20), `ALERT_UNCLAIMED_SWEEP_SEC` (30). Strict-mode webhooks need `CRED_ENC_KEY`.
Backwards compatibility: a tenant with no hand-off config is untouched. **Decision (default ON only where an alert can be pinned to one person):** the re-alert runs for a tenant with assignees, team routing or region routing configured, unless `handoff_config.unclaimedAlerts=false` (or `ALERT_UNCLAIMED_MINUTES=0` globally); a tenant with none of them is off unless it sets `unclaimedAlerts=true`. Existing production tenants that already have assignees configured will start getting a re-alert after 5 min — set the env to 0 / the flag to false to opt out.

## 4. Deviations from the PLN / brief

1. Two extra `conversations` columns (`unclaimed_pages`, `unclaimed_paged_at`): the de-dupe/cap state lives on the row instead of Redis or an alert join — restart-proof and race-safe with a conditional UPDATE.
2. Re-route UI is a button + confirmation dialog, not an inline select (W6): a stray click on a dropdown must not page another team. Same data and toast.
3. The thread note is an INTERNAL note (`chat_comments`, console-only). A system message would be shown to the customer's widget (which would leak the agent's name).
4. The team chips replace the old team `<select>` (redundant); a team with zero conversations has no chip.
5. "Per-category configured assignees" (strict ladder step 3) = the tenant's assignee list filtered to ACTIVE users of the hotel's region or nationwide; presence is not required (the operator named them), as in the prefer ladder.
6. Re-route is allowed on any non-ended thread (including one the AI still holds → it becomes an escalation to that team), without an ownership check (same as `accept`), and does not apply off-hours email routing (an agent asked for that team now).
7. New alert status `superseded` (replaced/settled alerts); `acked` is kept for "someone took it".
8. Minutes/cap are global env only (no per-tenant override); per-tenant is on/off.
9. Slack webhooks: sealed + masked + Slack-host-only (credential + SSRF), which the brief did not spell out.
10. CSV: any malformed row blocks the replace (a replace-all must not silently drop a hotel); row numbers count non-blank rows (the CSV reader drops blank lines).
11. `partnerLabelOf` in chat.service now delegates to `global/util/partner-label.util.ts` (one wording for the escalation and the UNCLAIMED text); `tsconfig.build.json` excludes `**/testing/**`.

## 5. Files (81; main groups)

- Schema: `sql/261017-*.sql` ×3, `sql/artefacts.tsv`, `docker/init-sql/01-schema.sql`; entities `conversation`, `agent-alert`, new `hotel-province`; error codes E5125–E5129 (end of `error-code.constant.ts`); `EVENTS.USER_ROUTING_CHANGED`.
- API agent: `agent-alert.service.ts` (ladder/fence/settle/`pageUnclaimed`/re-point), new `unclaimed-sweep.service.ts`, `unclaimed-plan.util.ts`, `agent-routing.service.ts`, `agent-console.controller.ts`, `agent.service.ts` (small hunks: settle, hand-back clear, `unmapped` filter), `agent.mapper.ts`, DTOs, module.
- API ai-engine: `handoff-router.service.ts` (hotel fallback, route scope, `routingPolicy`), `hotel-province.{service,controller}.ts`, `hotel-province-csv.util.ts`, `handoff-config.util.ts`, `slack-webhook.util.ts`, `region-routing.util.ts`, `ai-config.service.ts` (mask/validate), `tenant-ai-config.entity.ts`.
- API chat/user: `chat.service.ts` (`markWaiting`, region lookup before route, hint stamp, route scope), `user.service.ts` (event).
- Types: `region.ts`; new `routing-queue.ts`, `error-detail.ts`, `handoff-hours.ts` (+ spec).
- Console: `LiveChatPage` (chips, region select, row badges, header, Hand-over), new `QueueBadges`, `RerouteControl`, `EscalationAlarm`, `HandoffSection` (+ new `BusinessHoursEditor`, `RegionStrictFields`, `HotelProvinceCard`, hooks/service), api-client (`details`), locales `livechat` + `aiSetting` ×6.
- Docs: `CONFIG.md`, Go2Joy env example, this RPT + TCR.

## 6. Commits

`4aa36ef5` schema/entities/types · `b5f2653d` hotel CSV, per-team hours, regional mailbox, strict config · `c8276c8d` sweep, re-route, counters, strict ladder, re-pointing · `b03ca7bf` mutation-hardened tests · `89d5f21d` CSV problem codes + pure console helpers · `0157af68` console · `302b832f` env docs + console-filter tests · (docs commit with TCR/RPT).

## 7. Verified vs not verified

VERIFIED (details in the TCR): tsc ×3; API jest (full: only the 3 known Windows baseline failures); types/common/widget tests; `i18n:check`; manifest; schema equivalence of entity-sync / SQL migrations / init-sql; real boot on a scratch DB; 31/31 mutations caught; HTTP smoke 38/38 on the real API (sweep, re-route, strict, CSV, webhook sealing, region-change re-point); browser smoke of the console (alarm modal, queue chips/counts/"my region"/badges, Hand-over, settings, CSV card, error-detail toast, per-team hours save).
NOT VERIFIED: real Slack/SMTP delivery; a genuine multi-instance race (unit-level only); wide/mobile layout (pane was ~468 px); UI rendering in es/ko/ja/zh (key parity only); the transient re-route success toast; native file picker; production-volume performance (`list()` now does one extra user read per poll, `counts` is two grouped queries per poll per agent); real Go2Joy identify claims; staging.

## 8. Follow-ups and cross-stream risks

- Follow-ups: optional `escalated_at` backfill; per-tenant minutes override; use `escalated_at` for time-to-claim in SG-52 analytics; surface the "on duty / region" effect on the Users screen; consider a Slack/email note to the NEW assignee on re-route.
- Conflict risks when merging: `error-code.constant.ts` (my block is at the end, as asked), `sql/artefacts.tsv`, `docker/init-sql/01-schema.sql`, locale JSON (keys appended at the end of `livechat` root/`team`/`region` and `aiSetting.handoff`), `chat.service.ts` (region lookup moved before `route`, `stampRegion` split into `lookupRegion` + `stampRegion`, `partnerLabelOf` body — s1b/s5d also touch it), `agent.service.ts` (accept/assign/end/handBack hunks — s5d), `agent-console.controller.ts`, `agent.module.ts` (now imports `AiEngineModule`), `infrastructure.module.ts` (EVENTS), `tsconfig.build.json`.

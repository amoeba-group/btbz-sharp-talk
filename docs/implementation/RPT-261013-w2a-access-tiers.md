# RPT-261013 — w2a: role-tiered knowledge access (SG-10, SG-11, SG-06)

- Date: 2026-10-13 · PLN: `PLN-261012-Go2Joy-Stage1-Gap-Closure` §3.2 (SG-10, SG-11) + §3.1 (SG-06) + wireframe W1 · REQ: D-06 (and D-15 for the over-fetch)
- Branch `feature/go2joy-s2a-access-tiers` (base `test/go2joy-integration` `5f9ebc3e`; **not pushed**, no PR)
- Detailed cases and results: `docs/test/TCR-261013-w2a-access-tiers.md`
- **Deploy state: not deployed anywhere.** Migration state: `sql/261018-kb-access-tier.sql` not applied to any shared DB (applied only to a scratch DB through `DB_SYNCHRONIZE`, dropped).

## 1. What changed

| Commit | Content |
|---|---|
| `c5bdba33` | **Types.** `packages/types/src/common/audience.ts`: `AUDIENCE`, `Audience`, `AUDIENCE_RANK` (public 0 / partner 1 / manager 2), `audienceOf(effectiveIdentity())`. `kb-access.ts`: reads a category's tier from `min_audience` + `guest_visible`, the `setAccess` column mapping, and the console's pure helpers (confirm / warning keys). `SCENARIO_AUDIENCE.MANAGER`, `GuestGuidance.managerNotice`, `REFUSAL_REASON.ROLE_MANAGER_ONLY` doc line. |
| `0745cd00` | **Schema.** `sql/261018-kb-access-tier.sql` (both columns, additive, nullable, no `AFTER`, idempotence guard + rollback in comments), entity columns with explicit `type`, `docker/init-sql/01-schema.sql`, `sql/artefacts.tsv` (+2 rows), error codes E5135, E5136. |
| `a50038bd` | **Retrieval, chat, reuse.** `RetrievalOpts.audience` + the manager-only exclusion in `baseQuery`; tier gate (`hasAudienceTiers`), vector over-fetch 8 → 24; chat passes `audienceOf(identity)` to `answer()` (both searches), the guest gate, the out_of_scope override and the reuse store; the managerOnly reply in the low-confidence branch; SG-11 history guard; `answer_reuse.audience_rank` stamped and compared; human replies not stored (signed hotel conversation / tiers exist); `knowledge.ask` threads an optional audience. |
| `393c560c` | **Scenario buttons.** `manager` audience shown AND enforced at press time (`ScenarioService.handle`), `getScenarioButtons`, `guest_guidance.managerNotice` sanitiser. |
| `77537468` | **Category access.** `PUT /knowledge/categories/:id/access`, `setAccess`, legacy `/guest-visible` compatibility, audit, merge guard, list/mapper report the tier. |
| `be6a9acd` | **Console (W1).** `CategoryAccessSelect` replaces the guest-visible toggle in `CategoryManagerCard`; AI settings gets the manager scenario audience and the manager-only prompt; i18n ×6. |
| `e7879cbc` | Test: the managerOnly chip survives the widget poll. |
| (docs commit) | This report and the TCR. |

### How it works (one paragraph)

Every turn computes `audience = audienceOf(effectiveIdentity(session))` (so claims lapsed after the 8 h limit read as `public`). `RagService` adds `NOT EXISTS (… kb_categories … min_audience='manager')` to `baseQuery` for any caller below manager — guests of `open` agents and the guest-gated path included — so the keyword leg, the vector re-hydration and every entry point (`answer()` both searches, `groundingConfidence`, `retrieve`, the out_of_scope override, console `ask`) obey it. A tenant with **no** manager-only category is searched byte-identically (the audience is dropped before the query is built). When the audience-scoped answer is not confident and the asker is a signed-in partner below manager, one extra grounding check with the manager audience decides whether to reply "ask your hotel's manager account" (+ the existing "Talk to an agent" chip, trace `role_manager_only`, no CS page) instead of a plain handoff. The reuse store stamps the generating rank and replays only to a viewer of equal or higher rank.

## 2. PHASE 0 — verification of the plan against the code (and what the plan missed)

**Every reader/writer of `guest_visible`** (by symbol): entity `kb-category.entity`, `KnowledgeMapper.toCategory`, `KbCategoryService.list/setGuestVisible`, controller `PUT categories/:id/guest-visible` + DTO, `RagService.baseQuery` (guest scope SQL — untouched), `ChatService` (via `guestOnly`), console card/hook/service + 6 locales, specs (`rag-retrieval-scope`, `kb-category.service.guest-audit`, `kb-category.service`), `261001-guest-login-gate.sql` and init-sql. Scenario audience: `ai-config.service` (`getScenarioForSession`, `sanitize`), `ai-config.request` DTO, `ScenarioButton` in the tenant-ai-config entity, console AI settings. **Not** readers/writers: bulk import/export (no tier/flag column), catalogue sync and `ensure()` (never write it — asserted).

| Plan / brief claim | Finding |
|---|---|
| The REQ/PLN live in `rb/docs/...` | They are not at that path in the `rb` worktree; the copies in the session scratchpad (`REQ-261012.md`, `PLN-261012.md`) were used. |
| `scenario.service.ts` has no audience check at click time | **Confirmed.** The widget only stops listing; the endpoint ran any action. Now enforced for `manager`. |
| s1b's fork creates a new SESSION on a role-only change | **Confirmed** (`principalChanged` compares role; existing test "the same user in ANOTHER role gets a new session"); a real-boot run shows two sessions/conversations. Chat-level isolation test added. |
| "History of the manager cannot enter the receptionist's prompt" | Holds for the fork. **A gap the plan missed**: claims that LAPSE mid-conversation (SG-03) keep the same conversation while the viewer reads as a guest, so the earlier manager turns would reach the model. Guard added (`historyReadableBy`), gated on the tenant having a manager-only category. |
| `groundingReport` exists | It does not (that is SG-51). The check uses `groundingConfidence(…, { audience: 'manager' })`. |
| `LEG_LIMIT=8` is taken before scoping | True **for the vector leg only**: the keyword leg is scoped in SQL before its `take`. Only the vector leg over-fetches. |
| `ingestReplyForReuse` stores human replies "with no audience" | Confirmed; and it also stores replies to a signed hotel user with no hotel dimension (s4's flag, REQ D-06). |
| PLN lists two SQL files (`261013-…`) | One file `261018-kb-access-tier.sql` with both columns, as the brief says. |
| Merge/rename of categories | Not in the plan. Merging a manager-only category into an open one would silently widen access: now refused (E5136). |
| Stored replays when a category is narrowed | Not in the plan. Answers cached while the category was readable by receptionists may quote it: `setAccess` to manager retires all the tenant's replays. |

## 3. Design decisions and deviations from the PLN

1. **`audienceOf` takes `effectiveIdentity()`'s result, not the session** (the brief); lapsed claims therefore read as `public`. Unsigned claims never raise the tier; a verified identity without claims (v1, Shopify, Cafe24) is `partner`.
2. **Byte-identical for a tenant with no tier.** The audience is resolved against the tenant (`hasAudienceTiers`, one indexed count per search, uncached) and dropped when there is no manager-only category, so `baseQuery` builds exactly today's SQL (frozen in a test). The same tier read gates the managerOnly re-check, the history guard, the reuse rank rule and the over-fetch. Failure to answer the question means "tiered" (fail closed).
3. **Manager exclusion has no `origin <> 'catalog'` clause** (unlike the agent scope): a restriction must not vanish when a category's origin flips. `setAccess` still refuses catalogue categories.
4. **Over-fetch 8 → 24** (`RagService.SCOPED_LEG_LIMIT`) applies when any scope is active on the search: an audience scope, the guest gate scope, or the s2b `hide` scope. The agent scope alone does not trigger it (would change every chat turn of every tenant).
5. **managerOnly branch** only for a signed-in partner below manager (`audience === partner`); a guest keeps the sign-in gate / handoff. Skipped for an engine outage and for an answer-first deny rule (the page is required anyway). Tenant wording: `guest_guidance.managerNotice` (per language, same card and tabs as the sign-in prompt), built-in fallback in 6 languages.
6. **Reuse.** Rank stored on every new AI answer; replay needs `viewerRank >= storedRank`; a NULL-rank row never replays once the tenant has a manager-only category; a lookup that forgets the rank reads as rank 0. Human replies: **never stored for a conversation with signed hotel claims** (this goes further than the plan and also changes behaviour for hotel tenants without tiers — D-06 / s4), and **never stored while the tenant has a manager-only category**; the rest are stamped with the conversation's rank (unreadable session → highest rank). The partner-data bypass of s4 is untouched.
7. **Scenario press enforcement is for `manager` only.** `guest` / `verified` stay presentation-only (they steer relevance, they guard nothing), so a stale "Sign in" button after sign-in is not newly broken. The press is judged on the script an action resolves to and on **every configured button, enabled or not**; refused only when all of them are manager-only. Soft reply, nothing stored; the admin preview sandbox is exempt.
8. **`setAccess`** writes `guest_visible` and `min_audience` together (public → 1/'public', partner → 0/'partner', manager → 0/'manager'). `kbAccessOf`: manager wins, then the flag decides public vs partner; NULL `min_audience` reads by the flag (no backfill). The legacy endpoint keeps its body and call, clears `manager` when it opens a category, demotes an explicit `public` on close, and — instead of a second audit row — extends its existing `kb.category_guest_visible_changed` row with `accessFrom/accessTo` when it lifted a manager restriction. The new action `kb.category_access_changed` is written once per real change.
9. **Console.** The old guest-visible hook, service method and 6 locale keys were removed (the endpoint itself still works for API clients). The select is a separate component (`CategoryAccessSelect`) so the existing card keeps a small diff; widening asks to confirm; every save/failure toasts (errors sticky).
10. **Operator view unchanged.** `knowledge.ask`, agent coaching (`ai-coach`), board review and golden runs pass no audience and still see everything; `ask()` accepts an optional audience (tested to reach retrieval) for SG-51's simulator.

## 4. Files

- Types: `common/audience.ts` (new), `common/kb-access.ts` (new), `common/enum.types.ts`, `common/refusal-reason.ts`, `index.ts`.
- API: `chat/rag.service.ts`, `chat/chat.service.ts`, `chat/chat.module.ts`, `chat/conversation-audience.util.ts` (new), `chat/scenario.service.ts`, `chat/scenario-scripts.ts`, `answer-reuse/answer-reuse.service.ts` + entity, `agent/agent.service.ts`, `ai-engine/ai-config.service.ts`, `ai-engine/scenario-audience.util.ts` (new), `ai-engine/entity/tenant-ai-config.entity.ts`, `knowledge/kb-category.service.ts`, `kb-access.util.ts` (new), `knowledge.controller.ts`, `knowledge.mapper.ts`, `knowledge.service.ts`, `dto/request/knowledge.request.ts`, `entity/kb-category.entity.ts`, `global/constant/error-code.constant.ts`.
- Console: `knowledge/CategoryAccessSelect.tsx` (new), `CategoryManagerCard.tsx`, `knowledge.hooks.ts`, `knowledge.service.ts`, `ai-settings/GuestGuidanceSection.tsx`, `ai-settings.service.ts`, locales `knowledge` + `aiSetting` ×6.
- Schema: `sql/261018-kb-access-tier.sql`, `sql/artefacts.tsv`, `docker/init-sql/01-schema.sql`.
- Tests: 13 new API spec files + 2 types spec files (TCR §1), 3 existing specs updated.

## 5. Results

| Check | Result |
|---|---|
| `tsc -p tsconfig.check.json --noEmit` api / web / widget, `packages/types` `tsc --noEmit` | 0 errors ×4 |
| API jest, full run | 343 suites / 4227 tests: 4224 pass, **3 fail = the known Windows baselines** (`embed-loader`, `heic-conversion`, `board-attachment.service`). Base was 3994/3998: +229 new cases here |
| `packages/types` jest | 19 suites / 417 pass (base 386: +31) |
| `packages/common` jest (`jest.check.config.js`) | 64 pass |
| widget `node --test test/*.test.mjs` | 152/152 |
| `npm run i18n:check` | complete in 5 languages vs English |
| `npm run migrations:manifest` | only the 2 new rows (+ `check-initsql-drift`: OK, 213 artefacts, 96 tables) |
| Real boot, scratch DB `scratch_w2a`, port 3031 | `Nest application successfully started`; both columns present; DB dropped, grant revoked |
| Mutation checks | 27 temporary reverts, 27 turned a test red (TCR §1) |
| Real-MySQL retrieval per audience, HTTP identify→chat per role, role-change fork, console API, audit rows, merge guard, replay retire | TCR §2 |
| Console in a browser | TCR §3 (DOM/a11y based; pane hidden, no screenshots) |

## 6. Migration (schema-changing change — `## Migration`)

- SQL: `sql/261018-kb-access-tier.sql` — `ALTER TABLE kb_categories ADD COLUMN min_audience varchar(16) DEFAULT NULL;` and `ALTER TABLE answer_reuse ADD COLUMN audience_rank tinyint DEFAULT NULL;`. Additive, nullable, no backfill (NULL keeps today's meaning), no `AFTER`.
- **Order: apply the SQL to the target DB BEFORE deploying the code** (old code + new columns = safe; new code + old schema = 500 on the first category or reuse read). Staging runs `DB_SYNCHRONIZE=false`, so it must be applied by hand there.
- Per-environment: [ ] dev `db_sharptalk` · [ ] staging · [ ] production (TBD). Guard each statement with `SHOW COLUMNS FROM … LIKE …`.
- Rollback: `ALTER TABLE kb_categories DROP COLUMN min_audience; ALTER TABLE answer_reuse DROP COLUMN audience_rank;` (code that already shipped treats the missing columns as an error, so roll the code back first).
- Behaviour after deploy: nothing changes until an operator sets a category to "Managers only" in the console. From that moment: that tenant's stored replays are retired, NULL-rank replays stop, human replies stop being recorded, and receptionists asking about the category get the manager-account line.
- Local note: `npm run migrations:manifest` was re-run and only the two new rows were added; `docker/init-sql/01-schema.sql` is in sync.

## 7. VERIFIED vs NOT VERIFIED

**Verified** (numbers above): the exclusion predicate on real MySQL for every audience; the whole chat path over HTTP for receptionist / manager / guest; SG-11 on a real boot; the console API contract, audit rows, merge guard and replay retirement; the console select, warning, confirm and toasts (DOM-level); 27 mutations.

**Not verified:** (1) real Voyage embeddings and a real Qdrant vector leg (local = stub embedder, count-based confidence; the over-fetch is asserted on the call, not measured); (2) a replay served from the real reuse store (unit + table-level only); (3) the widget drawing the managerOnly chip in a browser; (4) console screenshots; (5) anything on staging.

## 8. Open follow-ups / risks

- **`verified` / `guest` scenario audiences remain presentation-only at press time** (deliberate, §3.7); say if they should be enforced too.
- **Moving a document into a manager-only category does not retire stored replays** (only `setAccess` does); replays age out by `ANSWER_REUSE_TTL_DAYS` (30). A hook on document re-categorisation would close it.
- **Per-document tiers** are out (PLN: per category first). The CSV has no tier column; a new category from an import is "Signed-in partners" until opened/restricted in the console.
- **Agent coaching** (`ai-coach`) retrieves with no audience, as before: the human agent sees everything.
- **SG-51** (simulator `as_audience`, calibration) extends `Audience`; `ask()` already accepts it.
- The managerOnly line reveals that a manager-only topic exists — by design (PLN).
- **Cross-stream**: `chat.service.ts` (one low-confidence hunk, `audience` const, history line, five call-site args), `rag.service.ts` (opts interface, `retrieveHybrid`, `baseQuery`, constructor trailing repo), `kb-category.service.ts` (constructor trailing `AnswerReuseService`), `ChatModule` (`KbCategory` repository), `knowledge.json` (the six old guest-visible keys at the END of each file were replaced by the new block — another stream appending to the end of that file will conflict), `chat.service.guest-gate-flow/identity/partner-data` specs (one expectation each). The tool-loop stream (w2c) touching `rag.answer`/`chat.service` and the analytics stream (w2b) reading refusal reasons (`role_manager_only` is now emitted) are the likeliest conflicts.
- Noticed during the HTTP smoke: the **shared dev Redis** is not DB-scoped — a pilot-allowlist config cached by another stream's scratch run denied my hotel for about a minute ("This assistant isn't available for your hotel yet") until the cache entry expired. Not caused by this stream; worth knowing when several streams smoke at once.

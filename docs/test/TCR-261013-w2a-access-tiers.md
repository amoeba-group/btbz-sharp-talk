# TCR-261013 — Role-tiered knowledge access (PLN-261012 SG-10 / SG-11 / SG-06, REQ D-06), stream w2a

- Basis: PLN-261012 §3.2 (SG-10, SG-11) + §3.1 (SG-06) + wireframe W1; REQ-261012 §3.1, §3.2, defect D-06 (and D-15 for the over-fetch). Implementation report: `RPT-261013-w2a-access-tiers`.
- Branch `feature/go2joy-s2a-access-tiers` (base `test/go2joy-integration` `5f9ebc3e`). Nothing pushed, nothing deployed.
- Vocabulary: **audience** = `public` (rank 0, a visitor who never signed in) / `partner` (rank 1, any signed-in partner incl. a receptionist, a v1-verified user, a Shopify login) / `manager` (rank 2, signed role `manager` or `internal`). A KB category carries `min_audience`; only `manager` restricts reading.

## 1. Unit cases (jest) — 229 new API cases, 31 new types cases

| Suite | Cases | What it pins |
|---|---|---|
| `packages/types/src/common/audience.spec.ts` | 18 | `audienceOf`: guest → public; verified + SIGNED manager/internal → manager; receptionist → partner; **v1-verified (no claims) → partner**; **unsigned claims never raise the tier**; unrecognised roles (`admin`, `MANAGER`, ` manager`, `manager|1`, `''`) → partner; null/undefined → public; the three constants and the ranks 0/1/2 |
| `packages/types/src/common/kb-access.spec.ts` | 13 | `kbAccessOf` (NULL min_audience reads by `guest_visible`; manager wins even with a hand-edited `guest_visible=1`; explicit public/partner not believed without the flag; unknown value ignored), `kbAccessColumns` round-trip, `normalizeAudience`, the console helpers (`kbAccessConfirmKey` only when documents become readable by MORE people, `kbAccessWarningKey` only for manager) |
| `apps/api/.../session/identity.audience.spec.ts` | 7 | the REAL `effectiveIdentity` → `audienceOf` chain: fresh manager → manager, v1 → partner, claims past 8 h → **public**, the boundary (exactly 8 h valid, +1 ms lapsed), tenant policy moves the limit, unreadable `verifiedAt` → public |
| `apps/api/.../chat/rag-audience-scope.spec.ts` | 29 | the predicate: present for public/partner, absent for manager and for "no audience"; "NOT in the set" polarity; `(group, name)` match; **no `origin <> 'catalog'` clause**; own tenant parameter; applies to a **guest of an open agent** and on top of the gated path; applies to the vector re-hydration; **tier-less tenant: predicates equal today's** (frozen literal of the pre-change base query + equality with/without audience for public/partner/manager + the gated path); one tier read per search, none for the operator view / a manager; `hasAudienceTiers` fails CLOSED (no repo, failed read) and the exclusion then stays; **over-fetch**: `SCOPED_LEG_LIMIT === 24`, vector leg asked for 24 for audience scope / guest scope, 8 for operator view / manager / tier-less tenant; `groundingConfidence` and `answer()` carry the audience; **follow-up turn: contextual AND message-alone search both scoped** |
| `apps/api/.../chat/chat.service.access-tiers.spec.ts` | 46 | audience handed to `answer()` for guest/v1/receptionist/manager/internal/**lapsed manager (public)**; open-agent guest scoped; gated path `{guestOnly, audience}`; follow-up turn; out_of_scope override; **managerOnly reply**: system turn, 6 languages, tenant wording and per-language fallback, `agent_connect` chip, **reason `role_manager_only` + `actorRole` + `requiredRole`, no question text in the trace**, second grounding asked with the manager audience on the same agent, **no CS page** (no ESCALATION event, thread not set WAITING), the stored turn maps back to the same chip on the widget poll; not applied when the manager scope would not ground it, for a tier-less tenant, for a manager/internal, for a guest, on an engine outage, with an answer-first deny rule; no extra work on a confident answer; reuse: lookup rank 0/1/1/2, stored rank 0/1/2, lapsed manager stored as a guest; **SG-11**: role change on a new session = new conversation and the model sees no earlier turns (history read by conversation id only), lapse mid-thread and a manager-opened thread inherited by a receptionist withhold history, same role keeps it, a manager continuing a receptionist thread keeps it, tier-less tenant keeps it, unstamped thread never guarded |
| `apps/api/.../chat/conversation-audience.util.spec.ts` | 15 | `conversationAudience` / `historyExceedsViewer` matrix (no stamp = public, unknown stamp = partner) |
| `apps/api/.../answer-reuse/answer-reuse-audience.spec.ts` | 18 | tiered tenant: manager row never replays to rank 1 or 0, replays to 2; receptionist row replays to 1 and 2 not 0; public row to all; **NULL-rank row never replays**; a lookup that forgets the rank = rank 0; agent-less row; tier-less tenant: NULL rows replay as before, stored rank ignored, explicit public/partner categories are not a restriction; another agent's row still refused; stores the generating rank (NULL when omitted); **human reply not stored while tiers exist**, stored with its rank for a tier-less tenant |
| `apps/api/.../agent/agent.service.reuse-ingest.spec.ts` | 8 | a reply to a signed receptionist/manager/internal is NOT stored, even after the claims lapsed, nor when the conversation is stamped with a hotel; guest → rank 0, v1 → rank 1, unreadable session → rank 2 (fail closed) |
| `apps/api/.../chat/scenario.service.manager-audience.spec.ts` | 16 | **press-time enforcement**: guest / v1 / receptionist refused softly (system notice + chip, nothing stored, moderated, answered or opened); manager/internal run it; lapsed manager refused; judged on the script an action resolves to; scriptless `message` action; ordinary buttons untouched; another open button on the same action allows it; a **disabled** manager-only button still guards; unmapped action not judged; preview sandbox exempt; SessionService double without `identityOf`; tier-less tenant unchanged |
| `apps/api/.../ai-engine/scenario-audience.util.spec.ts` | 21 | show matrix (4 audiences × 3 viewers) and the press rule |
| `apps/api/.../ai-engine/ai-config.service.manager-audience.spec.ts` | 11 | menus for guest / v1 / receptionist / manager / internal / lapsed manager; the save sanitiser keeps `manager`, drops unknown; `guest_guidance.managerNotice` sanitiser (per language, trimmed, known languages, snake and camel spelling, alone is not "empty", no change to the stored shape without it) |
| `apps/api/.../knowledge/kb-category.service.access.spec.ts` | 34 | **`setAccess` writes both columns** for each tier, E5135 for 7 bad values with nothing saved, catalogue refused, tenant-scoped lookup; audit `kb.category_access_changed` (one row, user as actor, legacy rows read by flag, no-op not audited, system actor, failing audit does not fail the change); **narrowing to manager retires stored replays** (not for other moves, not for a repeated PUT, outage tolerated); **legacy `/guest-visible`**: clears manager and says so in ONE extended audit row, demotes an explicit public on close, leaves legacy NULL alone, an ordinary flip's audit row byte-identical; `list` reports `access`; **merge refuses to widen a manager-only category (E5136)**; `ensure()` never writes the tier or the flag |
| `apps/api/.../knowledge/knowledge.controller.category-access.spec.ts` | 15 | DTO accepts the 3 tiers and rejects 9 bad values; controller hands tenant/id/tier/user to the service and returns `access` + `minAudience`; the older endpoint's body and call unchanged |
| `apps/api/.../knowledge/knowledge-ask-audience.spec.ts` | 5 | `ask()` without audience = exactly the old call; each audience reaches the retrieval opts; carried next to a partner-data block |
| `apps/api/.../knowledge/kb-access.util.spec.ts` | 4 | exclusion SQL shape, tier counter |
| existing suites updated | 3 | `chat.service.guest-gate-flow.spec`, `chat.service.identity.spec`, `chat.service.partner-data.spec`: the retrieval options a turn hands to `rag` now carry `audience` (the contract changed on purpose) |

### Mutation checks (temporary revert, run, restore) — all 27 caught

| # | Mutation | Failing cases |
|---|---|---|
| M1 | `baseQuery` drops the manager-only exclusion | 9 |
| M2 | tier-less tenant keeps the audience (not byte-identical) | 5 |
| M3 / M3b | no over-fetch / `hasAudienceTiers` fails open | 2 / 1 |
| M4 | chat does not pass the audience to `rag.answer` | 9 |
| M5 / M5b | gate grounding drops the audience / out_of_scope override drops it | 2 / 1 |
| M6 / 6b / 6c / 6d | managerOnly never produced / pages CS / forgets the reason code / re-check runs for a tier-less tenant | 9 / 1 / 1 / 1 |
| M7 / M8 | reuse ignores viewer rank / NULL-rank rows replay | 5 / 1 |
| M8b / M8c | chat does not pass the viewer rank / does not stamp the generating rank | 4 / 4 |
| M9 / M9b | human replies recorded while tiers exist / recorded for signed-hotel conversations | 1 / 5 |
| M10 / M10b | press not enforced / widget no longer hides manager buttons | 9 / 6 |
| M11 | history guard removed | 2 |
| M12 / 12b / 12c / 12d | `setAccess` forgets `guest_visible` / legacy no longer clears manager / narrowing does not retire replays / merge may widen | 4 / 1 / 1 / 1 |
| M13 | `knowledge.ask` drops the audience | 4 |
| M14 / M14b | `audienceOf` trusts unsigned claims / makes v1-verified a manager | 1 / 10 |

## 2. Integration (real stack: MySQL 8 scratch DB `scratch_w2a`, API :3031 with `DB_SYNCHRONIZE=true`, dropped afterwards; stub AI engine and embedder — no Voyage key locally)

| # | Scenario | Result |
|---|---|---|
| I-1 | Real boot after the entity changes | `Nest application successfully started`; `SHOW COLUMNS`: `kb_categories.min_audience varchar(16) NULL`, `answer_reuse.audience_rank tinyint NULL` |
| I-2 | **The exclusion predicate executed on MySQL** (4 KB docs: one in a manager-only category, one in a guest-visible category, one in an ordinary category, one uncategorised; one search per audience through `RagService.retrieve`) | operator → all 4; `public` / `partner` → the manager document is **absent**, the other three present; `manager` → all 4; gate scope (`guestOnly`) → only the guest-visible one, with or without `audience`; `hasAudienceTiers(1)` = true, a tenant with none = false |
| I-3 | Grounding on the manager topic | partner scope 0.74 (unrelated hits), manager scope 0.86 |
| I-4 | HTTP chat, identify v2 (`/public/embed/identify`, HMAC) then `/chat/message` "How do I change the payout bank account for settlement?" | **receptionist**: system reply = the manager-account line, chip `agent_connect`, `escalate:false`; stored trace `{"reason":"role_manager_only","agentId":1,"grounded":0.62,"actorRole":"receptionist","requiredRole":"manager","threshold":0.45,"followUps":[…]}`. **manager**: the answer from the manager-only category (citation = the settlement document). **guest (open agent)**: `low_confidence` handoff, the manager document is not in the answer. With the partner-readable documents left active the receptionist is answered from those and never sees the manager one |
| I-5 | **SG-11 on the real boot**: the same person identified as `manager`, asks, re-identified as `receptionist` on the same token, asks | tokens differ (forked); conversations 7 (session 13, stamp `manager`) and 8 (session 14, stamp `receptionist`), 2 messages each; the receptionist is told to ask the manager account |
| I-6 | Console API: `GET categories` | each row carries `access` (`manager` / `partner` / `public`) |
| I-7 | `PUT /knowledge/categories/:id/access` manager → 200 with `access:"manager", minAudience:"manager"`; `{access:"owner"}` → 400 E5003 "must be one of public, partner, manager" | pass |
| I-8 | Legacy `PUT …/guest-visible` true on a manager-only row → 200 `guestVisible:true, access:"public", minAudience:"public"`; false → `partner` | pass (manager cleared, columns coherent) |
| I-9 | Audit rows | `kb.category_access_changed {from:partner,to:manager}`; ONE `kb.category_guest_visible_changed` for the legacy flip, extended with `accessFrom:"manager", accessTo:"public"`; the ordinary flip's row has no tier keys |
| I-10 | `POST /knowledge/categories/merge` manager-only source into an ordinary category | 409 **E5136** |
| I-11 | Stored replays: an active `answer_reuse` row (rank 1); `public → partner` change | row stays `active=1`; then `partner → manager` | `active=0` |

## 3. Console (browser tab on the shared pane, vite :5173 → API :3031)

The Browser pane was hidden, so the page could not composite frames: **no screenshots**; the checks read the DOM and the accessibility tree and drove the controls through the form tooling.

| # | Scenario | Result |
|---|---|---|
| C-1 | Knowledge › Categories | per-category select with the three options "Public / Signed-in partners / Managers only", the saved tier selected (Settlement = Managers only, Check-in = Signed-in partners, Public FAQ = Public); the explanatory line under "Mine" |
| C-2 | Manager-only row | the warning "Receptionists who ask about this will be told to ask their hotel's manager account." under the row (own line, buttons stay in place); absent for the other two |
| C-3 | A first run of this check showed Settlement as "Signed-in partners" — the list endpoint reports the derived `access` but no raw `min_audience`, and the select derived the tier locally. **Fixed** (`CategoryAccessSelect` prefers `access`); re-run correct |
| C-4 | Narrowing Check-in to Managers only | saved, warning appears |
| C-5 | Widening it back with the confirm declined | no request, the select snaps back to the saved value |
| C-6 | Widening with the confirm accepted | confirm text "Let every signed-in partner, receptionists included, read 1 document(s) that are manager-only today?"; toast "Category is now for signed-in partners."; row updated |
| C-7 | AI settings | scenario audience options: Everyone / Not signed in / Signed in / **Managers only**; the guest-guidance card has the "Manager-only prompt" textarea with its hint |

## 4. Edge cases covered on purpose

- **Fail-closed identity**: unsigned claims, an unknown role, a role with different case, claims past the max age and an unreadable `verifiedAt` never reach `manager`.
- **Tier-less tenant**: no predicate, no over-fetch, no extra embed, replays judged as before, history never withheld, scenario menu/press unchanged, merge unchanged. The SQL predicates of the base query are frozen in a test.
- **A failed or unavailable tier read** keeps the exclusion in the query (fail closed).
- **The vector leg**: Qdrant has no category filter; the scope is applied when the ids are re-hydrated, and the leg now looks 24 deep when a scope applies so in-scope documents are not starved by out-of-scope neighbours.
- **Operator view** (`knowledge.ask`, agent coaching, board review, golden runs) passes no audience and sees everything; an optional audience can be passed to `ask()` (the control itself is SG-51).
- **Legacy**: NULL `min_audience` reads by `guest_visible`; no backfill; the guest gate's SQL and spec are untouched.
- **A category flip is audited once**, never twice; narrowing to manager-only retires stored replays; merging a manager-only category into a more open one is refused.
- **Human replies**: never stored for a signed hotel conversation, never while a manager-only category exists.

## 5. Not covered / not verified

- Real **Voyage** embeddings and a real **Qdrant** vector leg (local runs use the stub embedder: confidence is count-based, so the receptionist's managerOnly branch was shown by leaving no partner-readable document; with Voyage the same branch is decided by the 0.45 floor on the manager-scope similarity). The over-fetch is asserted on the call, not measured against real neighbours.
- A replay served from the real reuse store (needs a non-stub embedder): proved by unit cases and by the retire-on-narrowing check on the real table.
- The **widget** rendering of the managerOnly chip in a real browser (the API response, the stored trace and the poll mapping are verified; `agent_connect` is the chip the widget already handles).
- Screenshots of the console (pane hidden).
- Staging / production behaviour, migration on a real staging DB.

# RPT-261013 — w3c: product fixes for the findings of the Go2Joy operations manual review

- Basis: the 22 findings in [RPT-261013-w3b-ops-manual](RPT-261013-w3b-ops-manual.md) §5 and the findings table of `apps/web/public/manual/go2joy-ops.en.md`; PLN-261012 SG-85 follow-ups. Test report: [TCR-261013-w3c-polish](../test/TCR-261013-w3c-polish.md).
- Branch `feature/go2joy-s10-polish`, base `test/go2joy-integration` `3666b043` (the base has since moved: it now also contains the w3a gate simulator; **nothing here was merged or rebased**). **Not deployed, nothing pushed. No schema change** (no entity, no SQL, `migrations:manifest` diff 0).
- Method: every finding was re-checked against the code before changing anything (the reviewers' claims were right, none was rejected); each fix has a test where the repo has a runner and was driven in a real Chrome on a seeded scratch stack where it is a UI behaviour.

## 1. Result at a glance

| Finding (w3b §5) | Verdict | What |
|---|---|---|
| 1 Role-label rename path (Go2Joy-facing promise) | **Fixed** | "Tên vai trò" dialog in Users & Labels, audited; localized default names; English-neutral seed |
| 2 Untranslated ranks and statuses | **Fixed** | Users, platform-admin tenant users, sidebar chip, My page, 6 languages |
| 3 (brief item 3) / 13 No staff display name | **Fixed** | Name on invite and edit, e-mail-words fallback for staff-facing text only |
| 4 Alarm shows raw partner role | **Fixed** | Manager / Receptionist / Internal staff |
| 5 Partner outage reads "low confidence" | **Fixed** | `partner_unavailable` / `partner_unverified` end to end |
| 6 Silent Accept failure at the cap | **Fixed** | Error toasts (Accept, End, Hand back), E5022 sentence x6 |
| 7 Team labels only for `cs` / `business` | **Fixed** | Tenant's own team names via `useTeamLabel` |
| 8 vi widget contact card with IVY placeholders | **Fixed neutrally** | No bundled values, card draws only what has a value; tenant-driven setting still open |
| 11 CONFIG path, 12 RUNBOOK 11 | **Fixed** | Docs corrected against the code |
| 14 English "AI configuration saved." | **Partly fixed** | Handoff card, AI setting, moderation rule, propose toasts localized; Knowledge's own English toasts open |
| 15 Staff Dashboard of zeros, 403 on `GET /users` | **Fixed** | KPI numbers not requested below manager; explanatory state; users list idle below manager |
| 16 Alarm preview is the team chip | **Fixed** | Preview = the question |
| 17 `[IVY Chat]` subject | **Subject fixed** | `ALERT_EMAIL_SUBJECT_PREFIX`, default `[SharpTalk]`; English-only body open |
| 18 Role options ignore renamed labels | **Fixed** | Team table and deny-list read the role names |
| 19 Language tabs open on KO | **Fixed** | Console language, EN fallback (4 editors) |
| 21 "OperationInfo" tab | **Partly fixed** | vi / ja / zh (en, es, ko keep the product's group names) |
| 22 "My region" hides the agent's own thread | **Fixed** | Filter also keeps held conversations |
| Guest policy hint wording (list item in brief 6) | **Fixed** | "Who can read" is "Public", 6 languages |
| 9 consent banner, 10 `EMBEDDER_DEGRADED`, 20 "self-declared" mark | **Open** | See §3 |
| 23 (new) Orders for Sales Admin | **Open, reported** | Found while verifying; see §3 |

## 2. What changed

### 2.1 Role names and staff names (findings 1, 2, 13, 18, 22)

- `packages/types/src/common/job-label-name.ts` (+ spec, exported from the index): `DEFAULT_JOB_LABEL_NAME` (Customer Support, Accounting, Operations, Sales Admin), `isDefaultJobLabelName` (also recognises the legacy Korean seed names), `planJobLabelRenames`, `hasBlankJobLabelName` (pure, so the dialog logic is tested in the shared package).
- API: `tenant.service.ts` and `seed.runner.ts` write the English defaults for new tenants / seeds only (existing rows untouched; a seeded scratch DB confirmed it). `UserService.updateLabel` trims, refuses blank (E5003) and duplicate (E5004, case-insensitive) names and writes `job_label.renamed` (code, old, new). `InviteUserRequest.name` (max 80), `PATCH /users/:id/name` (`USER_INVITE`, i.e. master and director; audit `user.name_changed` carries no name). `permission-matrix.ts`: director gains `label.edit` (see §5).
- `global/util/user-display.util.ts`: `displayNameOf` (real name, else the e-mail words, else null). Used by the re-route toast and thread note (`agent-routing.service.ts`), comment authors (`chat-comment.service.ts`), assignee and console thread senders (`agent.service.ts`). **The customer widget's `ChatService.resolveSenderNames` deliberately keeps the real name only** (the widget prints the agent name above the bubble; an address must not leak). Pinned by `staff-display-name.spec.ts`.
- Web (`apps/web/src/domain/users`): `UsersPage.tsx` (name over e-mail column, rank/status translated, "Tên vai trò" dialog, Name field in invite and edit, hidden/disabled below master/director), `users.hooks.ts` (`useJobLabels` shows the localized default or the typed name, `useRenameJobLabels`, localized toasts for invite / update / temp password / MFA, `useUsers` stays idle below manager), `job-label-name.ts`, `users.service.ts`; `TenantUsersPage.tsx`, `MyPage.tsx`, `layouts/Sidebar.tsx` translate the rank; `HandoffSection.tsx` reads the role names; locale `users.json` x6 (names, ranks, statuses, role-name dialog, localized defaults, meaning text, errors).
- `agent.service.ts` `listSessions(…, alsoHeldBy)` and `agent-console.controller.ts`: "My region" keeps the caller's own held conversations.

### 2.2 Alarm, queue and alerts (findings 4, 5, 6, 7, 16, 17)

- `chat.service.ts`: `EscalationReason` gains `partner_unavailable` / `partner_unverified`, published by `answerWithPartnerNotice` (it published `low_confidence`; the stored trace already said the right thing and was left as is). `refusal-reason.ts` `buildHandoffTrace` maps both. `agent-alert.service.ts` has the two alert-text reasons.
- `chat/escalation-preview.util.ts`: the preview is the customer's last message that is not a `team_choice` chip, used by `ChatService.escalate` and `AgentRoutingService.reroute` (the UNCLAIMED re-page copies it).
- `agent-alert.service.ts`: mail subject prefix from `ALERT_EMAIL_SUBJECT_PREFIX` (default `[SharpTalk]`, one line, 40 characters).
- Web: `live-chat.hooks.ts` (`useConversationActions` error toasts, E5022 sentence; `useTeamLabel`), `EscalationAlarm.tsx` (partner role label, two new reason sentences, tenant team names), `QueueBadges.tsx`, `LiveChatPage.tsx` (team badges); `livechat.json` x6.

### 2.3 Copy and consistency (findings 8, 14, 19, 21 and the guest policy hint)

- Widget: `ContactCard.tsx` + `lib/contact-card.ts`; the `contact.phone / email / hours / emailHours` keys were **removed** from the six widget bundles (empty strings would fail `i18n:check`), the card reads them with an empty default and draws only methods that have a value.
- Console: `lib/copy-lang.ts` (`useCopyLang`) for the Agent handoff card, Privacy Notice, AI agent greeting and scenario button labels; `ai-settings.hooks.ts` toasts and `live-chat.hooks.ts` propose toast localized (`aiSetting.json`, `livechat.json`); `aiSetting.json` `agents.guestPolicyHint` x6; `knowledge.json` `group.operation` for vi / ja / zh.
- Dashboard: `DashboardPage.tsx`, `dashboard.hooks.ts`, `lib/rbac.ts` (`analytics_read` capability, `canListOrders`); `dashboard.json` x6 (`noStats`).

### 2.4 Documentation (findings 11, 12 and the manual)

- `CONFIG.md` §4.2 (card path; `ALERT_EMAIL_SUBJECT_PREFIX`), five env examples (`ALERT_EMAIL_SUBJECT_PREFIX`; the IVY profile and the staging example keep `"[IVY Chat]"`), `docs/guide/RUNBOOK-261013-Go2Joy-SelfHosted.md` §11.1-11.3 (opt-in customer anonymisation and audit-log purges, the operator DSAR tool and its limits).
- `apps/web/public/manual/go2joy-ops.vi.md` / `.en.md` (+ regenerated `.html`): §1.4, §3.6, §3.9, §5, §6, §8.4, troubleshooting, glossary, appendices A-E; the English findings table has a Status column. **§0.3, §7.4 and the English "Test as" summary row were left untouched on purpose** (the simulator is being merged separately). 11 screenshots re-taken with the capture script (Users, alarm x3, queue chips x2, conversation header, re-route dialog and result, handoff card x2); the other 16 are unaffected.
- w3b's RPT §5 and TCR carry an update note pointing here.

## 3. Skipped, partly done, or open — and why

| Item | Why |
|---|---|
| Knowledge's English toasts (~20 strings in `knowledge.hooks.ts`) | Out of the brief's wording ("other Knowledge toasts" were a side remark); the file is the busiest of the parallel gate-simulator stream's neighbourhood, so a 20 x 6 string change there is better done after the merge. Listed in the manual's Appendix C |
| Tenant-driven phone / e-mail / hours for the contact card | Needs a schema or config field, a console editor and widget plumbing: a feature, not a polish. The brief allowed "neutral or tenant-driven"; neutral was done, no number invented. **Consequence:** IVY's deployment, which showed `1588-0000`, now shows only "chat with an agent" until that setting exists |
| Finding 9, default consent banner (CCPA text) | Selecting the `vn_pdpl` profile is the fix and it is Go2Joy's / counsel's decision (s5a §7); no code defect |
| Finding 10, `EMBEDDER_DEGRADED` never emitted | Needs the retrieval layer to report a vector-only outage; belongs to the resilience stream |
| Finding 20, "self-declared" mark | Legacy-data mark; retiring it is a product decision |
| Finding 17, English-only Slack / e-mail body | Localizing staff alerts is a feature (per-recipient language); only the brand prefix was a defect |
| Finding 21, category access select has no visible "Who can read" text | Layout decision; tooltip kept |
| **New: Orders for Sales Admin** | The menu logic grants SA the Orders screen, but `GET /admin/orders` requires `MODULE_OPERATIONS` (operations label, or master). SA gets a 403 on that screen (also seen in w3b's browser run). Fixing it means choosing a capability for SA, an RBAC decision. The Dashboard no longer calls the endpoint for such users |
| Slack / e-mail body in Vietnamese for the two new reasons | English only, like every alert body |

## 4. VERIFIED vs NOT VERIFIED

**Verified:** the numbers in TCR §1 (tsc x3, API jest with only the 3 baseline failures, types 451, common 65, widget 155, `i18n:check` complete, manifest no diff, real boot on the scratch DB); the 15 browser checks in TCR §2, including a real run of the seed, the re-route toast with names, the Accept error at the cap, the staff Dashboard with zero 403 responses, and the default language tabs in vi and en; the revert proofs.

**Not verified:** a live partner-data call (the two new alarm sentences were seen through seeded alert rows; the outage itself is a jest double); real Slack / SMTP delivery of the new reasons and of the prefix; the widget contact card in a browser; a director without the Users menu on the handoff card; languages other than vi and en in a browser; native-speaker quality of any new string (es, ko, ja, zh, vi are first-pass translations).

## 5. Deviations from the brief

- **Director may rename roles** (the brief says MASTER/DIRECTOR): the matrix change is one line plus a spec. The API already let a director invite and assign labels. The dialog is only reachable where the Users menu is granted, which is master-only by default, so in practice nothing widens until a tenant grants it. `POST /job-labels` (create) is covered by the same capability.
- **Per tenant, not per language**: a role has one stored name (`job_labels.name`, as the brief said to follow). The per-language part is the localized defaults for labels left alone; a typed name is the same in every language.
- **Name edit needs `USER_INVITE`** (master, director), not "self edit": there is no profile screen to hang it on.
- The preview-skipping change in `AgentRoutingService.reroute` and `listSessions(…, alsoHeldBy)` landed inside the first commit because they live in files that commit already touched; the commit messages say so.

## 6. Deploy state and migration

Not deployed. **No schema change, so no `## Migration` section is owed and no SQL has to be applied.** New optional env var `ALERT_EMAIL_SUBJECT_PREFIX` (default `[SharpTalk]`; in `CONFIG.md` §4.2 and the five env examples). **An IVY or staging deployment whose mailbox rules match `[IVY Chat]` must set `ALERT_EMAIL_SUBJECT_PREFIX="[IVY Chat]"`** before this ships, or its alert subjects change (the IVY profile and the staging example already carry it). The widget bundle loses the contact values: rebuild the widget image with the web image.

## 7. Cross-stream risk for the merge

- Shared files touched with small hunks: `agent-alert.service.ts`, `chat.service.ts`, `agent.service.ts`, `agent-routing.service.ts`, `agent-console.controller.ts`, `refusal-reason.ts`, `permission-matrix.ts`, six locale files each of `users`, `livechat`, `aiSetting`, `dashboard`, `knowledge`, the manual `.md`/`.html`, `CONFIG.md`, env examples. The most likely textual conflicts are the locale JSON (appended keys) and `chat.service.ts`.
- The w3a branch (gate simulator) is in `chat.service.ts` gate code, `KnowledgeQaPanel`, golden questions: none of that was touched here. The three simulator passages in the manual must be updated by the coordinator after the merge (left as instructed).
- The manual `.md` files were converted to LF (the converter expects LF; git normalises either way).

## 8. Follow-ups

1. Knowledge toasts x6 (after the merge). 2. Tenant-driven contact card (field + console editor + widget). 3. Sales Admin and `GET /admin/orders`. 4. `EMBEDDER_DEGRADED` emission. 5. Native-speaker review of the new strings. 6. Localized staff alert bodies. 7. Drive the partner-data outage end to end once the partner API (or a fake) exists.

## 9. Commits

| SHA | Subject |
|-----|---------|
| `925b36b5` | feat(console): role names dialog, localized default roles, staff display names (w3c, ops-manual findings 1, 2, 13, 18, 22) |
| `813fc86f` | fix(alerts): accept errors, partner-outage reason, question preview, team wording, subject prefix (w3c, ops-manual findings 4, 5, 6, 7, 16, 17) |
| `c08766f1` | fix(widget): the Contact support card no longer shows another company's phone and address (w3c, ops-manual finding 8) |
| `baafa844` | fix(console): staff Dashboard, language-tab default, localized save toasts, guest policy wording (w3c, ops-manual findings 3, 14, 15, 19, 21) |
| `ac1042df` | docs: ALERT_EMAIL_SUBJECT_PREFIX, CONFIG 4.2 card path, runbook 11 DSAR and retention (w3c, ops-manual findings 11, 12, 17) |
| `aa514a16` | fix(console): follow-ups found by the browser smoke (w3c) |
| `f2797e17` | docs(manual): re-take the 11 screenshots the fixes changed (w3c) |
| `60171f72` | docs(manual): align the Go2Joy operations manual with the fixed behaviour (w3c) |
| `21c34017` | test(agent): pin where staff names come from, and that customers never get the e-mail fallback (w3c) |
| (this commit) | docs: TCR and RPT for the w3c polish stream, status notes on the w3b RPT and TCR |

Cleanup done at the end of the stream: the scratch API (:3037) and Vite (:5177) were stopped, the Redis container `w3c_redis` removed, the scratch database `scratch_w3c` dropped and its grant revoked; `db_sharptalk` was never touched.

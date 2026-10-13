# Go2Joy Operations Manual (CS and Sales Admin) — English summary and go-live checklist for Amoeba

> Version 1.0 draft · 2026-10-13 · Companion to the Vietnamese manual [go2joy-ops.vi.md](go2joy-ops.vi.md) (PLN-261012 SG-85)
> Audience: Amoeba delivery and support team, and bilingual Go2Joy reviewers. The Vietnamese edition is the manual Go2Joy staff actually read; this page does not replace it.
> Status: draft for Go2Joy review. Nothing described here is deployed on a Go2Joy host; everything was built and tested locally. Labels quoted below are the English console labels; the Vietnamese labels are in the Vietnamese edition.

This summary lists the Go2Joy-specific console features built in the PLN-261012 effort, where each lives, who may use it, and what it does in one line. It then gives the checklist Go2Joy must complete before go-live, the verification status of the manual itself, the open questions for Go2Joy, and the label and behaviour problems found while writing the manual.

---

## Contents
1. [Feature summary](#1-feature-summary)
2. [Go-live checklist for Go2Joy](#2-go-live-checklist-for-go2joy)
3. [What was verified and what was not](#3-what-was-verified-and-what-was-not)
4. [Findings: wrong or missing labels and behaviours](#4-findings-wrong-or-missing-labels-and-behaviours)
5. [Open questions for Go2Joy](#5-open-questions-for-go2joy)
6. [Sources](#6-sources)

---

## 1. Feature summary

"Who may use it" follows the code: capability `CONVERSATION_HANDLE` needs the CS or SA label (staff rank is enough); `AI_SETTINGS_MANAGE` is master, director and manager; Settings screens are master and director by default; items marked "master" are enforced on the API by `@RequireRank(MASTER)`.

| Feature | Where in the console | Who may use it | One-line behaviour |
|---|---|---|---|
| On duty / Off duty switch | Live Chat, page header | Any user with the CS or SA label | Counts the user for routing only while on duty AND the console polled within 90 s (`AGENT_PRESENCE_TTL_SEC`); stored per account, never reset on logout |
| Chat escalation alarm, Accept | Modal on any console page; Live Chat header buttons | CS / SA | A directed alert shows only to its addressee, a broadcast to everyone; Dismiss only acknowledges the alert, Accept takes the conversation |
| Partner context header | Live Chat, list rows and conversation header | CS / SA | Role @ hotel (hotelSn) · province with a signed / self-declared / expired mark; signed claims lapse after 8 h by default |
| Team question | Customer widget; configured in Tenant Settings > Basic > Agent handoff | Customer; master, director configure | After an agent request, asks Customer Service vs Business; the choice is stored on the conversation |
| Routing ladder | Automatic | System | Label + same region + online, then label + nationwide, then configured assignees, then broadcast; never the other region in the first two rounds; max 3 conversations per agent |
| Unclaimed sweep | Automatic; Tenant Settings > Basic (Auto / On / Off) | System; master, director toggle | After `ALERT_UNCLAIMED_MINUTES` (default 5) re-broadcasts and posts "UNCLAIMED" to Slack/email, up to 3 times; skips off-hours email threads |
| Hand over to… | Live Chat, conversation header | CS / SA, staff rank included | Moves the conversation to another team/region, releases the holder, pages the new target, internal note + audit; customer is not told; not allowed once ended |
| Queue counters, My region | Live Chat, list header | CS / SA | Team chips, "N unclaimed · oldest mm:ss", waiting badge turning red after 5 min; My region is the default filter for staff with a region and hides other and unknown regions |
| Off-hours handling | Customer widget; Tenant Settings > Basic business hours, off-hours email | Customer; master, director | Customer is asked for an email; summary goes to the off-hours mailbox (regional one if set); the agent's console reply is emailed; no Slack page, no unclaimed re-alert; no holiday calendar |
| Users & Labels | Users & Labels | Master by default | Roles CS / SA / Others, Region North / South / Nationwide, duty column; label display names are database data (default Korean), renamed only through the API |
| Agent handoff settings | Tenant Settings > Basic > Agent handoff | Master, director (menu); API needs `AI_SETTINGS_MANAGE` | Assignees, unclaimed switch, business hours, off-hours email and notice, team table (max 4, per-team hours), region table with Load Vietnam preset and Try a province, strict mode with widen minutes, per-team mailbox and Slack webhook |
| Hotel → province CSV | Same card, under the region table | Master, director | Dry-run preview then replace-all; any bad row blocks the upload; matched by signed hotelSn only; a signed province wins over the table |
| Guest policy ("guide to sign in") | AI Settings > AI agents > edit > Visitors who are not signed in; Guest guidance card | Master, director, manager | Anonymous or lapsed visitors are answered only from Public categories, otherwise given the sign-in prompt without an LLM call; gate threshold not yet calibrated with real embeddings |
| KB category access | Knowledge > Categories > Who can read | Master, director (`KNOWLEDGE_SOURCE_MANAGE`) | Public / Signed-in partners / Managers only; new categories start as Signed-in partners; a receptionist asking a manager topic gets the manager-account line, no CS page |
| KB UI version stamping | Knowledge document editor, list column and filter; AI Settings > Reference UI version | Knowledge managers stamp; manager+ sets the reference | Equality-only match (case and leading v ignored); mismatch adds one fixed sentence after moderation or hides the document; unversioned documents are never flagged in answers; version axis undecided |
| "Test as" gate simulator | Knowledge > Ask the knowledge base | n/a | **Not present in this build**; arrives with the gate simulator. The current panel asks as an administrator |
| Signed sign-in (SSO) policy | Tenant Settings > Widget | Master edits, director views | Claims max age (default 8 h, 1 to 720) and the refuse-v1 switch; per-process cache about 15 s |
| Pilot scope by hotel | Tenant Settings > Widget | Master edits, director views | Allow-list matched against the signed hotelSn on every turn; hide the widget or show a notice; hotel list changes apply immediately |
| Partner data lookup | Tenant Settings > Other settings | Master only (the card is hidden from other ranks) | Read-only; hotel always from the signed identity; mock (sample hotels) until Go2Joy's API exists; when down: fixed notice + hand-off, no guessed figures |
| Answer contact footer | AI Settings | Manager+ | One fixed contact block appended to every KB answer after moderation, after the version caveat |
| Privacy notice (vn_pdpl) | Tenant Settings > Privacy Notice | Master, director | Vietnam profile with server-filled retention and AI region; changing the version forces re-consent; wording is draft pending counsel |
| Operator DSAR | Tenant Settings > Data requests | Master, director | Look up (masked), export, erase (permanent anonymisation, typed customer-id confirmation); every step audited; no per-customer legal-hold flag |
| Statistics > Pilot | Statistics > Pilot | Manager+ view; master, director export | AI-only resolved vs handed off vs refused vs no answer by hotel, role or day; silent hotels; per-conversation CSV for manual grading (5,000 rows, BOM, scrubbed transcript) |
| Incident handling | Alarm reason lines; documents | CS / SA | AI outage: fixed Vietnamese notice + hand-off; moderation block keeps the draft; suspected exposure: stop, record time, call the incident commander, 72 h PDPD clock |

---

## 2. Go-live checklist for Go2Joy

The Vietnamese edition (appendix B) carries the same list for Go2Joy staff. Tick when decided and write the answer next to the item.

**A. Contacts and incidents**
- [ ] Incident commander, DPO / legal, infrastructure on-call and Amoeba support contact filled in (`docs/guide/INCIDENT-RESPONSE.md` section 6, `RUNBOOK-261013-Go2Joy-SelfHosted.md` section 10.4, manual section 10.3); the 72 h notification channel and form confirmed by counsel
- [ ] DSAR owner named; an external DSAR register exists (restoring a backup undoes erasures)
- [ ] Ops alert channel (`OPS_ALERT_EMAIL` or `OPS_ALERT_WEBHOOK_URL`) set for AI, backup and dependency alerts

**B. Hours and mailboxes**
- [ ] CS and SA hours (they may differ per team), time zone `Asia/Ho_Chi_Minh`, break, and a procedure to change hours before public holidays (the system has no holiday calendar)
- [ ] Off-hours mailbox is a shared inbox checked every morning; regional mailboxes (North, South) supplied if wanted; SMTP (and Slack, regional webhooks if used) configured and test-sent
- [ ] Vietnamese off-hours notice approved, or the default accepted

**C. People**
- [ ] Job labels renamed to CS and SA through `PATCH /api/v1/job-labels/:id` (no console screen); the two customer-facing team names confirmed
- [ ] Users created with rank, role and region (there is no field for a display name, see finding 13); passwords changed; MFA if enforced (master and director only, once enforcement starts)
- [ ] At least one CS and one SA per region per shift; decision for when no SA is on duty
- [ ] Staff trained: exercises 1 to 10 and the quiz in the Vietnamese edition

**D. Hotels and regions**
- [ ] Pilot hotel list (hotelSn) entered; Hide widget vs Show notice decided; Vietnamese notice approved
- [ ] Hotel Admin signs identify v2 with hotelSn, role and, if available, province; recall timing for `identify` agreed (open item R7)
- [ ] If the province is not sent: hotel → province CSV uploaded
- [ ] Region table loaded from the Vietnam preset and checked against the exact province spellings Hotel Admin sends (old names, abbreviations); default (prefer) vs Strict decided, widen minutes chosen

**E. Knowledge**
- [ ] Categories created with tiers set before documents are loaded; list of Managers-only topics agreed (settlement, bank accounts)
- [ ] UI version axis chosen (v23.x vs v0.x), documents stamped, reference version and mode (caveat or hide) set
- [ ] Answer contact footer and Guest guidance (login URL, sign-up URL, notices) entered in Vietnamese
- [ ] Guest gate threshold calibrated with real embeddings on staging **before** enabling "Only guide them to sign in or register"

**F. Privacy and legal**
- [ ] `vn_pdpl` profile selected; controller line filled so no `[[…]]` placeholder remains; counsel and a native speaker reviewed all lines
- [ ] Retention periods decided and set (conversation logs; opt-in customer and audit-log purges are off by default); cross-border and impact-assessment decisions recorded
- [ ] Consent version bumped once after the wording is final

**G. Sign-in and partner data**
- [ ] Claims max age confirmed (default 8 h); date set for turning on "refuse sign-in without hotel and role (v1)"
- [ ] Partner data lookup stays **off** until Go2Joy delivers the API (R8/R9) and Amoeba confirms live mode; never enable it in mock mode for real partners
- [ ] Values shown in the widget "Contact support" card (phone, email, hours) are Go2Joy's, or that card is not enabled (the vi widget default holds IVY placeholders)

---

## 3. What was verified and what was not

**Verified (against code on this base, 689e9530):** every console path and label quoted in the Vietnamese edition was read from `apps/web/src/i18n/locales/vi/*.json` and the components; every behaviour statement was traced to code or to an RPT/TCR under `docs/` (Vietnamese edition, appendix D, lists chapter by chapter).

**Verified in a browser:** see RPT-261013-w3b-ops-manual for the screens that were captured on a scratch database (sample data only) and what each showed.

**Not verified:**
- Anything on a Go2Joy host or on staging; real Anthropic / Voyage; real Slack and SMTP delivery
- The claim that the first console user in the morning sees the alarm modal for overnight off-hours requests (derived from code, not run end to end)
- Presence under long-hidden tabs or sleeping laptops in specific browsers
- Go2Joy's real partner API: contract, error codes and signature are Amoeba's assumptions
- Native-speaker quality of the Vietnamese console strings and of this manual

---

## 4. Findings: wrong or missing labels and behaviours

Found while writing the manual. None was fixed in this stream (documentation only).

| # | Finding | Evidence | Suggested follow-up |
|---|---|---|---|
| 1 | Job label display names default to Korean and there is no console screen to rename them | `seed.runner.ts`, `tenant.service.ts` `DEFAULT_JOB_LABELS`, `job-label.controller.ts` | Rename via API before go-live, or add a rename UI |
| 2 | Rank (`master` / `director` / `manager` / `staff`) and status values are shown untranslated in the Vietnamese Users screen | `UsersPage.tsx` | Add vi labels |
| 3 | Accept, End and Hand back have no error handling: at 3 concurrent conversations Accept is refused (409, E5022) and nothing is shown | `live-chat.hooks.ts` `useConversationActions` | Toast the error |
| 4 | The alarm modal shows the partner role as the raw code (`manager`, `receptionist`) | `EscalationAlarm.tsx` | Use `partner.role.*` |
| 5 | A partner-data outage hand-off reads "AI could not find an answer in the knowledge base" in the alarm; the real cause is only in the last system message | `answerWithPartnerNotice` hands off with `low_confidence` | Add an alarm reason line |
| 6 | The Guest policy hint (vi and en) still says categories marked "Guest-visible"; the control is now "Who can read: Public" | `aiSetting.json` `agents.guestPolicyHint` | Update both |
| 7 | Team chips and the alarm only have console labels for team ids `cs` and `business`; other ids render raw | `livechat.json` `team.*` | Keep the ids or add labels |
| 8 | The vi widget "Contact support" card holds IVY placeholder values and is not tenant-configurable | `apps/widget/src/i18n/locales/vi.ts` | Replace or make configurable |
| 9 | The default consent banner (vi) still carries CCPA / Google Analytics / 365 days / United States text until `vn_pdpl` is selected | widget `vi.ts`, RPT-261013-s5a §7 | Select the profile before go-live |
| 10 | `REFUSAL_REASON.EMBEDDER_DEGRADED` is defined and classified but never emitted, so vector outages have no Statistics line | `analytics-pilot.util.ts`, search for emitters | Emit it or drop the label |
| 11 | CONFIG.md says strict regional routing is configured under "AI settings > Handoff"; the card is under Tenant Settings > Basic | `CONFIG.md` §4.2, `SettingsBasicPage.tsx` | Fix the path |
| 12 | `RUNBOOK-261013-Go2Joy-SelfHosted.md` sections 11.1 and 11.3 still say the operator DSAR tool and the customer / audit-log retention purges do not exist | RPT-261013-s5a | Update the runbook |
| 13 | There is no way to set a user's display name (the invite takes none, no endpoint edits it), so the re-route toast that names the person never appears: it always says "all eligible people were notified" even when one person was paged; the internal note author shows "Không rõ" and the note body "user #N" | `useRerouteConversation`, `user.controller.ts`, observed in the browser | Add a name field (invite and edit) or fall back to the email |
| 14 | The success toast of the Agent handoff card is English ("AI configuration saved."); other success toasts in Knowledge are English too | `ai-settings.hooks.ts`, `knowledge.hooks.ts`, observed | Translate |
| 15 | Staff-rank users land on a Dashboard of zeros (403 on the dashboard and orders calls is swallowed silently) | observed in the browser | Hide the counters or show a note |
| 16 | The alarm preview is the customer's last message, which is the team chip text right after the team choice, not the question | `escalate` stores the choice as a user message; observed | Skip `team_choice` messages in the preview |
| 17 | Staff alerts (Slack and email) are English-only and the email subject is "[IVY Chat] UNCLAIMED / Escalation — conversation #N" | `agent-alert.service.ts` `notifyEmail` | Rebrand and localise |
| 18 | The role options of the team table are fixed (Tư vấn / Sales Admin / Kế toán / Vận hành) and ignore renamed labels | `HandoffSection.tsx` | Read label names from the label list |
| 19 | Language tabs open on KO, not VI, in the Agent handoff card (off-hours notice, team prompt and names) and in Privacy Notice ("Ngôn ngữ chỉnh sửa" = 한국어); typing without switching saves Korean copy | `HandoffSection.tsx` (`useState('KO')`), `PrivacyNoticePage.tsx` (`copyLang` 'KO') | Default to the console language |
| 20 | The "self-declared" mark cannot occur for new sessions: `identify` refuses claims without a valid signature and only ever stores `signed: true` | `embed.service.ts` | Keep for legacy rows or retire the mark |
| 21 | "OperationInfo" (KB group tab) is untranslated in every locale; the category access select has no visible "Ai được xem" label (tooltip only) | observed | Translate / add a visible label |
| 22 | The default "My region" filter hides even a conversation the agent holds herself when its region is the other one | observed | Show held conversations regardless of region |

---

## 5. Open questions for Go2Joy

1. R7: how and when does Hotel Admin sign identify v2, and does it send the province and the hotel name? (The manual assumes v2 with role and, ideally, province.)
2. R10: which version axis do the UI-version stamps use (v23.3.0 / v23.4.0 or v0.4.1 to v0.12.0)?
3. R14: the pilot hotel list, and whether non-pilot hotels should see nothing or a notice.
4. R16: retention periods, who is the controller and DPO, the governing statute (Decree 13/2023 and/or the 2025 law), the cross-border basis; who approves the Vietnamese notice.
5. R8/R9: the partner data API specification and keys; until then partner data stays off.
6. What should happen when no SA is on duty (today: broadcast to all staff with live chat access)?
7. Do the two team names ("Hỗ trợ khách hàng" / "Hỗ trợ kinh doanh") match what Go2Joy wants customers to read, and may SA staff reply directly in the chat?
8. Regional off-hours mailboxes (North / South) or one shared mailbox?
9. Who owns the holiday calendar, given the system only knows weekday and time?
10. Consent: should a different person on the same browser always be asked again (current behaviour: yes)?

---

## 6. Sources

- `PLN-261012-Go2Joy-Stage1-Gap-Closure` §3 (SG-xx), §5 wireframes, §8 risks (copy in the session scratchpad; the file lives on branch `feature/go2joy-stage1-gap-plan`)
- `docs/implementation/RPT-261013-` : `s1b-identity-audit`, `s2b-KB-UI-Version`, `s3b-Routing-Extras`, `s5a-Compliance-Embed-NFR`, `s5d-pilot-flag`, `w2a-access-tiers`, `w2b-analytics-pilot`, `w2c-tool-loop`, `Partner-Data`, `Resilience-Observability`; `RPT-261007-Handoff-Team-Routing`, `RPT-261007-Hotel-Region-Routing`
- `docs/guide/INCIDENT-RESPONSE.md`, `RUNBOOK-261013-Go2Joy-SelfHosted.md`, `GUIDE-261013-Go2Joy-PDPL-Checklist.md`, `GUIDE-261013-Observability-Alerting.md`, `GUIDE-261013-Partner-Data-Tools-Mode.md`, `CONFIG.md` §4.2
- Code paths per chapter: Vietnamese edition, appendix D

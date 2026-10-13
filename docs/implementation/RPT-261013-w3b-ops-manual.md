# RPT-261013 — w3b: Go2Joy operations manual for CS and Sales Admin (PLN-261012 SG-85)

- Basis: [PLN-261012 §3.5 SG-85](../plan/PLN-261012-Go2Joy-Stage1-Gap-Closure.md) (plan copy on branch `feature/go2joy-stage1-gap-plan`), PDF phase 4 "operations manual and training material". Test report / review checklist: [TCR-261013-w3b-ops-manual](../test/TCR-261013-w3b-ops-manual.md).
- Branch `feature/go2joy-s9-ops-manual`, base `test/go2joy-integration` 689e9530. **Documentation only: no product code, no schema, no environment variable. Not deployed, nothing pushed.**

## 1. What was delivered

| Deliverable | Where |
|---|---|
| **Sổ tay vận hành Go2Joy: CS và Sales Admin** (Vietnamese, primary): 13 chapters, 27 screenshots of the real console, 10 training exercises with expected results, a one-page cheat sheet, a Vietnamese ↔ English UI glossary, a 12-question quiz with answers, an English summary table (appendix A), a go-live checklist for Go2Joy (appendix B), the label and behaviour findings (appendix C), a Sources appendix (D) and an unverified list (E) | `apps/web/public/manual/go2joy-ops.vi.md` and `.html` |
| English edition for Amoeba: summary table (feature → where → who → one line), go-live checklist, verification status, 22 findings about wrong/missing labels and behaviours, open questions for Go2Joy, sources | `apps/web/public/manual/go2joy-ops.en.md` and `.html` |
| Screenshots (JPEG q82, 1440 px viewport crops, 1.26 MB total, fictional data) | `apps/web/public/manual/img/go2joy-ops-<name>.vi.jpg` (27 files) |
| Re-runnable capture script: `prep` seeds fictional data through the real HTTP flow, `shoot` captures, `experiments` probes behaviour; refuses any database not named `scratch_*` | `scripts/manual-screenshots-go2joy-ops.mjs` |
| Registration: card 07 on the manuals index (ko/en/vi card text; ko falls back to the English edition because there is no Korean edition); subtitles now say seven guides | `apps/web/public/manual/index.html` |
| Converter: `DOC_LANGS` so the language bar of a document lists only the editions that exist, the two `go2joy-ops` metas, and the italic rule now accepts `; ! ? ·` after the closing asterisk (a gap found while rendering) | `scripts/manual-md2html.mjs` |
| Review checklist | `docs/test/TCR-261013-w3b-ops-manual.md` |

Follows the existing mechanism: markdown source + HTML generated from it by `scripts/manual-md2html.mjs` (head/style taken from `knowledge-ai.{lang}.html`), static files under `apps/web/public/manual` copied to `dist` by Vite and served by the web container's nginx (the existing `.md → text/markdown` location applies). The self-hosted image build rewrites Amoeba hosts in the manuals (`rewrite-manual-host.sh`); the new files cite no Amoeba host. The Vietnamese `.md` is the source of truth for the manual (there is no `docs/guide` original, unlike the older Korean-first manuals).

### Chapter map (Vietnamese edition)

0 before you start · 1 starting a shift (login, On duty / Off duty and the presence rule, why the queue says "unclaimed", alarm modal, accepting) · 2 reading a conversation (list row, partner header, signed / expired (and the legacy self-declared mark), "?") · 3 team question and routing (what the partner sees, who is paged, strict mode, unclaimed sweep, Hand over to…, My region, counters, capacity) · 4 off-hours (contact email, reply by email, next morning) · 5 Users & Labels (roles CS/SA/Others, regions, duty column, ranks) · 6 Agent handoff settings (assignees, unclaimed switch, hours, deny-list, team question, region table, Load Vietnam preset, Try a province, strict mode, regional mailbox and webhooks, hotel → province CSV with preview, per-team hours) · 7 guest policy, KB category access, what a receptionist sees on a manager topic, KB UI version stamping and reference version, the "Test as" simulator (absent), answer footer · 8 signed sign-in policy, pilot access card, partner data lookup (read-only, API down), privacy notice vn_pdpl, operator DSAR · 9 Statistics › Pilot and the CSV · 10 incidents (AI outage, moderation, suspected exposure, 72 h clock, quick fixes) · 11 training pack · 12 appendices (English summary, go-live checklist, label findings, sources, not verified).

## 2. How it was written and checked

1. Read the existing manuals (`quick-setup`, `knowledge-ai`, `user-manual`, `custom-widget`, `cafe24`), `docs/guide`, the converter and the index; copied the format.
2. Read PLN/REQ-261012 and every wave-1/2 RPT that built a console feature (s1b, s2b, s3b, s5a, s5b, s5d, w2a, w2b, w2c, Partner-Data and the 261007 routing RPTs), then **read the real components and locale files** for every screen and quoted each Vietnamese label from the locale, not from memory.
3. Mechanical label check: 685 distinct bold/italic segments looked up in the vi locale, widget and API copy; no UI label was found to be invented (TCR §2).
4. Statement checklist: 51 rows mapping each claim to code and/or an RPT section (TCR §3); the same mapping is the manual's Sources appendix.
5. Two independent read-only fact-checkers re-verified chapters 0–4 and 5–10 against the code: 14 + 12 problem groups plus 9 small points, every one re-checked in the code and fixed (TCR §4). The biggest corrections: the "configured assignees" step is only the first listed person, "Bỏ qua" closes the alert for everyone, "tự khai" cannot occur for new sessions, the privacy token is `{{retentionDays}}`, the phone DSAR scans oldest-first.
6. A browser run on a scratch environment (stub AI) captured the 27 screenshots and probed behaviour; it confirmed the toasts, the region filter, the re-route, the sweeper, the silent accept failure and found five more issues (TCR §5).
7. Structural checks of the generated HTML and links; rendered in Chrome (27/27 images, 0 page errors).

## 3. VERIFIED vs NOT VERIFIED

**Verified**
- Every UI path and label quoted exists in the locale files and components (TCR §2); every behaviour statement was traced to code or an RPT/TCR (TCR §3); two independent reviews (TCR §4).
- Screens and behaviours observed in a real browser on the scratch environment: duty switch and presence column, region filter, re-route (toast, header, status, alerts, note), alarm modal variants, the unclaimed sweeper, accept at capacity (silent 409), an SA-only user, the settings cards, DSAR dialogs, Statistics › Pilot (TCR §5).
- Structure, links, index card and serving on the dev server (TCR §1).

**Not verified**
- Anything on a Go2Joy host or staging; real Anthropic / Voyage; real Slack / SMTP delivery (UNCLAIMED, off-hours, ops alerts).
- The morning alarm for overnight off-hours requests (§4.3 of the manual) is derived from code only.
- Presence under long-hidden tabs or sleeping laptops in specific browsers.
- Go2Joy's real partner API (contract and codes are Amoeba's assumptions); the guest-gate threshold with real embeddings.
- No screenshot shows a real AI answer (stub engine; sample text written by SQL on the scratch DB).
- Native-speaker quality of the Vietnamese manual and of the console strings it quotes.

## 4. Screenshots and the browser run

27 images, all `go2joy-ops-<name>.vi.jpg`, all referenced from the manual (figures 1–27): duty-toggle, duty-toggle-off, alarm, alarm-unclaimed, alarm-rerouted, livechat-queue-all, livechat-queue, conversation-header, expired, expired-row, reroute, reroute-after, users, handoff-team, handoff-hours, handoff-region, hotel-csv, kb-access, kb-docs, kb-version, identity-policy, pilot, partner-data, privacy-notice, dsar, dsar-erase, stats-pilot. Fictional data only (hotels "(demo)", `@go2joy.example`; the console masks customer names). Scratch DB `scratch_w3b`, API :3036, Vite :5176, own Redis :6396; the scratch database, its grant and the Redis container were removed at the end of the stream. Re-run: `node scripts/manual-screenshots-go2joy-ops.mjs prep` then `shoot` (and `experiments` for the four extras) against a scratch stack.

What the browser run established (details in TCR §5): the duty toggle and presence cell behave as written; the default "Vùng của tôi" filter hides other regions, unmapped provinces, AI-active conversations and even the user's own held conversation of the other region; a re-route restarts the wait clock, keeps the region, supersedes the alert and writes an English internal note (visible after reload); the toast cannot name the paged person because users have no name; Accept at three conversations returns 409 and the console says nothing; the real sweeper raised the UNCLAIMED alarm; an SA-only user works normally in Live Chat; staff-rank users see a Dashboard of zeros.

## 5. Wrong or missing Vietnamese labels and behaviours found (not fixed in this stream)

| # | Finding | Where |
|---|---|---|
| 1 | Job label display names default to Korean (상담, 영업관리, …); the console has no screen to rename them (only `PATCH /api/v1/job-labels/:id`, master). The Users screen and the invite dialog therefore show Korean role names in a Vietnamese console | `seed.runner.ts`, `tenant.service.ts`, `UsersPage.tsx` |
| 2 | Rank (`master`, `director`, `manager`, `staff`) and status (`active`, `suspended`) are shown untranslated | `UsersPage.tsx`, `StatusBadge.tsx` |
| 3 | `aiSetting.agents.guestPolicyHint` (vi and en) still says categories marked "Công khai cho khách" / "Visible to guests"; the control is now the category select "Công khai / Đối tác đã đăng nhập / Chỉ Quản lý" | `aiSetting.json` |
| 4 | The alarm modal shows the partner role as the raw code (`manager`, `receptionist`) | `EscalationAlarm.tsx` |
| 5 | A partner-data outage hand-off is stored with reason `low_confidence`, so the alarm says "AI không tìm được câu trả lời trong kho tri thức." | `chat.service.ts` `answerWithPartnerNotice`, `EscalationAlarm.tsx` |
| 6 | Accept / End / Hand back have no `onError`: at 3 concurrent conversations Accept is refused (409, E5022) and the console shows nothing (observed) | `live-chat.hooks.ts` |
| 7 | Team chips and the alarm have vi labels only for ids `cs` and `business`; other ids render raw | `livechat.json` `team.*` |
| 8 | The vi widget "Liên hệ hỗ trợ" card carries IVY placeholders (`1588-0000`, `help@ivy.com`) and is not tenant-configurable | widget `vi.ts`, `ContactCard.tsx` |
| 9 | The default vi consent banner still says CCPA / Google Analytics / 365 ngày / Hoa Kỳ until the `vn_pdpl` profile is selected | widget `vi.ts`, RPT-261013-s5a §7 |
| 10 | `REFUSAL_REASON.EMBEDDER_DEGRADED` is defined and classified but never emitted, so a vector-only outage has no Statistics line | `analytics-pilot.util.ts` |
| 11 | CONFIG.md §4.2 locates strict regional routing under "AI settings > Handoff"; the card is under Tenant Settings › Basic | `CONFIG.md` |
| 12 | `RUNBOOK-261013-Go2Joy-SelfHosted.md` §11.1/§11.3 still say the operator DSAR tool and the customer / audit-log retention purges do not exist | runbook vs RPT-261013-s5a |
| 13 | No endpoint or field sets a user's display name (invite takes none): the re-route toast that names the paged person never appears (always "all eligible people were notified"), the internal note says "user #N", author "Không rõ" | `user.controller.ts`, `useRerouteConversation`, observed |
| 14 | The Agent handoff card's success toast is the English "AI configuration saved."; other Knowledge toasts are English too | `ai-settings.hooks.ts`, `knowledge.hooks.ts`, observed |
| 15 | Staff-rank users land on a Dashboard of zeros (403 swallowed); Live Chat fires a silent 403 on `GET /users` | observed |
| 16 | The alarm preview is the customer's last message, i.e. the team chip text right after the team choice | observed |
| 17 | Alert Slack/email text is English-only and the email subject is "[IVY Chat] UNCLAIMED / Escalation — conversation #N" | `agent-alert.service.ts` |
| 18 | The role options of the team table are fixed names and ignore renamed labels | `HandoffSection.tsx` |
| 19 | Language tabs open on KO in the Agent handoff card and in Privacy Notice ("Ngôn ngữ chỉnh sửa" = 한국어); the `[[…]]` warning needs the controller line in every listed language | `HandoffSection.tsx`, `PrivacyNoticePage.tsx` |
| 20 | The "tự khai" (self-declared) mark cannot occur for new sessions: `identify` refuses unsigned claims and stores only `signed: true` | `embed.service.ts` |
| 21 | "OperationInfo" (KB group tab) untranslated in all locales; the category access select has no visible "Ai được xem" text (tooltip only) | observed |
| 22 | "Vùng của tôi" hides even the conversation the agent holds herself when it belongs to the other region | observed |
| 23 | Console label differences that are intentional but worth knowing: "Hand over to…" is **Chuyển sang…**; region badge "Bắc/Nam" vs Users "Miền Bắc/Miền Nam"; chip "Kinh doanh" vs customer-facing "Hỗ trợ kinh doanh"; "Nhân viên AI" (AI agent) vs "nhân viên" (human); the Users page is titled "Người dùng" while the menu says "Người dùng & nhãn" | locales |

## 6. Open questions for Go2Joy (also in the English edition)

R7 identify v2 signing and recall timing, and whether province and hotel name are sent · R10 UI-version axis (v23.x vs v0.x) · R14 pilot list and hide-vs-notice · R16 retention, controller and DPO, governing statute, cross-border basis, who approves the Vietnamese notice · R8/R9 partner API (until then partner data stays off) · behaviour when no SA is on duty · the two customer-facing team names and whether SA may reply directly in chat · regional off-hours mailboxes · who owns the holiday calendar · consent re-ask for a different person on the same browser.

## 7. Deploy state and migration

Not deployed. No schema, SQL, entity or environment change, so no `## Migration` section is owed. The files ride along with the next web image build (about 1.3 MB of images added to `apps/web/public/manual/img`).

## 8. Follow-ups

- Gate simulator ("test as" Khách / Lễ tân / Quản lý): the manual states it is absent; update §7.4 and the English table when it lands.
- Fix the findings in §5 (priorities before go-live: 1 label rename path, 6 silent Accept failure, 13 no display name, 5 alarm reason for partner outages, 8 widget contact card, 9 consent banner, 19 KO default language tabs).
- Native-speaker review of the Vietnamese manual and of the console strings it quotes.
- Re-capture the screenshots after Go2Joy renames the labels and when the wording is final (re-run the capture script against a scratch environment).
- Update the runbook sections in finding 12 and the CONFIG.md path in finding 11.
- Optional: regenerate the other manuals' HTML with the converter's new italic rule (`*text*;` used to print its asterisks) — not done here to keep the diff to this stream's files.

## 9. Commits

| SHA | Subject |
|-----|---------|
| `2084b1b8` | docs(manual): converter language list per document and italic punctuation (PLN-261012 SG-85) |
| `a6e4c1e1` | docs(manual): Go2Joy operations manual for CS and Sales Admin, vi + en (PLN-261012 SG-85) |
| (this commit) | docs: TCR/RPT w3b ops manual |

Cleanup done: the scratch database `scratch_w3b` was dropped and its grant revoked, the scratch Redis container `w3b_redis` removed, the scratch API (:3036) and Vite (:5176) stopped; `db_sharptalk` was never touched.

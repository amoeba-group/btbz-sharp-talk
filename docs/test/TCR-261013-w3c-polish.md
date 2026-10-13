# TCR-261013 — w3c: product fixes for the findings of the Go2Joy operations manual review

- Basis: [RPT-261013-w3b-ops-manual](../implementation/RPT-261013-w3b-ops-manual.md) §5 and [TCR-261013-w3b-ops-manual](TCR-261013-w3b-ops-manual.md) §5 (the 22 findings). Report: [RPT-261013-w3c-polish](../implementation/RPT-261013-w3c-polish.md).
- Branch `feature/go2joy-s10-polish`, base `test/go2joy-integration` `3666b043`. **Nothing deployed, nothing pushed.** No schema change (no entity, no `sql/*.sql`).
- Environment for the browser checks: scratch DB `scratch_w3c` (seeded with the repo's own seed, tenant `go2joy`, AI engine = stub), API :3037 from the worktree (`ts-node`, `tsconfig.check.json`), console on Vite :5177, own Redis :6397, Chrome driven through Playwright. Sample data from `scripts/manual-screenshots-go2joy-ops.mjs prep` (fictional hotels "(demo)", `@go2joy.example`).

## 1. Automated checks (final numbers)

| Check | Result |
|-------|--------|
| `tsc -p tsconfig.check.json --noEmit` in `apps/api`, `apps/web`, `apps/widget` | 0 errors in all three |
| `apps/api` `npx jest` (full, final run) | 362 suites passed, 3 failed (the known Windows baseline `embed-loader.spec.ts`, `heic-conversion.spec.ts`, `board-attachment.service.spec.ts`), 1 skipped; 4,667 tests passed, 9 skipped, 3 failed (all in those three) |
| `packages/types` `npx jest` | 21 suites, 451 tests passed |
| `packages/common` `npx jest -c jest.check.config.js` | 2 suites, 65 tests passed |
| `apps/widget` `node --test test/*.test.mjs` | 155 passed, 0 failed (152 before + 3 new) |
| `npm run i18n:check` | es, ko, vi, ja, zh: complete (0 missing, 0 stray, 0 empty) |
| `npm run migrations:manifest` then `git diff --ignore-space-at-eol --stat sql/artefacts.tsv` | no difference (no new SQL) |
| Real boot | `Nest application successfully started` on `scratch_w3c` with `DB_SYNCHRONIZE=true` after the seed; no entity changed, so no column check is owed |

### 1.1 Tests added

| Where | Test | Pins |
|-------|------|------|
| `packages/types/src/common/job-label-name.spec.ts` (11) | defaults are English-neutral; English and legacy Korean names count as defaults, typed names and other labels' defaults do not; `planJobLabelRenames` sends nothing for an untouched dialog, only changed rows, trims, "use default" writes the English default (never the localized text), is a no-op on a label that already has its built-in name, skips rows without id; `hasBlankJobLabelName` | finding 1 |
| `apps/api/src/domain/user/user.service.names.spec.ts` (10) | rename trims, audits old/new; blank refused (E5003); duplicate refused case-insensitively (E5004); re-saving the same name writes no audit row; other tenant's label is a 404; `updateName` sets/clears, audits without the value, tenant fence (E1006); invite stores a trimmed name or none | findings 1, 13 |
| `apps/api/src/global/util/user-display.util.spec.ts` (5) | real name wins; e-mail words ("hung.nguyen" -> "Hung Nguyen"); never the domain; null when nothing; 80-character cap | finding 13 |
| `apps/api/src/domain/agent/staff-display-name.spec.ts` (3) | comment authors, assignee and console thread senders use the fallback; the **customer widget's** `ChatService.resolveSenderNames` stays on the real name only | finding 13 (privacy) |
| `apps/api/src/domain/agent/agent-routing.service.spec.ts` (+3) | the re-route alert quotes the question, not the team chip; the paged person and the note author are named from the e-mail when no name is set; a real name wins | findings 13, 16 |
| `apps/api/src/domain/chat/escalation-preview.util.spec.ts` (8) | skips one chip, several chips, gives up after N hops, empty when the chip is all there is, 300-character cap, never loops on a row without id, recognises a chip by its trace kind only | finding 16 |
| `apps/api/src/domain/chat/chat.service.team-routing.spec.ts` (+1) | after a team choice the escalation event's preview is the earlier question | finding 16 |
| `apps/api/src/domain/chat/chat.service.partner-data.spec.ts` (+1, 1 updated) | a partner API outage publishes `partner_unavailable` (stored trace too, never `low_confidence`); an unverifiable figure publishes `partner_unverified` | finding 5 |
| `packages/types/src/common/refusal-reason.spec.ts` (+2) | `buildHandoffTrace` keeps the two partner words | finding 5 |
| `apps/api/src/domain/agent/agent-alert.service.routing-extras.spec.ts` (+4, 1 updated) | default subject prefix `[SharpTalk]`; `ALERT_EMAIL_SUBJECT_PREFIX` honoured; prefix helper (default, trims, one line, 40 characters); the alert text names a partner outage | findings 5, 17 |
| `apps/api/src/domain/agent/agent.service.listsessions.spec.ts` (+3) | "My region" also keeps the conversations the caller holds; other callers and the `none` / `unmapped` / `all` filters are unchanged | finding 22 |
| `packages/common/src/rbac/permission-matrix.spec.ts` (+1) | master and director hold `label.edit`; manager and staff do not | finding 1 |
| `apps/widget/test/contact-card.test.mjs` (3) | an unconfigured tenant draws no phone / e-mail / hours; a configured method is drawn; no widget locale bundles contact values or the IVY placeholders | finding 8 |

### 1.2 Revert proofs (the tests fail without the fix)

With the changed source files of the alerts commit restored to their base versions, five suites failed (10 tests: partner-data outage and unverified, team-routing preview, agent-routing preview and two name tests, routing-extras subject / prefix / alert text, listSessions held-conversation); with `refusal-reason.ts` restored, the two new `buildHandoffTrace` rows fail. Each file was then restored from the commit.

## 2. Browser checks (Chrome via Playwright, vi console unless noted)

| ID | Check | Result |
|----|-------|--------|
| W1 | Users table: name over e-mail in one column, unset names read "(chưa đặt)", rank badges read Master / Nhân viên / Quản lý, status "Hoạt động" | PASS |
| W2 | "Tên vai trò" dialog lists the four labels with meaning text; typing "CS" and "Dùng tên mặc định" on SA; the SA input previews "Hỗ trợ kinh doanh"; Save shows "Đã lưu tên vai trò."; stored: `consult = CS`, `sales_admin = Sales Admin` (the English default, not the Vietnamese text); the table shows CS as typed and SA in Vietnamese | PASS |
| W3 | Renaming accounting to "cs" is refused with "Đã có vai trò khác mang tên này. Hãy đặt mỗi vai trò một tên riêng." | PASS |
| W4 | `GET /audit?action=job_label.renamed` returns the rows | PASS |
| W5 | Invite with name "Thảo Nguyễn": toast "Đã mời người dùng."; the user list carries the name | PASS |
| W6 | A staff agent holding 3 conversations clicks Accept on a 4th: red toast "Bạn đang xử lý số cuộc trò chuyện tối đa cùng lúc. Hãy kết thúc hoặc trả lại một cuộc cho AI, rồi nhận lại cuộc này." (previously nothing); no 403 on `GET /users` from Live Chat | PASS |
| W7 | Staff user: Dashboard shows the card "Số liệu tổng quan dành cho Quản lý trở lên", no KPI tiles, **no 403 response at all** (the first run caught four 403s on `/agent/routing-options` from the global alarm; fixed in `aa514a16`) | PASS after fix |
| W8 | Master user: Dashboard keeps its KPI tiles | PASS |
| W9 | Settings > Basic: the language tab of the Agent handoff card opens on VI (EN with an English console); Save shows "Đã lưu cấu hình AI."; Privacy Notice editing language opens on VI (EN) | PASS (vi and en) |
| W10 | Re-route (experiments phase of the capture script): toast "Đã chuyển sang Hỗ trợ kinh doanh. Lê Thị Hương đã được báo."; stored note "Routed to Business Support (South) by Phạm Thu Lan"; after reload the note author shows the name | PASS |
| W11 | Alarm for a conversation whose last message is the team chip: shows the question ("Mình cần gặp nhân viên hỗ trợ về đặt phòng của khách hôm nay."), team "Hỗ trợ khách hàng", partner "… (91004) · Lễ tân" | PASS |
| W12 | Alarm with reason `partner_unavailable` / `partner_unverified` (alert rows written directly into the scratch DB): "Hiện chưa đọc được dữ liệu của đối tác nên AI không đưa được số liệu. Cần nhân viên xác nhận." / "AI đã giữ lại câu trả lời vì có số liệu không đối chiếu được với dữ liệu khách sạn. Cần nhân viên xác nhận." | PASS (alert rows seeded, not produced by a live partner call) |
| W13 | Queue chips and badges read "Hỗ trợ khách hàng 4", "Hỗ trợ kinh doanh 1" (the tenant's team names) | PASS |
| W14 | The seed (re-run with the new code) wrote English-neutral labels: Customer Support, Accounting, Operations, Sales Admin | PASS |
| W15 | 11 manual screenshots re-captured and viewed (Users, alarm, alarm-rerouted, alarm-unclaimed, queue chips, conversation header, re-route dialog and result, handoff card) | PASS |

## 3. Not driven / not verified

- The live partner-data call (the partner API outage was produced in a jest double, and the two new alarm sentences were seen through seeded alert rows).
- Real Slack and SMTP delivery of the new alert reasons and of the new subject prefix (the prefix is covered by the unit test on the mail call).
- The widget "Contact support" card in a browser (covered by the node test and tsc; the card was not opened in the widget).
- A director account without the Users menu on the Agent handoff card (the fallback names are code-reviewed, not driven).
- Languages other than vi and en in the browser; the six locale files are checked by `i18n:check` and by reading, not by native speakers.
- Knowledge's English toasts and the English alert body were deliberately left (RPT §3).

# SharpTalk × Go2Joy — Work Request (tasks for Go2Joy)

> Shared page (KO/EN): https://claude.ai/artifact/YXajSxYLdmHLgXnUQdVShz — same content. `v1.1` and `v1.2` mark items added or changed in that version.


| Item |  |
|----|----|
| To | Go2Joy PM · HA dev team (backend · FE) · Go2Joy dev (Partner API) · Infra · Operations (CS) · Legal |
| From | SharpTalk (Amoeba) |
| Date / version | 2026-10-24 · **v1.2** (replaces v1.1 and v1.0 of 10/23) |
| Based on | ① HA integration guide **v1.3** + the changes in §1 of this request (→ guide v1.4, released by SharpTalk on 10/26) ② Integration requests & checklist (G numbers, 2026-10-22) ③ Go2Joy Support Assistant API overview and the public Partner API docs (`dev.go2joy.vn/api`, checked 10/23)<br>**The v1.0 PDF (10/20) is withdrawn.** Its userId format, region values and test vectors T1 · T2 no longer apply. |
| Reply | Per-task completion report, or the reply table in §8 — daily check-in channel (WR-40) |



**Changes in v1.2 (10/24)**

- SharpTalk releases of 10/23 – 10/24 (§2.1): consult categories (the customer picks Business Support or Customer Services in the widget; choice × hotel region decides the team), alarm center, personal alert settings and assignment check (simulator), conversations of the same customer or hotel merged, AI notice text with a terms link, retry on an empty AI answer
- go2joy staging routing set-up added (§2.3): 4 teams, 11 agents (8 have not accepted the invitation), 4 rules. **The South team has no active agent**, so southern hotels never reach it
- Task updates: WR-10 confirm rules · WR-11 accept invitations · WR-12 consult category definitions and Vietnamese names (replaces Sales keywords) · WR-13 assignee for skipped categories and unmatched enquiries · WR-15 **done** · WR-31 please confirm · WR-19a new
- HA UAT re-checked 10/24: D1 – D9 unchanged


## 0. Summary

- SharpTalk's phase-1 features (signature verification, hotel = business customer, conversation continuity, region routing, hotel profile and room types) are **deployed and working on staging**.
- Checking HA UAT on 10/23: **the widget is embedded but the identity is not signed** (`hash: "testing"`). HA followed the v1.0 PDF; the spec changes since v1.3 are not in yet (§2.2). Only staging temporarily accepts unsigned sign-ins; **production rejects them.**
- `v1.1` The identity package gets simpler. **HA no longer sends the region; SharpTalk derives it** from the Partner API Province Feed `region`. Province and role are sent as **language-independent codes** instead of display names. Less work on the HA server, and the region table lives in one place, the Go2Joy Partner API.
- `v1.2` Go2Joy operations have already entered most of the routing set-up in the console (§2.3). What remains is **accepting invitations** (the South team above all) and **category names and the default assignee**.
- **Staging open on 10/31** needs: WR-01 · 02 · 04 · 05 · 10 – 14 · 40.
- **Production open** additionally needs WR-06 (HA production deploy) · WR-20 – 23 · WR-30 · 31. The earliest production open is **Tue 11/10**: 7 working days after the production server (WR-20) and the Partner API production certification (WR-23, about one week) must both be done.

## 1. Integration spec history `v1.1`

Parts of HA were built from the v1.0 PDF, so the differences between versions are in one table. **The v1.4 column is the final spec.** SharpTalk releases guide v1.4 and new test vectors by 10/26 (S-01).


<table>
<thead>
<tr>
<th>Item</th>
<th>v1.0 (10/20 PDF)</th>
<th>v1.3</th>
<th>v1.4 (this request)</th>
</tr>
</thead>
<tbody>
<tr>
<td><code>userId</code></td>
<td>Login ID (<code>go2joysupport</code>)</td>
<td><code>"ha:" + userSn</code></td>
<td>Same as v1.3</td>
</tr>
<tr>
<td>Signed attribute keys</td>
<td>5: <code>hotel_id</code> · <code>hotel_name</code> · <code>province</code> · <code>region</code> · <code>role</code></td>
<td>5 (same)</td>
<td><strong>4</strong>: <code>hotel_id</code> · <code>hotel_name</code> · <code>province_sn</code> · <code>role</code></td>
</tr>
<tr>
<td>Province</td>
<td><code>province</code> = province name (<code>Hồ Chí Minh</code>)</td>
<td>Same</td>
<td><code>province_sn</code> = Go2Joy <code>provinceSn</code> (Province Feed <code>sn</code>, e.g. Hồ Chí Minh = <code>"1"</code>)</td>
</tr>
<tr>
<td>Region</td>
<td>Derived by HA, 3 values (north · central · south)</td>
<td>Derived by HA, 5 codes</td>
<td><strong>Not sent.</strong> SharpTalk derives it from Province Feed <code>region</code> (1 – 5)</td>
</tr>
<tr>
<td>Role</td>
<td>Display name (<code>Lễ tân</code>)</td>
<td>Same</td>
<td><strong>HA role code</strong> (independent of UI language); code list returned in WR-01</td>
</tr>
<tr>
<td>Normalisation</td>
<td>Collapse whitespace · trim · 120 chars</td>
<td>+ NFC</td>
<td>Fixed order: <strong>NFC → collapse whitespace → trim → 120 chars (<code>mb_substr</code>)</strong></td>
</tr>
<tr>
<td>"All hotels" selected</td>
<td>Not specified</td>
<td>Re-identify only</td>
<td>Drop the 3 hotel keys (<code>hotel_id</code> · <code>hotel_name</code> · <code>province_sn</code>), sign <code>role</code> only → fallback agent (WR-13)</td>
</tr>
<tr>
<td>Empty values</td>
<td>Empty attributes and email dropped</td>
<td>Same</td>
<td>Empty <code>name</code> · <code>email</code> · <code>phone</code> are dropped as fields too (empty or malformed email → 400)</td>
</tr>
<tr>
<td>Test vectors</td>
<td>T1 · T2 (old userId)</td>
<td>T1 – T5</td>
<td><strong>T1 – T6</strong> (T6 = decomposed Unicode input). Earlier vectors are not used</td>
</tr>
<tr>
<td>Transition</td>
<td colspan="3">For a while SharpTalk also verifies the v1.3 shape (<code>province</code> · <code>region</code> keys); routing prefers v1.4 values. This ends once HA is on v1.4 (S-02).</td>
</tr>
</tbody>
</table>


### 1.1 v1.4 identity package


| Field | Signed | Value | Source in HA (e.g.) | UAT example |
|----|----|----|----|----|
| `userId` | Yes | `"ha:" + userSn` | Staff number in the HA DB | `ha:<userSn>` |
| `attributes.hotel_id` | Yes | Selected hotel `hotelSn` (string) | `profile.hotelSn` | `"1721"` |
| `attributes.hotel_name` | Yes | Hotel name | `hotelViewList[].name` | `A In Hotel Del Luna` |
| `attributes.province_sn` | Yes | The hotel's `provinceSn` (string) | HA DB hotel → provinceSn | `"1"` |
| `attributes.role` | Yes | HA role code | Role key in the HA DB | Returned in WR-01 |
| `name` · `email` · `phone` | No | Display only; drop the field when empty | `profile.fullName` etc. | `G2J SUPPORT` |


``` tl
Signing string (keys in alphabetical order, separated by \n)
ha:<userSn>
hotel_id=1721
hotel_name=A In Hotel Del Luna
province_sn=1
role=<HA role code>

hash = hex( HMAC-SHA256( key = SHARPTALK_EMBED_SECRET, message = signing string (UTF-8) ) )
```

How SharpTalk derives the region: Province Feed `region` `1` → `south`, `2` → `north`, `3` → `central`, `4` → `north_center`, `5` → `south_center`. The undocumented `10` (Manila) is settled after WR-27.

## 2. Status (2026-10-24) `v1.2`

### 2.1 Ready on the SharpTalk side (staging)


| Feature | Status |
|----|----|
| Signed identify verification, HA terms recorded as widget consent (no consent banner), staff name in the first greeting | Done |
| Hotel = business customer, staff = contact, B2B / B2C split, conversation continuity per hotel account | Done |
| **Consult categories**: on "talk to an agent" or an AI handoff the widget asks what the enquiry is about (skippable); choice × hotel region → team × job label | Done (10/24) — rules and roster partly entered (§2.3) |
| **Alarm center**: header 🔔 with assignee, rule, category, hotel, region; acknowledge vs dismiss; personal settings (all / mine / off, sound, desktop notifications, mail) | Done (10/24) |
| **Assignment check** (simulator) and rule warnings: enter category, region, province → matching rule, assignees, reasons for skips; warnings for zero active agents and misused job labels | Done (10/24) |
| Several sessions of the same customer or hotel merged into one room; later sessions added automatically | Done (10/23) |
| AI notice line under the widget (per language) with a terms link; show / hide the header language and settings buttons | Done (10/23) |
| One retry and handoff on an empty AI answer, client IP spoofing blocked, transcript search | Done (10/23) |
| Replies and buttons in the selected language (vi / en), live-chat title "staff / hotel" | Done |
| Hotel info and room types from the Partner API → company profile and per-hotel products; province → region table refreshed automatically (80 provinces) | Done — running on the staging credential |
| Stopgap: province name → region (HA currently sends a province name as region) | Deployed 10/23 |
| Names in plain text on console lists; masked toward external AI and logs | Done |


### 2.2 HA UAT findings

Checked from the embed code on HA UAT (`go2joy-ha-uat.go2joy.io`, `window.sharptalkSignIn`) and SharpTalk staging logs. "Basis" is the document HA followed. `v1.2` **Re-checked 10/24: no change** (`hash: "testing"`, login ID, 5 extra keys, a province name in `region`).


| \# | Item | HA today | Basis | v1.4 | Effect |
|----|----|----|----|----|----|
| D1 | Signature | Package built in the browser, `hash: "testing"` | — (server signing since v1.0) | **HA server** signs with HMAC-SHA256 and returns it to the FE | 401 in production |
| D2 | `userId` | Login ID | Built to v1.0 | `"ha:" + userSn` (changed in v1.3) | Conversations break when a login ID changes; may collide with booking-customer IDs |
| D3 | Attribute keys | 5 + `hotel_code` · `hotel_group_id` · `user_id` · `user_sn` · `district` | — | Only the 4 | Once signed, unknown keys cause 401 |
| D4 | Region | Province name in `region` | v1.0: 3 values, v1.3: 5 codes | Not sent (SharpTalk derives it) | SharpTalk stopgap in place |
| D5 | Province / role values | Display names (`Hồ Chí Minh`, `Lễ tân`) | v1.0 · v1.3 | `province_sn` · role code | Switching the HA language can change signed values and break routing and continuity |
| D6 | Normalisation | Not applicable (built in the FE) | v1.0 PHP sample has no NFC | NFC required (`intl` extension) | 401 when Vietnamese diacritics arrive decomposed |
| D7 | `locale` | `localStorage.lang` → `vi` / `en`, `setLocale` on change | Same | Same | OK |
| D8 | Sign-out | `sharptalkSignOut()` → `logout` (button) | Same | Also on session expiry and account switch | A previous staff identity can linger on shared PCs |
| D9 | Hotel change | Re-identify not confirmed; no "all hotels" rule | — | Re-identify on every change; "all hotels" per §1 | Confirm in UAT (WR-04) |


### 2.3 go2joy staging routing set-up (read 10/24) `v1.2`

Values Go2Joy operations entered in the console. Settings › Agent handoff › **Assignment check** shows the same result for a given category and region.


| Item | Now |
|----|----|
| Consult categories (shown to customers) | `bs` Business Support · `cs` Customer Services — **no Vietnamese names** (Vietnamese screens show English) |
| Teams | North · North Center · South · South Center |
| 11 agents | 3 active (North 1, North Center 2) · **8 invited, not accepted** (North 2, North Center 2, South 3, South Center 1) |
| Job labels | `cs` · `sa` (also consult · accounting · operations) |



| Rule | Category | Hotel region | Target | Result now |
|----|----|----|----|----|
| BS_North_SA | bs | north · north_center | North team × sa | Assigned (1 active sa) |
| CS_North_CS | cs | north · north_center | North team × cs | Assigned (1 active cs) |
| CS_South | cs | south · south_center | South team × cs | **Skipped — 0 active** |
| BS_South_SA | bs | south · south_center | South team × sa | **Skipped — 0 active** |


- **The North Center and South Center teams** are not the target of any rule; north-central hotels also go to the North team. There is no rule for the `central` region.
- A customer who **skips** the category, or an enquiry no rule matches, goes to the default assignee (or an "everyone — no rule matched" alert).
- Rule region conditions use the region SharpTalk derives, so the rules need no change after the move to v1.4.

## 3. Work items

**P0-S** 10/31 staging open · **P0** production open · **P1** production quality · **P2** phase 2 and later. Due dates are SharpTalk's proposal; if one does not work, write a feasible date in the reply table (§8).

### 3.1 HA dev team — backend


| WR | Task | Detail | Done when | Prio | Due (proposed) | Ref |
|----|----|----|----|----|----|----|
| WR-01 | **Signing endpoint** `v1.1` | An API called with the login session (e.g. `GET /api/v1/staff/sharptalkIdentity`) builds and signs the package on the server.<br>① `userId = "ha:" + userSn`<br>② 4 attributes: `hotel_id` · `hotel_name` · `province_sn` · `role` (role code). No `region`<br>③ "All hotels": drop the 3 hotel keys, sign `role` only<br>④ Normalise in this order: `Normalizer::normalize($v, Normalizer::FORM_C)` → collapse whitespace → trim → `mb_substr(…, 0, 120)`. Needs the PHP `intl` extension<br>⑤ Drop empty values, in attributes and in `name` · `email` · `phone`<br>⑥ `hash = hex(HMAC-SHA256(embed secret, signing string))`<br>⑦ Read values from the HA session and DB, never from the browser | Guide v1.4 test vectors **T1 – T6** match + **HA role code list** (code · vi/en label) sent back | P0-S | Tue 10/27 | G10 · D1 – D6 · D9 |
| WR-02 | **Signing key decision** `v1.1` | **Option A (recommended)**: the embed secret SharpTalk issues, kept only in an HA server environment variable. SharpTalk sends the staging secret over a secure channel the same day.<br>**Option B**: reuse the Go2Joy client secret. SharpTalk must add input for a partner-supplied secret (S-04), and a leak would also expose Partner API access.<br>If there is no decision by 10/26, staging opens with option A and the choice is made again before production (same spec and code; only the secret value changes). The secret never goes into the FE, the browser, logs or documents. | Decision + staging secret in place | P0-S | Decide by Mon 10/26 | G12 |
| WR-03 | Signature expiry (`ts`) | Whether to add a signing time to stop package reuse. A 5-minute expiry like the Partner API's means both sides change the spec together. | Yes / no | P1 | 11/06 | G16 |


### 3.2 HA dev team — FE and deployment


| WR | Task | Detail | Done when | Prio | Due (proposed) | Ref |
|----|----|----|----|----|----|----|
| WR-04 | **Fix the embed** `v1.1` | ① `sharptalkSignIn` passes the WR-01 response to `identify` **unchanged** (no assembling or editing in the browser)<br>② Call it when sign-in is confirmed · on page reload · **whenever the selected hotel changes (including "all hotels")** · when the HA language changes<br>③ Call `logout` on the sign-out button · on **automatic sign-out from session or token expiry** · just before signing in as another account · when another tab signs out (e.g. the `storage` event)<br>④ Remove `hash: "testing"` from the initial `SHARPTALK_WIDGET_CONFIG.user`<br>⑤ Allow the SharpTalk domain in CSP (`script-src` · `frame-src` · `connect-src`) and CORS<br>⑥ Put the 3 SharpTalk domain uses (`embed.js` src · `widgetUrl` · `ivy:event` origin check) behind one environment setting (switched to production in WR-06) | Network shows `POST …/public/embed/identify` **200** (`consentState: "granted"`) and the page receives `ivy:event` `identified {ok: true}` | P0-S | Wed 10/28 | G11 · D1 · D8 · D9 |
| WR-05 | Joint UAT | Run the §6.1 checklist together with SharpTalk | Signed-off result table | P0-S | 10/29 – 10/30 | G13 |
| WR-06 | **HA production deploy** `v1.1 new` | ① Deploy WR-01 · WR-04 to HA production<br>② Set the production embed secret in the production environment. It differs from staging; SharpTalk sends it over a secure channel (S-08)<br>③ Switch to the production SharpTalk domain: `https://sharptalk.go2joy.vn/widget/embed.js` · `widgetUrl` · origin check<br>④ Production CSP and CORS<br>⑤ Share the HA release schedule with SharpTalk in advance | identify 200 on production HA; a package signed with the staging secret gets 401 in production | P0 | Before production UAT (WR-20 handover + 4 working days) | G11 · G1 |


### 3.3 Go2Joy operations (CS)


| WR | Task | Detail | Done when | Prio | Due (proposed) | Ref |
|----|----|----|----|----|----|----|
| WR-10 | **Confirm the routing rules** `v1.1` `v1.2`<br>[Partial] | Go2Joy has **5 regions** in the Partner API (1 South · 2 North · 3 Central · 4 North Central · 5 South Center). Please check the 4 rules in §2.3.<br>① Should the **North Center and South Center teams** receive enquiries? If yes, split the rules by region or add them as targets<br>② The team for the `central` region (Da Nang etc.); today no rule covers it, so it goes to the default assignee<br>③ To split by province instead, list the exception provinces<br>④ The Philippines (region `10`) is phase 2 | Confirmation (or edit in the console and tell us); no warnings in the assignment check | P0-S | 10/27 | G20 |
| WR-11 | **Accept invitations, complete the roster** `v1.2`<br>[Partial] | The 8 invited agents must sign in once (accept the invitation) before they can be assigned. **The South team has no active agent**, so southern hotels never reach it. Send name · email · team · job label (cs / sa) · rank for anyone missing | At least one active agent per team (no "0 active" warning in the assignment check) | P0-S | 10/27 | G21 |
| WR-12 | **Define the consult categories and name them** `v1.2`<br>[Partial] | Instead of Sales keywords, **the customer picks in the widget**. Say when to pick Business Support and when Customer Services (1 – 2 lines each), and give the **Vietnamese display names**, shown as-is on the widget card. Decide whether to split further (e.g. settlement / contract) | Definitions and Vietnamese names (or enter them in the console's category manager) | P0-S | 10/27 | G22 |
| WR-13 | **Hours, absence order, default assignee** `v1.2` | Working hours per team (HCM time zone), order when nobody is available (proposal: backup agent → team queue → offline message). The **default assignee** for enquiries with no region (**"all hotels" selected**, no hotel selected, unmapped province), **customers who skip the category**, and enquiries no rule matches | Reply → SharpTalk enters the rules and shares a preview | P0-S | 10/27 | G23 |
| WR-14 | **UAT test accounts** | One `Quản lý` (several hotels) + one `Lễ tân` (one hotel), covering hotels in at least two regions **including north and south**, and at least one hotel name with Vietnamese diacritics. `v1.2` [Partial] UAT runs only on the southern Lá Hotel Quận 10 account today | Accounts sent over a secure channel | P0-S | 10/27 | G13 |
| WR-15 | Reconnect the Notion knowledge source<br>[Done] | `v1.2` The 3 sources (HA guide, FAQ, hotel registration guide) were reconnected on 10/22 and sync normally | — | P0 | 10/30 | G30 |
| WR-16 | Knowledge conflict decisions | The 78 items classified on 10/15 (3 real corrections, 3 duplicate policy documents, 32 copied FAQs): which side to keep | Decision table | P1 | 11/06 | G31 |
| WR-17 | Golden set review | Confirm the answers of the 44 `#Talk-4-Hotel` questions (the regression baseline for engine changes and tuning) | Review result | P1 | 11/06 | G32 |
| WR-18 | Widget visibility and resume window | Current defaults: the widget shows the user's own conversations + "n earlier enquiries from this hotel"; the same agent is preferred for 24 hours (a chosen category takes the rules first) | Keep / change | P1 | 11/06 | G14 · G15 |
| WR-19 | Zalo OA · ZNS templates | To send agent alerts over Zalo too | Approved OA and templates | P1 | TBD | G24 |
| WR-19a | Agent alert settings `v1.2` | Each agent sets, under 🔔 › Settings in the console: alert scope (all / mine only), sound, **allow desktop notifications**, mail. Browser notification permission is what makes an alert visible while the console tab is in the background | Set for every agent | P1 | 10/30 | New |


### 3.4 Infrastructure · Partner API go-live


| WR | Task | Detail | Done when | Prio | Due (proposed) | Ref |
|----|----|----|----|----|----|----|
| WR-20 | **Production server + SSH + DNS + TLS** `v1.1` | `sharptalk.go2joy.vn` (no DNS record as of 10/23), Vietnam region. Pilot 4 vCPU / 8 GB / 80 GB; production 8 vCPU / 16 GB / 200 GB or more. Daily backup storage. **Static public IP** (for the WR-23 allow-list) and **NTP time sync** (the Partner API `timestamp` expires after 5 minutes) | SSH access and static IP delivered, DNS resolves | P0 | 10/30 | G1 |
| WR-21 | **Production AI API keys (Go2Joy account and billing)** | Answer LLM (Anthropic Claude recommended) and embeddings (Voyage). Monthly limit and the person who receives exhaustion alerts | Keys delivered over a secure channel | P0 | 10/30 | G2 |
| WR-22 | Mail sender account | SMTP for agent alert mails | Account delivered | P1 | 10/30 | G3 |
| WR-23 | **Partner API production certification, credential and IP allow-list** `v1.1` | The public go-live procedure is: certification request (about one week) → 3 test bookings (hourly · overnight · daily) → production clientId · secret → 3 more bookings for a final check. **SharpTalk uses no booking API**, so we ask for an exemption from the booking tests and an alternative check (a lookup-API connection test). Allow the SharpTalk production static IP on `https://partner.go2joy.vn` (about 500 requests/minute). This turns on hotel info, room and region-table refresh in production | Request filed → exemption answered → credential delivered, connection test passes | P0 | File 10/26 · credential by 11/02 | G18 |


### 3.5 Go2Joy dev — Partner API questions

Where the public Partner API docs (checked 10/23) and staging measurements (10/21 – 10/23) differ. Replies only; Go2Joy decides whether anything needs fixing.


| WR | Question | Docs / observed | Prio | Ref |
|----|----|----|----|----|
| WR-24 | Partner staging vs HA UAT database | Hotel 4118: 21 rooms in Partner / 7 in HA, different prices and hours. Is production one database? | P1 | G19 ① |
| WR-25 | Room status codes | The docs define `status` as 1 Available · 2 Locked only, but we observe 1 · 4 · 5. Meaning of 4 and 5; the codes for "pending approval" and "draft" | P1 | G19 ② |
| WR-26 | Room count | Per the docs, `numOfRoom` 2147483647 means "cannot be determined", and every value we see is this. Is there a field for each hotel's total number of rooms? | P1 | G19 ③ ⑥ |
| WR-27 | Region `10` `v1.1` | The documented enum is 1 – 5, but the Province Feed returns 17 Manila cities with `10`. Name and meaning, and the list of region values to expect. Directly affects SharpTalk's region derivation (§1.1) | P1 | G19 ⑤ |
| WR-28 | Hourly lookup error | Room Type List with `bookingType=1` returns `code 0` (internal server error). The docs require `startTime` · `endTime` for hourly, so SharpTalk re-checks its own request first (S-09) and asks only if it still happens | P2 | G19 ⑦ |
| WR-29 | Hotel Feed coverage and behaviour | The docs make `provinceSn` · `districtSn` required and `hotelSnList` optional. Does it include every HA hotel (4118 is missing)? Is returning everything, ignoring the filter, when no hotel matches intended? | P2 | G18 · G34 |
| — | Support Assistant API document errata | Hotel Info path `getHotelnfo` (the public docs say `/api/v2/hotel/getHotelInfo`); Room Type Feed v1 path shows a v2 response example | P2 | G19 ⑧ |


### 3.6 Legal


| WR | Task | Detail | Done when | Prio | Due (proposed) | Ref |
|----|----|----|----|----|----|----|
| WR-30 | **Privacy / PDPL review** | Cross-border transfer notice (processors Anthropic · Voyage, processing regions), whether a transfer impact assessment is needed, masking scope, conversation retention (draft 180 days), breach notification procedure | Written reply | P0 | 10/30 | G4 |
| WR-31 | **Confirm the terms URL, version and AI notice** `v1.2`<br>[Please confirm] | For signed-in HA users the HA terms acceptance is recorded as widget consent and the consent banner is skipped. What SharpTalk set on staging: terms `https://go2joy.vn/vi-vn/policy?tab=terms-of-use`; notice under the widget VI "Được tạo bởi AI, áp dụng **điều khoản dịch vụ**" / EN "Created by AI; apply **terms of service**" (the bold part links to the terms). Is it the right document, which **version**, and is the text approved? | Confirmation including the version | P0 | 10/30 | G5 |


### 3.7 PM


| WR | Task | Detail | Prio | Due (proposed) | Ref |
|----|----|----|----|----|----|
| WR-40 | **Owners and channel** | Owners for PM, HA backend / FE, infra, Partner API, operations (CS lead), legal, and the daily check-in channel | P0-S | 10/26 | G6 |
| WR-41 | Phase-2 schedule | B2C before / after booking, booking-completed webhook, Go2Joy app / web embed, HA menu (iframe · SSO), reception-agent operations, point billing, Zalo conversations, service-contract terms | P2 | November | G40 – G47 · G7 |
| WR-42 | Business name and address needed? `v1.1 new` | Left open in v1.0. SharpTalk can fetch the **hotel address** itself from Hotel Feed `address`, so HA does not need to send it (except hotels missing from the feed, WR-29). If the **registered business name** is needed in the console, adding a signed key is agreed as a phase-2 spec (v1.5). Do not send it before then (unknown keys cause 401) | P2 | With WR-41 | v1.0 §8 |


## 4. SharpTalk work `v1.1`


| \# | Work | Starts when | Time / due | Prio |
|----|----|----|----|----|
| S-01 | Release guide v1.4: §1 spec, change history, PHP sample (with NFC), new test vectors T1 – T6 | — | Mon 10/26 | P0-S |
| S-02 | Accept v1.4: `province_sn` and role codes, derive the region from the Province Feed, accept v1.3 keys during the transition | — | Tue 10/27 on staging | P0-S |
| S-03 | Send the staging embed secret over a secure channel | WR-02 option A | Same day | P0-S |
| S-04 | Input for a partner-supplied secret (small change) | WR-02 option B | Schedule after the decision | Conditional |
| S-05 | `v1.2` Invite missing agents, complete the rules (North Center, South Center, central), Vietnamese category names, default assignee and hours (or review what Go2Joy entered) → share the assignment-check result | WR-10 – 13 | Same day – half a day | P0-S |
| S-06 | After verification, end the temporary unsigned mode. The province-name region stopgap stays during the transition | WR-01 · 04 · 05 | Same day | P0-S |
| S-07 | Install SharpTalk on the Go2Joy server (VN profile), move the go2joy tenant, knowledge, region table and rules, re-index, connect the Partner API. Sync stays within the production limit (about 500/minute) | WR-20 · 21 · 22 · 23 | 4 days | P0 |
| S-08 | Send the production embed secret over a secure channel (different from staging) | WR-20 | Before WR-06 | P0 |
| S-09 | Re-check the hourly lookup request (with `startTime` · `endTime`) | — | 10/27 | P2 |
| S-10 | **Zero-downtime secret rotation**: accept the old and new secret together during a rotation window, then retire the old one. Add the procedure to the guide | — | 11/06 | P1 |
| S-11 | Enter the terms version (URL and notice text already set on staging; moved with the production install) | WR-31 | Same day | P0 |
| S-12 | Clean up knowledge conflicts (Notion re-sync confirmed) | WR-16 | 1 – 2 days | P1 |


## 5. Timeline and dependencies

``` tl
Mon 10/26  WR-02 signing key decision · WR-40 owners · WR-23 Partner production certification filed
           SharpTalk: S-01 guide v1.4 and test vectors
Tue 10/27  WR-01 signing endpoint + T1–T6 · role code list · WR-10–14 teams, roster, criteria, accounts
           SharpTalk: S-02 accept v1.4 · S-03 secret · S-05 accounts and rules
Wed 10/28  WR-04 FE embed fix → identify 200
10/29–30   WR-05 joint UAT · WR-19a agent alert settings · WR-20/21/22 production prerequisites
Sat 10/31  Staging open (HA UAT → SharpTalk staging, real agents answer)

Production open = the day all three are done
  ① WR-20 server handover + S-07 install 4 days + production UAT 3 days (needs WR-30 · 31)
  ② WR-23 Partner production credential (certification about one week)
  ③ WR-06 HA production deploy (needs S-08 production secret)
  → If every proposed date holds, the earliest production open is Tue 11/10
```

- The 10/22 prerequisite deadline has passed, so **10/31 is a staging open, not a production open** (PLN-261015 decision).
- If WR-01 or WR-04 is late, staging can only open with the temporary unsigned mode. In that case we recommend not starting real agent service.
- WR-23 certification takes about a week and is on the critical path; it must be filed on 10/26 for 11/10 to hold.
- `v1.2` If WR-11 is late, southern hotels reach only the default assignee.

## 6. Done criteria

### 6.1 Staging open (WR-05 checklist)


| Check | Expected |
|----|----|
| Open the widget while signed out | As today: guest, consent banner shown |
| Sign in to HA → open the widget | identify **200**, `identified {ok: true}`, no consent banner, staff name in the greeting, "verified" in the console live chat |
| Console › Customers › Business | One hotel (name · province · region, the region derived by SharpTalk), the signed-in staff and role as a contact, room types as that hotel's products |
| Switch HA language vi ↔ en | Signed values stay the same, so the conversation continues; only reply and button language changes |
| Change the selected hotel | Business customer and conversation switch to the new hotel |
| Select "all hotels" → talk to an agent | identify 200, no hotel, routed to the WR-13 fallback agent |
| "Talk to an agent" from hotels in all 5 regions (north · north_center · central · south_center · south) → pick category bs and cs each `v1.2` | Assigned to team × label by the WR-10 rules; the alarm center shows assignee and rule; assignees alerted |
| Skip the category `v1.2` | Assigned to the WR-13 default assignee |
| Console Settings › Agent handoff › Assignment check `v1.2` | No rule warnings (no "0 active" left) |
| Hotel name with diacritics (including decomposed input) | 200 (NFC confirmed) |
| Staff account with an empty email | The email field is dropped; 200 |
| Widget after sign-out · session expiry · signing in as another account | Guest (or the new account); the previous staff member's name and conversations are not visible |
| Edit one **signed value** (`userId` or an attribute) without re-signing | 401 E5048, `ok: false`, guest. `name` · `email` · `phone` are not signed, so editing them still gives 200, as designed |


Once these pass, SharpTalk turns off the temporary unsigned mode on staging (S-06).

### 6.2 Production open


| Check | Expected |
|----|----|
| Sign in to production HA → widget (`sharptalk.go2joy.vn`) | identify 200 (production secret); the key §6.1 checks pass again |
| Send a package signed with the staging secret to production | 401 (environments are separate) |
| Partner API production connection | Hotel info · rooms · region table refresh succeeds; no error 6 (signature) or 8 (IP) |
| Terms and notice | Consent records carry the HA terms URL and version from WR-31 |


## 7. Reference — Partner API essentials (public docs, 10/23)


| Item | Docs | Used by SharpTalk for |
|----|----|----|
| Environments | Staging `staging-partner.go2joy.vn` (about 250/minute) · production `partner.go2joy.vn` (about 500/minute) | Sync rate limit |
| Auth | `Authorization` = hex(HMAC-SHA256(client secret, URL + "\|" + JSON body)); body has `clientId` · `timestamp` (expires in 5 minutes); IP allow-list | WR-20 NTP · static IP |
| Language | `Localization` header `vi` / `en` (default en) | Lookups in the widget's language |
| Regions | Province Feed `region`: 1 South · 2 North · 3 Central · 4 North Central · 5 South Center | §1.1 derivation table |
| Hotel → province | Hotel Feed `provinceSn` · `address`; Hotel Info has no province | Why HA sends `province_sn` (hotels missing from the feed) |
| Error codes | Body `code` 0 server error · 1 success · 2 failure; error 6 invalid signature · 8 unauthorized (IP) · 12 too many attempts | Production monitoring alerts |


## 8. Reply table

Fill in and send to the daily check-in channel.


| WR | Prio | Owner | Feasible date | Status (in progress / done / on hold) | Note |
|----|----|----|----|----|----|
| WR-01 | P0-S |  |  |  |  |
| WR-02 | P0-S |  |  |  | Option A / B |
| WR-03 | P1 |  |  |  |  |
| WR-04 | P0-S |  |  |  |  |
| WR-05 | P0-S |  |  |  |  |
| WR-06 | P0 |  |  |  |  |
| WR-10 | P0-S |  |  |  |  |
| WR-11 | P0-S |  |  |  |  |
| WR-12 | P0-S |  |  |  |  |
| WR-13 | P0-S |  |  |  |  |
| WR-14 | P0-S |  |  |  |  |
| WR-15 | P0 |  |  | Done |  |
| WR-16 | P1 |  |  |  |  |
| WR-17 | P1 |  |  |  |  |
| WR-18 | P1 |  |  |  | Keep / change |
| WR-19 | P1 |  |  |  |  |
| WR-19a | P1 |  |  |  |  |
| WR-20 | P0 |  |  |  |  |
| WR-21 | P0 |  |  |  |  |
| WR-22 | P1 |  |  |  |  |
| WR-23 | P0 |  |  |  | Booking-test exemption? |
| WR-24 – 29 | P1 / P2 |  |  |  |  |
| WR-30 | P0 |  |  |  |  |
| WR-31 | P0 |  |  |  |  |
| WR-40 | P0-S |  |  |  |  |
| WR-41 | P2 |  |  |  |  |
| WR-42 | P2 |  |  |  | Needed / not needed |


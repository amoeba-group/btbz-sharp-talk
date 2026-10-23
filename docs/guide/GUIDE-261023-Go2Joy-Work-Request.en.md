# SharpTalk × Go2Joy — Work Request (tasks for Go2Joy)

| Item | |
|---|---|
| To | Go2Joy PM · HA dev team (backend · FE) · Go2Joy dev (Partner API) · Infra · Operations (CS) · Legal |
| From | SharpTalk (Amoeba) |
| Date / version | 2026-10-23 · v1.0 |
| Based on | Integration requests & checklist (G numbers, 2026-10-22) · HA integration guide v1.3 · Go2Joy Support Assistant API document |
| Reply | Per-task completion report, or the reply table in §6 — daily check-in channel (G6) |

## 0. Summary
- SharpTalk's phase-1 features (signature verification, hotel = business customer, conversation continuity, region routing, hotel profile and room types) are **deployed and working on staging**.
- Checking the HA UAT page on 10/23: **the widget is embedded, but the identity is not signed.** The package is built in the browser and `hash` is the fixed value `"testing"` (§1.2). Staging temporarily accepts these "unsigned sign-ins" so UAT can go on; **production rejects them.**
- This document splits what Go2Joy needs to do into **work items (WR)** with an owner, a proposed due date and a done criterion.
- **Staging open on 10/31** needs: WR-01 · WR-02 · WR-04 · WR-05 · WR-10 – WR-14.
- **Production open** additionally needs WR-20 – WR-23 · WR-30 · WR-31: about **7 working days** after the production server (WR-20) is handed over (install 4 days + UAT 3 days).

## 1. Status (2026-10-23)

### 1.1 Ready on the SharpTalk side (staging)
| Feature | Status |
|---|---|
| Signed identify verification, HA terms recorded as widget consent (no consent banner), staff name in the first greeting | Done |
| Hotel = business customer, staff = contact, B2B / B2C split, conversation continuity per hotel account | Done |
| Region → team routing, team / job-label coverage, AI handoff and "talk to an agent" | Done — waiting for teams and roster (WR-10 – WR-13) |
| Replies and buttons in the selected language (vi / en), live-chat title "staff / hotel" | Done |
| Hotel info and room types from the Partner API → company profile and per-hotel products; province → region table refreshed automatically (80 provinces) | Done — running on the staging credential |
| Names in plain text on console lists; masked toward external AI and logs | Done |

### 1.2 HA UAT findings — differences from guide v1.3
Checked from the embed code on the HA UAT page (`window.sharptalkSignIn`) and SharpTalk staging logs.

| # | Item | HA today | Guide v1.3 | Effect |
|---|---|---|---|---|
| D1 | Signature | Package built in the browser, `hash: "testing"` | **HA server** signs with HMAC-SHA256 and returns the package to the FE | Rejected (401) in production |
| D2 | `userId` | `profile.value.userId` (login ID) | **`"ha:" + userSn`** (immutable staff number) | Earlier conversations break when a login ID changes; may collide with booking-customer IDs |
| D3 | Attribute keys | the 5 keys + `hotel_code` · `hotel_group_id` · `user_id` · `user_sn` · `district` | **only 5** (`hotel_id` · `hotel_name` · `province` · `region` · `role`) | Once signed, unknown keys make the package fail (401) |
| D4 | `region` | Province name (`provinceName`, e.g. `Hồ Chí Minh`) | **Region code** (`north` · `north_center` · `south_center` · `south` · `central`) | SharpTalk now converts a province name to its region as a stopgap (deployed 10/23) |
| D5 | `locale` | `localStorage.lang` → `vi` / `en`, `setLocale` on change | Same | OK |
| D6 | Sign-out | `sharptalkSignOut()` → `logout` | Same | OK (call sites to confirm) |
| D7 | Re-identify on hotel change | Not confirmed | `identify` again whenever the selected hotel changes | Confirm in UAT (WR-04) |

## 2. Work items

**Priority**
- **P0-S**: needed for the 10/31 staging open.
- **P0**: needed for the production open.
- **P1**: needed for production quality.
- **P2**: phase 2 and later.

Due dates are SharpTalk's proposal. If one does not work, write a feasible date in the reply table (§6).

### 2.1 HA dev team — backend
| WR | Task | Detail | Done when | Prio | Due (proposed) | Ref |
|---|---|---|---|---|---|---|
| **WR-01** | **Signing endpoint** | An API called with the login session (e.g. `GET /staff/sharptalkIdentity`) builds and signs the package on the server: ① `userId = "ha:" + userSn` ② only the 5 attributes, empty ones dropped ③ `region` = region code (region table `REGIONS` → code, guide 4.1) ④ NFC-normalise and trim values, then sign ⑤ `hash = hex(HMAC-SHA256(embed secret, signing string))`. About 40 lines of PHP (guide 5.2) | Test vectors T1 – T5 match; results sent back (guide 5.4) | P0-S | Tue 10/27 | G10 · D1 – D4 |
| **WR-02** | **Signing key decision** | Option A (recommended): the embed secret SharpTalk issues, kept only in an HA server environment variable. On decision SharpTalk sends the staging secret over a secure channel. Never in the FE, the browser, logs or documents | Decision + staging secret in place | P0-S | Decide by Mon 10/26 | G12 |
| WR-03 | Signature expiry (`ts`) | Whether to add a signing time to stop package reuse. If yes, both sides change the spec together (guide §7) | Yes / no | P1 | 11/06 | G16 |

### 2.2 HA dev team — FE
| WR | Task | Detail | Done when | Prio | Due (proposed) | Ref |
|---|---|---|---|---|---|---|
| **WR-04** | **Fix the embed** | ① `sharptalkSignIn` passes the WR-01 API response to `identify` **unchanged** instead of assembling it in the browser ② call it when sign-in is confirmed, on page reload, and **whenever the selected hotel changes (including "all hotels")** ③ `logout` on sign-out ④ remove `hash: "testing"` from the initial `SHARPTALK_WIDGET_CONFIG.user` ⑤ allow the SharpTalk domain in CSP (`script-src` · `frame-src` · `connect-src`) and CORS | Network shows `POST …/public/embed/identify` **200** (`consentState: "granted"`) and the page receives `ivy:event` `identified {ok: true}` | P0-S | Wed 10/28 | G11 · D1 · D7 |
| WR-05 | Joint UAT | Run the 16 checks of guide 8.2 together with SharpTalk | Signed-off result table | P0-S | 10/29 – 10/30 | G13 |

### 2.3 Go2Joy operations (CS)
| WR | Task | Detail | Done when | Prio | Due (proposed) | Ref |
|---|---|---|---|---|---|---|
| **WR-10** | **Region → team mapping** | Are teams split by region (4) or by province? Proposal: `north` · `north_center` → Hanoi team, `south` · `south_center` → HCMC team. Da Nang and the Central Highlands (`south_center`, 13 provinces) to confirm. The Philippines (17 Manila cities, Go2Joy region `10`) is phase 2 | Mapping table | P0-S | 10/27 | G20 |
| **WR-11** | **Agent roster** | Name · email · team · job (CS / Sales) · rank (master / director / manager / staff) | Roster received → SharpTalk issues console accounts the same day | P0-S | 10/27 | G21 |
| **WR-12** | **What counts as Sales** | Which enquiries are Sales (e.g. settlement, contract, commission): keywords and 5 – 10 example questions. Without it everything goes to CS | Criteria | P0-S | 10/27 | G22 |
| **WR-13** | **Hours, absence order, fallback** | Working hours per team (HCM time zone), order when nobody is available (proposal: backup agent → team queue → offline message), who takes enquiries with no region (no hotel selected) | Reply → SharpTalk enters the rules and shares a preview | P0-S | 10/27 | G23 |
| **WR-14** | **UAT test accounts** | One `Quản lý` (several hotels) + one `Lễ tân` (one hotel), covering hotels in at least two regions | Accounts sent over a secure channel | P0-S | 10/27 | G13 |
| WR-15 | Reconnect the Notion knowledge source | The source and its token were deleted together on 10/21, so the HA guide and FAQ are inactive. Sharing the same pages with the integration again restores them automatically | Sync succeeds | P0 | 10/30 | G30 |
| WR-16 | Knowledge conflict decisions | The 78 items classified on 10/15 (3 real corrections, 3 duplicate policy documents, 32 copied FAQs): which side to keep | Decision table | P1 | 11/06 | G31 |
| WR-17 | Golden set review | Confirm the answers of the 44 `#Talk-4-Hotel` questions (the regression baseline for engine changes and tuning) | Review result | P1 | 11/06 | G32 |
| WR-18 | Widget visibility and resume window | Current defaults: the widget shows the user's own conversations + "n earlier enquiries from this hotel"; the same agent is preferred for 24 hours | Keep / change | P1 | 11/06 | G14 · G15 |
| WR-19 | Zalo OA · ZNS templates | To send agent alerts over Zalo too | Approved OA and templates | P1 | TBD | G24 |

### 2.4 Infrastructure
| WR | Task | Detail | Done when | Prio | Due (proposed) | Ref |
|---|---|---|---|---|---|---|
| **WR-20** | **Production server + SSH + DNS + TLS** | `sharptalk.go2joy.vn` (no DNS record as of 10/23), Vietnam region. Pilot 4 vCPU / 8 GB / 80 GB; production 8 vCPU / 16 GB / 200 GB or more. Daily backup storage | SSH access delivered, DNS resolves | P0 | 10/30 | G1 |
| **WR-21** | **Production AI API keys (Go2Joy account and billing)** | Answer LLM (Anthropic Claude recommended) and embeddings (Voyage). Monthly limit and the person who receives exhaustion alerts | Keys delivered over a secure channel | P0 | 10/30 | G2 |
| WR-22 | Mail sender account | SMTP for agent alert mails | Account delivered | P1 | 10/30 | G3 |
| **WR-23** | **Partner API production credential + IP allow-list** | Production `partner.go2joy.vn` clientId · secret; allow the SharpTalk production server IP. This turns on the hotel info, room and region-table refresh in production | Credential delivered, connection test passes | P0 | After the server IP is fixed | G18 |

### 2.5 Go2Joy dev — Partner API questions
Where the Support Assistant API document and staging measurements (10/21 – 10/23) differ. Replies only; Go2Joy decides whether anything needs fixing.

| WR | Question | Observed | Prio | Ref |
|---|---|---|---|---|
| WR-24 | Partner staging vs HA UAT database | Hotel 4118: 21 rooms in Partner / 7 in HA, different prices and hours. Is production one database? | P1 | G19 ① |
| WR-25 | Room status codes | Meaning of 1 · 4 · 5; the codes for "pending approval" and "draft" | P1 | G19 ② |
| WR-26 | Room count and rooms left | Can the API give the number of rooms? Room Type List `numOfRoom` is always 2147483647 (unknown) | P1 | G19 ③ ⑥ |
| WR-27 | Region `10` | Province Feed returns 17 Manila cities with region `10`, but the documented enum is 1 – 5. Name and meaning? | P1 | G19 ⑤ |
| WR-28 | Hourly lookup error | Room Type List with `bookingType=1` (hourly) returns `code 0` | P2 | G19 ⑦ |
| WR-29 | Hotel Feed coverage and behaviour | Does it include every HA hotel (4118 is missing)? With no matching hotel it ignores the filter and returns everything | P2 | G18 · G34 |
| — | Document errata | Hotel Info path `getHotelnfo`; Room Type Feed v1 path shows a v2 response example; does the go-live procedure (3 test bookings) apply to SharpTalk, which uses no booking API? | P2 | G18 · G19 ⑧ |

### 2.6 Legal
| WR | Task | Detail | Done when | Prio | Due (proposed) | Ref |
|---|---|---|---|---|---|---|
| **WR-30** | **Privacy / PDPL review** | Cross-border transfer notice (processors Anthropic · Voyage, processing regions), whether a transfer impact assessment is needed, masking scope, conversation retention (draft 180 days), breach notification procedure | Written reply | P0 | 10/30 | G4 |
| **WR-31** | **HA terms URL and version, AI-use notice text** | For signed-in HA users the HA terms acceptance is recorded as widget consent and the consent banner is skipped; this needs the terms URL and version as its basis | URL · version · text delivered | P0 | 10/30 | G5 |

### 2.7 PM
| WR | Task | Detail | Prio | Due (proposed) | Ref |
|---|---|---|---|---|---|
| WR-40 | Owners and channel | Owners for PM, HA backend / FE, infra, operations (CS lead), legal, and the daily check-in channel | P0-S | 10/26 | G6 |
| WR-41 | Phase-2 schedule | B2C before / after booking, booking-completed webhook, Go2Joy app / web embed, HA menu (iframe · SSO), reception-agent operations, point billing, Zalo conversations, service-contract terms | P2 | November | G40 – G47 · G7 |

## 3. Timeline and dependencies
```
Mon 10/26  WR-02 signing key decision · WR-40 owners
Tue 10/27  WR-01 signing endpoint + T1–T5 · WR-10–14 teams, roster, criteria, accounts
           └ SharpTalk: secret handed over (same day), console accounts and routing rules (half a day)
Wed 10/28  WR-04 FE embed fix → identify 200, identified ok
10/29–30   WR-05 joint UAT · WR-15 Notion reconnect
Sat 10/31  Staging open (HA UAT → SharpTalk staging, real agents answer)

Production open = WR-20 server handover + about 7 working days
           SharpTalk install and go2joy configuration move, 4 days (needs WR-21 · 22 · 23)
           → production UAT, 3 days (needs WR-30 · 31)
```
- The 10/22 prerequisite deadline has passed, so **10/31 is a staging open, not a production open** (PLN-261015 decision).
- If WR-01 or WR-04 is late, staging can only open with the temporary unsigned mode. In that case we recommend not starting real agent service.

## 4. Done criteria — staging open
| Check | Expected |
|---|---|
| Sign in to HA → open the widget | identify **200**, `identified {ok: true}`, no consent banner, staff name in the greeting, "verified" in the console live chat |
| Console › Customers › Business | One hotel (name · province · region), the signed-in staff as a contact, room types as that hotel's products |
| Change the selected hotel | Business customer and conversation switch to the new hotel |
| "Talk to an agent" from hotels in 4 regions | Routed to the team mapped in WR-10, agent alerted |
| Widget after sign-out | Guest; earlier conversations not visible |
| Edit one package value without re-signing | 401, guest |

After that SharpTalk turns off the temporary unsigned mode on staging.

## 5. What SharpTalk does on receipt
| Received | SharpTalk work | Time |
|---|---|---|
| WR-02 decision (A) | Send the staging embed secret over a secure channel | Same day |
| WR-01 · WR-04 | Confirm verification, end the temporary unsigned mode (the province-name region fix stays; it is harmless) | Same day |
| WR-11 | Issue console accounts, assign teams and job labels | Same day |
| WR-10 · 12 · 13 | Team regions, "region match" routing rules, Sales keywords, hours and fallback → share a preview | Half a day |
| WR-31 | Enter the HA terms URL and version | Same day |
| WR-20 · 21 · 22 · 23 | Install SharpTalk on the Go2Joy server (VN profile), move the go2joy tenant, knowledge, region table (80 provinces) and rules, re-index, connect the Partner API | 4 days |
| WR-15 · 16 | Confirm the Notion re-sync, clean up knowledge conflicts | 1 – 2 days |

## 6. Reply table
Fill in and send to the daily check-in channel.

| WR | Owner | Feasible date | Status (in progress / done / on hold) | Note |
|---|---|---|---|---|
| WR-01 | | | | |
| WR-02 | | | | |
| WR-04 | | | | |
| WR-05 | | | | |
| WR-10 | | | | |
| WR-11 | | | | |
| WR-12 | | | | |
| WR-13 | | | | |
| WR-14 | | | | |
| WR-15 | | | | |
| WR-20 | | | | |
| WR-21 | | | | |
| WR-22 | | | | |
| WR-23 | | | | |
| WR-24 – 29 | | | | |
| WR-30 | | | | |
| WR-31 | | | | |
| WR-40 | | | | |

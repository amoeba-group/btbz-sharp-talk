# SharpTalk Chat & Customer Support Widget — User Manual (Integrated)

> Version 2.2.0 · First edition 2026-07-01 · Fully revised 2026-08-24 · **Updated 2026-10-24** (against the code — Agent handoff tab · consult categories · Alarm center)
> Audience: tenant operators · agents · platform administrators
> Legend: **✅ implemented / 🟡 in preparation·roadmap**. Marked honestly against the actual code.
> ⚠ AI-translated draft pending native review. The Korean edition is authoritative.
>
> If you are setting up for the first time, start with the [Quick Setup Manual](quick-setup.en.md);
> if you are refining knowledge and AI, see the [Knowledge & AI Setup Manual](knowledge-ai.en.md).
> This document is **the reference manual that walks every screen**.

---

## Table of Contents
1. [Getting Started (Login·Roles·Menu)](#1-getting-started)
2. [Customer Widget](#2-customer-widget)
3. [AI Response Flow (Summary)](#3-ai-response-flow-summary)
4. [Live Chat Console](#4-live-chat-console)
5. [Issue Board](#5-issue-board)
6. [Conversation History](#6-conversation-history)
7. [Work Log](#7-work-log)
8. [Statistics](#8-statistics)
9. [Dashboard](#9-dashboard)
10. [Customers·Orders·Products](#10-customersordersproducts)
11. [Campaigns](#11-campaigns)
12. [Reviews](#12-reviews)
13. [Knowledge & AI Settings (Links)](#13-knowledge--ai-settings)
14. [Tenant Settings](#14-tenant-settings)
15. [Privacy Notice·My Page](#15-privacy-noticemy-page)
16. [Platform Admin Console](#16-platform-admin-console)
17. [FAQ / Troubleshooting](#17-faq--troubleshooting)

---

## 1. Getting Started

### 1.1 Accessing the console
- Tenant console: `https://shoptalk.amoeba.site/user/<slug>` — a store-specific login address.
- Platform administrators: `/admin/login`.
- Login is email + password (JWT). Invited accounts sign in first with a **temporary
  password** and then go through a **forced change** (10+ characters · 3 character classes ·
  no common passwords).
- master/director and system administrators are **required to enroll MFA (TOTP)** (a grace
  banner before the enforcement date → a blocking modal after). At enrollment, the 10
  recovery codes are shown **only once**.
- Full onboarding procedure: [Quick Setup Manual, Chapters 1–2](quick-setup.en.md).

### 1.2 Roles & permissions (RBAC)
- **Ranks**: master · director · manager · staff / **duty labels**: consult ·
  accounting · operations. System administrators: super · admin.
- Menu visibility is **2-tier**: ① the menus the platform administrator provides to the
  tenant (plan defaults + exceptions) → ② the per-rank permissions plus per-user exceptions
  the tenant master sets (the *Menu access* card in [Settings]). Typing a URL directly is
  re-validated and blocked by the server.
- The owner-visibility policy (ACL) applies on top of feature permissions.

### 1.3 Console menu
Clicking the sidebar logo opens the **card list of accessible screens** (`/menu`).

| Menu | Path | Purpose |
|---|---|---|
| Dashboard | `/dashboard` | KPIs·popular questions·integration status |
| Live chat | `/live-chat` | Real-time support·handoff handling |
| Issues | `/issues` | Inquiry-ticket kanban board (native-workflow tenants) |
| History | `/history` | Browse past conversations·verify evidence |
| Work log | `/work-log` | Audit trail of agent actions |
| Statistics | `/statistics` | Question analytics·channels·agents·outcomes·satisfaction·hours |
| AI settings | `/ai-setting` | Agents·persona·rules·scenarios·built-in conversations·engine wiring·moderation·coaching |
| Knowledge | `/knowledge` | Knowledge board (`/knowledge/board`)·documents·sources·validation |
| Customers / Orders / Products | `/customers` `/orders` `/products` | Browse·manage cached data |
| Campaigns / Reviews | `/campaigns` `/reviews` | Sending·review management |
| Users | `/users` | Team invites·ranks·labels |
| Tenant settings | `/settings` | 8 tabs: Basic settings / Agent handoff / Widget settings / Platform integrations / Marketing & helpdesk / Messenger channels / Other settings / Privacy notice (§14) |
| Alarm center | `/live-chat/alerts` | Handoff alarm history·assignment·acknowledgement (header 🔔 → View all, §4.4) |
| My page | `/my-page` | Profile·password·MFA |
| Admin | `/admin/*` | Platform administration (system administrators only) |

---

## 2. Customer Widget

### 2.1 Screen layout
- The **launcher** on the shop page (position·size·icon set by the tenant theme settings) →
  clicking opens the panel (full screen on mobile / floating card on desktop).
- Header: store display name (or logo), **language switcher** (6 languages en/es/ko/vi/ja/zh
  — switching also updates the session language on the server, changing the AI answer
  language), settings (gear), close.
- **Tabs**: notifications / orders / chat — which tabs show, in what order and position
  (top/bottom), follows the tenant settings. With only one tab, the tab bar itself hides.

### 2.2 Notifications & orders tabs
- Notification tab chips: `All · Events` / order tab chips: `Orders (order list) · Shipping ·
  Reviews · Inquiries`. **Turning one tab off absorbs its chips into the remaining tab** —
  disabling a tab never loses the feature.
- Items: icon·title·status badge·body·relative time·unread dot. The latest unread item is
  highlighted.
- **Order detail**: line items·totals·shipping-tracking stepper·**Track shipping**·**Ask
  about this order** (feeds the order number into chat)·per-item **Write a review** (1–5
  stars + comment).
- The inline order list shows only the recent window; "See more" links to the shop's own
  My Page (the order-list page on Cafe24, the account page elsewhere).

### 2.3 Chat tab
- Top: **AI-consultation disclosure** + **End chat** link (only while in progress).
- **Consent banner**: shown on first entry or when the notice version changes. Before
  consent, features requiring personal data are restricted.
- **Scenario buttons**: the quick menu the tenant configured (6 defaults). Product help
  opens a submenu (usage·ingredients·exchange/return·restock). After an answer, quick chips
  (my orders/shipping/returns/connect to agent) are appended.
- **Identity verification (AuthGate)**, 2 methods: ① store login — redirect (default) or
  popup per tenant setting, Cafe24/Shopify login paths handled automatically, widget
  auto-reopens on return ② guest order lookup — order number + email (rate-limited).
- **Attachments**: images ≤10MB (HEIC included — auto-converted) / files ≤20MB
  (pdf·txt·csv·docx·xlsx), max 5 per message. Sending files alone is also possible.
- **Consult category picker**: if the tenant has consult categories shown to customers,
  pressing [Connect to an agent] first brings up a "What do you need help with?" card, and
  the conversation is connected to the group responsible for the chosen consult category.
  When the AI hands off to an agent, the same card appears below the notice; picking one
  reconnects the conversation to that category's group (once, on the first pick, while no
  agent has accepted). [Skip] connects as before. If no consult categories are shown, the
  conversation connects directly without the card (§14.1).
- **Waiting indicators**, 3 kinds: AI generating / agent responding / awaiting handoff
  (no agent assigned yet).
- **Closing & satisfaction**: when the customer ends the chat, it closes after confirmation.
  A closed conversation shows a **satisfaction card (5-level emoji = 1–5 points)** within 24
  hours. Sending a new message starts a new conversation.

### 2.4 Settings (gear)
- **Consent management**: view status·time·version, withdraw (2-step confirmation —
  withdrawal stops the conversation), re-consent.
- After login: **marketing opt-out** (a single toggle — declines promotions·coupons·review
  requests; order/shipping notifications are sent regardless), **do-not-sell/share**
  (CCPA/CPRA), **export my data** (JSON download), **delete my data** (2-step confirmation
  — on completion the widget resets to a logged-out state).
- The category×channel subscription matrix was removed from the widget and relocated to
  **store policy (the console's notification channel settings)**.

---

## 3. AI Response Flow (Summary)

```
Customer message → intent classification (identity-verification prompt if personal data is needed)
  → if policy-forced handoff (deny-list) matches:
      "No answer" rule → straight to an agent with no AI
      "Answer, then hand off" rule → answer from knowledge first, then hand off anyway
  → knowledge search (RAG) → answer generation (persona+rules, confidence scoring) → moderation
  → confidence sufficient: answer + sources to the customer / low·blocked·customer request: agent queue
```

- Agent-sent messages pass moderation identically (non-bypassable; blocked on failure).
- How to adjust each point of the pipeline: [Knowledge & AI Manual](knowledge-ai.en.md).

---

## 4. Live Chat Console
*(`/live-chat` · holders of the consult label)*

Three columns: **queue (left) — conversation (center) — context (right)**. Lists
auto-refresh every 5 seconds.

### 4.1 Queue (left)
- Scope: **All / Needs attention / Closed** (default All — conversations the AI is handling
  are visible too). The **Groups** tab on the second row is session grouping (§4.5).
- Channel filter + **AI-agent filter** (all agents / per agent). Customer name/email search.
  Channels: Widget·Telegram·Viber·Zalo·LINE·WhatsApp·WeChat·KakaoTalk·SMS·Email —
  conversations arriving through the btbz relay also show their original messenger name.
  **SMS is receive-only**: it carries a badge and replying is disabled.
- Each row: **session alias** (editable inline by agents; falls back to customer name →
  email → session ID), channel·status badges, the assigned AI-agent chip, an "auto-reply
  OFF" chip, the last message, and elapsed time.
- **Pin**: hover a row to reveal the pin icon. Pinned conversations always sit at the top
  of the list — **shared by the team, max 3 per store** (a 4th is refused; unpin one first).
- The filter/search rows stay fixed while scrolling; only the inner area of each of the 3
  panes scrolls.

### 4.2 Conversation (center)
- Header **auto-reply control**: `Follow channel default / Automatic / Send after approval /
  Off` + a current-state badge (AI responding / agent responding / awaiting approval). Once
  an agent takes over, agent handling takes precedence regardless of this setting.
- Buttons: **[Accept]** (take over — assigns ownership), **[Hand back to AI]** (only from
  agent state — returns the conversation to the AI, confirmation modal), **[End]**,
  **[Sync]** (manual refresh), **[Pin/Unpin]**, **[Assign]** (change the owner to another
  AI agent or a human agent — an AI-agent change applies **from the next response**).
- **4 customer-message actions** — appear on hover over a customer bubble (hidden while
  the AI is auto-answering the conversation):
  | Action | What it does |
  |---|---|
  | Translate | Pick a language → a **console-only** translated bubble under the original (invisible to the customer) |
  | Look up in knowledge | Copies the message into the knowledge-lookup panel on the right and queries it |
  | Quote reply | Shows a quote chip above the composer — the quotation is assembled into the message on send |
  | File this message as an issue | Creates an issue from an excerpt+type+memo (added as a memo if this conversation already has an issue) |
- **Send-after-approval mode**: the AI draft appears in an editable panel (with confidence
  shown); **[Approve & send]** sends it in the agent's name (moderation·audit apply
  identically). **[Discard]** is also available.
- **Composing messages**: text + attachments (same limits as the customer widget — images
  10MB/files 20MB/max 5). If sending is refused, it is a moderation block — rephrase and
  retry. **The SMS channel is receive-only**, so composing is disabled.
- Under an AI answer bubble, **[Save as knowledge]** (master/director only): captures the
  answer as a knowledge document draft.
- Older messages load via "Load earlier messages".

### 4.3 Context (right)
- **AI briefing**: summary of the conversation so far·intent·sentiment·recommended actions.
  (When a group is selected, this spot becomes the **customer journey report** panel — §4.5.)
- **Knowledge lookup**: ask the knowledge base directly mid-conversation (one click inserts
  the last customer message) → check the answer·sources (stale/conflict badges, document
  shortcuts) → **[Send to customer] / [Edit & send] (fills the composer) / [Propose as
  knowledge]** (queued for the knowledge owner's approval).
- **Customer card**: name·email·phone·tier + **customer matching** (search & link) /
  **create customer**.
- **Recent orders** card.
- **Issue panel** (native-workflow tenants): issue number·status·type·reopen count,
  [Resolve]/[Decline] (reason required: policy-impossible/misassigned/spam), reassignment
  selector, event timeline.

### 4.4 Handoff alerts · Alarm center · auto-wrap-up
- **Escalation alarm**: when a new handoff occurs, wherever you are in the console an alert
  popup appears within 10 seconds. The popup shows the reason (low confidence/moderation
  block/customer request/reconnected by consult category pick) together with the
  **hotel·region·consult category**, **Assigned: agent name** ("Everyone" when no rule
  matched), and the **rule name**. Alarms are visible to every agent of the same tenant;
  those assigned to another agent are marked *Assigned to someone else*.
  - **[Close]**: hides it on your screen only (marked read). The assignee's alarm and
    re-alerts stay as they are.
  - **[Open chat]**: goes to the conversation. If you are the assignee or the alarm is for
    everyone, it is **acknowledged** (re-alerts stop).
- **Header 🔔**: unread alarm count. Click it to open the latest 20 alarms (read state·
  assignment·status·acknowledged by); *View all* goes to the **Alarm center**
  (`/live-chat/alerts`).
- **Alarm center**: filter by All / Assigned to me / Everyone, status (unacknowledged·
  acknowledged), period (1·7·30·90 days), and consult category. Click a row to go to the
  conversation; alarms you can acknowledge have an [Acknowledge] button.
- **Alarm settings (personal)**: *Alarm settings* in the 🔔 drawer or the Alarm center —
  popup (All alarms / Only those assigned to me (incl. everyone) / Off), sound (with
  preview), browser desktop notifications (browser permission required), and email me when
  assigned. Even with the popup off, everything stays in 🔔 and the Alarm center.
- The live chat conversation header shows the consult category the customer picked as a
  `Consult: Payment` badge, and it is also recorded as a system line in the conversation.
- **Idle conversation auto-wrap-up** (server behavior, widget channel only): if both sides
  are silent for 30 minutes it sends "Is there anything else we can help with?", and closes
  after 1 more minute of silence. Conversations older than 7 days are closed quietly.
  Conversations awaiting an email reply are never auto-closed.

### 4.5 Session grouping & customer journey report
- **[Select]** in the list header → check 2 or more sessions → **[Create group]**. Two
  types: **timeline** (one customer's sessions in time order) / **project** (conversations
  of the parties involved in the same case). You can create a new group or add to an
  existing one.
- **Group room** (entered from the queue's *Groups* tab): all member sessions merged into
  one timeline. Sending is **1:1** — pick a **recipient** first. In the group settings you
  can remove members or **dissolve the group**; dissolving keeps every conversation and
  message intact.
- **Customer journey report** (right panel while a group is selected): **[Generate
  report]** (whole period / custom range) → ① Summary ② Contact history ③ What they ask
  ④ Resolution time ⑤ Customer path (5A) ⑥ Needs (hypothesis) ⑦ Next actions. **The
  numbers are counted by code; only the narrative is written by AI** — a large group takes
  tens of seconds and you may leave the screen. Pick two past reports for a **comparison
  analysis** (a warning shows when their criteria versions differ).
- The report's **writing criteria** (section on/off·top-question count·sample cap·quote
  length·banned phrases) are managed in *Journey report criteria* under [Tenant settings →
  Other settings] (master only). Saving mints a new version; existing reports keep the
  version they were written with.

---

## 5. Issue Board
*(`/issues` · only for tenants whose workflow mode is **native** — otherwise only a notice is shown)*

A **kanban board** that manages inquiries as tickets (issues).

- Columns: `Open → In progress → Resolved / Declined → Closed` (only allowed moves can be
  dragged — an invalid move snaps back. On touch devices use the card's move selector).
- Top KPIs: open·in progress·**unassigned**·average resolution time·reopen rate (30-second
  refresh).
- Cards: issue number·type·**SLA badge (⚠️ approaching / 🔥 exceeded)**·reopen count·session
  alias·customer's last utterance·assignee (label badge+name, or unassigned)·**urgent/normal
  toggle**.
- **Declining** requires a reason (policy-impossible/misassigned/spam + memo). Reopening is
  possible after resolve/decline.
- Card click → a read-only preview of the last 10 turns (viewing is recorded in the audit
  log) → [Open session] enters live chat.
- The customer-message action **[File this message as an issue]** in live chat (§4.2) also
  creates issues.
- SLA baseline hours are set on the [Tenant settings → Agent handoff] tab
  (normal/urgent, 1–168 hours, defaults 24h/4h).
- The workflow mode (whether native) is the platform administrator's **Plan/Add-ons**
  setting (§16) — with the menu provided but the mode off, only a notice screen shows.

---

## 6. Conversation History
*(`/history`)*

- Filters: period · assignee (consult-label holders) · status · escalated or not · **message
  body search** (runs via the search button — searches are audit-logged) · whether to
  include preview conversations.
- Row click → full-conversation modal: customer/assignee/channel/**language**/start·end
  metadata + per-utterance bubbles. **Every AI answer shows evidence-document chips
  (title+similarity; click to open the knowledge document) and a confidence badge**, so you
  can trace why it answered that way. Handoff moments carry a reason badge.
- Viewing is recorded in the audit log (notice at the bottom of the modal). Export (CSV,
  etc.) is 🟡 not provided.

---

## 7. Work Log
*(`/work-log`)*

The audit trail of agent actions (an agent lens over the same store as the admin audit log).
Filters: period·agent·action (accept/message sent/customer linked/customer created/
closed/conversation viewed/full-text viewed).
Columns: time·agent·action·target·result (success/failure).

---

## 8. Statistics
*(`/statistics` · one shared date filter, default last 30 days)*

Six top-level sections — **Question analytics / Channels / Agents / Outcomes /
Satisfaction / Hours**.

- **Question analytics**: 4 sub-tabs (**intent / knowledge used / keywords / similar-question
  groups**). Trend chart + table (count·share·**escalation rate**·**no source**·**average
  confidence**). ⚠-marked rows have a high escalation rate or low confidence — **your
  knowledge-reinforcement priority list** (in *knowledge used*, clicking a row jumps to the
  document). Built on daily snapshots, so the numbers survive conversation-log deletion; a
  warning banner appears if aggregation has stalled for 2+ days.
- **Channels**: per-channel conversations·customer messages·**messages per conversation
  (median)**·agent handoffs. Read the median first — a single conversation with hundreds of
  turns drags the average far away.
- **Agents**: an **AI agents** table and a **human agents** table. Conversations·replies
  sent·resolved·satisfaction (the rating count is shown alongside — interpret thin samples
  with care).
- **Outcomes**: how ended conversations finished. Resolved (customer rated / agent closed /
  closed after confirmation) vs unresolved (in progress / ended without closure / **customer
  spoke last**). The **same definition** as the customer journey report and the dashboard —
  a conversation where the customer spoke last still had a question, so it never counts as
  resolved.
- **Satisfaction**: average rating·responses·response rate·1–5 distribution + **per-agent /
  per-session** tables (rating·agent filters).
- **Hours**: a weekday×hour grid (customer messages) — computed in **the tenant's
  timezone**, with a warning that UTC is used when no timezone is configured.

The Channels·Agents·Outcomes·Hours sections are computed directly from conversation logs,
so **history beyond the retention window is not queryable** (Question analytics and
Satisfaction persist as snapshots).

---

## 9. Dashboard
*(`/dashboard`)*

- 6 KPIs (each linking to its screen): conversations in progress · today's notifications ·
  AI resolution rate · unresolved Top N · total conversations · total orders.
- **AI resolution rate** = the share of ended conversations whose customer question was not
  left unresolved — the same definition as the statistics *Outcomes* section and the
  customer journey report. Conversation counts include only real customer conversations,
  **excluding AI-settings preview sessions**.
- **Popular questions** ranking, **integration status** (a badge per provider —
  Shopify·Cafe24·Odoo·Haravan·Klaviyo·Yotpo·Notion·Google Drive, etc.; "connected" means
  the **connection test passed**, not merely saved credentials, §14), **5 most recent
  orders**.

---

## 10. Customers·Orders·Products

### 10.1 Customers (`/customers`)
A list (name·email·**tier**·order count·total spend·signup date) + email search. The only
editable thing is the **tier change** (guest/subscriber/regular). Tiers are used to segment
customers in widget·AI responses.

### 10.2 Orders (`/orders`)
A read-only list of orders synced from the platform (order number·status·amount·item
count·date).

### 10.3 Products (`/products`)
Browse the synced product catalog (archived products included).
- KPIs: total·active·archived·**knowledge-registered count** (with last sync time).
- The **knowledge-registered badge** in the list is what matters — a product marked `none`
  **cannot be used by the AI in answers.** Check description·tags·SKU in the detail modal.
  Products with no description at all are not converted into knowledge (explicitly marked
  in the detail).
- The procedure to push products into knowledge (catalog sync):
  [Knowledge & AI Manual, Chapter 2.2](knowledge-ai.en.md).

---

## 11. Campaigns
*(`/campaigns` · operations)*

- Creation fields: name · **channel (email / sms / kakao)** · message · **link** (none /
  product handle / https URL — validity is checked at send time).
- Clicking **[Send]** in the list **sends immediately (no confirmation dialog)** — be
  careful.
- 🟡 Scheduled sending·audience builder UI are on the roadmap. The current flow is create →
  send immediately.

---

## 12. Reviews
*(`/reviews`)*

The management list of product reviews customers left in the widget (customer·order
item·stars·body·status). The only action is **hide ↔ unhide** — a hidden review **remains
visible to its author** (only store exposure is removed).

---

## 13. Knowledge & AI Settings

Knowledge registration (manual/catalog/CSV/external sources), validation (QA panel·conflict
review·gap proposals), AI settings (agents·persona·rules·scenarios·engines·moderation·
answer reuse), and the improvement loop (preview·coaching·regression checks) are all
organized in the **[Knowledge & AI Setup Manual](knowledge-ai.en.md)**.
For per-screen deep dives, see AI-SETTINGS-GUIDE.

The essentials:
- The AI answers **only from active knowledge documents**. Frequent handoffs mean missing
  knowledge.
- Knowledge follows the standard path of being drafted and reviewed on the **Smart
  Knowledge Board** (`/knowledge/board`) first, then **adopted** into the KB (with a
  pre-adoption simulation). Adding documents directly is for emergency fixes.
- Knowledge is organized by 3 groups (CounselInfo / ProductInfo / OperationInfo) ×
  categories, and a category's **agent scope** can limit it to specific AI agents.
- Bulk tools: **bulk download ↔ bulk import** (CSV/XLSX round trip), **AI import**
  (pdf·docx·xlsx·csv·md·YouTube captions → draft review → board publish).
- All outbound messages (AI·agent) pass moderation. On error, they are safely **blocked**.
- AI coaching·settings changes go through an **approval gate** — review proposals before
  applying.

## 14. Tenant Settings

`/settings` has **8 tabs** (formerly a single "Settings" screen → 7 tabs on 2026-08-24 →
the *Agent handoff* tab split out on 2026-10-24). Tabs are also menu-provisioning units —
a tab the platform administrator does not provide is invisible (the *Agent handoff* tab is
provided together with *Basic settings*).

| Tab | Contents |
|---|---|
| Basic settings | **AI engines** (register the tenant's own engines — used ahead of platform engines; connection test·default selection; calls on your key are billed to your account) · **AI usage** (calls/tokens by period and axis, stub-fallback warnings — no cost estimates) · Storefront · **Knowledge options** (whether the "usage guides" card is shown on the Knowledge page — for shop-type tenants, off by default) |
| Agent handoff | Assigned agents · **Routing rules** (consult category × topic × customer information → agent group, **Check routing**·warnings, **Manage consult categories**) · re-alerts for unaccepted handoffs · business hours·breaks · off-hours email/copy · SLA · policy-forced handoff (§14.1) |
| Widget settings | Widget theme (brand colour·header·logo·launcher position) · **Custom widgets** (build several named designs — font, text size, corners, panel size, launcher icon — keep them here and apply one with **[Use]**: live immediately, no deployment; **[Back to basic widget]**, preview link, duplicate, JSON **package export/import**, **History** (every save keeps the previous state for restore), archive·delete. The sanitized-CSS box appears only for tenants the platform administrator has enabled the add-on for) · **Design files** (fonts woff2/ttf/otf·icons·images·design docs uploaded to this tenant's own folder — survive deployments, usage shown per area) · tab layout · behaviour (display name·greetings — **6 language tabs**, with the shipped default copy shown) · Embed/SDK · store install guide — details: [Custom Widget Manual](custom-widget.en.md) |
| Platform integrations | Shopify · Cafe24 · WooCommerce · Odoo · Haravan tiles + the **[Integration guide]** button top-right (where to find each credential) |
| Marketing & helpdesk | Klaviyo · Yotpo · Gorgias |
| Messenger channels | Telegram · Viber · AmoebaTalk hub · btbz messenger relay · Gmail (Zalo·LINE·WhatsApp planned) |
| Other settings | Notification channels · menu access (master) · journey report criteria (master, §4.5) · stored integration credentials · **Settings snapshots** (12 settings fields — widget theme·copy·tabs·notifications etc. — plus the custom widget library saved as one JSON file; diff then restore, download, delete; credentials and secrets are never included) |
| Privacy notice | Policy URL · consent notice version (§15) |

- **Saved ≠ connected**: saving credentials sets the status to "untested". Only passing the
  **[Connection test]** flips it to "connected" ("error" on failure) — the dashboard's
  integration badges follow this status.
- Odoo·WooCommerce·Haravan pull data via **[Import products] / [Sync orders]** in their
  config modals (Cafe24 has its dedicated OAuth card; Shopify has [Sync now]+[Register
  webhooks]). For the AI to use imported products, the catalog sync in [Knowledge] is a
  separate step (§10.3).
- **Policy-forced handoff (deny-list)** rules carry one of two customer-facing modes:
  **No answer** (straight to an agent with no AI — the default) / **Answer, then hand
  off** (answer from knowledge first, then hand off) — either way an agent is called.
### 14.1 Agent handoff — consult categories and routing rules

A **consult category** is the consult topic the customer picks in the widget (e.g.
Booking · Payment · Room listing). Manage them via **[Manage consult categories]** in the
routing rules header.
- Add one with a code (letters·digits·_) and a name. **The code cannot be changed after
  creation**; the name and order can be changed at any time.
- **Shown/Hidden**: only Shown categories appear on the widget card (new ones default to
  Shown).
- **Per-language names** (▸ expand): the name in the customer's language is shown if
  present, otherwise the default name.
- A consult category used by a rule, team, or label cannot be deleted; you are told where
  it is used.
- The 👁 mark on a rule chip means the consult category is shown to customers.

**Routing rules** are checked from the top, and the conversation is connected to the
**agent group (team × label)** and individually designated agents of the **first rule whose
consult category · topic · customer information all match**. If no rule matches, the
assigned agents are notified; if there are none, everyone is notified.
- **Consult category** line: compared only with the value the customer picked. Customers
  who did not pick one only match rules with an empty consult category.
- **Topic** line: looks at question keywords and labels attached by *policy-forced handoff
  (deny)* rules. Label chips on the topic line only match conversations handed off by a
  policy rule, so pick agent-group labels under *Assignee* below.
- **Customer information** line: Region (North·North Center·Central·South Center·South —
  the hotel region signed and sent by the host app), province, language, verification
  level, customer tier·type, hotel, role, entry path.
- Example: *Payment · South* = consult category Payment + Region South·South Center → team
  South × label accounting.
- When the customer picks a consult category, its rules are followed instead of the
  previous-agent-first connection.

**Check routing**: enter a consult category·region·province·language in the box above the
rules and press [Check] to see, **using the rules being edited, before saving**, who the
conversation would be connected to and why rules were skipped (consult category mismatch·
region condition mismatch·0 assignable agents, etc.). No alarm is sent.

**Warnings** (they do not block saving): ① misuse of topic labels ② a region name in the
rule name but no region·province condition ③ 0 agents assignable right now (members who
have not yet accepted their invitation are shown). Users who have not accepted their
invitation are not assigned.

→ Screen-by-screen walkthrough (units & labels → consult categories → routing rules → customer request → alarms): [Agent Assignment Guide](agent-assignment.en.md)

→ [Quick Setup Manual, Chapters 3–4](quick-setup.en.md) ·
widget settings guide

---

## 15. Privacy Notice·My Page

- **Privacy notice** (a tab of [Tenant settings], `/settings/privacy` — the old
  `/privacy-notice` address redirects automatically; master/director): manages the policy
  URL and the **consent notice version**. ⚠️ **Bumping the version re-displays the consent
  banner to every customer** — bump only when the notice actually changes.
- **My page** (`/my-page`): profile (rank·labels·workspace), password change, MFA
  enroll/remove.

---

## 16. Platform Admin Console
*(`/admin/*` · system administrators)*

| Screen | Path | Purpose |
|---|---|---|
| Overview | `/admin` | Tenant count·integration status |
| Tenants | `/admin/tenants` | Create (name·slug·domain·plan) · **Plan/Add-ons** · **provided menus** · suspend/activate |
| Tenant users | `/admin/tenants/…/users` | Invite · **temporary password issuance (shown once·no email sent)** · MFA reset · suspend |
| AI engines | `/admin/ai-engines` | Register engines (provider·model·API key)·manage activation — tenants pick per function |
| Audit log | `/admin/audit` | Tracking privileged actions (temp password issuance·permission changes·PII views, etc.) |

- **Plan/Add-ons** modal: the plan (`starter`/`growth`/`enterprise`/`custom` — each plan
  presets the provided menus; per-menu overrides survive a plan change) + the **issue
  workflow add-on** (`base` off / `bridge` external-helpdesk link / `native` issue
  board·kanban on). In the list, a non-base mode shows as an "Issues: {mode}" badge in the
  plan column.
  Only tenants with the **Allow custom widget CSS** checkbox on can add sanitized CSS to a
  custom widget (stable `.st-*` classes and colour/font/spacing properties only). The **Files**
  column in the tenant list is the space used by the tenant's folder (design files·snapshots).

Full tenant-creation procedure: [Quick Setup Manual, Chapter 1](quick-setup.en.md).

---

## 17. FAQ / Troubleshooting

**Q. The bot keeps handing off to agents.**
Missing knowledge is the most common cause. Find the cause via the ⚠ rows in statistics
(`/statistics`) and the knowledge QA panel, then reinforce the documents. Also check
whether the keyword matches the deny-list (policy-forced handoff) — a "No answer" rule
skips the AI intentionally, and an "Answer, then hand off" rule calls an agent even after
answering. The document's category may also carry an **agent scope** that hides that
knowledge from the current agent.

**Q. An agent's reply won't send.**
That is a moderation block. Rephrase and retry; if the rules are excessive, ask the master
to adjust them.

**Q. A conversation closed by itself.**
That is idle-conversation auto-wrap-up (30 min silence → notice → close, §4.4). When the
customer messages again, a new conversation starts.

**Q. I can't see the issue board.**
It is exclusive to tenants whose workflow mode is native — check that the platform
administrator's **Plan/Add-ons** setting says `native`. If the menu itself is missing,
check the provided menus/rank permissions (2-tier).

**Q. The settings screen looks different from older descriptions.**
`/settings` has **8 tabs** (Tenant settings, §14). Since 2026-10-24, agent handoff has
its own **Agent handoff** tab, and menu access is on the *Other settings* tab.

**Q. A customer asked for an agent, but the consult category card doesn't appear.**
Check in [Agent handoff → Manage consult categories] that at least one consult category is
**Shown**. If none are shown, the conversation connects directly without the card.

**Q. I created a rule, but conversations aren't assigned to the team I specified.**
Enter the same conditions in **Check routing** above the rules — it shows why rules were
skipped. Common causes: using label chips on the topic line, a missing region condition, or
team members who have not yet accepted their invitation (0 assignable agents).

**Q. Dashboard/statistics numbers dropped compared to before.**
That can be normal — conversation counts now **exclude AI-settings preview sessions**, and
with the unified "resolved" definition, conversations where the customer spoke last no
longer count as resolved (§8·§9).

**Q. I changed widget settings but nothing changed.**
The widget reads new settings from the customer's **next session**. Close and reopen the
widget, or refresh.

**Q. A customer isn't receiving notifications (email, etc.).**
Check, in order: ① the channel is enabled in the console's notification channel policy
② the customer opted out of marketing (affects promotional messages only). A channel the
store disabled cannot be enabled by the customer.

**Q. I changed temperature but answers stayed the same.**
temperature is not applied to Anthropic (Claude) engines (the model rejects it, so it is
not sent). Only max_tokens is effective.

**Q. It works even though there is no AI key.**
Those are demo responses from the stub adapter. Be sure to register and assign a real
engine before production.

**Q. I hid a review but the customer still sees it.**
That is by design — hiding only removes store exposure; the review stays visible to its
author.

---

*Related documents: [Quick Setup Manual](quick-setup.en.md) ·
[Knowledge & AI Setup Manual](knowledge-ai.en.md) ·
widget settings guide · AI-SETTINGS-GUIDE ·
mobile app integration guide (WebView·Android SDK) ·
service introduction · SPEC.md*

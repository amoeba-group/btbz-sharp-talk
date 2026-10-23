# SharpTalk Quick Setup Manual — From Tenant Creation to the First Conversation

> Version 1.2 · First published 2026-08-24 · **Updated 2026-10-24** · Written against the code
> Audience: **Platform administrators** (Chapter 1) · **New tenant administrators** (Chapters 2–8)
> Online edition: https://shoptalk.amoeba.site/manual (HTML edition plus EN·VI translations)
> Legend: ✅ implemented / 🟡 in preparation·roadmap. Staging base URL `https://shoptalk.amoeba.site`
> ⚠ AI-translated draft pending native review. The Korean edition is authoritative.

This document covers only the shortest path from opening a new store (tenant) to **the
chat widget actually serving customers**. For in-depth knowledge and AI configuration, see the
[Knowledge & AI Setup Manual](knowledge-ai.en.md).

---

## Table of Contents
0. [Before You Start](#0-before-you-start)
1. [<Platform Admin> Creating a Tenant](#1-creating-a-tenant)
2. [<Tenant Admin> First Login](#2-first-login)
3. [Commerce Platform Integration](#3-commerce-platform-integration)
4. [Chat Widget Setup & Installation](#4-chat-widget-setup--installation)
5. [Minimum AI Configuration](#5-minimum-ai-configuration)
6. [Initial Knowledge Entry](#6-initial-knowledge-entry)
7. [(Optional) Team Invites & Handoff Settings](#7-optional-team-invites--handoff-settings)
8. [Completion Checklist](#8-completion-checklist)
9. [Troubleshooting](#9-troubleshooting)

---

## 0. Before You Start

**Terms**

| Term | Meaning |
|---|---|
| Tenant | One store hosted on SharpTalk. Data, settings, and knowledge are fully isolated per store |
| Slug | The tenant's dedicated login URL fragment. Appended to the address like `https://shoptalk.amoeba.site/user/ivyusa` |
| Platform administrator | A SharpTalk operator admin who logs in at `/admin` (has tenant-creation rights) |
| Tenant administrator (master) | The highest rank in the store console. Manages all team members, permissions, and settings |
| Temporary password | A one-time password issued by the system at invite time. **Shown on screen only once** |

**What you need**
- A platform administrator account (`/admin/login`)
- The **shop domain** of the store to create (e.g. `example.myshopify.com`, `mallid.cafe24.com`)
- The **email address** of the person to invite as tenant administrator
- Credentials for the platform to integrate (see Chapter 3 — prepared by the tenant administrator)

**Time required**: ~5 min of admin work + ~30 min of initial tenant setup (excluding platform integration approval wait)

---

## 1. Creating a Tenant
*(Platform administrator · `/admin/tenants`)*

### 1.1 Create a new tenant

`/admin/tenants` → **[New tenant]** button → fill 4 fields in the modal:

| Field | Required | Description |
|---|---|---|
| Name | ✅ | Display name of the store |
| Login path (slug) | — | Auto-derived from the name if left blank. Lowercased automatically when typed |
| Shop domain | ✅ | The store's primary domain. `*.myshopify.com` for Shopify, the mall domain for Cafe24, etc. — **shared across all platforms** |
| Plan | ✅ | `starter` / `growth` / `enterprise` / `custom` — the default menus provided differ by plan. After creation, change it via **[Plan & add-ons]** on the tenant row (the issue-workflow add-on base/bridge/native lives there too) |

💡 **Tip — slug rules**: lowercase letters, digits, and hyphens only; it cannot collide with
console screen names (reserved words such as `admin`, `login`, `dashboard`, `settings`). If you
enter a reserved word, the server automatically appends a `-shop` suffix. Since the slug is
the login URL itself, choose a value the store can remember easily.

### 1.2 (Optional) Adjust provided menus

On the tenant row, **[Provided menus]** → three-way choice per menu:

| Mode | Meaning |
|---|---|
| Follow plan | Keep the plan default (default) |
| Force provide | Provide to this tenant regardless of plan |
| Block | Withhold regardless of plan |

The result column updates immediately, and rows with an exception show a `*`.

💡 **Tip**: A menu blocked here stays invisible even if the tenant master grants rank
permissions for it (2-tier structure: admin provisioning → tenant-internal permissions).
The issue board also requires the workflow mode to be configured.

### 1.3 Invite the tenant administrator + issue a temporary password

On the tenant row, **[Users]** → `/admin/tenants/…/users` → **[Invite user]**:

1. Enter the `email`; keep `rank` at the default **master** (this is the first administrator)
2. Click **[Invite]** → a **temporary password modal** appears immediately

```
┌─ Temporary password issued ──────────────────┐
│ Temporary password for user@shop.com          │
│ ┌──────────────────────────┐                 │
│ │  TmpXXXXXXXXX!           │   [Copy]        │
│ └──────────────────────────┘                 │
│ ⚠️ This value is shown only once, right now.  │
│    Deliver it through a secure channel;       │
│    it must be changed at first login.         │
└──────────────────────────────────────────────┘
```

> ⚠️ **The temporary password is NOT sent by email.** The administrator must copy the value
> shown once in this modal and **deliver it directly**. If you closed the window and lost the
> value, reissue it with the **[Temp password]** button on that user's row (the previous
> value is invalidated).

💡 **Tip — secure delivery**: Never leave the password in an email body or a group chat.
Deliver it via a 1:1 secure messenger or a phone call, and consider the creation procedure
complete only after confirming the first login (= forced change) has happened. Every
issuance is recorded in the audit log (`/admin/audit`).

### 1.4 Hand over the login URL

The card at the top of the same screen shows this tenant's **login page URL**
(`https://…/slug`). **[Copy]** it and hand it over together with the temporary password.

Three things to deliver: ① login URL ② email (account ID) ③ temporary password

---

## 2. First Login
*(Tenant administrator · `https://shoptalk.amoeba.site/user/<slug>`)*

### 2.1 Log in

Opening the URL you received shows a login screen bearing the store name. Sign in with the
email + temporary password.

💡 **Tip**: If you see "store not found", check the spelling of the slug in the URL.
Turn on **Remember email** and this browser will pre-fill the email next time.

### 2.2 Forced password change

Immediately after login, a **non-dismissable password change dialog** appears (it cannot be
cancelled — the console cannot be used with a temporary password).

- Enter `current (temporary) password` + `new password` + `confirmation`
- The three new-password rules are shown as live ✓/✕ while you type:
  **① at least 10 characters ② at least 3 of: uppercase, lowercase, digits, special characters ③ not a common password**
- Passwords containing your own email, or identical to the previous one, are rejected by the server

### 2.3 MFA (two-factor authentication) enrollment

The master and director ranks are **required to enroll MFA (TOTP)** by security policy.

| Term | Meaning |
|---|---|
| TOTP | The 6-digit code that an authenticator app (Google Authenticator, etc.) generates every 30 seconds |
| Recovery codes | 10 one-time codes to use if you lose the authenticator app — **shown only once, right after enrollment** |

- Before the enforcement date: a yellow grace banner at the top (showing the deadline) → you can enroll early from My Page
- After the enforcement date: an enrollment dialog blocks console use until you enroll
- Enrollment: scan the QR (or enter the manual key) → type the app's 6-digit code →
  **download/store the 10 recovery codes** → done. From then on, every login asks for the
  6-digit code as an extra step

💡 **Tip**: The recovery codes are shown only this once. Be sure to save them. If you lose
both the authenticator app and the recovery codes, only an administrator's (system admin or
store master) **[Reset MFA]** can unlock you.

---

## 3. Commerce Platform Integration
*(Console left menu **[Tenant Settings]** → **Platform integrations** tab)*

> Settings has **8 tabs**: Basic settings (AI engines · usage · storefront ·
> knowledge options) / Agent handoff / Widget settings / Platform integrations /
> Marketing & helpdesk / Messenger channels / Other settings / Privacy notice.
> This chapter is the *Platform integrations* tab; Chapter 4 is the *Widget settings* tab.

In the tiles of the Platform integrations tab, press **[Configure]** on the platform you
use to open the integration dialog. The **[Integration guide]** button at the top right of
the tab explains where to find each platform's credentials.
⚠️ **Saving ≠ connected**: after saving credentials the status is "Not tested" — it becomes
"Connected" only when **[Test connection]** passes ("Error" on failure).

| Term | Meaning |
|---|---|
| Credential | Keys/tokens for accessing the platform API. Stored encrypted; after saving, only "Configured" is shown instead of the value |
| Test connection | A button that makes one real API call with the saved credentials to verify their validity |
| Sync | The job that pulls the platform's order/product data into the SharpTalk cache |

### 3.1 Cafe24 ✅

**Recommended path — OAuth connection card**: on the *Cafe24 (OAuth)* card of the Platform integrations tab
1. Enter the `mall ID` (the mallID part of `mallID.cafe24.com`)
2. **[Connect]** → you are taken to the Cafe24 authorization page → sign in and approve → automatically returned to the console
3. Confirm the Connected badge, then run **[Sync now]** (orders) / **[Import products]**

💡 **Tip**: Product sync fills only the product **cache**. For the AI to use these products
in answers, you must separately run **Sync from catalog** (preview → run) on the [Knowledge]
screen — see [Knowledge & AI Manual, Chapter 2.2](knowledge-ai.en.md).

Manual path (if you already hold a token): you can also enter `mall_id` +
`access_token` (+ client_id/secret) directly in the Cafe24 tile's modal. The OAuth
connection is the standard.

### 3.2 Shopify ✅

The Shopify tile's modal:

| Field | Required |
|---|---|
| Shop domain (`*.myshopify.com`) | ✅ |
| Admin API Access Token | ✅ |
| API Key / API Secret | Optional |

After saving, run **[Test connection] → [Sync now] → [Register webhooks]** in that order.
Webhooks must be registered for order/shipping status changes to reach widget notifications
in real time. For token issuance steps, see the Shopify integration guide.

### 3.3 Odoo · WooCommerce · Haravan ✅

Enter the credentials in each tile's modal (Odoo: `server URL` / `DB name` / `username` /
`API Key`), pass **[Test connection]**, then pull data with **[Import products]** /
**[Sync orders]** in the same modal. For the AI to use the imported products in answers,
the catalog sync on the [Knowledge] screen is still required separately (same as the tip
in 3.1).

### 3.4 Storefront URL

Enter the store's **customer-facing site address** in the *Storefront* card on the
**Basic settings tab**. If unset, the widget's product links are disabled (the card shows
a warning).

> Other integrations — Klaviyo·Yotpo (marketing) and Gorgias (helpdesk) live on the
> *Marketing & helpdesk* tab; messenger channels (Telegram·Viber·Gmail, etc.) on the
> *Messenger channels* tab — the same kind of tiles/cards. They are omitted from this
> document.

---

## 4. Chat Widget Setup & Installation
*(**[Tenant Settings] → Widget settings** tab)*

### 4.1 Install the widget

In the **installation guide card**, pick the platform tab (Shopify / Cafe24 / WooCommerce /
Odoo) to see the installation snippet and step-by-step guide for that platform. Every code
block has a copy button.

- **Shopify**: three method tabs — app embed (recommended) / ScriptTag / manual install
- **Cafe24**: a dedicated snippet to paste into the mall design (it includes the member login path)
- **WooCommerce**: a PHP snippet for `functions.php` / **Odoo**: a generic HTML snippet

In the **Embed & SDK card**:
- Copy the universal installation snippet (`embed.js`)
- **Allowed domains**: the list of domains where the widget may load. If left blank, the storefront URL applies
- **Signing secret**: used for member identity federation (login federation). **After [Generate],
  the value is shown only once** — copy it immediately and hand it to your server engineer

💡 **Tip**: The surest verification is to open the live shop page and check that the
launcher (speech-bubble button) appears at the bottom right. If it does not, see
[Chapter 9, Troubleshooting](#9-troubleshooting).

### 4.2 Copy & behavior (widget behavior card)

| Item | Description |
|---|---|
| Login method | `redirect` (go to the shop login page and return, default) / `popup` (popup login) |
| Timezone | The store's timezone — used for business-hours display, etc. |
| Display name | The store name shown in the widget header (max 80 characters) |
| First-visit greeting / post-login greeting | Written per language across **6 language tabs** (EN/ES/KO/VI/JA/ZH) (max 500 characters) — the shipped default is shown under the field as "Default copy:" |

💡 **Tip**: If a greeting is left empty for a language, the default copy is used. It is fine
to write one primary language carefully first and fill in the rest later.

### 4.3 Tabs & theme

**Widget tabs card**: choose which of the 3 tabs — notifications / orders / chat — to show
(at least 1 must remain — the last one cannot be unchecked); tab position is top/bottom.

**Widget theme card**: `brand color` (picker/HEX) · `header style` (white/brand color) ·
`logo` upload · `launcher` position (left/right)·size (sm/md/lg)·icon (chat/question
mark/headset/logo). The preview on the right updates instantly.

**Custom widgets card** (below the theme card): to go beyond colours — font, text size,
corners, panel size, launcher icon — press **[Create custom widget]**, name the design and
press **[Use]**. It goes live immediately with no deployment, and **[Back to basic widget]**
is always one click away. Upload fonts and icons to the **Design files** card first.
Details: User Manual Ch. 14.

💡 **Tip**: You only need to pick **one brand color**. Lightness steps and text colors are
computed automatically against the contrast standard (4.5:1), so "I picked a light color and
the text disappeared" cannot happen. A saved theme takes effect **from the customer's next
widget session**. Details: widget settings guide.

---

## 5. Minimum AI Configuration
*(left menu **[AI settings]**)*

The AI settings screen has settings cards on the left and the **preview/coaching studio** on
the right. At the setup stage, only three things need checking.

| Term | Meaning |
|---|---|
| Persona | Text describing the AI assistant's tone, attitude, and principles. Sets the tone of every AI answer |
| Response rules | The list of rules the AI must obey (one line = one rule) |
| Engine | The AI model that generates answers. Choose among those registered by the platform administrator |
| stub | A demo responder that works without a real AI key. **Not production quality** |

1. Describe the store introduction, tone, and prohibitions in the **bot persona** card and save
   (e.g. *"You are the friendly, concise assistant of OO Mall. Answer only from the provided knowledge."*)
2. Register at least 2–3 **response rules**
   (e.g. "Never state that a refund is complete", "Never guarantee arrival on a specific date")
3. In the **AI functions** card, check the engine applied to each function — **a `stub` badge
   means no real engine is connected**. Two ways to fix it: ① register **your own engine
   with your own API key** in the *AI engines* card of [Tenant Settings → Basic settings]
   (it takes priority over platform engines; calls are billed to your account) ② ask the
   platform administrator to register a shared engine (`/admin/ai-engines`).

💡 **Tip**: The scenario buttons (the quick menu at the bottom of the widget) come with 6
defaults (Delivery Status · Cancel / Refund · Product Help · Contact Support · Affiliate ·
My Orders) applied automatically, **with labels in all 6 languages**, so you do not need to
touch them at the setup stage.
For persona/rule writing tips and full AI configuration, see
[Knowledge & AI Manual, Chapter 4](knowledge-ai.en.md).

---

## 6. Initial Knowledge Entry
*(left menu **[Knowledge]**)*

The AI answers **only from registered knowledge**. Without knowledge, most questions get
handed to agents, so fill in the core policy knowledge at the setup stage. The fastest
path is the **universal counsel guide**:

1. In the group tabs above the documents card, pick **CounselInfo** → **[Bulk import]** →
   download the **universal counsel guide** (a ready-made starter counsel KB, ~90 rows)
   as CSV/XLSX from the highlighted block
2. Adjust deadlines, fees, and policies to your store → upload it in the same dialog →
   check the created/updated counts
   - Shipping · cancellation/refund · exchange/return · FAQ get filled in one pass.
     Re-uploading the same file after edits **updates without duplicates** (round-trip)
3. Register individual documents via **[Write on board]** (recommended — publish, then
   [Adopt to KB]) or **[Add KB-Document]** (for urgent fixes)
4. In the **knowledge QA panel** on the right, type questions a customer would ask and
   check the answer, sources, and confidence — if the document you just registered appears
   in the source list, you succeeded

💡 **Tip**: Including **the phrasing customers actually use** (e.g. "how long does shipping
take") in the document title and body raises search hit rates. The knowledge board
workflow, bulk product knowledge (catalog sync·CSV), AI import (pdf·docx·md·YouTube),
external sources (Google Drive·Notion), and validation/quality management are covered in
the [Knowledge & AI Manual](knowledge-ai.en.md).

---

## 7. (Optional) Team Invites & Handoff Settings

- **Invite team members**: **[Users]** menu → [Invite user] → choose email, rank
  (director/manager/staff), and duty labels → the same **temporary password modal** as in
  Chapter 1 appears (shown once · deliver directly). Per-menu access is adjusted per rank in
  the *Menu access* card of [Tenant Settings → Other settings] (master only).
- **Agent handoff**: in the [Tenant Settings → Agent handoff] tab, assign the responsible
  agents, routing rules (team × label per consult category and region), working hours, and
  the off-hours forwarding email. To let customers pick a consult topic in the widget, set
  it to **Shown** in *Manage consult categories*. After creating rules, use **Check routing**
  to see who a conversation will be connected to. Details:
  [Knowledge & AI Manual, Chapter 5](knowledge-ai.en.md).

---

## 8. Completion Checklist

- [ ] Tenant created + administrator invited · temp password delivered (admin)
- [ ] First login → password changed → MFA enrolled
- [ ] Platform integration: credentials saved + **connection test passed** (status shows
  "Connected") + (Shopify) webhooks registered
- [ ] Storefront URL configured (Basic settings tab)
- [ ] Widget snippet installed → **launcher confirmed visible on the live shop**
- [ ] Display name & greetings written
- [ ] Persona & response rules saved; AI engine confirmed not `stub`
- [ ] Universal counsel guide uploaded (or 3+ core policy documents registered) → answers verified in the QA panel
- [ ] Asked a question directly in the widget and confirmed AI answer + sources (end-to-end)

---

## 9. Troubleshooting

**Q. I cannot log in (temporary password).**
Reissuing a temporary password invalidates the previous value. Make sure you have the latest
issuance; if it still fails, ask the administrator to reissue. Also check that the slug in
the login URL is not another store's (after 2+ failures, guidance appears on screen).

**Q. I closed the temporary password window.**
The value cannot be viewed again. Reissue it with the **[Temp password]** button on the
user's row.

**Q. The widget does not appear on the shop.**
Check, in order: ① the snippet is on the actually deployed page ② the domain is included in
the allowed domains of the embed card (if empty, the storefront URL applies) ③ refresh the
browser cache.

**Q. AI answers feel oddly mechanical.**
Check whether the AI functions card shows a `stub` badge. The stub is a demo responder.
Register your own engine in the *AI engines* card of [Tenant Settings → Basic settings],
or ask the platform administrator to register a shared engine. The "fallbacks: n" warning
in the *AI usage* card is the same signal.

**Q. The AI keeps handing off to "connect to an agent".**
Most likely there is no knowledge document on that topic, or it is inactive. Register
documents as in Chapter 6 and verify with the QA panel.

**Q. I changed settings but the widget looks the same.**
Widget settings (copy·theme·tabs) take effect from the customer's **next session**. Close
and reopen the widget, or refresh the page.

---

*Next step: [Knowledge & AI Setup Manual](knowledge-ai.en.md) — the full
knowledge pipeline, detailed AI configuration, live chat operations, and the quality
improvement loop.*

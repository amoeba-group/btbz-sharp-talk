# SharpTalk Cafe24 Integration Guide — from mall connection to member sign-in

> Version 1.0 · first issued 2026-10-08 · written against the code
> Audience: platform administrators (chapter 1 — once per deployment) · tenant operators (master — chapters 2–7)
> Online edition: https://shoptalk.amoeba.site/manual (HTML edition plus EN·VI translations)
> Prerequisites: [Quick Setup Manual](quick-setup.en.md) · for where to obtain each value, see the [Commerce Integration Credentials Guide](platform-integration.en.html)

A hands-on guide that walks through attaching one Cafe24 mall to SharpTalk, **in order**. Each chapter follows **what it does → procedure → 💡 behavior tips**, and the checklist in chapter 8 verifies everything end to end.

---

## Contents
0. [Overview](#0-overview)
1. [Platform admin — Developers app and server settings](#1-platform-admin--developers-app-and-server-settings)
2. [Tenant basic settings — Store domain and shop URL](#2-tenant-basic-settings--store-domain-and-shop-url)
3. [Connecting the mall — OAuth consent](#3-connecting-the-mall--oauth-consent)
4. [Order sync](#4-order-sync)
5. [Products → knowledge](#5-products--knowledge)
6. [Widget install — Smart Design](#6-widget-install--smart-design)
7. [Member sign-in · My orders](#7-member-sign-in--my-orders)
8. [Task checklist](#8-task-checklist)
9. [FAQ / Troubleshooting](#9-faq--troubleshooting)

---

## 0. Overview

The Cafe24 integration consists of **three connections**. They are independent, so you can turn on only the ones you need.

```
① Admin connection (OAuth, Ch. 3)    mall → SharpTalk   reads orders & products (read-only)
      ├─ Order sync (Ch. 4)            → AI answers "where's my order?" with the real order
      └─ Import products (Ch. 5)       → knowledge conversion → AI cites & links products
② Widget install (Smart Design, Ch. 6) SharpTalk → mall   chat widget on every page
③ Member sign-in (Ch. 7)              mall member ↔ widget session   'My orders' inside the widget
```

| Term | Meaning |
|---|---|
| Mall ID | The Cafe24 store ID — the `yourmall` part of `yourmall.cafe24.com` |
| Developers app | The SharpTalk app registered at developers.cafe24.com. **One per deployment (staging, production)**; every tenant connects its own mall through this app |
| Admin connection | The step where the mall's primary operator grants the app its permissions. The resulting token is encrypted and stored per tenant |
| Member sign-in | When a shopper (mall member) signs in from the widget, the widget conversation is bound to that member using the member ID Cafe24 has verified |

| Chapter | Who | Screen |
|---|---|---|
| 1 | Platform admin | Cafe24 Developers · server environment variables |
| 2–3 | Tenant master | Settings > Basic settings · Settings > Platform integrations |
| 4–5 | Tenant master | Settings > Platform integrations · Knowledge |
| 6 | Tenant master + mall design owner | Settings > Widget settings · Cafe24 admin |
| 7 | Tenant master | Settings > Widget settings |

⚠️ **The connection is read-only.** SharpTalk only reads orders, products and categories; it never modifies mall data.

---

## 1. Platform admin — Developers app and server settings

Do this chapter **once per deployment**. If another tenant already uses the Cafe24 connection, skip ahead to chapter 2.

### 1.1 Registering the Developers app

1. Sign in to developers.cafe24.com → create a SharpTalk app with **Create app**.
2. In the app details, note the **Client ID** and **Client Secret** (they go into the environment variables in 1.3).
3. Register **exactly one** **Redirect URI**: the callback on your console domain.
   Staging `https://shoptalk.amoeba.site/api/v1/auth/cafe24/callback` · Production `https://sharptalk.amoeba.site/api/v1/auth/cafe24/callback`
4. Add the four **Scopes** below. All are read-only.

| Scope | Used for |
|---|---|
| `mall.read_order` | Order sync (chapter 4) |
| `mall.read_product` | Product import (chapter 5) |
| `mall.read_category` | Product category names (chapter 5) — without it, knowledge documents end up with empty categories |
| `mall.read_customer_identifier` | Member sign-in (chapter 7) |

⚠️ **Cafe24 accepts only one Redirect URI per app.** The admin connection and member sign-in therefore share the same callback (`/auth/cafe24/callback`), and SharpTalk tells the request types apart internally. Staging and production have different callback URLs, so create **a separate app** for each.

💡 **Tip**: The member personal-data scope (`mall.read_personal`) is **not needed.** The member ID comes in the member sign-in token response, so no personal-data resource is read. Fewer scopes make Cafe24 review and mall operator consent easier.

### 1.2 If you add scopes later

Adding scopes **does not apply to malls that are already connected**, because a token is issued with the scopes granted at consent time. After adding scopes, each tenant must **click [Connect Cafe24] again (chapter 3) to re-consent**. Running a feature that needs the new scope without re-consenting makes Cafe24 reject it with `insufficient_scope`.

### 1.3 Server environment variables

Set these in the API container's env file (`env/backend/.env.{environment}`).

| Variable | Value | Notes |
|---|---|---|
| `CAFE24_CLIENT_ID` | The app's Client ID | **Required** — if empty, connecting fails with E5010 |
| `CAFE24_CLIENT_SECRET` | The app's Client Secret | **Required** |
| `CAFE24_REDIRECT_URI` | **Identical, character for character,** to the callback in 1.1 | If it differs, the token exchange fails |
| `CAFE24_CONSOLE_RETURN_URL` | Console URL (e.g. `https://sharptalk.amoeba.site`) | Where the operator lands after connecting |
| `CAFE24_SCOPES` | `mall.read_order,mall.read_product,mall.read_category` | Admin connection scopes |
| `CAFE24_CUSTOMER_SCOPES` | `mall.read_customer_identifier` | Member sign-in scope |
| `CAFE24_SYNC_INTERVAL_MIN` | e.g. `30` | Automatic order sync interval (minutes). `0` turns it off |
| `CAFE24_LOGIN_SYNC_LOOKBACK_DAYS` | Default `30` (max 90) | Range of the catch-up sync right after member sign-in |

⚠️ **Do not leave lines with an empty value (`CAFE24_SCOPES=`).** An empty line is read as "empty value", not "use the default" — the consent screen opens with no scopes, or the operator cannot return to the console after connecting. Delete the whole line for unused variables, and set explicit values for the ones you use, as in the table above. Unless you have a specific reason, delete the lines for `CAFE24_CUSTOMER_REDIRECT_URI`, `CAFE24_API_HOST_TEMPLATE`, `CAFE24_AUTH_HOST_TEMPLATE` and `CAFE24_API_VERSION`.

⚠️ After changing env, restart the API container and confirm the boot log prints `Cafe24 auto-sync enabled — every N min` (or `disabled`) as intended.

---

## 2. Tenant basic settings — Store domain and shop URL

First save two values in the **Settings > Basic settings > Storefront** card. This must happen before connecting because SharpTalk uses these values to **check "is this mall really this tenant's mall?"**

| Field | Value | Used for |
|---|---|---|
| Store domain | `yourmall.cafe24.com` | How the widget finds this tenant · mall match check on connect/sync |
| Shop URL | `https://yourmall.cafe24.com` | Makes product links in chat clickable |

**Mall match check**: if the Store domain (or Shop URL) is `*.cafe24.com`, trying to connect with a different mall ID in chapter 3 is rejected (E5045), and an already stored connection for a different mall has its order sync refused. This guards against a one-character typo **pulling in another store's orders**.

⚠️ If the two values point to **different Cafe24 malls**, neither can be trusted, so both connecting and syncing are refused. Make both point to the same mall.

💡 **Tip**: Malls on their own brand domain (e.g. `www.brand.co.kr`) can still connect — but with nothing to compare against, the mall match check is skipped and only a warning is written to the server log. Double-check the mall ID in this case. Member sign-in (chapter 7) works only on `*.cafe24.com` addresses.

---

## 3. Connecting the mall — OAuth consent

Use the **Cafe24 (OAuth)** card in **Settings > Platform integrations**. Only the master rank can do this.

1. Enter the store ID in the **Mall ID** field (`yourmall`). Pasting `yourmall.cafe24.com` or `https://yourmall.cafe24.com/` also works — only the mall ID is used.
2. Click **[Connect Cafe24]** to go to the Cafe24 consent screen.
3. Sign in with the **mall's primary operator account** and grant the permissions.
4. Back in the console, a "Cafe24 connected: yourmall" toast appears and the status changes to **Connected**. From then on the **[Sync now]** and **[Import products]** buttons appear.

| Message on return | Meaning · action |
|---|---|
| Cafe24 connected: {mall} | Success |
| Cafe24 rejected the requested permissions (invalid_scope) | The Developers app lacks that scope → add the four scopes from 1.1 and connect again |
| Cafe24 consent was denied (access_denied) | Cancelled on the consent screen, or an account without permission → retry with the primary operator account |
| Cafe24 connection failed | One of the causes below — see the chapter 9 FAQ |

Common causes of "Cafe24 connection failed":

- The mall ID differs from the Store domain's mall (E5045) → check the Store domain in chapter 2
- That mall is **already connected to another tenant** (E5046) → one mall connects to only one tenant
- Stayed on the consent screen for more than 10 minutes (E5011) → start over
- The server has no app values (E5010) → ask the platform admin for section 1.3

💡 **Tip**: The same tenant **reconnecting the same mall** is always safe. When you have added scopes (1.2) or the token has expired (4.3), just click [Connect Cafe24] again and the token is replaced with a new one.

⚠️ The console has **no disconnect button.** If you connected the wrong mall, reconnect with the correct mall (within the same tenant it is replaced), or ask the platform admin to delete the credential.

---

## 4. Order sync

Cafe24 has no real-time webhooks like Shopify, so SharpTalk **pulls orders periodically.** The pulled orders feed AI support (shipping inquiries, etc.) and the widget's "My orders" (chapter 7).

### 4.1 Three ways a sync happens

| Path | Range | When |
|---|---|---|
| **[Sync now]** button | Last **7 days** · up to 2,000 orders | When an operator clicks it |
| Automatic sync | Last 7 days | Every `CAFE24_SYNC_INTERVAL_MIN` minutes, for all connected tenants |
| Member sign-in catch-up | Last **30 days** (up to 90 if configured) | Right after a member signs in from the widget |

### 4.2 Procedure

1. Click **[Sync now]**.
2. A toast shows the result (e.g. `Synced 12 order(s)`).
3. Check that Cafe24 orders appear in the console's **Orders** menu.

💡 **Tip**: Cafe24 order lookup allows **at most 3 months per query**. That is why no path pulls more than 90 days. For inquiries about older orders, agents should check the Cafe24 admin directly.

### 4.3 Keeping the token alive

The connection token is a **2-hour access token + 14-day refresh token**, and SharpTalk refreshes it automatically each time it is used. With automatic sync on, refreshes keep happening and the token never expires.

⚠️ On a deployment with automatic sync off, **going more than 14 days without any sync** expires the refresh token. The sync result then shows `Cafe24 store is not connected — reconnect the mall`; redoing [Connect Cafe24] in chapter 3 restores it.

---

## 5. Products → knowledge

Product data becomes knowledge in **two steps**. The preview in between ensures that refreshing the product list never silently changes the knowledge base.

```
[Import products] (Settings > Platform integrations)   Cafe24 products → SharpTalk product list
        │
        ▼
[Sync from catalog] (Knowledge)                         check preview → [Run sync] → 1 knowledge doc per product + index
```

### 5.1 Importing products

1. In **Settings > Platform integrations > Cafe24 (OAuth)**, click **[Import products]**.
2. "N product(s) synced, M archived — run the conversion on the Knowledge page" means success.

- **Archived**: products that could not be found in the mall this time (deleted or not displayed). Products are archived only when the import runs to completion; an interrupted run archives nothing.
- Imports product name, price, category, option values and product tags. For products with a short description (under 80 characters), the detailed description is fetched as well.

### 5.2 Converting to knowledge

1. On the **Knowledge** menu, click **[Sync from catalog]**.
2. In the preview, check the counts for new, updated, absorbed and held back.
3. **[Run sync]** → Writing documents → Indexing; when these finish, you are done. It takes a few minutes and continues even if you close the dialog.

| Preview item | Meaning |
|---|---|
| New documents / Documents updated | One document per product. Re-running does not create duplicates |
| Variants absorbed | Color/size variants of the same product are merged into one document |
| Hand-written kept | Hand-edited documents keep their body; only the link and sold-out state are refreshed |
| Held back | Products whose description and tags are **both** empty, so they cannot support an answer |

💡 **Tip**: Korean malls often publish detailed descriptions **as images only**, leaving almost no text description. So SharpTalk always fills tags from category, option values and product tags, ensuring products are not held back even without a description. To improve answer quality, fill in the Cafe24 product's **search keywords (tags)** and **short description** as text.

⚠️ Even after knowledge is created, if the **Shop URL (chapter 2)** is empty, product citations in chat appear as plain text with no link. Cafe24 product links are built as `https://yourmall.cafe24.com/product/detail.html?product_no={number}`.

---

## 6. Widget install — Smart Design

### 6.1 Copying the snippet

1. In the **Settings > Widget settings > Install on your store** card, choose the **Cafe24** platform.
2. Copy the snippet shown. The Store domain (chapter 2) is already filled in.

```html
<!-- SharpTalk widget (Cafe24) -->
<script>
  window.SHARPTALK_WIDGET_CONFIG = {
    shop: "yourmall.cafe24.com",
    locale: "ko",
    widgetUrl: "https://shoptalk.amoeba.site/widget",
    loginPath: "/member/login.html",
    loginReturnParam: "returnUrl"
  };
</script>
<script src="https://shoptalk.amoeba.site/widget/embed.js" defer></script>
```

### 6.2 Pasting into the Cafe24 admin

1. In Cafe24 admin, open **Design (PC/Mobile) → Smart Design edit**.
2. Open the layout HTML (common layout) of your **default design**.
3. Paste the snippet right before `</body>` and **save/deploy**.
4. **If you have separate PC and mobile designs, paste it into both.**

💡 **Tip**: Copy the snippet from the console **as is**. If hand-editing drops the `/widget` path, the console page responds instead of the widget (with status 200), and the widget simply doesn't appear, with no error.

⚠️ When you create a new design or change the default design, **the new design does not contain the snippet.** Always paste it again after switching designs.

---

## 7. Member sign-in · My orders

Cafe24 has no channel that tells the widget "who is signed in right now." So SharpTalk uses Cafe24's **customer authentication (member OAuth)** and binds the widget conversation to the member using the member ID that Cafe24 itself verified.

### 7.1 What the shopper sees

1. In the widget's **Orders** tab, click **[Sign in]**.
2. Cafe24 sign-in (skipped if already signed in) → the mall's consent screen.
3. The widget reopens on the Orders tab, showing **up to 10 orders from the last 30 days**.
4. For older orders, **[View more]** → directs to the mall's My Page order lookup (`/myshop/order/list.html`).

### 7.2 Operator settings

Choose **Customer sign-in opens as** under **Settings > Widget settings > Widget behavior**.

| Mode | Behavior | When |
|---|---|---|
| Full page (recommended) | Signs in in the same tab, returns to the original page, and the widget reopens automatically | Default · most reliable |
| Popup window | Signs in in a small window that closes itself when done; the page stays put | When you want to avoid page navigation, e.g. on the cart |

💡 **Tip**: If the browser blocks the popup, it automatically falls back to full-page mode and sign-in continues.

### 7.3 Security · limitations

- No Cafe24 token is passed to the widget. After verification, the server returns only a **one-time ticket (60 seconds)** to the mall page, and the widget exchanges it for a conversation session.
- The return address after sign-in is allowed **only on that mall's `*.cafe24.com` address**.
- ⚠️ **Shoppers visiting through a custom domain cannot use member sign-in.** The only address from which the widget can determine the mall ID is `yourmall.cafe24.com`. On custom-domain malls, widget chat works normally but "My orders" is not shown.
- If one mall is connected to two tenants, there is no way to decide which tenant to sign in to, so **sign-in is refused** (E5046 in chapter 3 prevents this state).

---

## 8. Task checklist

**Platform admin (once per deployment)**
- [ ] Developers app created, Redirect URI = this deployment's `/api/v1/auth/cafe24/callback`
- [ ] Four scopes: `mall.read_order` · `mall.read_product` · `mall.read_category` · `mall.read_customer_identifier`
- [ ] env has Client ID/Secret · Redirect URI · console URL · scopes · auto-sync interval — **no empty lines**
- [ ] After restarting the API, the `Cafe24 auto-sync` line is in the boot log

**Tenant master (per mall)**
- [ ] Settings > Basic settings: Store domain `yourmall.cafe24.com`, Shop URL `https://yourmall.cafe24.com`
- [ ] Settings > Platform integrations: enter Mall ID → [Connect Cafe24] → "connected" toast
- [ ] [Sync now] → Cafe24 orders appear in the Orders menu
- [ ] [Import products] → Knowledge > [Sync from catalog] → preview → [Run sync]
- [ ] Settings > Widget settings: paste the Install on your store (Cafe24) snippet before `</body>` in the Smart Design PC and mobile layouts
- [ ] The widget appears on the mall, and product questions get answers with product links
- [ ] Sign in to the widget with a test member via [Sign in] → that member's orders appear in the Orders tab

---

## 9. FAQ / Troubleshooting

**Q. Clicking [Connect Cafe24] immediately shows "Cafe24 connection failed".**
It failed **before** reaching the consent screen. It is one of: ① the mall ID differs from the Store domain's mall (E5045) ② that mall is already connected to another tenant (E5046) ③ the server has no app values (E5010). For ①, check the chapter 2 settings; for ② and ③, contact the platform admin.

**Q. I completed consent, but back in the console it shows "Cafe24 connection failed".**
The token exchange failed. The most common cause is `CAFE24_REDIRECT_URI` in env differing from the URI registered in Developers (including a trailing `/` or `http`/`https`). If you stayed on the consent screen for more than 10 minutes, start over.

**Q. I get "Cafe24 rejected the requested permissions (invalid_scope)".**
A scope SharpTalk requested is not registered on the Developers app. Nothing needs fixing on the SharpTalk side — add the scopes from 1.1 to the app and connect again.

**Q. [Sync now] returns `refusing to sync: tenant runs on A.cafe24.com but the stored credential is for "B"`.**
The stored connection is not this tenant's mall. Sync is blocked so another store's orders don't get mixed in. Redo [Connect Cafe24] with the correct mall ID. If it says `names two malls`, the Store domain and Shop URL point to different malls — align them in chapter 2.

**Q. The sync result is `Cafe24 store is not connected — reconnect the mall`.**
Either it was never connected, or the refresh token expired after more than 14 days without use (4.3). Redo [Connect Cafe24].

**Q. I imported products, but the AI doesn't know them.**
[Import products] only fills the product list. They are used in answers only after **Knowledge > [Sync from catalog] → [Run sync]** (5.2).

**Q. Knowledge documents have empty categories.**
The mall was connected without the `mall.read_category` scope. Add the scope to the app (1.1), re-consent with [Connect Cafe24], then rerun [Import products] and the catalog sync.

**Q. Product citations in chat have no link.**
The **Shop URL** in Settings > Basic settings is empty or differs from the mall address. Save it as `https://yourmall.cafe24.com`.

**Q. The widget doesn't appear on the mall.**
Check ① the snippet is in the layout of the **current default design** (it disappears when you switch designs) ② it is in both the PC and mobile designs ③ the snippet's `shop` matches the Store domain in Settings > Basic settings. A quick check: in the browser DevTools Network tab, see whether `embed.js` is served as JavaScript (if it's HTML, the URL is wrong).

**Q. A member signed in, but the widget stays signed out.**
Check ① if the shopper is on a custom domain, member sign-in does not work (7.3) ② the app has the `mall.read_customer_identifier` scope ③ the mall is connected to this tenant only. On failure the shopper is quietly returned to the original page, so find the reason in the server log lines `Cafe24 customer-auth … failed` / `Cafe24 member sign-in callback failed`.

**Q. Sign-in works, but "My orders" is empty.**
Either that member ID has no orders in the last 30 days, or they haven't been synced yet. A 30-day catch-up sync runs automatically right after sign-in, but it fails without the order scope (`mall.read_order`). Guest orders have no member ID and are not shown.

**Q. Can staging and production use the same Developers app?**
No. A Cafe24 app accepts only one Redirect URI, so it cannot serve two deployments with different callback URLs at once. Create one app per deployment.

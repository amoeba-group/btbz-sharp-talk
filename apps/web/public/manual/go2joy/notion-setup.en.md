# Go2Joy Notion Knowledge Setup Guide

- Audience: the Go2Joy Notion workspace admin (owner of the "HA-UserGuide" integration)
- As of: 2026-10-19 (verified on staging)
- The previous guide (2026-08-28, written for the "Truc connection" integration) no longer applies after the token change on 10/16; this document replaces it.

> What the Go2Joy Notion admin needs to do so SharpTalk can read Notion pages as knowledge for the support AI. Everything happens inside Notion and takes about a minute per page.

## 1. Current state

Everything on the SharpTalk side is in order. The token is valid, and we checked the integration's identity and reach directly against the Notion API.

| Item | Finding |
|---|---|
| Registered integration | **HA-UserGuide** (replaced on 10/16) |
| Workspace the integration belongs to | **Go2Joy** |
| Pages the integration can see | **Only 1** — "Hướng dẫn sử dụng Hotel Admin" (ID `bfb56ba4…`) |

All three Notion sources registered in SharpTalk fail to sync, and for the same reason: **the page is not connected to the "HA-UserGuide" integration (Connections).**

| # | SharpTalk source | Registered Notion target | Status |
|---|---|---|---|
| 1 | Go2Joy Hotel FAQ (Notion) | `hotel-go2joy.notion.site/FAQ-f03737634c38…` | ❌ Not connected |
| 2 | Hướng dẫn sử dụng Hotel Admin | `…8968fee0bb548347a35e01756b4cc89c` | ❌ Not connected (the integration only sees a page with the same title and a different ID `bfb56ba4…` — see 2-D) |
| 3 | Hướng dẫn đăng ký khách sạn trên Go2Joy | `…2026dfbd464d800085cedea4c57f8d15` | ❌ Not connected |

## 2. What Go2Joy needs to do

### A. Connect the three pages to the integration (about a minute each)

For each of the three pages below:

1. Open the page in Notion.
2. Click **⋯** (more) in the top-right corner → **Connections** near the bottom of the menu.
3. Type **HA-UserGuide** → select it → **confirm** access.
4. Done when "HA-UserGuide" appears under **⋯ → Connections** for the page.

Pages:

- **Go2Joy Hotel FAQ** — `https://hotel-go2joy.notion.site/FAQ-f03737634c3848339910d50f7e77bf7b`
- **Hướng dẫn sử dụng Hotel Admin** — ID `8968fee0bb548347a35e01756b4cc89c` (see 2-D)
- **Hướng dẫn đăng ký khách sạn trên Go2Joy** — ID `2026dfbd464d800085cedea4c57f8d15`

**Child pages inherit the connection.** Connecting the parent page is enough; pages beneath it need nothing extra.

### B. "Publish to web" is not a connection

The FAQ page is published to the web at `hotel-go2joy.notion.site`. A published page can be viewed by anyone in a browser, but **the Notion API reads only pages connected to the integration, whether or not they are public.** Step A is required even for a published page.

### C. Check the workspace

The "HA-UserGuide" integration is installed in the **Go2Joy workspace**. All three pages must live in that workspace for "HA-UserGuide" to show up in the Connections search. If it does not appear, the page is in a different workspace: move the page into Go2Joy, or create a new integration in that workspace and register its token in SharpTalk again (see E).

### D. "Hướng dẫn sử dụng Hotel Admin" — confirm which page is the right one

The ID registered in SharpTalk is `8968fee0…`, but the page the integration currently sees has the same title and ID `bfb56ba4…`. One of two things is true:

- The page was duplicated or moved and its ID changed → if `bfb56ba4…` is the current version, just tell us; we will change the source's target ID on the SharpTalk side (nothing for Go2Joy to do).
- They are two different pages → connect the `8968fee0…` page as in A as well.

How to check: open the page in Notion and look at the 32 alphanumeric characters at the end of the browser address bar.

### E. Caution when replacing the token (integration)

When the integration changed from "Truc connection" to "HA-UserGuide" on 10/16, **every page connected to the old integration became invisible to the new one.** Connections are managed per integration. If the token ever has to change again:

1. Create the new integration,
2. **Reconnect every page used as a SharpTalk source** to the new integration,
3. Register the new token in the SharpTalk console.

Keeping the current token unchanged is the safest option.

## 3. After connecting — Go2Joy can verify on its own

1. SharpTalk console → **Knowledge** → **Sources** table → click **↻** (sync) on the source's row.
2. On success, a green notice appears and the row shows the last sync time in black.
3. On failure, a red notice shows the cause and the fix. The message below means step A is not done yet.
4. After a successful sync, ask about the content in the chat widget; the AI cites the page in its answer.

Example failure notice:

```
The source target cannot be read.
Could not find page with ID: f0373763-… Make sure the relevant pages and databases are shared with your integration "HA-UserGuide".
The Notion page isn't shared with the integration — open the page in Notion, ⋯ → Connections, and add the integration.
```

Example success notice: `Sync: 1 created, 0 updated`

## 4. Scope and limits

| Item | Detail |
|---|---|
| Scope | The target page's body plus its direct child pages (one level). Deeper nesting is not collected. |
| Text only | Paragraphs, headings, lists, toggles, tables, code. Images, attachments and embeds are skipped. |
| Limits | Up to 200 pages per sync, about 30,000 characters per page. Split very long pages into child pages. |
| Updates | Edits in Notion are not picked up automatically. Click ↻ again in the console; only changes are updated. |
| Deleted pages | Hidden from knowledge, not deleted. |
| Security | The token is stored encrypted and used read-only. Only connected pages (and their children) are reachable. |

## 5. Reply checklist

- [ ] HA-UserGuide connected to the FAQ page (`f0373763…`)
- [ ] HA-UserGuide connected to "Hướng dẫn đăng ký khách sạn…" (`2026dfbd…`)
- [ ] "Hướng dẫn sử dụng Hotel Admin": connected `8968fee0…`, or confirmed that `bfb56ba4…` is the current version
- [ ] One screenshot of the Connections list (optional — speeds up verification)

Contact: SharpTalk operations team (existing channel).

# SharpTalk Knowledge & AI Setup Manual — The Knowledge Pipeline and Customer-Response Operations

> Version 1.2 · First edition 2026-08-24 · **updated 2026-10-24** · Written against the code
> Audience: tenant operators · CS staff (master/director recommended — AI settings are restricted to senior ranks)
> Online edition: https://shoptalk.amoeba.site/manual (HTML edition plus EN·VI translations)
> Legend: ✅ implemented / 🟡 in preparation·roadmap. Prerequisite: [Quick Setup Manual](quick-setup.en.md)
> ⚠ AI-translated draft pending native review. The Korean edition is authoritative.

Each chapter is structured as **terms → procedure → 💡 operating tips**.

---

## Table of Contents
0. [Understanding the AI Response Pipeline](#0-understanding-the-ai-response-pipeline)
1. [Understanding the Knowledge Structure](#1-understanding-the-knowledge-structure)
2. [Registering Knowledge](#2-registering-knowledge)
3. [Knowledge Validation & Quality Management](#3-knowledge-validation--quality-management)
4. [AI Settings](#4-ai-settings)
5. [Live Chat Customer-Response Settings](#5-live-chat-customer-response-settings)
6. [Validation & Improvement Loop](#6-validation--improvement-loop)
7. [Operations Checklist](#7-operations-checklist)
8. [FAQ / Troubleshooting](#8-faq--troubleshooting)

---

## 0. Understanding the AI Response Pipeline

This is the full flow one customer message goes through. Every setting in this document
adjusts some point in this flow.

```
Customer message
  │
  ▼
① Intent classification ── if orders/personal data are needed → identity-verification (login) prompt
  │               on a deny-list match: "No answer" rule → hand off immediately /
  │               "Answer, then hand off" rule → answer via ②–④, then hand off
  ▼
② Knowledge search (RAG) ── find relevant evidence in the registered knowledge documents
  │
  ▼
③ Answer generation ──── compose the answer from persona·response rules + retrieved evidence, score confidence
  │
  ▼
④ Moderation ─── check the moderation rules (a failing answer is never shown to the customer)
  │
  ▼
⑤ Branch: confidence sufficient → answer the customer (+sources)
        low confidence / blocked / customer asked for an agent → agent queue (escalation)
```

- **The answer language** follows the customer's session language (en/es/ko/vi/ja/zh).
- Messages sent by agents also pass ④ moderation identically (non-bypassable).

---

## 1. Understanding the Knowledge Structure

**Terms**

| Term | Meaning |
|---|---|
| Knowledge document | One piece of text the AI uses as answer evidence. Consists of title, category, and body |
| **Knowledge board** | The **curation layer where every piece of knowledge is written and reviewed first** (`/knowledge/board`). A published board document becomes answer evidence once "adopted" into the KB |
| KB adoption | Promoting a board document into a knowledge-base (KB) document. Re-adopting updates the same document (no duplicates) |
| Embedding | The indexing job that turns a document into a searchable vector. Performed automatically on create/update |
| RAG | The method of searching for documents related to the question and answering only from that evidence |
| Source | A connection that imports documents automatically from outside (board·Google Drive·Notion) |
| Group | Three top-level document classifications: **CounselInfo** (support — policy·FAQ) / **ProductInfo** (product — from the catalog) / **OperationInfo** (operations manuals) |
| Category | Sub-classification under a group. Managed **per (group, name)**; the agent scope (§3.5) also hangs on the category |
| Active/visible | Whether the document is included in search. **Inactive documents are never used as answer evidence** |
| Confidence | A score of how well the answer is supported by evidence. Low values hand off to an agent |

Layout of the knowledge screen (`/knowledge`): the board banner and **knowledge gap
proposals** at the top; sources, usage guides, categories, and document management on the
left; and the **QA panel (Answer with knowledge)** and **conflict review** pinned on the
right, so you can move between registering and verifying on one screen. The **group tabs**
above the document list (All / CounselInfo / ProductInfo / OperationInfo) decide what the
documents, categories, and bulk tools operate on.

---

## 2. Registering Knowledge

### 2.0 The standard path — Smart Knowledge Board (recommended)

The standard path is to write and review every piece of knowledge on the board first, then
adopt it into the KB. **[Write on board]** is the primary button on the documents card;
[Add KB-Document] (direct add) is **for emergencies only**.

**Procedure**: the **[Open board]** banner at the top of `/knowledge`, or **[Write on
board]** on the documents card →
1. Write: `group` (CounselInfo/ProductInfo/OperationInfo) / `Category (1st·2nd)` / `Team` /
   `title` / `tags` / markdown body + attachments (50MB per file, [Insert into body]
   available). Writing `[[Document Title]]` in the body links to another board document
   (check backlinks in the *Links* panel on the right — links are **by title**, so renaming
   a document shows its old links as "not written").
2. **[Save draft]** (Draft) → **[Publish]** (Published) — an unpublished document cannot be
   adopted.
3. **[Simulation]**: enter a customer question to check, before adopting, whether this
   document gets cited, plus confidence and similarity. **Golden-set A/B** runs the
   registered verification questions (§6.3) once without and once with the document to show
   the improvement delta (2 LLM calls per question — confirm before running).
4. **[Adopt to KB]**: the reviewer picks a category (if unset, 2nd-level then 1st-level
   classification is used) and a KB document is created. **Re-adopting updates the same KB
   document** and re-embeds automatically. After editing the board original, a **"revision
   behind"** badge shows until you re-adopt.
5. Collaboration: **comments** on the right (type `@` to mention a teammate — mentions pile
   up in the `@me` inbox on the board list), and **[Hold]/[Re-adopt]/[Back to published]**
   to move the status back and forth.

**Bulk FAQ migration**: **[FAQ import]** on the board list — export your existing FAQ/Q&A
board as CSV/XLSX and upload it; each row becomes a published board document (required
columns title·content, optional category1·category2·tags; duplicate titles are skipped).

💡 **Tips**
- Editing an adopted KB document on the KB side makes it **diverge** from the board
  original — the document detail shows a warning and [Open board original]. Revise on the
  board and re-adopt instead.
- If the simulation says "not cited", reinforce the title/body with customer vocabulary and
  simulate again — one step faster than adopting first and checking in the QA panel.

### 2.1 Manual document creation & editing (for emergencies)

**Procedure**: documents card → **[Add KB-Document]** → choose the `group` / enter `title`
/ `category` (autocomplete offers only the chosen group's) / `content` → save. Clicking a
title opens the detail dialog; **[Edit]** manages the following:

| Field | Purpose |
|---|---|
| Source URL | Link to the external document the content is based on (opens directly from the list) |
| Effective date | The date the policy takes effect |
| Review interval (days) | When exceeded, a `stale` (needs review) badge appears in the list → §3.3 |
| Content | On save, the document is **automatically re-embedded** (search index refreshed) |

💡 **Tips**
- One document = one topic. Splitting "shipping+refund+exchange" into separate documents
  instead of one makes search more accurate.
- Include **customers' actual phrasing** ("how long does shipping take", "when do I get my
  refund") in titles and bodies. Search is similarity-based, so the closer to customer
  vocabulary, the better it hits.
- Instead of deleting outdated policies, **turn visibility off (inactive)** to
  exclude them from evidence. History is preserved and reverting is easy.
- The list is now **title-first**: group (All tab only), **origin badge** (direct/board/
  file/YouTube/Drive/Notion/catalog), category, title, and updated date are the columns;
  the visibility toggle, status, delete, and the rest moved to the **⋯ (More)** menu at the
  row's end. The visibility/origin/status filters and sorting are all server-side. A
  document whose status is "Pending" is **already used in keyword search** — only semantic
  search waits for the index.

### 2.2 Product knowledge — catalog sync · CSV · usage guides

**Terms**

| Term | Meaning |
|---|---|
| Product cache | The raw product list synced from the platform (Cafe24, etc.) (the result of product sync on the Settings screen) |
| Catalog sync | The job that converts the product cache into product knowledge documents. Two stages: **preview → run** |
| Variant folding (merge) | Grouping dash-separated variants like "Lipstick-Red/Lipstick-Pink" into one representative product |
| Curation preserved | Keeping product documents hand-polished by operators from being overwritten by sync |
| Usage guide | A shared how-to document per product **type** (e.g. "How to use lip products") — serves as answer evidence separately from product documents |

**Procedure ① catalog sync**: documents card header → **[Sync from catalog]**
1. A **preview** runs first — it shows the scan count and expected results (created /
   updated / curation preserved / absorbed by merge / unchanged / held), the estimated
   embedding batches, and a sample list of merges.
2. In the merge samples, verify **that different products were not folded into one**, then **[Run]**.
3. Watch the two progress lines (writing / embedding), and after completion check the
   **embedding failure count** in the results table (failed items are not searchable and
   need a re-run).

**Procedure ② product CSV import**: **[Import product CSV]** → choose a file → check the
result statistics (parsed/created/updated/skipped/invalid/embedded) and per-row errors (up
to 20 shown). Uploading the same product again overwrites it (upsert).

**Procedure ③ usage guides**: the *usage guides* card shows written/unwritten badges per
product type. **[Write]** → save a title and body (20+ characters).

💡 **Tips**
- **Always look at the preview first.** A wrong merge (distinct product lines folded
  together) can only be caught in the preview, before running.
- When products change on the platform, run the **two stages in order** — product sync in
  [Settings] → catalog sync in [Knowledge] — for the change to reach the knowledge.
- For stores with thin product descriptions, tags become the raw material of knowledge —
  tidying product tags on the platform side raises answer quality.

### 2.3 External source integration (board · Google Drive · Notion)

**Terms**

| Term | Meaning |
|---|---|
| Service account | The robot account used for the Google Drive integration. The folder must be shared with this account's email to be readable |
| Integration | The unit by which Notion grants external tool access. Must be "connected" to the target page |
| Sync result counts | Created·updated·skipped·hidden counts. `dropped`/`truncated` is a **warning that part of the content could not be imported** |

**Procedure**
1. **Register credentials** (the two cards below the sources table):
   - Google Drive: paste the service-account key JSON → **share the target folder with the
     displayed service-account email** → [Test connection]
   - Notion: register the token (`ntn_…`) → in Notion, **connect the integration** to the
     target page/DB → [Test connection]
2. **[Add source]** → choose the type (board / gdrive / notion) → for gdrive enter the
   `folder ID`; for notion enter the `page·DB ID or a shared URL`
3. Run **↻ (sync)** on the source row → check the result counts in the *last sync* column

Supported types: board ✅ · Google Drive ✅ · Notion ✅ · the GitHub repository source type is **not supported**.

💡 **Tips**
- If a red **dropped/truncated** warning appears in the sync result, the page was too large
  or too deep and part of it was cut off. Open the document, check that its ending is
  intact, split the original, and sync again. A Notion failure shows its reason right in
  the *last sync* cell — if you see "not shared with your integration", open the page in
  Notion and add the integration under ⋯ → Connections.
- If a sync suddenly imports **0 items** (folder unshared, integration disconnected, etc.),
  the existing documents are left as-is rather than hidden — restore the connection first.
- Clicking a source's status cell toggles active↔inactive. An inactive source only stops
  syncing; already-imported documents remain.
- **[View conversion history]** (icon next to the source name): shows the sync-run history
  (ok/failed · created/updated/kept/hidden · indexed · elapsed · reason) and the list of
  documents converted from this source.
- **Deleting a source is safe** — only the source is removed; its documents are not deleted
  but **deactivated** and dropped from search (they can be reactivated from the document
  list).

### 2.4 Bulk download ↔ bulk import (CSV/XLSX round trip)

**[Bulk download ▾]** (CSV/Excel) and **[Bulk import]** on the documents card share one
column contract: `category · title · content` (required) + `external_key · source_url`
(optional). **Both buttons appear only after selecting a group tab** (hidden on the All
tab — the target group must be decided).

**Procedure**: pick a group tab → download the current documents with [Bulk download] and
edit them → re-upload with [Bulk import]. Rows with the same `external_key` (or, failing
that, the same **trimmed title**) update the existing document instead of duplicating it,
and unchanged rows are ignored. The result toast reports created·updated·skipped counts.

- Up to 5,000 rows / 5MB. CSV must be **UTF-8 only** — from Korean Excel, save as
  "CSV UTF-8" or upload the `.xlsx` itself.
- The CounselInfo tab has a **universal counsel guide** download block (a ready-made
  starter support KB) — download it, adjust deadlines and costs to your store's policy,
  and upload it to fill your initial knowledge in one pass.
- Documents that came from an external source (catalog·board·Notion·Drive) can be edited
  too, but **the next sync may overwrite your edits** — fixing the original is the rule.

### 2.5 AI import (file·YouTube → drafts → board)

**[AI import]** — upload a file (pdf·docx·xlsx·csv·md, up to 15MB) or a YouTube URL with
public captions, and the AI splits the content into **article-level drafts**.

**Procedure**: choose a group (support manual/product recommendation/operations manual) →
upload a file or enter a video URL → **[Start analysis]** (a background job — you can leave
the screen) → review the drafts (select, edit titles/categories, watch for the "needs
review" badge) → **[Save N selected]**.

⚠️ Saved drafts are published **to the board**, not the KB — review them on the board and
adopt them into the KB (§2.0). Files without a text layer (like scanned PDFs) and videos
without captions cannot be analyzed.

---

## 3. Knowledge Validation & Quality Management

**Terms**

| Term | Meaning |
|---|---|
| Knowledge QA panel | A test panel for asking the knowledge base questions as a customer would (pinned on the right) |
| Citation | The list of documents the answer is based on. Shown with similarity scores |
| Conflict | A state where two documents are detected as containing **mutually contradictory content** |
| stale | The badge on a document whose review interval has passed and needs re-checking |
| Knowledge gap | A topic customers asked about that the knowledge had no answer for — the system proposes it as a document draft |
| Answer proposal | A proposal to promote an agent's real answer into a knowledge document (human approval required) |
| Revision | A snapshot of a document's change history. Supports diff view and restore |

### 3.1 Knowledge QA panel — always verify after registering

**Procedure**: pick an agent (**All (operator view)** or a specific agent — testing with
the actual view that the agent scope §3.5 allows) → enter a question → check the answer +
**confidence score** + **source list** (similarity per document) → if an evidence document
is wrong, press **[Fix]** next to the source (that document opens directly in edit mode) →
after fixing, re-check with **[Ask again]**.

💡 **Tips**
- If the answer carries a **blocked by moderation** badge, it hit a moderation rule (§4.5) —
  a real customer would never have seen this answer.
- If a source carries a `conflicted`/`stale` badge, clean up that document first. Topics
  with low confidence usually mean the document is missing or far from customer vocabulary.
- Whenever a policy changes, throwing "3 questions a customer would ask" at the QA panel is
  the cheapest regression test there is (for automation, see §6.3 golden questions).

### 3.2 Conflict review

**Procedure**: right-hand *conflict review* panel → per item, check the verdict
(**Contradicts/Duplicate/Related**), the two documents' similarity, and the verdict
rationale → choose an action:

| Action | Behavior |
|---|---|
| Follow A · hide B / Follow B · hide A | Keep the chosen one and deactivate the other |
| Keep both | Judged not a contradiction — both stay active |
| Not a conflict | Close this conflict item |
| Re-judge this pair | Request a new verdict after fixing the documents (failed verdicts retry here too) |

**[Re-scan]** re-checks all documents.

💡 **Tip**: Conflicts usually come from **not retiring the old version when a policy is
revised**. Don't stop at "Keep A" — record the revision date (effective date) on the
surviving document so the same thing doesn't repeat at the next revision.

### 3.3 Review interval · stale management / change history

- Setting a `review interval (days)` in the document editor puts a `stale` badge on the list
  when the deadline passes. Pressing **[Mark reviewed]** in the review-status box of the
  document detail recalculates the deadline.
- In the detail dialog's **change history tab**, you can view per-revision diffs and
  **[Restore]**.

💡 **Tip**: Give frequently changing documents (shipping fees, promotions) a short review
interval of around 30 days and stable ones (legal notices) a long one, and the stale badges
become a practical to-do list.

### 3.4 Knowledge gap proposals · answer proposals (closed loop)

- **Knowledge gap proposals** (top of the screen, shown only when there are items):
  escalation-heavy topics, intents with no evidence document, and agents' resolutions
  accumulate as KB candidates. **[Approve as KB doc]** (create the document after editing
  title·content) or **[Dismiss]** — nothing is applied automatically.
- **Answer proposals** (shown when items are pending): proposals to promote an agent's real
  answer into knowledge. Check the question, answer, and source-conversation link, then
  **[Approve]** or **[Reject]** (the reason is shown to whoever proposed it).

💡 **Tip**: These two are the channels through which the knowledge grows on its own. Making
a weekly routine of emptying them reduces the root cause of "the AI keeps handing off to
agents". Before approving, always check **that no personal data (order numbers·names)
remains in the answer** — knowledge documents are reused as evidence for every customer's
answers.

### 3.5 Category agent scope (per-agent knowledge)

Each row of the *categories* card shows its current scope as a button — **"All agents"**
(default; an empty scope = visible to everyone) or **"Agents n/total"**.

**Procedure**: click the button → choose **All agents (default)** / **Selected agents
only** → save. Narrowing the scope means only the selected agents can cite that category's
documents (answer reuse follows the same scope).

💡 **Tips**
- ⚠️ **Agents created later cannot see a narrowed category** — recheck the scopes whenever
  you add a new agent.
- Categories generated from the catalog (brands) are always usable by every agent and
  cannot be scoped.
- The agent selector in the QA panel (§3.1) is the surest way to verify "what this agent
  actually sees".

---

## 4. AI Settings
*(left menu **[AI settings]** — access: master/director)*

**Terms**

| Term | Meaning |
|---|---|
| AI agent | A bot unit with its own persona·rule set. You can create several and run different bots per channel/page |
| Default agent | The agent used by widgets with no specific assignment (always active) |
| Entry snippet | An installation code fragment that launches the widget with a specific agent |
| Persona / response rules | The bot's tone·principles description / the list of rules it must obey (injected at pipeline ③ in §0) |
| Scenario buttons | The quick-menu buttons at the bottom of the widget. Choose among 7 actions; **labels are managed per language** |
| Built-in conversations | Editing the response copy·follow-up chips of the **7 built-in scripts** SharpTalk ships with (§4.7) |
| AI function | The 5 places AI is used (chat/rag/summary/assist/moderation) — an engine is assigned per place |
| Moderation rules | The rules that inspect outbound messages (pipeline ④ in §0) |
| Answer reuse | Replaying an approved past answer for the same question without an LLM call |
| Change note | A one-line note recorded when saving persona·rules — viewable in the settings change history |

### 4.1 AI agents (multi-persona)

**Procedure**: selecting an agent in the *AI agents* card switches the persona·response
rules cards below to **that agent's**. Use **[Add]** to create a new agent with a name and
code (lowercase), and manage **[Set as default]** / the active toggle / **[Delete]**. Copy
each agent's **entry snippet** and install it on a specific page/channel so that bot
responds there.

Two customer-facing identity fields are set separately when editing an agent:
- **Widget display name** — shown in the widget header (falls back to the store display
  name when empty).
- **First response message** — written per language tab. The first bubble of a session
  assigned to this agent; empty languages fall back to the store-wide first message.

Right below the agents card, the **"Settings applied to {agent}"** card is a read-only
summary of **which values actually apply** (including default fallbacks) for the greeting,
persona, response rules, and exposed buttons — editing happens in each section.

💡 **Tips**
- An agent is **assigned once at session start** — swapping snippets mid-conversation does
  not change the bot of a session already in progress.
- Entering with a non-existent code falls back to the default agent, so the widget never
  breaks.
- The "AI agents" here have nothing to do with (human) agent accounts. Human accounts live
  in the [Users] menu.

### 4.2 Persona & response rules

**Procedure**: write the persona text → enter a **change note** → save. Response rules are
added one line at a time via [Add rule] (blank lines are removed on save).

💡 **Tips**
- Put identity·tone in the persona ("friendly, concise, polite") and **behavioral
  constraints** in the rules ("never state that a refund is complete") — the split keeps
  things manageable. Factual information (shipping fees, etc.) belongs in **knowledge
  documents**, not here — the persona is not searched.
- After saving, propagation can take up to 60 seconds because of caching.
- In the *change history* card you can open a past revision and **[Load into editor]**, but
  loading alone does not apply it — **you must also save** for it to take effect.

### 4.3 Scenario buttons

**Procedure**: pick a **Label language** tab (6 languages) at the top, then per row edit
the `label` (max 60 chars) / `action` / `enabled` checkbox / order (↑↓) / **[Agents]** (the
agents that show this button — shared by all agents, or selected agents only).
- **Labels are per language**: what you type applies only to the selected language tab; the
  others keep theirs. The 6 default buttons (Delivery Status·Cancel / Refund·Product
  Help·Contact Support·Affiliate·My Orders) ship with labels in all 6 languages.
- The hint under each label names the **built-in script** the button actually runs — "no
  built-in script" means the label is sent as a chat message and the AI answers. Script
  copy is edited in §4.7 Built-in conversations.

The 7 actions:

| Action | Actual behavior in the widget |
|---|---|
| Track shipping | Fixed shipping-policy answer + follow-up buttons |
| Cancel/refund | Fixed cancellation·refund·return answer + follow-up buttons |
| Product help | Submenu (usage·ingredients·restock, etc.) |
| Contact support | Leave-your-contact form — the path to an agent |
| My orders | Identity verification, then jumps to the orders tab |
| Partnership | Partnership info card |
| Send message | **Sends the label text verbatim as the question** → the AI answers from knowledge |

Pressing **[Edit reply]** lets you edit each action's response copy across **6 language
tabs** and configure follow-up chips (label·action·URL). The editor opens with the shipped
default copy **filled into the field** — change it to override, leave it untouched and
nothing is saved. **[Reset to default]** restores it at any time.

💡 **Tips**
- To turn a frequent question into a button, use the **Send message** action with the label
  written as the question sentence (e.g. "What is the free-shipping threshold?").
- Rather than deleting a button, hide it by unchecking `enabled` — re-enabling is easy.
  Keeping **Contact support** always on is recommended — customers who can't find an agent
  leave.
- Keep the fixed answer copy and the policy content of knowledge documents **from drifting
  apart** — update both together when a policy is revised.

### 4.4 AI functions (engine·parameters)

**Procedure**: on each function's row, choose the applied engine, enter `temperature` (0–1)
and `max_tokens`, and save individually. Unassigned functions show an
`inherited/default/stub` badge plus the actually applied engine name.

What the 5 functions do:

| Function | Actual use |
|---|---|
| chat | Conversation control such as intent classification of customer messages |
| rag | **Knowledge-based answer generation — the body of what customers see** |
| summary | Conversation summaries (history·handoff briefing) |
| assist | AI assistance in the agent console |
| moderation | LLM verdicts for context-type moderation rules |

**Fallback chain**: chosen engine unavailable → tenant default → platform default →
**stub** (demo responses) — automatic downgrade, so the conversation never breaks.

💡 **Tips**
- **max_tokens** is the answer-length ceiling — 512–1024 is plenty for chat answers.
- ⚠️ **temperature is not applied to Anthropic (Claude) engines.** Current Claude models
  reject the sampling parameter, so the system deliberately does not send it. Entering a
  value is ignored; it applies only to OpenAI-family engines.
- A lingering `stub` badge means you are not at production quality. Engines come from two
  places: **tenant-owned engines** (the *AI engine* card under [Tenant Settings → Basic
  settings] — registered with your own API key, preferred over platform engines, billed to
  your own account) and platform-provided engines (registered by the platform administrator
  at `/admin/ai-engines`). Check actual usage in the *AI usage* card on the same tab
  (including the stub-fallback count warning).
- The embedding model for knowledge search is not on this screen — it is managed
  server-side, shared across all tenants.

### 4.5 Moderation rules

**Procedure**: **[Add rule]** → choose type/scope/action:

| Item | Choices | Meaning |
|---|---|---|
| Type | Word / phrase | Containment match (case-insensitive) |
| | Regex | Pattern match (e.g. `\bsurgery\b`) |
| | Context (LLM) | Write "what to block" as a sentence and the AI judges each message |
| Scope | AI only / agents only / both | Whose outbound messages to inspect |
| Action | Block | Do not send the message (an AI answer converts into an agent handoff) |
| | Mask | Only the matched part becomes ▇▇▇, then delivered |
| | Rewrite | The AI rewrites it into a safe sentence, then delivers |

💡 **Tips**
- This gate **cannot be turned off**, and if the check itself fails it resolves to **block**
  for safety. If an agent message is refused (block notice), rephrase and send again.
- The context (LLM) type uses the moderation function's engine — in stub state there is no
  verdict quality, so connect a real engine before using it.
- Excessive word rules block legitimate answers too. Start with **mask/rewrite**, watch the
  logs, then escalate to block — that order is recommended. Rule propagation takes up to 60
  seconds.

### 4.6 Answer reuse

**Procedure**: in the *answer reuse* card, search the stored Q&As (filter to active only),
edit/delete per item, and stop everything at once with **[Deactivate all]** (after
confirmation).

💡 **Tip**: A reused answer goes out instantly for the same question without an LLM call —
fast and cheap — but **when a policy changes, a stale answer can go out unchanged.** Put
"search and update/deactivate the related items" on your policy-revision checklist. Reused
answers still pass moderation, and they follow the category agent scope (§3.5) too.

### 4.7 Built-in conversations (the 7 built-in scripts)

The *Built-in conversations* card lists **every script SharpTalk ships with** — not only the
ones scenario buttons run, but also **those a customer only reaches through a follow-up
chip** — 7 in total (cancel/refund · order cancellation · refund policy · return/exchange ·
shipping policy · order help · general product help).

**Procedure**: **[View / edit]** on a script row → choose a language → edit the
`Customer's line` (the sentence shown in the thread as if the customer had typed it when
they press the button) / `response copy` / `follow-up chips` / `after the answer` (stay in
chat·open my orders·open the inquiry form·open the partnership card·connect to an
agent·open a URL) → save.

💡 **Tips**
- Each row's badge tells you how it is reached: **"Menu button · {action}"** (run by a
  scenario button) vs **"Follow-up chip only"**. The number of edited languages ("n
  language(s) edited") is shown too.
- The default copy opens filled into the field — leave it and nothing is saved; change it
  and it overrides. **[Reset to default]** restores it.
- Keep the fixed script copy and the knowledge documents' policy **from drifting apart** —
  update both together when a policy is revised (§7 checklist).

---

## 5. Live Chat Customer-Response Settings
*(the **[Tenant Settings] → Agent handoff** tab — split out of the Basic settings tab on 2026-10-24)*

**Terms**

| Term | Meaning |
|---|---|
| Escalation (handoff) | The AI passing a conversation to the agent queue |
| Handoff settings | The bundle of settings for assignment·hours·notices after escalation |
| Business hours | The window when agents respond. Outside it, the flow switches to off-hours notice·email intake |
| SLA | Response target time. The standard by which the live chat console judges delays |
| Waiting (queue) | The state of a handed-off conversation waiting for an agent to take it |

### 5.1 Assignees · business hours · off-hours notice

**Procedure**: in the *Agent handoff* tab
1. **Assigned agents** — check the agents who receive handoffs (leave empty to notify every
   agent; whoever accepts first responds)
2. **Business-hours-only** toggle → timezone·start/end times·weekdays, plus a **break
   time** toggle if needed (break-time inquiries are treated the same as off-hours)
3. **Off-hours email** — the address that receives inquiries outside business hours
   (a warning shows if SMTP is not configured)
4. **Off-hours message to the customer** — written per language tab (default wording when
   left blank)
5. **Issue-board SLA targets** — normal/urgent (hours, 1–168h; defaults 24h/4h) — the
   basis of the board's ⚠️/🔥 delay badges
6. **Policy-forced handoff (deny-list)** — register keyword (comma-separated) + inquiry
   type + duty label + **customer-visible mode** rules. Two modes: **No answer** (hand off
   immediately without replying, the default) / **Answer, then hand off** (reply from the
   knowledge base first, then hand off anyway) — an agent is called either way, and the
   created issue gets the type·label stamped automatically

💡 **Tips**
- Set the business-hours **timezone** precisely to the store's — a US store left on Korean
  time sends the notices exactly backwards.
- Off-hours email intake requires server SMTP configuration first. If you see the warning,
  ask the platform administrator.
- If no assignee is designated, handed-off conversations only pile up in the shared queue.
  Designate at least one.

### 5.1a Consult categories · routing rules

1. In **[Manage consult categories]**, create the consult topics customers will pick from
   (e.g. Booking · Payment) and set them to **Shown**. If needed, enter vi/en names under
   ▸ *Per-language names*.
2. Write the **routing rules** from the top down. Rule = consult category + topic (keywords)
   + customer information (region · province · language, etc.) → assignee (team × label
   group, or individual agents). The **first rule** whose conditions all match is used.
3. In **Check routing** above the rules, enter a consult category, region, etc. to see who
   the conversation goes to before saving, then **Save**.

⚠️ Caution
- Label chips on the *Topic* line only match conversations handed off by a policy-forced
  handoff. Pick agent-group labels under *Assignee* (the editor shows a warning).
- Agents who have not accepted their invitation are not assigned. If a group has 0 active
  agents, that rule is skipped.
- If the customer does not pick a consult category, only rules with an empty consult
  category match. Keeping a default rule with no conditions at the bottom is the safe choice.

→ Screen-by-screen walkthrough (units & labels → consult categories → routing rules → customer request → alarms): [Agent Assignment Guide](agent-assignment.en.md)

### 5.2 Understanding escalation triggers

When the AI hands off to an agent:

| Trigger | Behavior |
|---|---|
| **Low confidence** | Appends "Shall I connect you to an agent?" to the answer and queues it |
| **Blocked by moderation** | The AI answer is withheld; an agent-connection notice is shown, then queued |
| **Customer request** | The scenario's *Contact support* or an explicit request → queued immediately (if any consult categories are shown, the widget first asks for a consult category and connects via that category's rule) |
| **Policy-forced handoff (deny-list)** | "No answer" rule: to the queue **immediately, with no AI response**. "Answer, then hand off" rule: answers from knowledge first, then queues. The message is stored·displayed normally, and the issue is stamped with type·label (this is not a message-blocking feature) |

💡 **Tips**
- The confidence threshold is not adjustable on screen (code policy) — if handoffs are
  frequent, the right response is **reinforcing the knowledge**, not the threshold (find
  the cause with the QA panel, §3.1).
- Handling handed-off conversations (accepting·AI briefing·closing·reassignment) happens
  in the live chat console (`/live-chat`) — see the live chat chapter of the integrated
  manual.

---

## 6. Validation & Improvement Loop
*(the studio on the right of **[AI settings]** + the regression check card)*

**Terms**

| Term | Meaning |
|---|---|
| Preview | A test panel for chatting with the bot without creating a real customer session |
| AI coaching | Give natural-language feedback like "make it answer this way" and receive a **proposed** settings change, applied only on approval |
| Proposal | The settings-change card coaching produced. Can be applied/rejected/reverted |
| Golden questions | The list of representative questions whose answer quality you want to keep checking (regression-test input) |
| Regression check | Re-running all golden questions after settings/knowledge changes to confirm answers did not degrade |
| Variability measurement | Running the same question repeatedly to see how much the answer fluctuates |

### 6.1 Preview

**Procedure**: studio's **Preview** tab → choose a language → **[New session]** → choose the
mode (customer/agent) and type messages. Responses display the responsible **agent badge**
and **whether escalation occurred**. Pressing **[Coach this]** on a response attaches that
conversation turn to coaching.

💡 **Tip**: After changing settings, save and then start with **[New session]** to see a
conversation with the new settings applied. Check your key questions across languages —
the answer language follows the session language. Preview sessions are **not counted in
the dashboard·statistics conversation totals** — test freely.

### 6.2 AI coaching

**Procedure**: **Agent coaching** tab → pick a thread or [New thread] → review the reference
turns attached from the preview and give instructions in natural language (e.g. "The refund
explanation is too long. Keep it under 3 sentences") → review the changes in the generated
**proposal card** → **[Apply]** / **[Reject]** / after applying, **[Revert]**.

💡 **Tips**
- Coaching **changes nothing without approval.** Read the actual changes in the proposal
  card (persona·rules diff) before applying.
- **Factual information** like "free shipping over ₩50,000" belongs in a knowledge
  document, not in coaching — coaching is a tool for polishing tone and behavioral rules.
- Slight wording drift is normal variation. **Falling confidence·rising escalations** are
  the real warning signs.

### 6.3 Regression check (golden questions)

**Procedure**: *regression check* card → register golden questions (10–20 representative
ones) → **[Run now]** → in the recent-runs list, **[Compare with previous]** to see answer
changes side by side. **[Measure variance]** shows how much the same question's
answer fluctuates. The questions registered here are also reused by the knowledge board's
**simulation golden-set A/B** (§2.0) — the yardstick for measuring a document's improvement
before adopting it.

💡 **Tips**
- Put into the golden questions: ① questions tied directly to revenue (shipping·refunds)
  ② questions that produced wrong answers in the past ③ questions affected by policy
  revisions.
- Make it an operating routine to run once **right after bulk knowledge changes, catalog
  sync, or persona revisions**. A `truncated` badge on a run means the question count
  exceeded the run ceiling and only part was executed.

---

## 7. Operations Checklist

**When a policy changes** (e.g. shipping-fee revision)
- [ ] Edit the board original → **[Re-adopt]** (for directly registered documents, edit the
  document — re-embedding is automatic) + deactivate old versions
- [ ] Check the built-in conversations copy (shipping policy·cancel/refund and the other
  built-in scripts, §4.7)
- [ ] Search answer-reuse items → fix/deactivate stale answers
- [ ] Verify 3 representative questions in the QA panel → run the golden-question regression
- [ ] Update the documents' effective date·review interval

**Weekly routine**
- [ ] Empty the knowledge gap proposals·answer proposals (§3.4)
- [ ] Process pending conflict-review items (§3.2)
- [ ] Review `stale`-badged documents and the board's "revision behind" badges (§3.3·§2.0)
- [ ] Topics with frequent handoffs in live chat → reinforce the knowledge
- [ ] If you created a new AI agent, recheck the category agent scopes (§3.5)

---

## 8. FAQ / Troubleshooting

**Q. I registered a document but the AI doesn't know its content.**
Check ① whether you only published it to the board without **adopting it into the KB** (a
board document is not answer evidence until adopted) ② the document is active (visibility
ON) ③ whether an **agent scope** on its category hides it from the current agent (§3.5 —
verify with that agent selected in the QA panel) ④ the document appears in the QA panel's
source list. If it doesn't, reinforce the title/body with customer vocabulary. Also check
whether the catalog sync result reported embedding failures.

**Q. I ran an AI import but nothing shows in the document list.**
AI-import drafts are published **to the board**, not the KB. They appear in the document
list·answer evidence only after you review and **[Adopt to KB]** on the board (§2.5).

**Q. The AI keeps handing off to agents.**
Check the question's confidence and sources in the QA panel. If there is no evidence
document, registering one is the answer; if there is one but confidence is low, split the
document and reinforce the vocabulary.

**Q. An agent's message is refused on send.**
That is a moderation block. Rephrase the expression that hit a moderation rule (§4.5) and
send again. If the rules are excessive, ask the master to soften the action (block→mask).

**Q. Answers come out only in English.**
The answer language follows **the customer's session language**. Verify by setting the
language in the preview. Writing the persona in Korean is unrelated to the answer language.

**Q. Google Drive/Notion sync imports 0 items.**
Most often the folder share (service-account email) or the Notion integration connection is
broken. Start over from [Test connection] on the credentials card.

**Q. I applied a coaching proposal and answers got worse.**
Recover with **[Revert]** on that proposal card; you can also open the previous revision in
*change history*, load it into the editor, and save.

**Q. The same question gets slightly different answers each time.**
That is normal LLM variation (check the spread with §6.3 [Variability measurement]). If the
**content** — not the wording — differs, suspect a knowledge conflict (§3.2). Note that
adjusting temperature has no effect on Anthropic engines (§4.4).

---

*Prerequisite: [Quick Setup Manual](quick-setup.en.md) · full screen reference:
[User Manual (integrated)](user-manual.en.md) · AI settings deep dive:
AI-SETTINGS-GUIDE · widget: widget settings guide*

# RPT-261013 — KB UI-version stamping (PLN-261012 SG-20 / REQ FR-010), stream s2b

- Basis: PLN-261012 §3.2 SG-20 + W2, REQ-261012 §3.4; tests in TCR-261013-s2b-KB-UI-Version.
- Branch `feature/go2joy-s2b-kb-version`, base `test/go2joy-integration` f7266697. **Not pushed, not deployed.**

## 1. Result

| Part | State |
|---|---|
| Schema `261016-kb-ui-version.sql` (3 nullable columns) | done, applied to a scratch DB only |
| Version stamp on documents, console + API + CSV import/export + history | done |
| Policy `kb_version_policy {referenceVersion, onMismatch: caveat\|hide\|off, notice{lang}}` | done |
| `caveat`: one fixed 6-language sentence after moderation, before the contact footer, never in the reuse store, replays covered | done |
| `hide`: retrieval predicate (unversioned documents stay) | done |
| `off` / no policy: byte-identical to before | done (tested) |
| Changing the reference version or mode retires the answer-reuse store | done |
| Console: list column + badge + filter, editor and add-dialog field, Q&A source badges, "Reference UI version" card | done, smoke-tested in a browser (§5) |

### The version axis (decision still open)

Go2Joy's policy CSV cites Hotel Admin **v23.3.0 / v23.4.0**; the requirements document (FR-010 / R10) cites **v0.4.1 - v0.12.0**. The implementation does not pick one:

- a version is an **opaque label**; the only operation is **equality after normalisation** (trim, lower-case, drop ONE leading `v` that sits directly before a digit: `V23.3.0` = `v23.3.0` = `23.3.0`; `0.10` != `0.1`; `version2` untouched);
- there is deliberately **no ordering** ("newer than", "within one minor") - that would bake a scheme in;
- the rule exists once in `packages/types/src/common/kb-version.ts` and once as SQL (`kbVersionNormSql`); a real-MySQL check of 21 labels shows both agree (TCR I-14);
- stated in the code comments, in the console help text (card hint and the editor field hint, 6 languages) and here.

When Go2Joy answers R10: nothing in the code changes. Stamp the documents (console, CSV, or the `UI_VERSION_BY_KEY` map in `scripts/go2joy/build-ha-policies-kb.py`) and set the reference in AI settings.

## 2. Commits (in order)

| SHA | Subject |
|---|---|
| `1a378ef2` | feat(types): KB UI-version normaliser, state and caveat copy |
| `e95ee701` | feat(kb): ui_version / kb_version_policy schema, entities, error codes, HA builder column |
| `e285ca02` | feat(kb): UI-version caveat after moderation, hide predicate, version in revisions/import/export |
| `4b2febfa` | feat(kb): read-only GET /knowledge/version-policy for the document list badge and filter |
| `7c1fe40b` | feat(console): KB UI version column, filter, badge, editor field and Reference UI version card |
| (this commit) | docs: TCR/RPT |

## 3. What changed (files)

**Schema / config**
- `sql/261016-kb-ui-version.sql` (new), `sql/artefacts.tsv` (+3 lines), `docker/init-sql/01-schema.sql` (+3 columns).
- `apps/api/src/global/constant/error-code.constant.ts`: `KB_UI_VERSION_INVALID` E5110, `KB_VERSION_POLICY_INVALID` E5111 (E5112-E5114 reserved, unused), appended at the end of the object.
- Entities: `kb-document.entity.ts` (`uiVersion`), `kb-document-revision.entity.ts` (`uiVersion`), `tenant-ai-config.entity.ts` (`kbVersionPolicy`, explicit `type: 'json'`).

**Shared (`packages/types`)**
- `src/common/kb-version.ts` (+ spec, + `index.ts` export): normaliser, `sameKbVersion`, `kbVersionState`, label validation, `KbVersionPolicy`, six built-in caveat sentences, `kbVersionCaveatText/Variants`, `kbVersionBadge`, `kbVersionPolicyProblem`.

**API**
- `knowledge/kb-version.util.ts` (new, standalone - no service imports, avoids the circular-import boot crash): `sanitizeKbVersionPolicy`, `parseUiVersionInput`, `activeKbReference`, `kbPolicyChangedBehaviour`, SQL builders.
- `chat/rag.service.ts`: `RetrievedChunk.uiVersion`; `RetrievalOpts.uiVersionReference` + `withVersionScope` (resolved inside `retrieveHybrid` so no caller can forget it) + a 3-line predicate in `baseQuery` (kept tiny for s2a); `kbVersionPolicy()`, `versionCaveat()`.
- `chat/chat.service.ts`: policy read next to the footer config; caveat variants stripped from the history; one block after the footer logic; `answerText: baseText` for the reuse store; trace flag `uiVersionCaveat`. No new constructor parameter, nothing added to `SYSTEM_MESSAGES` (copy lives in `packages/types`).
- `ai-engine/ai-config.service.ts`: `getKbVersionPolicy`, save through `sanitizeKbVersionPolicy` (validated BEFORE any other write of the request), `answerReuse.deactivateAll` on a behaviour change, audit `ai_config.kb_version_policy`; two optional trailing constructor params (`AnswerReuseService`, `AuditService`). `ai-config.controller.ts` / DTO `kb_version_policy`; `ai-engine.module.ts` imports `AnswerReuseModule` (acyclic).
- `knowledge/knowledge.service.ts`: create/update `ui_version`, list select + `ui_version_state` filter, `ask()` sources `uiVersion`/`versionState` + caveat, `getVersionPolicy`, `retireReplaysIfHiding`; optional trailing `AnswerReuseService`; `knowledge.module.ts` imports `AnswerReuseModule`. `knowledge.controller.ts`: `GET /knowledge/version-policy`. `knowledge.mapper.ts`, `dto/request/knowledge.request.ts`.
- `kb-revision.service.ts`: `uiVersion` tracked, snapshotted, restored (see deviation 3). `bulk-import.service.ts` / `bulk-export.service.ts`: `ui_version` column.
- `scripts/go2joy/build-ha-policies-kb.py`: `ui_version` fieldname, blank by default, `UI_VERSION` / `UI_VERSION_BY_KEY` overrides, warning about blank cells (see §8).

**Console (`apps/web`)**
- `knowledge/KbVersionBadge.tsx` (new: badge + editor field), `KnowledgePage.tsx` (column, filter, field in editor and add dialog, detail badge), `KnowledgeQaPanel.tsx`, `knowledge.service.ts`, `knowledge.hooks.ts`.
- `ai-settings/KbVersionSection.tsx` (new card), `AiSettingsPage.tsx` (mount), `ai-settings.service.ts`.
- Locales: `knowledge.json` and `aiSetting.json`, six languages each, pure insertions (no existing line touched).

## 4. Deviations from the PLN

1. **Migration file name**: `261016-kb-ui-version.sql` (stream brief), not `261014-...` of PLN §4.
2. **A third column**: `kb_document_revisions.ui_version`. The PLN lists `kb-revision.service` snapshots without a column to hold them.
3. **Revision states**: NULL = "not recorded" (every revision before this file), `''` = "recorded, unversioned". A restore applies a label or `''` and leaves the document's own version alone for NULL - otherwise rolling back to an old revision would silently wipe a stamped version and silence the caveat on exactly the stale text. (Real-DB check: TCR I-13.)
4. **`GET /knowledge/version-policy`** (not in the PLN): the badge and the mismatch filter need the reference, and the people who curate documents hold the knowledge capability, not AI-settings rights. Returns reference + mode only (no wording). The console degrades to neutral badges if it fails.
5. **`unversioned` is a warning only while the tenant has a reference** (`kbVersionBadge`): for a tenant that never configured it every document is unversioned and flagging them all is noise. A fourth state `unchecked` = has a version, nothing to compare with.
6. **Normaliser detail**: ONE leading `v` is dropped only when a digit follows (the PLN said "strip a leading v"). Keeps labels like `version2` intact and keeps TS and SQL identical (`REGEXP '^v[0-9]'`).
7. **The caveat is one sentence with no placeholder**: a tenant that changes its reference version must not leave earlier conversations holding a sentence we can no longer recognise; plain substring stripping then works for history and for a model-written copy. The sentence does not name the versions (the console shows them). Wording is draft copy, per language, tenant-overridable.
8. **Console Q&A (`knowledge.ask`) also appends the caveat** and returns per-source `versionState`, so what the operator tests is what shoppers read (the contact footer is not appended there, as before).
9. **Retiring replays also on a document re-stamp, but only under `hide`** (edit, CSV import, restore): a stored replay may cite a document `hide` now excludes. Under `caveat` the live read already covers replays, so nothing is retired. The PLN only asked for reference/policy changes.
10. **Audit row** `ai_config.kb_version_policy` on a behaviour change (privileged: it decides what customers are told). No config-revision history for the policy: `guest_guidance` has none either.
11. **Sanitiser refuses `caveat`/`hide` with no reference** (E5111) - it would silently do nothing. `off` + blank + no wording = policy removed (null).
12. **Not regenerated**: `reference/go2joy-ha-policies-kb-260916.csv`. A blank `ui_version` column in a re-imported file CLEARS stamped versions (that is what makes download -> edit -> upload round-trip), so the committed CSV without the column stays the safe artefact until the axis is decided.
13. **No vector payload change**: Qdrant stores `tenant_id, category, source, active` only; `hide` works because vector-only hits are re-hydrated from MySQL through `baseQuery`. Confirmed by reading `retrieveHybrid` and by the real-MySQL `hide` run.

## 5. Verified vs not verified

**Verified**
- tsc (api, web, widget) clean; API full jest 248 suites passed + the 3 known Windows baseline failures (2,648 / 2,651 tests); 170 new/extended API tests (7 suites); types 313; common 64; widget 61; i18n:check; manifest diff = only my 3 lines.
- Real boot on a scratch DB (`Nest application successfully started`) and `SHOW COLUMNS`; HTTP smoke of every new/changed endpoint, CSV round trip with and without the column, `hide` against real MySQL, reuse retirement, audit rows, restore semantics on the real revision table, SQL-vs-TS normaliser on 21 labels (TCR §2).
- Browser smoke (vite + scratch API, 1500x900): list column/badges/filter, detail badge, editor field with inline validation, save, history label, AI-settings card + toast, Q&A badges + caveat (TCR §3).
- Mutation checks for the five key behaviours (TCR §1).

**NOT verified**
- The five non-English UI languages were only checked for key parity (`i18n:check`) and by reading; the browser run was in English. Vietnamese/Korean/Japanese/Chinese/Spanish wording needs a native-speaker review (caveat sentences included - they are draft copy).
- The add-document dialog field (type-checked and wired like the editor field; not clicked).
- A real LLM + Voyage run: the scratch engine was the built-in stub, so the "model copies the caveat" case is covered by unit tests only.
- `.xlsx` upload of the new column (same record path via `cell.text`; only CSV exercised). Excel coercing `0.10` to `0.1` is documented in the hint, not tested.
- Mobile layout, narrow viewports (the list gained a column and scrolls horizontally as before).
- Any staging/production behaviour; Notion/Drive-synced documents get no version (they stay "unversioned").

## 6. Migration (for the PR body)

## Migration
- SQL: `sql/261016-kb-ui-version.sql` - three additive nullable columns, no backfill, no `AFTER`.
- Apply **before** deploying the code (old code + new column is safe; new code + old schema returns 500 on `kb_documents` / `tenant_ai_config` reads).
  - [ ] local dev DB (`db_sharptalk`) - **stop `nest --watch` first** (memory: synchronize would otherwise drop the columns of other branches)
  - [ ] staging (`DB_SYNCHRONIZE=false` since 2026-07-31: manual pre-apply, then `pre-deploy-check`)
  - [ ] production (not hosted yet)
  - [ ] self-hosted Go2Joy install: `docker/init-sql/01-schema.sql` already carries the columns; an existing install applies the file.
- Rollback: `ALTER TABLE kb_documents DROP COLUMN ui_version; ALTER TABLE kb_document_revisions DROP COLUMN ui_version; ALTER TABLE tenant_ai_config DROP COLUMN kb_version_policy;` - safe, nothing reads them before this release. Code rollback alone is also safe (old code ignores the columns).
- Order with sibling streams: independent of the other 2610NN files; the three tables it touches are shared with s2a (kb_categories is NOT touched here) - no overlap.
- If a later backfill stamps existing documents, assign `updated_at = updated_at` in the same UPDATE (template in the SQL header; the `migration_kb_provenance.sql` trap).

## 7. Deploy state

Not deployed anywhere. No PR yet (the coordinator merges branches into `test/go2joy-integration`). No new environment variable.

## 8. Operator notes

- **Excel and numeric versions**: typing `0.10` in a spreadsheet stores the number 0.1, which no longer equals `0.10`. Write versions with a `v` (`v0.10`); the editor hint says so.
- **CSV semantics**: a file WITHOUT a `ui_version` column never touches versions; a file WITH it sets every row - a blank cell clears. Exports always carry the column (last), so the round trip is lossless.
- **`hide` and `caveat` interplay with the reuse store**: changing reference/mode retires every stored replay of the tenant (they re-fill by use). Editing only the caveat wording does not.
- **Agent-written replies** stored in the reuse store carry no citations, so a replay of one has no document to compare - it gets no caveat.

## 9. Follow-ups

- Decide the axis (R10) and stamp the Go2Joy documents; decide whether `UI_VERSION_BY_KEY` should split POL-22..25 (v23.4.0) from the rest (v23.3.0).
- Native-speaker review of the six caveat sentences and the console copy; consider placing the reference version in the caveat once the wording is signed off (needs variant handling by regex).
- Notion / Drive adapters could read a `ui_version` property from the source page.
- Gate simulator (s2a wave 2) and the golden-question runner could report which caveat/hide decision applied.
- Show the stamped version in the history transcript's source chips (`trace.citations[].uiVersion` is already stored).

## 10. Cross-stream risk

- `rag.service.ts` `baseQuery` / `RetrievalOpts` (s2a will add an access-tier predicate/field): my hunk is one `if (opts?.uiVersionReference)` block at the end of `baseQuery` and one field in `RetrievalOpts`; keep both.
- `chat.service.ts`: two small hunks near `footerCfg` and the footer block, one `answerText: baseText` line, one import-list entry.
- `error-code.constant.ts`: my codes are at the very end of the object, after `E9002`.
- `locale JSON`: insertions after `videoRefHint` / `"filter": {` / `"field": {` (knowledge) and before `"guest": {` (aiSetting) - not at end-of-file.
- `sql/artefacts.tsv` and `01-schema.sql` will conflict textually with other streams; regenerate the manifest after merging (`npm run migrations:manifest`).
- `KnowledgeService` / `AiConfigService` gained optional trailing constructor params, and `AiEngineModule` / `KnowledgeModule` import `AnswerReuseModule`; specs that build these positionally keep working.

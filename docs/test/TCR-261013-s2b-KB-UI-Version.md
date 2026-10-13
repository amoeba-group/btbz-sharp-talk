# TCR-261013 — KB UI-version stamping (PLN-261012 SG-20 / REQ FR-010), stream s2b

- Basis: PLN-261012 §3.2 SG-20 + wireframe W2, REQ-261012 §3.4. Implementation report: RPT-261013-s2b-KB-UI-Version.
- Branch `feature/go2joy-s2b-kb-version` (base `test/go2joy-integration` f7266697). Nothing deployed.
- The version AXIS is undecided (Go2Joy CSV: Hotel Admin v23.3.0 / v23.4.0; FR-010 / R10: v0.4.1-v0.12.0). Every case below that compares versions is written for BOTH axes and for equality only.

## 1. Unit cases (jest)

| Suite | Cases | What it pins |
|---|---|---|
| `packages/types/src/common/kb-version.spec.ts` | 51 | normalisation matrix (`v23.3.0` = `V23.3.0` = `23.3.0`; `version2`, `vNext`, `vv1.0` untouched; blank/null -> none), equality only (`0.10` != `0.1`), `kbVersionState` (unversioned / unchecked / match / mismatch), label validation (charset, 1-16, trim), six built-in caveat sentences (one sentence, no placeholder), tenant wording per exact language else built-in, caveat variants, console badge severity ("unversioned" is a warning only while a reference exists), policy form rules |
| `apps/api/.../knowledge/kb-version.util.spec.ts` | 45 | policy sanitiser (valid, snake_case spelling, defaults, off+blank = null, 14 refusals with E5111, notice limit), `parseUiVersionInput` (E5110), `activeKbReference`, `kbPolicyChangedBehaviour` (reference / mode change retires replays; re-spelling, wording, null->off do not), SQL builders |
| `apps/api/.../chat/rag-kb-version.spec.ts` | 29 | `hide` predicate present for hide only (and for the vector re-hydration), absent for no policy / caveat / off / hide-without-reference (retrieval byte-identical), caller can pin the scope, other scope flags kept; `versionCaveat`: mismatch -> sentence in 6 languages, tenant wording, NULL/blank silent, match silent in either spelling, ONE sentence for several mismatching citations, both axes, no DB read for no policy / off / hide / no reference, LIVE batch read ignores a stale stored `uiVersion`, only distinct positive ids, tenant + shared scope |
| `apps/api/.../chat/chat.service.kb-version.spec.ts` | 23 | whole chat path with a REAL `RagService`: caveat appended on mismatch (6 languages), **after moderation** (moderator never sees it), **not in the reuse store**, silent for NULL and for a match, between answer and contact footer, idempotent against a model-written copy (also another language's copy), earlier caveats stripped from the history, tenant wording, **replay covered** (live read beats stored citations), replay of a now-matching document silent, draft mode carries it, trace flag, **tenant without policy / off / hide byte-identical and no document read** |
| `apps/api/.../ai-engine/ai-config.service.kb-version.spec.ts` | 15 | save + read-back, null clears, bad policy refused with E5111 **before the persona in the same request is written**, `answerReuse.deactivateAll` on a new reference / new mode / first enable / disable, not on wording-only, re-spelling or an unrelated save, audit row with old and new, reuse/audit outage never fails the save, service builds without the optional collaborators |
| `apps/api/.../knowledge/knowledge.service.ui-version.spec.ts` | 31 | edit stamps / clears (blank, null) / leaves alone / refuses malformed (E5110, nothing saved), no re-embed, history diff base, create with and without; hide policy: re-stamp and restore retire replays, caveat / off / none do not, reuse outage tolerated; list filter (`unversioned`, `mismatch` with the NORMALISED reference, empty page without a reference, default where unchanged); console Q&A: per-source `uiVersion` + `versionState`, null state without a reference, caveat shown after moderation, none on a blocked answer; `GET /knowledge/version-policy` payload (no wording); mapper |
| `apps/api/.../knowledge/bulk-import.service.ui-version.spec.ts` | 15 | **file without the column never wipes a version** (same text: skipped; changed text: updated and keeps it; created: unversioned), file with the column: create, blank cell clears, **version-only difference is an update, not skipped, no re-embed**, history row, identical version skipped, text+version, case-insensitive header, 3 bad labels as row errors; export: `ui_version` last column; **export -> import is a no-op** |
| `apps/api/.../knowledge/kb-revision.service.ui-version.spec.ts` | 12 | snapshot carries the version (`''` = recorded unversioned, never NULL), baseline carries the pre-edit version, re-stamp alone is a changed field, null == undefined, **restore applies a label, applies `''` as clear, and leaves the document alone for NULL / absent (legacy revision)**, restore revision lists the field |
| existing suites touched | - | `bulk-export.service.spec.ts` updated for the new last column (the contract it documents changed on purpose) |

Mutation checks (temporary revert, run, restore): caveat never appended -> 12 fail; caveat copied into the reuse store -> 6 fail; import guard removed -> 2 fail; restore treating NULL as "unversioned" -> 2 fail; `hide` predicate dropped -> 2 fail.

## 2. Integration (real stack, scratch DB `scratch_s2b`, API on :3023, DB_SYNCHRONIZE=true, then dropped)

| # | Scenario | Result |
|---|---|---|
| I-1 | Real boot after the entity change | `Nest application successfully started`; `SHOW COLUMNS` shows `kb_documents.ui_version varchar(16) NULL`, `kb_document_revisions.ui_version varchar(16) NULL`, `tenant_ai_config.kb_version_policy json NULL` |
| I-2 | `GET /ai-config` default / `PUT` caveat v0.12.0 with VI notice / invalid reference / invalid mode | `null` / stored cleaned / 400 E5111 x2 with details |
| I-3 | `PATCH /knowledge/documents/:id` `" v0.9.2 "`, `V0.12.0`, `v 1/2`, 70 chars | 200 `v0.9.2` / 200 `V0.12.0` / 400 E5110 / 400 E5003 (DTO cap) |
| I-4 | List filters | `ui_version_state=mismatch` -> the one `v0.9.2` doc; `unversioned` -> 10 docs, all null; bogus -> 400 E5003 |
| I-5 | Revisions | doc history shows `[update, changedFields=[uiVersion]]` and `[baseline]`; revision detail carries `uiVersion` |
| I-6 | `POST /knowledge/ask` in caveat mode | sources `[id, uiVersion, versionState]` = unversioned / match / mismatch...; answer tail = the tenant's VI wording after the answer |
| I-7 | Export CSV | header `category,title,content,external_key,source_url,video_ref,ui_version`; stamped cells `V0.12.0`, `v0.9.2` |
| I-8 | Re-upload the unchanged export | `created 0, updated 0, skipped 12, versionChanged 0` |
| I-9 | Upload an OLDER file (no `ui_version` column) | rows updated/skipped, `versionChanged 0`; stamped versions still present afterwards |
| I-10 | `hide` mode, real MySQL predicate | the `v0.9.2` document disappears from `ask` sources; `V0.12.0` (normalised match) and unversioned ones stay; `off` -> it is back; policy `null` -> `versionState` null everywhere |
| I-11 | Answer-reuse retire | two active reuse rows -> `active=0, active=0` after the policy changed (caveat -> hide) |
| I-12 | Audit | three `ai_config.kb_version_policy` rows with `{from,to}` (caveat on, hide, off); off -> null wrote none (no behaviour change) |
| I-13 | Restore semantics on the real revision table | revision with `''` -> document cleared; legacy revision with NULL -> stamp `v0.12.0` **survives**; revision with a label -> label comes back |
| I-14 | **SQL vs TypeScript normaliser on MySQL 8** | 21 labels (incl. `V23.3.0`, `v23.4.0-RC1`, `version2`, `vNext`, `v`, `vv1.0`, `R5`, `2026-10`, `v0.10` vs `0.1`, `''`, `'   '`): normalised key, "unversioned" and the `hide` keep-predicate all agree - **ALL 21 AGREE** |

## 3. Console (browser, vite :5193 -> API :3023, viewport 1500x900)

| # | Scenario | Result |
|---|---|---|
| C-1 | AI settings > Reference UI version card renders; blank reference + caveat shows the "enter the version or choose Off" hint and Save disabled; built-in VI sentence is the textarea placeholder | pass |
| C-2 | Type `v0.12.0`, Save | toast "Reference version saved" |
| C-3 | Knowledge list | column "UI version": `v0.9.2` orange (mismatch), `V0.12.0` green (match), "No version" orange; before the reference existed the same rows were grey / dash |
| C-4 | Filter "Other version" | exactly the `v0.9.2` row; option disabled (tooltip) while no reference is set (observed against an API that lacked the endpoint) |
| C-5 | Document detail | version badge; Edit shows the "UI version" field with its hint; `v 1/2` shows the inline warning and disables Save; `v0.12.0` saves (detail badge turns green) |
| C-6 | Change history tab | the edit is listed with the field label "UI version" |
| C-7 | Knowledge Q&A | answer + caveat sentence (KO, the panel language), source badges "No version" |
| C-8 | Degradation | with the `version-policy` request returning 404 the list still renders (badges neutral, mismatch option disabled) |

## 4. Edge cases covered on purpose

- `v0.10` vs `0.1`; `version2`/`vNext` keep their leading letters; two leading v's.
- NULL, `''` and whitespace are all "unversioned"; `''` on a revision means "recorded unversioned", NULL means "not recorded".
- Replays: citations stored days ago say the old version; the live read wins.
- A model that copies the caveat from the history (all six languages and tenant wording are stripped from history and from the answer).
- Blank cell vs absent column in a CSV; xlsx uses the same record path (`cell.text`) - not separately tested.
- Policy saved together with a persona edit and a bad policy -> nothing persisted.
- Reuse store or audit unavailable at save time -> the save still succeeds (logged).

## 5. Gates

| Gate | Result |
|---|---|
| `apps/api` `npx tsc -p tsconfig.check.json --noEmit` | 0 errors |
| `apps/web` `npx tsc -p tsconfig.check.json --noEmit` | 0 errors |
| `apps/widget` `npx tsc -p tsconfig.check.json --noEmit` | 0 errors |
| API jest, full run | 248 suites passed, **3 failed = the known Windows baseline** (`embed-loader`, `heic-conversion`, `board-attachment.service`); 2,648 of 2,651 tests passed |
| 7 new/extended API suites | 170 / 170 |
| `packages/types` jest | 13 suites, 313 tests passed |
| `packages/common` jest (check config) | 2 suites, 64 tests passed |
| widget `node --test` | 61 / 61 |
| `npm run i18n:check` | es, ko, vi, ja, zh complete |
| `npm run migrations:manifest` | only the 3 new `261016-kb-ui-version.sql` lines added to `sql/artefacts.tsv` |

## 6. Not verified

See RPT-261013-s2b-KB-UI-Version §6 (other five UI languages visually, the add-document dialog field, a real LLM + Voyage run, staging, xlsx upload of the new column, Excel number coercion).

#!/usr/bin/env node
/**
 * init-sql drift guard (PLN-261012 SG-80 / REQ D-18).
 *
 * A FIRST INSTALL builds its schema from docker/init-sql/01-schema.sql only —
 * `DB_SYNCHRONIZE` stays false, so a table or column that file lacks is missing
 * forever, and every entity that selects it answers 500. That is exactly how six
 * migrations (260920 … 261008) shipped to `sql/` without reaching the file, and
 * a fresh Go2Joy install booted fine and then failed on the first query that
 * touched `tenant_ai_config.answer_footer`.
 *
 * The deploy-time check (scripts/check-migrations.sh) cannot catch this: it
 * inspects a RUNNING database. This guard compares the two committed sources —
 * the artefact manifest (sql/artefacts.tsv, one row per table/column/index a
 * migration promises) against the first-boot DDL — so the gap fails in CI,
 * before a customer is the one to find it.
 *
 *   npm run initsql:check
 *   node scripts/check-initsql-drift.mjs [--schema <file>] [--manifest <file>]
 *
 * Exit 0 = every manifest artefact exists in the first-boot schema. Exit 1 = drift
 * (the list says which migration and what to add). Exit 2 = a source could not be
 * read or parsed (never reported as "no drift").
 *
 * Optional exceptions: docker/init-sql/drift-exceptions.tsv (kind<TAB>table<TAB>name
 * <TAB>reason) for an artefact a LATER migration removed again — the manifest only
 * records ADDs, so a dropped column would otherwise be flagged forever. Missing
 * file = no exceptions. A reason is mandatory so an exception is a decision, not
 * a way to silence the guard.
 */

import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Strip comments the same way scripts/check-migrations.mjs does, so both agree on what is DDL. */
function normalise(sql) {
  return sql
    .replace(/\/\*(?!!)[\s\S]*?\*\//g, ' ')
    .replace(/^\s*--.*$/gm, ' ')
    .replace(/^\s*#.*$/gm, ' ');
}

const IDENT = '[`"]?([A-Za-z0-9_]+)[`"]?';

/**
 * What the first-boot schema contains.
 *
 * mysqldump-style `CREATE TABLE` blocks give columns and keys line by line. Later
 * `ALTER TABLE … ADD COLUMN/INDEX` and `CREATE INDEX` statements are honoured as
 * well, so appending DDL at the end of the file is as valid as editing the block
 * — a contributor should not have to know which style the file happens to use.
 *
 * @returns {{ tables: Map<string, { columns: Set<string>, indexes: Set<string> }> }}
 */
export function parseSchema(text) {
  const tables = new Map();
  const lines = text.split(/\r?\n/);
  let current = null;

  for (const line of lines) {
    const create = line.match(/^\s*CREATE TABLE (?:IF NOT EXISTS )?[`"]?([A-Za-z0-9_]+)[`"]?\s*\(/i);
    if (create) {
      current = { columns: new Set(), indexes: new Set() };
      tables.set(create[1], current);
      continue;
    }
    if (!current) continue;
    if (/^\s*\)\s*(ENGINE|DEFAULT|COMMENT|;)/i.test(line) || /^\s*\)\s*;?\s*$/.test(line)) {
      current = null;
      continue;
    }
    const col = line.match(/^\s+[`"]([A-Za-z0-9_]+)[`"]\s+\S/);
    if (col) {
      current.columns.add(col[1]);
      continue;
    }
    const key = line.match(/^\s+(?:UNIQUE |FULLTEXT |SPATIAL )?(?:KEY|INDEX)\s+[`"]?([A-Za-z0-9_]+)[`"]?/i);
    if (key) current.indexes.add(key[1]);
    if (/^\s+PRIMARY KEY/i.test(line)) current.indexes.add('PRIMARY');
  }

  // Statements after the CREATE blocks. Only text OUTSIDE the CREATE TABLE bodies
  // matters here; scanning the whole normalised file is harmless because column
  // lines never start with ALTER/CREATE.
  const flat = normalise(text).replace(/\s+/g, ' ');
  for (const m of flat.matchAll(new RegExp(`ALTER TABLE ${IDENT}([^;]*)`, 'gi'))) {
    const table = tables.get(m[1]) ?? tables.set(m[1], { columns: new Set(), indexes: new Set() }).get(m[1]);
    const tail = m[2] ?? '';
    for (const c of tail.matchAll(new RegExp(`ADD COLUMN (?:IF NOT EXISTS )?${IDENT}`, 'gi'))) table.columns.add(c[1]);
    for (const i of tail.matchAll(
      new RegExp(`ADD (?:UNIQUE |FULLTEXT |SPATIAL )?(?:KEY|INDEX) (?:IF NOT EXISTS )?${IDENT}`, 'gi'),
    )) {
      table.indexes.add(i[1]);
    }
  }
  for (const m of flat.matchAll(new RegExp(`CREATE (?:UNIQUE |FULLTEXT |SPATIAL )?INDEX ${IDENT} ON ${IDENT}`, 'gi'))) {
    const table = tables.get(m[2]) ?? tables.set(m[2], { columns: new Set(), indexes: new Set() }).get(m[2]);
    table.indexes.add(m[1]);
  }
  return { tables };
}

/** @returns {{ file: string, kind: 'table'|'column'|'index'|'data', table: string, name: string }[]} */
export function parseManifest(text) {
  const rows = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim() || line.startsWith('#')) continue;
    const [file, kind, table, name] = line.split('\t');
    if (!file || !kind) continue;
    rows.push({ file, kind, table: table ?? '-', name: name ?? '-' });
  }
  return rows;
}

function parseExceptions(text) {
  const out = new Set();
  const problems = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim() || line.startsWith('#')) continue;
    const [kind, table, name, reason] = line.split('\t');
    if (!kind || !table || !reason || !reason.trim()) {
      problems.push(`exception line needs kind<TAB>table<TAB>name<TAB>reason: "${line}"`);
      continue;
    }
    out.add(`${kind}\t${table}\t${name ?? '-'}`);
  }
  return { set: out, problems };
}

/**
 * Artefacts the manifest promises that the schema does not have.
 * Data-only migrations declare no schema and are skipped (their state cannot be
 * read from DDL — scripts/check-migrations.sh reports them separately).
 */
export function findDrift(schemaText, manifestText, exceptionsText = '') {
  const schema = parseSchema(schemaText);
  const manifest = parseManifest(manifestText);
  const { set: allowed, problems } = parseExceptions(exceptionsText);
  const missing = [];
  let checked = 0;

  for (const row of manifest) {
    if (row.kind === 'data') continue;
    if (allowed.has(`${row.kind}\t${row.table}\t${row.name}`)) continue;
    checked += 1;
    const table = schema.tables.get(row.table);
    let present;
    if (row.kind === 'table') present = !!table;
    else if (row.kind === 'column') present = !!table && table.columns.has(row.name);
    else present = !!table && table.indexes.has(row.name);
    if (!present) missing.push(row);
  }
  return { missing, checked, manifestRows: manifest.length, tableCount: schema.tables.size, problems };
}

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? path.resolve(process.argv[i + 1]) : fallback;
}

export function run(argv = process.argv) {
  const schemaPath = arg('--schema', path.join(ROOT, 'docker/init-sql/01-schema.sql'));
  const manifestPath = arg('--manifest', path.join(ROOT, 'sql/artefacts.tsv'));
  const exceptionsPath = arg('--exceptions', path.join(ROOT, 'docker/init-sql/drift-exceptions.tsv'));

  let schemaText;
  let manifestText;
  try {
    schemaText = readFileSync(schemaPath, 'utf8');
    manifestText = readFileSync(manifestPath, 'utf8');
  } catch (err) {
    console.error(`init-sql drift check could not read its inputs: ${err.message}`);
    return 2;
  }
  const exceptionsText = existsSync(exceptionsPath) ? readFileSync(exceptionsPath, 'utf8') : '';

  const result = findDrift(schemaText, manifestText, exceptionsText);

  // A parser that silently finds nothing would report "no drift" for everything.
  if (result.tableCount === 0 || result.manifestRows === 0) {
    console.error(
      `init-sql drift check parsed nothing (schema tables: ${result.tableCount}, manifest rows: ${result.manifestRows}).\n` +
        'Refusing to report "no drift" on an empty read.',
    );
    return 2;
  }
  if (result.problems.length) {
    for (const p of result.problems) console.error(p);
    return 2;
  }

  const rel = (p) => path.relative(process.cwd(), p) || p;
  if (result.missing.length === 0) {
    console.log(
      `OK — ${result.checked} manifest artefact(s) all exist in ${rel(schemaPath)} (${result.tableCount} tables).`,
    );
    return 0;
  }

  const byFile = new Map();
  for (const m of result.missing) {
    if (!byFile.has(m.file)) byFile.set(m.file, []);
    byFile.get(m.file).push(m);
  }
  console.error(`FAIL — ${rel(schemaPath)} is missing ${result.missing.length} artefact(s) from ${byFile.size} migration(s):\n`);
  for (const [file, rows] of byFile) {
    console.error(`  sql/${file}`);
    for (const r of rows) {
      console.error(`    missing ${r.kind} ${r.table}${r.kind === 'table' ? '' : `.${r.name}`}`);
    }
  }
  console.error(
    '\nA fresh install builds its schema from that file alone (DB_SYNCHRONIZE=false), so every one of\n' +
      'these is a 500 waiting on the first query that selects it. Add the same DDL to the matching\n' +
      'CREATE TABLE block (or regenerate the file from a migrated database — see its header), then re-run.\n' +
      'If a LATER migration removed the artefact on purpose, record it in docker/init-sql/drift-exceptions.tsv\n' +
      'with a reason.',
  );
  return 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  process.exit(run());
}

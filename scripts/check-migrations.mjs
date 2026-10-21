#!/usr/bin/env node
/**
 * Which migrations still need applying (PLN-260820 W3).
 *
 * The deploy standard is that SQL is applied BEFORE the code that needs it, by
 * a human, because a script that runs DDL unattended is how a bad migration
 * reaches production at 2am (kit 04 §3). This does not apply anything — it
 * tells you what is still outstanding, so "did I run the SQL?" stops being a
 * question answered by memory.
 *
 * How it decides: each file in sql/ declares artefacts (a table, a column, an
 * index). Those either exist in the database or they do not. That is a more
 * honest signal than a migrations table, which records intent rather than fact
 * and drifts the moment someone applies a file by hand.
 *
 * This runs where Node lives — a developer machine or CI. The deploy-time check
 * a customer runs is `scripts/check-migrations.sh`, pure bash, because their
 * host may well have Docker and no Node (the staging host does not). This
 * writes the artefact manifest that the bash script reads.
 *
 *   npm run migrations:manifest          regenerate sql/artefacts.tsv
 *   npm run migrations:manifest -- --check   fail if it is out of date (CI)
 *   node scripts/check-migrations.mjs --json  report against a live database
 */

import { readFile, readdir } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const exec = promisify(execFile);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SQL_DIR = path.join(ROOT, 'sql');

const asJson = process.argv.includes('--json');
const CONTAINER = process.env.MYSQL_CONTAINER || 'sharptalk_mysql';

/** Strip comments and string-literal quoting so one regex pass sees real DDL. */
function normalise(sql) {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/^\s*--.*$/gm, ' ')
    // MySQL also treats `#` as a line comment; a commented-out ALTER would
    // otherwise be recorded as an artefact the file never creates.
    .replace(/^\s*#.*$/gm, ' ')
    .replace(/\s+/g, ' ');
}

const ident = '[`"]?([A-Za-z0-9_]+)[`"]?';

/**
 * Artefacts one file promises to leave behind.
 *
 * Guarded migrations wrap their DDL in a string literal for a prepared
 * statement, so the same patterns are matched inside quotes — which is why the
 * text is normalised rather than parsed as statements.
 */
function artefacts(text) {
  const sql = normalise(text);
  const out = [];

  for (const m of sql.matchAll(new RegExp(`CREATE TABLE (?:IF NOT EXISTS )?${ident}`, 'gi'))) {
    // `*_bak_*` is a data snapshot taken before a backfill (rollback aid), not
    // schema: init-sql leaves it out, so a fresh install would never "apply" it.
    if (/_bak_/i.test(m[1])) continue;
    out.push({ kind: 'table', table: m[1] });
  }

  // ALTER TABLE x ADD COLUMN a, ADD COLUMN b — the table carries across the
  // whole statement, so capture it once and scan its tail.
  for (const m of sql.matchAll(new RegExp(`ALTER TABLE ${ident}([^;']*)`, 'gi'))) {
    const table = m[1];
    const tail = m[2] ?? '';
    for (const c of tail.matchAll(new RegExp(`ADD COLUMN (?:IF NOT EXISTS )?${ident}`, 'gi'))) {
      out.push({ kind: 'column', table, name: c[1] });
    }
    for (const i of tail.matchAll(
      new RegExp(`ADD (?:UNIQUE |FULLTEXT |SPATIAL )?(?:KEY|INDEX) ${ident}`, 'gi'),
    )) {
      out.push({ kind: 'index', table, name: i[1] });
    }
  }
  return out;
}

async function query(sql) {
  const { stdout } = await exec('docker', [
    'exec',
    CONTAINER,
    'sh',
    '-lc',
    // Name the database explicitly: without it DATABASE() is NULL and every
    // information_schema filter returns nothing, which reads as "no migrations
    // applied" rather than as an error.
    `mysql -uroot -p"$MYSQL_ROOT_PASSWORD" -N -B "$MYSQL_DATABASE" -e ${JSON.stringify(sql)}`,
  ]);
  return stdout
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !/^mysql: \[Warning\]/.test(l));
}

/** One round trip for the whole schema beats one per artefact across 59 files. */
async function schemaSnapshot() {
  const columns = new Set(
    await query(
      'SELECT CONCAT(TABLE_NAME, ".", COLUMN_NAME) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE()',
    ),
  );
  const indexes = new Set(
    await query(
      'SELECT DISTINCT CONCAT(TABLE_NAME, ".", INDEX_NAME) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE()',
    ),
  );
  const tables = new Set(
    await query('SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE()'),
  );
  return { columns, indexes, tables };
}

function present(schema, a) {
  if (a.kind === 'table') return schema.tables.has(a.table);
  if (a.kind === 'column') return schema.columns.has(`${a.table}.${a.name}`);
  return schema.indexes.has(`${a.table}.${a.name}`);
}

const files = (await readdir(SQL_DIR)).filter((f) => f.endsWith('.sql')).sort();

const MANIFEST = path.join(SQL_DIR, 'artefacts.tsv');

/**
 * The manifest is what makes the deploy-time check runnable without Node. It is
 * committed and regenerated here; CI fails when it drifts from sql/.
 */
async function buildManifest() {
  const lines = ['# file\tkind\ttable\tname — generated by scripts/check-migrations.mjs'];
  for (const file of files) {
    const found = artefacts(await readFile(path.join(SQL_DIR, file), 'utf8'));
    if (!found.length) lines.push(`${file}\tdata\t-\t-`);
    for (const a of found) lines.push(`${file}\t${a.kind}\t${a.table}\t${a.name ?? '-'}`);
  }
  return `${lines.join('\n')}\n`;
}

if (process.argv.includes('--manifest') || process.argv.includes('--check')) {
  const built = await buildManifest();
  if (process.argv.includes('--check')) {
    const current = await readFile(MANIFEST, 'utf8').catch(() => '');
    if (current !== built) {
      console.error(
        'sql/artefacts.tsv is out of date — run `npm run migrations:manifest` and commit it.\n' +
          'The deploy-time check reads this file, so a stale manifest means a customer\n' +
          'is told a pending migration is already applied.',
      );
      process.exit(1);
    }
    console.log('sql/artefacts.tsv is up to date.');
    process.exit(0);
  }
  const { writeFile } = await import('node:fs/promises');
  await writeFile(MANIFEST, built, 'utf8');
  console.log(`wrote ${path.relative(ROOT, MANIFEST)} (${files.length} file(s))`);
  process.exit(0);
}

let schema;
try {
  schema = await schemaSnapshot();
} catch (err) {
  console.error(
    `Could not read the schema from container "${CONTAINER}".\n` +
      `Is the stack running? Set MYSQL_CONTAINER to point elsewhere.\n${err.message}`,
  );
  process.exit(2);
}

const pending = [];
const partial = [];
const applied = [];
const unknown = [];

for (const file of files) {
  const text = await readFile(path.join(SQL_DIR, file), 'utf8');
  const found = artefacts(text);
  if (!found.length) {
    // Data backfills and seeds declare no schema, so their state cannot be read
    // from information_schema. Listed rather than silently called "applied".
    unknown.push(file);
    continue;
  }
  const have = found.filter((a) => present(schema, a));
  if (have.length === found.length) applied.push(file);
  else if (have.length === 0) pending.push({ file, artefacts: found });
  else partial.push({ file, missing: found.filter((a) => !present(schema, a)) });
}

if (asJson) {
  console.log(JSON.stringify({ pending, partial, applied: applied.length, unknown }, null, 2));
  process.exit(pending.length || partial.length ? 1 : 0);
}

console.log(`\nmigrations vs. ${CONTAINER}`);
console.log(`  applied            : ${applied.length}`);
console.log(`  data-only (unread) : ${unknown.length}`);

if (partial.length) {
  console.log(`\n  PARTIALLY applied (${partial.length}) — look at these first:`);
  for (const p of partial) {
    console.log(`    ${p.file}`);
    for (const a of p.missing) console.log(`      missing ${a.kind} ${a.table}.${a.name ?? ''}`);
  }
}

if (pending.length) {
  console.log(`\n  NOT applied (${pending.length}):`);
  for (const p of pending) console.log(`    sql/${p.file}`);
  // Filename order is not dependency order: several migrations use
  // `AFTER <column>` against a column that a later-named file adds.
  console.log(`\n  Apply them oldest-first (release order), before deploying the code:`);
  console.log(
    `    docker exec -i ${CONTAINER} sh -lc 'mysql -uroot -p"$MYSQL_ROOT_PASSWORD" "$MYSQL_DATABASE"' < sql/<file>\n`,
  );
}

if (unknown.length) {
  console.log(`\n  Data-only files (state cannot be read from the schema — check by hand):`);
  console.log(`    ${unknown.join(', ')}`);
}

if (pending.length || partial.length) {
  console.log(`\nFAIL — schema changes are outstanding.\n`);
  process.exit(1);
}
console.log(`\nOK — every schema migration is present.\n`);

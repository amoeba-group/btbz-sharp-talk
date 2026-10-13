// node --test scripts/__tests__/
//
// PLN-261012 SG-80 / D-18: the init-sql drift guard must (a) pass on the real
// repo, (b) FAIL on a fixture that reproduces the original defect, and (c) never
// report "no drift" when it could not read or parse its inputs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findDrift, parseSchema, parseManifest } from '../check-initsql-drift.mjs';

const SCRIPT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'check-initsql-drift.mjs');

const SCHEMA = `
DROP TABLE IF EXISTS \`sessions\`;
CREATE TABLE \`sessions\` (
  \`id\` bigint NOT NULL AUTO_INCREMENT,
  \`channel\` varchar(16) DEFAULT NULL,
  \`landing_path\` varchar(255) DEFAULT NULL,
  PRIMARY KEY (\`id\`),
  KEY \`idx_sessions_tenant_path\` (\`tenant_id\`,\`landing_path\`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE \`golden_runs\` (
  \`id\` bigint unsigned NOT NULL AUTO_INCREMENT,
  PRIMARY KEY (\`id\`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
`;

const MANIFEST = [
  '# file\tkind\ttable\tname — generated',
  '260920-x.sql\tcolumn\tsessions\tlanding_path',
  '260920-x.sql\tindex\tsessions\tidx_sessions_tenant_path',
  '261008-y.sql\tcolumn\tgolden_runs\tpass_count',
  '261008-z.sql\ttable\tgolden_audit\t-',
  '260808-seed.sql\tdata\t-\t-',
  '',
].join('\n');

function withTmp(fn) {
  const dir = mkdtempSync(path.join(tmpdir(), 'initsql-drift-'));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function cli(args) {
  return spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' });
}

test('parseSchema reads columns, keys and PRIMARY from mysqldump-style blocks', () => {
  const { tables } = parseSchema(SCHEMA);
  assert.deepEqual([...tables.keys()].sort(), ['golden_runs', 'sessions']);
  assert.ok(tables.get('sessions').columns.has('landing_path'));
  assert.ok(tables.get('sessions').indexes.has('idx_sessions_tenant_path'));
  assert.ok(tables.get('sessions').indexes.has('PRIMARY'));
});

test('negative fixture: reports every artefact the schema lacks, skips data-only rows', () => {
  const { missing, checked } = findDrift(SCHEMA, MANIFEST);
  assert.equal(checked, 4, 'data rows are not counted');
  assert.deepEqual(
    missing.map((m) => `${m.kind}:${m.table}.${m.name}`),
    ['column:golden_runs.pass_count', 'table:golden_audit.-'],
  );
});

test('positive fixture: no drift once the schema carries the artefacts', () => {
  const complete = `${SCHEMA}
ALTER TABLE \`golden_runs\` ADD COLUMN \`pass_count\` int NOT NULL DEFAULT 0;
CREATE TABLE IF NOT EXISTS \`golden_audit\` (
  \`id\` bigint NOT NULL
) ENGINE=InnoDB;
`;
  assert.deepEqual(findDrift(complete, MANIFEST).missing, [], 'ALTER-appended DDL counts as present');
});

test('CRLF input (a Windows checkout) is read the same as LF', () => {
  const crlf = (s) => s.replace(/\n/g, '\r\n');
  assert.equal(findDrift(crlf(SCHEMA), crlf(MANIFEST)).missing.length, 2);
  assert.equal(parseManifest(crlf(MANIFEST)).length, 5);
});

test('exceptions need a reason and silence exactly the listed artefact', () => {
  const ok = findDrift(SCHEMA, MANIFEST, 'table\tgolden_audit\t-\tdropped again in 261020-x.sql\n');
  assert.deepEqual(ok.missing.map((m) => m.table), ['golden_runs']);
  const bad = findDrift(SCHEMA, MANIFEST, 'table\tgolden_audit\t-\t\n');
  assert.equal(bad.problems.length, 1, 'an exception with no reason is rejected');
});

test('CLI exit codes: 1 on drift, 0 when clean, 2 on unreadable or empty input', () => {
  withTmp((dir) => {
    const schema = path.join(dir, 'schema.sql');
    const manifest = path.join(dir, 'artefacts.tsv');
    writeFileSync(schema, SCHEMA);
    writeFileSync(manifest, MANIFEST);

    const drift = cli(['--schema', schema, '--manifest', manifest, '--exceptions', path.join(dir, 'none.tsv')]);
    assert.equal(drift.status, 1);
    assert.match(drift.stderr, /missing column golden_runs\.pass_count/);
    assert.match(drift.stderr, /sql\/261008-y\.sql/);

    writeFileSync(
      schema,
      `${SCHEMA}\nALTER TABLE \`golden_runs\` ADD COLUMN \`pass_count\` int;\nCREATE TABLE \`golden_audit\` (\n  \`id\` bigint\n) ENGINE=InnoDB;\n`,
    );
    const clean = cli(['--schema', schema, '--manifest', manifest, '--exceptions', path.join(dir, 'none.tsv')]);
    assert.equal(clean.status, 0, clean.stderr);
    assert.match(clean.stdout, /^OK/);

    writeFileSync(schema, '-- nothing parseable here\n');
    const empty = cli(['--schema', schema, '--manifest', manifest]);
    assert.equal(empty.status, 2, 'an empty parse must not read as "no drift"');

    const unreadable = cli(['--schema', path.join(dir, 'missing.sql'), '--manifest', manifest]);
    assert.equal(unreadable.status, 2);
  });
});

test('the real repo has no init-sql drift (guards the six-migration regression of D-18)', () => {
  const real = cli([]);
  assert.equal(real.status, 0, real.stderr || real.stdout);
});

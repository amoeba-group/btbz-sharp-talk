// PLN-261012 SG-80/81: the shared migration helpers (scripts/lib/migrations.sh) decide
// whether a rollback is safe and in which order SQL must be applied. A wrong answer here
// means "rolled back fine" followed by 500s, or "apply alphabetically" followed by
// "Unknown column" — so the classifier and the ordering are tested directly.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { REPO, Sandbox } from './helpers/sandbox.mjs';

const sb = new Sandbox({ realSql: true });
test.after(() => sb.cleanup());

/** Classify SQL text with the real lib, inside the sandbox. */
function classify(sql) {
  sb.write('.t/x.sql', sql);
  const r = sb.run('-c', [`. scripts/lib/migrations.sh; migration_class .t/x.sql; migration_has_rollback .t/x.sql`]);
  assert.equal(r.status, 0, r.out);
  const [klass, rollback] = r.stdout.trim().split('\n');
  return { klass, rollback };
}

test('additive: nullable / defaulted columns, indexes and new tables', () => {
  assert.equal(classify('ALTER TABLE `t` ADD COLUMN `a` varchar(20) NULL;').klass, 'additive');
  assert.equal(classify('ALTER TABLE t ADD COLUMN n int NOT NULL DEFAULT 0, ADD COLUMN s varchar(8) NULL;').klass, 'additive');
  assert.equal(classify('ALTER TABLE t ADD INDEX idx_a (a);').klass, 'additive');
  assert.equal(classify('CREATE TABLE IF NOT EXISTS t (id bigint NOT NULL AUTO_INCREMENT, PRIMARY KEY (id));').klass, 'additive');
});

test('a decimal(12,2) default or ON UPDATE CURRENT_TIMESTAMP is not misread (commas inside a definition)', () => {
  assert.equal(classify('ALTER TABLE t ADD COLUMN price decimal(12,2) NOT NULL DEFAULT 0, ADD COLUMN n int NULL;').klass, 'additive');
  assert.equal(
    classify('ALTER TABLE t ADD COLUMN u datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6);').klass,
    'additive',
  );
});

test('breaking: NOT NULL with no DEFAULT would make the OLD code\'s INSERTs fail', () => {
  assert.equal(classify('ALTER TABLE t ADD COLUMN must_have int NOT NULL;').klass, 'breaking');
  assert.equal(classify('ALTER TABLE t ADD COLUMN ok int NULL, ADD COLUMN bad varchar(10) NOT NULL;').klass, 'breaking');
  // an AUTO_INCREMENT key and a generated column fill themselves
  assert.equal(classify('ALTER TABLE t ADD COLUMN g int AS (a + 1) STORED NOT NULL;').klass, 'additive');
});

test('destructive: DROP / MODIFY / CHANGE / RENAME / TRUNCATE / DELETE', () => {
  for (const sql of [
    'ALTER TABLE t DROP COLUMN a;',
    'DROP TABLE IF EXISTS t;',
    'ALTER TABLE t MODIFY a varchar(255) NULL;',
    'ALTER TABLE t CHANGE COLUMN a b int;',
    'RENAME TABLE t TO u;',
    'TRUNCATE TABLE t;',
    'DELETE FROM t WHERE 1;',
    'ALTER TABLE t DROP INDEX uk_a, ADD UNIQUE KEY uk_a (a, b);',
  ]) {
    assert.equal(classify(sql).klass, 'destructive', sql);
  }
});

test('comments never count: a rollback block full of DROP COLUMN must not make an additive file destructive', () => {
  const sql = [
    '-- Rollback: ALTER TABLE `t` DROP COLUMN `a`;',
    '/* DROP TABLE t; and a block comment',
    '   spanning lines with MODIFY */',
    'ALTER TABLE `t` ADD COLUMN `a` int NULL; -- DELETE FROM t trailing comment',
  ].join('\n');
  assert.deepEqual(classify(sql), { klass: 'additive', rollback: 'yes' });
});

test('a "/*" inside a -- comment does not open a block that swallows the whole file (real case: "America/*")', () => {
  const sql = '-- timezone drives the language (Asia/Seoul -> ko, America/* -> en).\nALTER TABLE t ADD COLUMN tz varchar(40) NULL;';
  assert.equal(classify(sql).klass, 'additive');
});

test('data-only files and additive+backfill files', () => {
  assert.equal(classify("INSERT INTO t (a) VALUES ('x');").klass, 'data');
  assert.equal(classify('UPDATE t SET a = 1 WHERE a IS NULL;').klass, 'data');
  assert.equal(classify('ALTER TABLE t ADD COLUMN a int NULL;\nUPDATE t SET a = 1;').klass, 'additive-data');
});

test('nothing recognisable is "unknown" (treated as blocking, never silently safe)', () => {
  assert.equal(classify('-- only a comment').klass, 'unknown');
  assert.equal(classify('SET @x = 1;').klass, 'unknown');
});

test('the rollback block is extracted without comment markers; absence is reported', () => {
  sb.write('.t/rb.sql', '-- Rollback (after reverting the code):\n-- ALTER TABLE `t` DROP COLUMN `a`;\n-- ALTER TABLE `t` DROP COLUMN `b`;\n\nSELECT 1;\n');
  const r = sb.run('-c', ['. scripts/lib/migrations.sh; migration_rollback_text .t/rb.sql']);
  assert.match(r.stdout, /ALTER TABLE `t` DROP COLUMN `a`;/);
  assert.doesNotMatch(r.stdout, /^--/m);
  assert.doesNotMatch(r.stdout, /SELECT 1/);
  assert.equal(classify('ALTER TABLE t ADD COLUMN a int NULL;').rollback, 'no');
});

test('every migration in the real sql/ directory classifies, none as unknown', () => {
  const files = readdirSync(path.join(REPO, 'sql')).filter((f) => f.endsWith('.sql'));
  const r = sb.run('-c', [
    '. scripts/lib/migrations.sh; for f in sql/*.sql; do printf "%s\\t%s\\n" "$(basename $f)" "$(migration_class $f)"; done',
  ]);
  assert.equal(r.status, 0, r.out);
  const rows = r.stdout.trim().split('\n').map((l) => l.split('\t'));
  assert.equal(rows.length, files.length);
  const unknown = rows.filter(([, c]) => c === 'unknown');
  assert.deepEqual(unknown, [], 'a real migration the classifier cannot read would silently block (or pass) rollbacks');
  // spot checks that encode decisions in the runbook
  const by = Object.fromEntries(rows);
  assert.equal(by['261007-answer-footer.sql'], 'additive');
  assert.equal(by['migration_tenant_slug.sql'], 'destructive'); // MODIFY ... NOT NULL after a backfill
  assert.equal(by['260808-tenant-timezone.sql'], 'additive');
});

// ---- release order -----------------------------------------------------------------

function gitRepoWithOrder() {
  const dir = mkdtempSync(path.join(tmpdir(), 'rel-order-'));
  const git = (args, env = {}) =>
    spawnSync('git', args, { cwd: dir, encoding: 'utf8', env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', ...env } });
  git(['init', '-q']);
  git(['config', 'user.email', 't@t']);
  git(['config', 'user.name', 't']);
  git(['config', 'commit.gpgsign', 'false']);
  mkdirSync(path.join(dir, 'sql'));
  // Released FIRST but sorts LAST by name (the real situation: migration_*.sql vs 2608…).
  const order = [
    ['migration_old.sql', '2026-08-01T00:00:00Z'],
    ['260807-new.sql', '2026-08-07T00:00:00Z'],
    ['260901-newer.sql', '2026-09-01T00:00:00Z'],
  ];
  for (const [name, when] of order) {
    writeFileSync(path.join(dir, 'sql', name), 'ALTER TABLE t ADD COLUMN a int NULL;\n');
    git(['add', `sql/${name}`]);
    git(['commit', '-q', '-m', name], { GIT_AUTHOR_DATE: when, GIT_COMMITTER_DATE: when });
  }
  return dir;
}

test('release order follows git history, not the file name (migration_* is oldest but sorts last)', () => {
  const dir = gitRepoWithOrder();
  try {
    const r = spawnSync('bash', ['-c', `. "${sb.root.replace(/\\/g, '/')}/scripts/lib/migrations.sh"; migration_release_order sql`], {
      cwd: dir,
      encoding: 'utf8',
      // (no MSYS_NO_PATHCONV here: native git.exe on Windows needs MSYS to translate /c/… paths)
      env: { ...process.env },
    });
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(r.stdout.trim().split('\n'), ['migration_old.sql', '260807-new.sql', '260901-newer.sql']);
    // …whereas the file-name order is the reverse trap
    assert.deepEqual(readdirSync(path.join(dir, 'sql')).sort(), ['260807-new.sql', '260901-newer.sql', 'migration_old.sql']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a bundle has no history: its frozen release-order.txt wins, and unknown names sort last', () => {
  sb.write('rel/release-order.txt', '# frozen\nb.sql\na.sql\n');
  sb.write('rel/sql/a.sql', 'SELECT 1;');
  sb.write('rel/sql/b.sql', 'SELECT 1;');
  sb.write('rel/sql/zz-extra.sql', 'SELECT 1;');
  const ordered = sb.run('-c', ['. scripts/lib/migrations.sh; migration_release_order rel/sql']);
  assert.deepEqual(ordered.stdout.trim().split('\n'), ['b.sql', 'a.sql']);
  const sorted = sb.run('-c', ['. scripts/lib/migrations.sh; printf "%s\\n" zz-extra.sql a.sql b.sql | migration_sort_release rel/sql']);
  assert.deepEqual(sorted.stdout.trim().split('\n'), ['b.sql', 'a.sql', 'zz-extra.sql']);
});

test('check-migrations.sh lists pending files in release order and tolerates a CRLF manifest', () => {
  const s = new Sandbox({ realSql: false });
  try {
    s.setSqlFixture(
      { 'migration_old.sql': 'ALTER TABLE t ADD COLUMN a int NULL;', '260807-new.sql': 'ALTER TABLE t ADD COLUMN b int NULL;' },
      ['migration_old.sql\tcolumn\tt\ta', '260807-new.sql\tcolumn\tt\tb'],
    );
    s.write('release-order.txt', 'migration_old.sql\n260807-new.sql\n');
    // CRLF manifest (a Windows checkout) — every artefact used to read as "missing"
    s.write('sql/artefacts.tsv', '# file\tkind\ttable\tname\r\nmigration_old.sql\tcolumn\tt\ta\r\n260807-new.sql\tcolumn\tt\tb\r\n');
    s.setSchema(['table\tt\t-', 'column\tt\tid']);
    const r = s.run('scripts/check-migrations.sh', [], { FAKE_SCHEMA: path.join(s.root, '.schema.tsv') });
    assert.equal(r.status, 1, r.out);
    const listed = r.stdout.split('\n').filter((l) => /^\s+sql\//.test(l)).map((l) => l.trim());
    assert.deepEqual(listed, ['sql/migration_old.sql', 'sql/260807-new.sql']);
    assert.match(r.stdout, /RELEASE order/);

    // now both columns exist: even with the CRLF manifest everything reads as applied
    s.setSchema(['table\tt\t-', 'column\tt\ta', 'column\tt\tb']);
    const ok = s.run('scripts/check-migrations.sh', [], { FAKE_SCHEMA: path.join(s.root, '.schema.tsv') });
    assert.equal(ok.status, 0, ok.out);
    assert.match(ok.stdout, /applied\s+: 2/);
  } finally {
    s.cleanup();
  }
});

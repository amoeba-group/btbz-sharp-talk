// PLN-261012 SG-81: scripts/rollback-self-hosted.sh. The point of the script is the REFUSAL:
// a rollback that runs the old code against a schema it cannot work with is worse than no
// rollback. These tests pin when it proceeds, when it refuses, and what it prints.
import test from 'node:test';
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { Sandbox } from './helpers/sandbox.mjs';

const SCRIPT = 'scripts/rollback-self-hosted.sh';

/** releases.log + per-release migration records: v1.0 (2 migrations) -> v1.1 (adds `extra` rows). */
function releases(sb, { extra = [], logExtra = [] } = {}) {
  sb.writeEnv();
  sb.write(
    'docker/self-hosted/releases.log',
    [
      '2026-10-01T00:00:00Z\t1.0.0\tbundle\tabc1\tdeployed\t',
      '2026-10-05T00:00:00Z\t1.1.0\tbundle\tdef2\tdeployed\t',
      ...logExtra,
    ].join('\n') + '\n',
  );
  const base = '260901-a.sql\tadditive\tyes\n260902-b.sql\tadditive\tno\n';
  sb.write('docker/self-hosted/releases/1.0.0/migrations.tsv', base);
  sb.write('docker/self-hosted/releases/1.1.0/migrations.tsv', base + extra.map((e) => e.join('\t')).join('\n') + (extra.length ? '\n' : ''));
  sb.write('sql/261001-new.sql', 'ALTER TABLE `t` ADD COLUMN `n` int NULL;\n-- Rollback (after reverting the code):\n-- ALTER TABLE `t` DROP COLUMN `n`;\n');
}

test('no migration in between: code-only rollback is safe, plan printed, nothing executed in --dry-run', () => {
  const sb = new Sandbox({ realSql: false });
  try {
    releases(sb);
    const r = sb.run(SCRIPT, ['--dry-run']);
    assert.equal(r.status, 0, r.out);
    assert.match(r.out, /current release : 1\.1\.0/);
    assert.match(r.out, /roll back to {4}: 1\.0\.0 {3}\(images sharptalk\/\{api,web,widget\}:1\.0\.0\)/);
    assert.match(r.out, /none — the two releases have the same schema/);
    assert.match(r.out, /\[dry-run\] docker image inspect sharptalk\/api:1\.0\.0/);
    assert.match(r.out, /SHARPTALK_VERSION=1\.0\.0 docker compose .* up -d --no-build/);
    assert.deepEqual(sb.calls(), [], 'a dry run does not call docker');
  } finally {
    sb.cleanup();
  }
});

test('additive migrations in between are safe; their documented SQL rollback is shown for reference', () => {
  const sb = new Sandbox({ realSql: false });
  try {
    releases(sb, { extra: [['261001-new.sql', 'additive', 'yes'], ['261002-seed.sql', 'data', 'no']] });
    const r = sb.run(SCRIPT, ['--dry-run']);
    assert.equal(r.status, 0, r.out);
    assert.match(r.out, /261001-new\.sql\s+additive\s+yes/);
    assert.match(r.out, /261002-seed\.sql\s+data\s+no/);
    assert.doesNotMatch(r.out, /BLOCKS/);
    assert.match(r.out, /SQL rollback guidance \(reference only/);
    assert.match(r.out, /ALTER TABLE `t` DROP COLUMN `n`;/);
  } finally {
    sb.cleanup();
  }
});

test('a destructive migration in between makes the script REFUSE (exit 3), with the way out', () => {
  const sb = new Sandbox({ realSql: false });
  try {
    releases(sb, { extra: [['261003-drop.sql', 'destructive', 'no']] });
    const r = sb.run(SCRIPT, ['--dry-run']);
    assert.equal(r.status, 3, r.out);
    assert.match(r.out, /261003-drop\.sql\s+destructive\s+no\s+<-- BLOCKS a code-only rollback/);
    assert.match(r.out, /REFUSED/);
    assert.match(r.out, /restore the backup taken before 1\.1\.0/);
    assert.match(r.out, /--allow-irreversible/);
    assert.doesNotMatch(r.out, /would run/);
  } finally {
    sb.cleanup();
  }
});

test('a NOT NULL column without DEFAULT ("breaking") blocks as well; an unknown one too', () => {
  for (const klass of ['breaking', 'unknown']) {
    const sb = new Sandbox({ realSql: false });
    try {
      releases(sb, { extra: [['261004-x.sql', klass, 'no']] });
      assert.equal(sb.run(SCRIPT, ['--dry-run']).status, 3, klass);
    } finally {
      sb.cleanup();
    }
  }
});

test('--allow-irreversible lets someone who has read the list proceed (and says so)', () => {
  const sb = new Sandbox({ realSql: false });
  try {
    releases(sb, { extra: [['261003-drop.sql', 'destructive', 'no']] });
    const r = sb.run(SCRIPT, ['--dry-run', '--allow-irreversible']);
    assert.equal(r.status, 0, r.out);
    assert.match(r.out, /proceeding ONLY because --allow-irreversible was given/);
    assert.match(r.out, /Dry run finished/);
  } finally {
    sb.cleanup();
  }
});

test('a release with no migration record cannot be proven safe: refuse', () => {
  const sb = new Sandbox({ realSql: false });
  try {
    releases(sb);
    sb.write('docker/self-hosted/releases/1.0.0/migrations.tsv', '');
    // remove the record entirely: a release deployed before this script existed
    rmSync(`${sb.root}/docker/self-hosted/releases/1.0.0`, { recursive: true, force: true });
    const r = sb.run(SCRIPT, ['--dry-run']);
    assert.equal(r.status, 3, r.out);
    assert.match(r.out, /no migration record for 1\.0\.0/);
  } finally {
    sb.cleanup();
  }
});

test('--to picks the target; the current release and a missing history are handled', () => {
  const sb = new Sandbox({ realSql: false });
  try {
    releases(sb);
    assert.equal(sb.run(SCRIPT, ['--dry-run', '--to', '1.1.0']).status, 1, 'already the current release');
    const unknown = sb.run(SCRIPT, ['--dry-run', '--to', '0.9.0']);
    assert.match(unknown.out, /never recorded as deployed/);

    const fresh = new Sandbox({ realSql: false });
    try {
      fresh.writeEnv();
      const r = fresh.run(SCRIPT, ['--dry-run']);
      assert.equal(r.status, 1);
      assert.match(r.out, /releases\.log not found/);
    } finally {
      fresh.cleanup();
    }
  } finally {
    sb.cleanup();
  }
});

test('after a rollback the log says so, and the NEXT rollback goes back from there', () => {
  const sb = new Sandbox({ realSql: false });
  try {
    releases(sb, { logExtra: ['2026-10-06T00:00:00Z\t1.0.0\trollback\tabc1\trolledback\tfrom 1.1.0'] });
    const r = sb.run(SCRIPT, ['--dry-run']);
    assert.equal(r.status, 0, r.out);
    assert.match(r.out, /current release : 1\.0\.0/);
    assert.match(r.out, /roll back to {4}: 1\.1\.0/);
  } finally {
    sb.cleanup();
  }
});

test('a real run: missing images abort; present images start the target version with --no-build and record it', () => {
  const sb = new Sandbox({ realSql: false });
  try {
    releases(sb);
    const none = sb.run(SCRIPT, ['--yes'], { FAKE_IMAGES_PRESENT: 'sharptalk/api:1.0.0 sharptalk/web:1.0.0' });
    assert.equal(none.status, 1, none.out);
    assert.match(none.out, /MISSING {2}sharptalk\/widget:1\.0\.0/);
    assert.equal(sb.firstCall(/compose .* up/), -1, 'nothing is started when an image is missing');

    sb.clearCalls();
    const ok = sb.run(SCRIPT, ['--yes']);
    assert.equal(ok.status, 0, ok.out);
    const up = sb.calls().find((c) => /compose .* up -d --no-build$/.test(c));
    assert.ok(up, 'compose up --no-build was not run');
    assert.match(up, /^VER=1\.0\.0 ::/, 'the target version reaches compose through SHARPTALK_VERSION');
    assert.equal(sb.firstCall(/up -d --build/), -1);
    assert.match(ok.out, /now running 1\.0\.0 \(was 1\.1\.0\)\. The database was not changed/);
    assert.match(sb.read('docker/self-hosted/releases.log'), /\t1\.0\.0\trollback\t[^\t]*\trolledback\tfrom 1\.1\.0\n$/);
  } finally {
    sb.cleanup();
  }
});

test('without --yes the rollback waits for a typed confirmation', () => {
  const sb = new Sandbox({ realSql: false });
  try {
    releases(sb);
    const r = sb.run(SCRIPT, [], {}, { input: 'no\n' });
    assert.equal(r.status, 1, r.out);
    assert.match(r.out, /aborted/);
    assert.equal(sb.firstCall(/compose .* up/), -1);
  } finally {
    sb.cleanup();
  }
});


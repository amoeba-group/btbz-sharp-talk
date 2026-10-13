// PLN-261012 SG-81: backup (encryption, rotation, Qdrant, failure markers), restore and the
// restore drill — dry-run and verification paths, against the fake docker. The full
// backup -> restore -> drill cycle was also run for real against a throwaway MySQL 8.0 and
// an alpine stand-in for the API container (recorded in TCR-261013-s5c-hosting); these tests
// pin the logic that does not need a database.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { Sandbox } from './helpers/sandbox.mjs';

const BACKUP = 'scripts/backup-self-hosted.sh';
const RESTORE = 'scripts/restore-self-hosted.sh';
const DRILL = 'scripts/restore-drill-self-hosted.sh';
const posix = (p) => p.replace(/\\/g, '/');

function withKey(sb, content = 'k'.repeat(48)) {
  const key = sb.write('keys/backup.key', `${content}\n`, 0o600);
  return posix(key);
}

function dirs(sb, rel = 'backups') {
  const p = path.join(sb.root, rel);
  return existsSync(p) ? readdirSync(p).sort() : [];
}

function backupDir(sb) {
  const [d] = dirs(sb).filter((n) => /^\d{8}T\d{6}Z/.test(n));
  return d;
}

const openssl = (args, input) => spawnSync('openssl', args, { input, encoding: 'buffer' });

test('plain backup (nothing configured) keeps the original behaviour: two archives and a manifest', () => {
  const sb = new Sandbox({ realSql: false });
  try {
    const r = sb.run(BACKUP, [], { BACKUP_QDRANT: 'off' });
    assert.equal(r.status, 0, r.out);
    const d = backupDir(sb);
    const files = dirs(sb, `backups/${d}`);
    assert.deepEqual(files, ['SHA256SUMS', 'db.sql.gz', 'manifest.txt', 'uploads.tar.gz']);
    const manifest = sb.read(`backups/${d}/manifest.txt`);
    assert.match(manifest, /^encrypted=no$/m);
    assert.match(manifest, /^attachment_rows=2$/m);
    assert.match(manifest, /^count\.tenants=1$/m);
    assert.match(manifest, /^count\.kb_documents=6$/m);
    assert.match(manifest, /^qdrant=skipped$/m);
    assert.match(sb.read('backups/LAST_SUCCESS').trim(), /^\d{4}-\d\d-\d\dT.*Z \d{8}T\d{6}Z$/);
    assert.equal(sb.exists('backups/LAST_FAILURE'), false);
    // the stored checksums verify
    const sums = spawnSync('sha256sum', ['-c', 'SHA256SUMS'], { cwd: path.join(sb.root, 'backups', d), encoding: 'utf8' });
    assert.equal(sums.status, 0, sums.stderr + sums.stdout);
  } finally {
    sb.cleanup();
  }
});

test('--dry-run writes nothing and touches no container', () => {
  const sb = new Sandbox({ realSql: false });
  try {
    const r = sb.run(BACKUP, ['--dry-run'], { BACKUP_KEEP_DAYS: '7', BACKUP_ENCRYPT_KEY_FILE: withKey(sb) });
    assert.equal(r.status, 0, r.out);
    assert.match(r.out, /DRY RUN/);
    assert.match(r.out, /db\.sql\.gz\.enc/);
    assert.match(r.out, /delete sibling backups in .* older than 7 days/);
    assert.deepEqual(sb.calls(), []);
    assert.equal(sb.exists('backups'), false);
  } finally {
    sb.cleanup();
  }
});

test('encrypted backup: only *.enc files exist, they decrypt with the key and fail with another', () => {
  const sb = new Sandbox({ realSql: false });
  try {
    const key = withKey(sb);
    const r = sb.run(BACKUP, [], { BACKUP_QDRANT: 'off', BACKUP_ENCRYPT_KEY_FILE: key });
    assert.equal(r.status, 0, r.out);
    const d = backupDir(sb);
    assert.deepEqual(dirs(sb, `backups/${d}`), ['SHA256SUMS', 'db.sql.gz.enc', 'manifest.txt', 'uploads.tar.gz.enc']);
    assert.match(sb.read(`backups/${d}/manifest.txt`), /^encrypted=yes$/m);
    assert.match(sb.read(`backups/${d}/manifest.txt`), /^cipher=aes-256-cbc pbkdf2 iter=600000$/m);

    const enc = readFileSync(path.join(sb.root, 'backups', d, 'db.sql.gz.enc'));
    assert.equal(enc.subarray(0, 8).toString('latin1'), 'Salted__', 'an openssl salted header, not plaintext gzip');
    assert.notEqual(enc[0], 0x1f, 'the gzip magic must not show through');

    const decrypt = (keyFile) =>
      openssl(['enc', '-aes-256-cbc', '-pbkdf2', '-iter', '600000', '-d', '-pass', `file:${keyFile}`, '-in', path.join(sb.root, 'backups', d, 'db.sql.gz.enc')]);
    const good = decrypt(key);
    assert.equal(good.status, 0, good.stderr.toString());
    assert.equal(good.stdout[0], 0x1f);
    assert.equal(good.stdout[1], 0x8b);

    const other = posix(sb.write('keys/other.key', `${'z'.repeat(48)}\n`, 0o600));
    assert.notEqual(decrypt(other).status, 0, 'a different key must not decrypt it');
  } finally {
    sb.cleanup();
  }
});

test('key file problems are refused before anything is written', () => {
  const sb = new Sandbox({ realSql: false });
  try {
    const missing = sb.run(BACKUP, [], { BACKUP_ENCRYPT_KEY_FILE: '/nonexistent/key' });
    assert.equal(missing.status, 2);
    assert.match(missing.out, /does not exist/);

    const short = sb.run(BACKUP, [], { BACKUP_ENCRYPT_KEY_FILE: posix(sb.write('keys/short.key', 'tooshort\n', 0o600)) });
    assert.equal(short.status, 2);
    assert.match(short.out, /at least 32 are required/);

    if (process.platform !== 'win32') {
      const loose = posix(sb.write('keys/loose.key', `${'k'.repeat(48)}\n`, 0o644));
      const r = sb.run(BACKUP, [], { BACKUP_ENCRYPT_KEY_FILE: loose });
      assert.equal(r.status, 2);
      assert.match(r.out, /group\/other must have no access/);
    }
    assert.equal(sb.exists('backups'), false);
    assert.deepEqual(sb.dockerCalls(), []);

    assert.equal(sb.run(BACKUP, [], { BACKUP_KEEP_DAYS: 'abc' }).status, 2);
    assert.equal(sb.run(BACKUP, [], { BACKUP_QDRANT: 'maybe' }).status, 2);
  } finally {
    sb.cleanup();
  }
});

test('rotation removes only OLD, DATED backup directories that hold a manifest — never the new one, never anything else', () => {
  const sb = new Sandbox({ realSql: false });
  try {
    const old = new Date(Date.now() - 40 * 86400000);
    const mk = (name, withManifest) => {
      const p = path.join(sb.root, 'backups', name);
      mkdirSync(p, { recursive: true });
      if (withManifest) writeFileSync(path.join(p, 'manifest.txt'), 'taken_at=x\n');
      utimesSync(p, old, old);
    };
    mk('20260801T020000Z', true); // old backup            -> removed
    mk('20260802T020000Z_pre-1.0.0', true); // old labelled backup  -> removed
    mk('20260803T020000Z', false); // dated but NO manifest -> kept (not provably a backup)
    mk('photos-2024', true); // not a dated name       -> kept
    mk('20261001T020000Z', true); // recent: touch to now
    utimesSync(path.join(sb.root, 'backups', '20261001T020000Z'), new Date(), new Date());

    const r = sb.run(BACKUP, [], { BACKUP_QDRANT: 'off', BACKUP_KEEP_DAYS: '14' });
    assert.equal(r.status, 0, r.out);
    assert.match(r.out, /removed 20260801T020000Z/);
    assert.match(r.out, /removed 20260802T020000Z_pre-1\.0\.0/);
    assert.match(r.out, /2 old backup\(s\) removed/);
    const left = dirs(sb);
    assert.ok(left.includes('20260803T020000Z'), 'a dated directory without a manifest is not ours to delete');
    assert.ok(left.includes('photos-2024'));
    assert.ok(left.includes('20261001T020000Z'));
    assert.ok(left.includes(backupDir(sb)), 'the backup just written is never rotated');
    assert.ok(!left.includes('20260801T020000Z'));
  } finally {
    sb.cleanup();
  }
});

test('a failed dump leaves LAST_FAILURE, removes the half-written directory and exits non-zero', () => {
  const sb = new Sandbox({ realSql: false });
  try {
    const r = sb.run(BACKUP, [], { BACKUP_QDRANT: 'off', FAKE_DUMP_FAIL: '1' });
    assert.notEqual(r.status, 0, r.out);
    assert.match(r.out, /BACKUP FAILED/);
    assert.match(sb.read('backups/LAST_FAILURE'), /exit=/);
    assert.equal(sb.exists('backups/LAST_SUCCESS'), false);
    assert.deepEqual(dirs(sb).filter((n) => /^\d{8}T/.test(n)), [], 'nothing that looks like a backup may remain');
  } finally {
    sb.cleanup();
  }
});

test('a later success clears LAST_FAILURE', () => {
  const sb = new Sandbox({ realSql: false });
  try {
    sb.write('backups/LAST_FAILURE', 'old\n');
    const r = sb.run(BACKUP, [], { BACKUP_QDRANT: 'off' });
    assert.equal(r.status, 0, r.out);
    assert.equal(sb.exists('backups/LAST_FAILURE'), false);
  } finally {
    sb.cleanup();
  }
});

test('Qdrant: snapshots are taken through the API container and recorded in the manifest', () => {
  const sb = new Sandbox({ realSql: false });
  try {
    const r = sb.run(BACKUP, [], { BACKUP_QDRANT: 'on' });
    assert.equal(r.status, 0, r.out);
    const d = backupDir(sb);
    assert.ok(dirs(sb, `backups/${d}`).includes('qdrant-snapshots.tar'));
    const manifest = sb.read(`backups/${d}/manifest.txt`);
    assert.match(manifest, /^qdrant=ok$/m);
    assert.match(manifest, /^qdrant_collections=kb_documents:12,reuse_questions:3$/m);
    assert.ok(sb.firstCall(/exec -i sharptalk_api node --input-type=module - backup \/tmp\/qdrant-backup-/) >= 0);
    // the helper is piped in and the temp dir removed afterwards
    assert.ok(sb.firstCall(/exec sharptalk_api rm -rf \/tmp\/qdrant-backup-/) >= 0);
    assert.match(sb.read(`backups/${d}/SHA256SUMS`), /qdrant-snapshots\.tar/);
  } finally {
    sb.cleanup();
  }
});

test('Qdrant: auto skips quietly when it is not configured, `on` fails the backup, a failing auto only warns', () => {
  const auto = new Sandbox({ realSql: false });
  try {
    const r = auto.run(BACKUP, [], { BACKUP_QDRANT: 'auto' }); // fake docker ps lists no qdrant container
    assert.equal(r.status, 0, r.out);
    assert.match(r.out, /qdrant : not backed up/);
    assert.equal(auto.firstCall(/node --input-type=module/), -1);
  } finally {
    auto.cleanup();
  }

  const must = new Sandbox({ realSql: false });
  try {
    const r = must.run(BACKUP, [], { BACKUP_QDRANT: 'on', FAKE_QDRANT_FAIL: '1' });
    assert.notEqual(r.status, 0);
    assert.match(r.out, /BACKUP_QDRANT=on and the Qdrant snapshot failed/);
  } finally {
    must.cleanup();
  }

  const soft = new Sandbox({ realSql: false });
  try {
    const r = soft.run(BACKUP, [], { BACKUP_QDRANT: 'auto', FAKE_DOCKER_PS: 'sharptalk_qdrant', FAKE_QDRANT_FAIL: '1' });
    assert.equal(r.status, 0, r.out);
    assert.match(r.out, /WARNING: the Qdrant snapshot failed/);
    assert.match(soft.read(`backups/${backupDir(soft)}/manifest.txt`), /^qdrant=FAILED/m);
  } finally {
    soft.cleanup();
  }
});

// ---- restore + drill (verification paths) -----------------------------------------

function takeBackup(sb, env = {}) {
  const r = sb.run(BACKUP, [], { BACKUP_QDRANT: 'off', ...env });
  assert.equal(r.status, 0, r.out);
  return `backups/${backupDir(sb)}`;
}

test('restore --dry-run verifies an encrypted backup and changes nothing', () => {
  const sb = new Sandbox({ realSql: false });
  try {
    const key = withKey(sb);
    const rel = takeBackup(sb, { BACKUP_ENCRYPT_KEY_FILE: key });
    sb.clearCalls();
    const r = sb.run(RESTORE, ['--dry-run', rel], { BACKUP_ENCRYPT_KEY_FILE: key });
    assert.equal(r.status, 0, r.out);
    assert.match(r.out, /archives read back correctly \(encrypted: true\)/);
    assert.match(r.out, /DRY RUN — the backup is intact/);
    assert.match(r.out, /stop sharptalk_api/);
    assert.deepEqual(sb.dockerCalls(), [], 'verification must not need docker');
  } finally {
    sb.cleanup();
  }
});

test('restore refuses: encrypted backup without a key, the wrong key, a corrupted archive', () => {
  const sb = new Sandbox({ realSql: false });
  try {
    const key = withKey(sb);
    const rel = takeBackup(sb, { BACKUP_ENCRYPT_KEY_FILE: key });

    const noKey = sb.run(RESTORE, ['--dry-run', rel]);
    assert.equal(noKey.status, 2, noKey.out);
    assert.match(noKey.out, /is encrypted; set BACKUP_ENCRYPT_KEY_FILE/);

    const wrong = posix(sb.write('keys/wrong.key', `${'w'.repeat(48)}\n`, 0o600));
    const bad = sb.run(RESTORE, ['--dry-run', rel], { BACKUP_ENCRYPT_KEY_FILE: wrong });
    assert.equal(bad.status, 1, bad.out);
    assert.match(bad.out, /cannot be read \(wrong key, or a damaged archive\)/);

    // flip a byte in the middle of the ciphertext
    const file = path.join(sb.root, rel, 'uploads.tar.gz.enc');
    const bytes = readFileSync(file);
    bytes[Math.min(40, bytes.length - 1)] ^= 0xff;
    writeFileSync(file, bytes);
    sb.clearCalls();
    const damaged = sb.run(RESTORE, ['--dry-run', rel], { BACKUP_ENCRYPT_KEY_FILE: key });
    assert.equal(damaged.status, 1, damaged.out);
    assert.match(damaged.out, /checksum mismatch/);
    assert.deepEqual(sb.dockerCalls(), [], 'a bad backup is rejected before any container is stopped');
  } finally {
    sb.cleanup();
  }
});

test('restore of a legacy backup (no SHA256SUMS, plain archives) still works but warns', () => {
  const sb = new Sandbox({ realSql: false });
  try {
    const rel = takeBackup(sb);
    rmSync(path.join(sb.root, rel, 'SHA256SUMS')); // a backup from before checksums existed
    const r = sb.run(RESTORE, ['--dry-run', rel]);
    assert.equal(r.status, 0, r.out);
    assert.match(r.out, /has no SHA256SUMS/);
    assert.match(r.out, /encrypted: false/);
  } finally {
    sb.cleanup();
  }
});

test('restore drill --dry-run: integrity checked, plan printed, no container started', () => {
  const sb = new Sandbox({ realSql: false });
  try {
    const key = withKey(sb);
    const rel = takeBackup(sb, { BACKUP_ENCRYPT_KEY_FILE: key });
    sb.clearCalls();
    const r = sb.run(DRILL, ['--dry-run', rel], { BACKUP_ENCRYPT_KEY_FILE: key });
    assert.equal(r.status, 0, r.out);
    assert.match(r.out, /PASS {2}SHA256SUMS verified/);
    assert.match(r.out, /PASS {2}db\.sql\.gz reads back/);
    assert.match(r.out, /start a throwaway mysql container/);
    assert.deepEqual(sb.dockerCalls(), []);
  } finally {
    sb.cleanup();
  }
});

test('restore drill fails fast on a damaged backup, before any scratch container exists', () => {
  const sb = new Sandbox({ realSql: false });
  try {
    const rel = takeBackup(sb);
    const file = path.join(sb.root, rel, 'db.sql.gz');
    const bytes = readFileSync(file);
    bytes[Math.min(20, bytes.length - 1)] ^= 0xff;
    writeFileSync(file, bytes);
    sb.clearCalls();
    const r = sb.run(DRILL, [rel]);
    assert.equal(r.status, 1, r.out);
    assert.match(r.out, /FAIL {2}SHA256SUMS does not match the archives/);
    assert.match(r.out, /DRILL FAILED before restoring anything/);
    assert.deepEqual(sb.dockerCalls(), []);
  } finally {
    sb.cleanup();
  }
});

test('restore drill --latest picks the newest dated backup', () => {
  const sb = new Sandbox({ realSql: false });
  try {
    const first = takeBackup(sb);
    const older = path.join(sb.root, 'backups', '20250101T000000Z');
    cpSync(path.join(sb.root, first), older, { recursive: true });
    const r = sb.run(DRILL, ['--dry-run', '--latest', 'backups']);
    assert.equal(r.status, 0, r.out);
    assert.match(r.out, new RegExp(`Restore drill for .*${first.split('/').pop()}`));
    assert.doesNotMatch(r.out, /20250101T000000Z/);
    const none = sb.run(DRILL, ['--dry-run', '--latest', 'empty-root']);
    assert.notEqual(none.status, 0);
  } finally {
    sb.cleanup();
  }
});

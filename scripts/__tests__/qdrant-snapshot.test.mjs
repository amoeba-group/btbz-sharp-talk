// PLN-261012 SG-81: scripts/lib/qdrant-snapshot.mjs against a FAKE Qdrant HTTP server that
// implements just the endpoints of Qdrant's snapshot API the helper uses. The real Qdrant
// was not started for this change; the endpoint paths below are the documented ones
// (POST/GET/DELETE /collections/{c}/snapshots…, POST …/snapshots/upload?priority=snapshot).
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { REPO } from './helpers/sandbox.mjs';

const HELPER = path.join(REPO, 'scripts', 'lib', 'qdrant-snapshot.mjs');

function fakeQdrant({ collections = { kb_documents: 12, reuse_questions: 3 }, failSnapshot = false, apiKey = '' } = {}) {
  const log = [];
  const snapshots = new Map(); // collection -> [names]
  const uploaded = [];
  const server = createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    log.push(`${req.method} ${url.pathname}${url.search}`);
    if (apiKey && req.headers['api-key'] !== apiKey) {
      res.writeHead(401).end('no key');
      return;
    }
    const send = (obj, code = 200) => {
      res.writeHead(code, { 'content-type': 'application/json' });
      res.end(JSON.stringify(obj));
    };
    const m = url.pathname.match(/^\/collections(?:\/([^/]+))?(?:\/snapshots(?:\/(upload)|\/([^/]+))?)?$/);
    if (!m) return send({ status: 'error' }, 404);
    const [, coll, upload, snap] = m;
    if (!coll && req.method === 'GET') return send({ result: { collections: Object.keys(collections).map((name) => ({ name })) } });
    if (coll && !url.pathname.includes('/snapshots') && req.method === 'GET') {
      return send({ result: { points_count: collections[coll] ?? 0 } });
    }
    if (upload && req.method === 'POST') {
      const chunks = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        uploaded.push({ coll, bytes: Buffer.concat(chunks).length, query: url.search });
        collections[coll] = collections[coll] ?? 1;
        send({ result: true, status: 'ok' });
      });
      return undefined;
    }
    if (url.pathname.endsWith('/snapshots') && req.method === 'POST') {
      if (failSnapshot) return send({ status: { error: 'boom' } }, 500);
      const name = `${coll}-2026.snapshot`;
      snapshots.set(coll, [...(snapshots.get(coll) ?? []), name]);
      return send({ result: { name } });
    }
    if (snap && req.method === 'GET') {
      res.writeHead(200, { 'content-type': 'application/octet-stream' });
      res.end(Buffer.from(`snapshot-bytes-of-${coll}`));
      return undefined;
    }
    if (snap && req.method === 'DELETE') {
      snapshots.set(coll, (snapshots.get(coll) ?? []).filter((n) => n !== snap));
      return send({ result: true });
    }
    return send({ status: 'error' }, 404);
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, log, snapshots, uploaded, url: `http://127.0.0.1:${server.address().port}` })));
}

function run(args, env) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [HELPER, ...args], { env: { ...process.env, ...env } });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.on('close', (status) => resolve({ status, stdout, stderr }));
  });
}

test('backup: one snapshot file per collection, server-side snapshots deleted afterwards, machine-readable summary', async () => {
  const q = await fakeQdrant();
  const out = mkdtempSync(path.join(tmpdir(), 'qd-'));
  try {
    const r = await run(['backup', out], { QDRANT_URL: q.url });
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(readdirSync(out).sort(), ['kb_documents.snapshot', 'reuse_questions.snapshot']);
    assert.equal(readFileSync(path.join(out, 'kb_documents.snapshot'), 'utf8'), 'snapshot-bytes-of-kb_documents');
    const lines = r.stdout.trim().split('\n');
    assert.match(lines[0], /^QDRANT_COLLECTION kb_documents points=12 bytes=\d+$/);
    assert.match(lines[1], /^QDRANT_COLLECTION reuse_questions points=3 bytes=\d+$/);
    // the helper cleans up after itself: Qdrant keeps snapshots until told otherwise
    assert.deepEqual([...q.snapshots.values()].flat(), []);
    assert.ok(q.log.some((l) => l.startsWith('DELETE /collections/kb_documents/snapshots/')));
  } finally {
    q.server.close();
    rmSync(out, { recursive: true, force: true });
  }
});

test('backup works when the script is piped in on stdin — how the backup script runs it inside the api container', async () => {
  const q = await fakeQdrant();
  const out = mkdtempSync(path.join(tmpdir(), 'qd-'));
  try {
    // `node --input-type=module - backup <dir>` with the script on stdin, exactly as backup-self-hosted.sh runs it.
    const r2 = await new Promise((resolve) => {
      const child = spawn(process.execPath, ['--input-type=module', '-', 'backup', out], { env: { ...process.env, QDRANT_URL: q.url } });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (d) => (stdout += d));
      child.stderr.on('data', (d) => (stderr += d));
      child.on('close', (status) => resolve({ status, stdout, stderr }));
      child.stdin.end(readFileSync(HELPER));
    });
    assert.equal(r2.status, 0, r2.stderr);
    assert.match(r2.stdout, /QDRANT_COLLECTION kb_documents points=12/);
  } finally {
    q.server.close();
    rmSync(out, { recursive: true, force: true });
  }
});

test('backup sends the api-key header when QDRANT_API_KEY is set and fails on a rejected key', async () => {
  const q = await fakeQdrant({ apiKey: 'secret-key' });
  const out = mkdtempSync(path.join(tmpdir(), 'qd-'));
  try {
    const bad = await run(['backup', out], { QDRANT_URL: q.url });
    assert.equal(bad.status, 1);
    assert.match(bad.stderr, /401/);
    const good = await run(['backup', out], { QDRANT_URL: q.url, QDRANT_API_KEY: 'secret-key' });
    assert.equal(good.status, 0, good.stderr);
  } finally {
    q.server.close();
    rmSync(out, { recursive: true, force: true });
  }
});

test('backup fails loudly when Qdrant refuses a snapshot, and when QDRANT_URL is missing', async () => {
  const q = await fakeQdrant({ failSnapshot: true });
  const out = mkdtempSync(path.join(tmpdir(), 'qd-'));
  try {
    const r = await run(['backup', out], { QDRANT_URL: q.url });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /qdrant-snapshot: POST \/collections\/kb_documents\/snapshots\?wait=true -> 500/);
    const none = await run(['backup', out], { QDRANT_URL: '' });
    assert.equal(none.status, 1);
    assert.match(none.stderr, /QDRANT_URL is not set/);
  } finally {
    q.server.close();
    rmSync(out, { recursive: true, force: true });
  }
});

test('an empty Qdrant is not an error and writes nothing', async () => {
  const q = await fakeQdrant({ collections: {} });
  const out = mkdtempSync(path.join(tmpdir(), 'qd-'));
  try {
    const r = await run(['backup', out], { QDRANT_URL: q.url });
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(readdirSync(out), []);
    assert.match(r.stderr, /no collections yet/);
  } finally {
    q.server.close();
    rmSync(out, { recursive: true, force: true });
  }
});

test('restore uploads each snapshot with priority=snapshot, so the backup wins over the present state', async () => {
  const q = await fakeQdrant();
  const dir = mkdtempSync(path.join(tmpdir(), 'qd-'));
  try {
    writeFileSync(path.join(dir, 'kb_documents.snapshot'), 'AAAA');
    writeFileSync(path.join(dir, 'reuse_questions.snapshot'), 'BBBBBB');
    const r = await run(['restore', dir], { QDRANT_URL: q.url });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(q.uploaded.length, 2);
    assert.ok(q.uploaded.every((u) => u.query.includes('priority=snapshot')));
    assert.deepEqual(q.uploaded.map((u) => u.coll).sort(), ['kb_documents', 'reuse_questions']);
    assert.match(r.stdout, /QDRANT_COLLECTION kb_documents points=12/);

    const empty = mkdtempSync(path.join(tmpdir(), 'qd-'));
    const none = await run(['restore', empty], { QDRANT_URL: q.url });
    assert.equal(none.status, 1);
    assert.match(none.stderr, /no \*\.snapshot files/);
    rmSync(empty, { recursive: true, force: true });
  } finally {
    q.server.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('usage errors exit non-zero', async () => {
  const r = await run(['frobnicate'], { QDRANT_URL: 'http://127.0.0.1:1' });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /usage:/);
});

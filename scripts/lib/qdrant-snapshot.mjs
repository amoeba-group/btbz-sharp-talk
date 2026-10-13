#!/usr/bin/env node
/**
 * Qdrant collection snapshots over Qdrant's own HTTP API (PLN-261012 SG-81).
 *
 *   node qdrant-snapshot.mjs backup  <out-dir>    one <collection>.snapshot per collection
 *   node qdrant-snapshot.mjs restore <in-dir>     upload every <collection>.snapshot back
 *   node qdrant-snapshot.mjs list                 collections and point counts
 *
 *   QDRANT_URL      required, e.g. http://qdrant:6333 (the API container already has it)
 *   QDRANT_API_KEY  optional, sent as the `api-key` header
 *
 * It is run INSIDE the api container (`docker exec -i … node - backup /tmp/x < this file`):
 * Qdrant is published to the compose network only, the image has no curl, and the API
 * image already ships Node with a global fetch — so this adds no dependency.
 *
 * Why per-collection snapshots and not the full-storage snapshot: a full-storage snapshot
 * cannot be restored through the HTTP API (only by starting Qdrant with --storage-snapshot),
 * which would make the restore drill a different, riskier procedure than the backup.
 *
 * Output (stdout, machine-readable, one line per collection):
 *   QDRANT_COLLECTION <name> points=<n> bytes=<n>
 * Anything else goes to stderr. Exit 0 only when every collection succeeded.
 */
import { createWriteStream, existsSync, mkdirSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import path from 'node:path';

const base = (process.env.QDRANT_URL || '').replace(/\/+$/, '');
const apiKey = process.env.QDRANT_API_KEY || '';

function fail(message) {
  console.error(`qdrant-snapshot: ${message}`);
  process.exit(1);
}

if (!base) fail('QDRANT_URL is not set');

async function request(method, route, init = {}) {
  const headers = { ...(init.headers || {}) };
  if (apiKey) headers['api-key'] = apiKey;
  const res = await fetch(`${base}${route}`, { method, ...init, headers });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`${method} ${route} -> ${res.status} ${body.slice(0, 200)}`);
  }
  return res;
}

const json = async (method, route, init) => (await request(method, route, init)).json();

async function collections() {
  const body = await json('GET', '/collections');
  return (body.result?.collections ?? []).map((c) => c.name);
}

async function pointCount(name) {
  const body = await json('GET', `/collections/${encodeURIComponent(name)}`);
  return body.result?.points_count ?? body.result?.vectors_count ?? 0;
}

async function backup(outDir) {
  mkdirSync(outDir, { recursive: true });
  const names = await collections();
  if (names.length === 0) {
    console.error('qdrant-snapshot: no collections yet — nothing to back up');
    return;
  }
  for (const name of names) {
    const enc = encodeURIComponent(name);
    const points = await pointCount(name);
    const created = await json('POST', `/collections/${enc}/snapshots?wait=true`);
    const snapshot = created.result?.name;
    if (!snapshot) throw new Error(`no snapshot name returned for ${name}`);
    const file = path.join(outDir, `${name}.snapshot`);
    try {
      const res = await request('GET', `/collections/${enc}/snapshots/${encodeURIComponent(snapshot)}`);
      await pipeline(Readable.fromWeb(res.body), createWriteStream(file));
    } finally {
      // The server keeps every snapshot until told otherwise; left alone they fill Qdrant's disk.
      await request('DELETE', `/collections/${enc}/snapshots/${encodeURIComponent(snapshot)}?wait=true`).catch((e) =>
        console.error(`qdrant-snapshot: could not delete server-side snapshot ${snapshot}: ${e.message}`),
      );
    }
    const bytes = statSync(file).size;
    if (bytes === 0) throw new Error(`downloaded snapshot for ${name} is empty`);
    console.log(`QDRANT_COLLECTION ${name} points=${points} bytes=${bytes}`);
  }
}

async function restore(inDir) {
  if (!existsSync(inDir)) fail(`${inDir} does not exist`);
  const files = readdirSync(inDir).filter((f) => f.endsWith('.snapshot'));
  if (files.length === 0) fail(`no *.snapshot files in ${inDir}`);
  for (const f of files) {
    const name = f.slice(0, -'.snapshot'.length);
    const form = new FormData();
    form.append('snapshot', new Blob([readFileSync(path.join(inDir, f))]), f);
    // priority=snapshot: the snapshot wins over whatever the collection holds now — the
    // point of a restore is to get back to the backup, not to merge with the present.
    await request('POST', `/collections/${encodeURIComponent(name)}/snapshots/upload?priority=snapshot&wait=true`, {
      body: form,
    });
    console.log(`QDRANT_COLLECTION ${name} points=${await pointCount(name)} bytes=${statSync(path.join(inDir, f)).size}`);
  }
}

async function list() {
  for (const name of await collections()) console.log(`QDRANT_COLLECTION ${name} points=${await pointCount(name)}`);
}

const [command, arg] = process.argv.slice(2);
try {
  if (command === 'backup' && arg) await backup(arg);
  else if (command === 'restore' && arg) await restore(arg);
  else if (command === 'list') await list();
  else fail('usage: qdrant-snapshot.mjs backup <out-dir> | restore <in-dir> | list');
} catch (err) {
  fail(err.message);
}

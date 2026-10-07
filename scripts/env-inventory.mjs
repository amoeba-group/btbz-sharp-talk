#!/usr/bin/env node
/**
 * Environment-variable completeness gate (PLN-260820 W1).
 *
 * The self-hosted template is what a customer's ops team fills in. A variable
 * the code reads but the template never mentions does not fail loudly — it
 * falls back to a default and works, until the day the default is wrong. The
 * worst example is `UPLOAD_DIR`: absent, the API writes attachments inside the
 * container and they disappear on the next deploy, with no error anywhere.
 *
 * So the template is checked against the code rather than maintained by hand.
 *
 *   npm run env:check              report and fail on gaps
 *   npm run env:check -- --list    print every key the code reads
 *   npm run env:check -- --fix     append missing keys to the template's
 *                                  "unclassified" section, for a human to sort
 */

import { readFile, writeFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const API_SRC = path.join(ROOT, 'apps/api/src');
const TEMPLATE = path.join(ROOT, 'docker/self-hosted/.env.self-hosted.example');

const argv = process.argv.slice(2);
const listOnly = argv.includes('--list');
const fix = argv.includes('--fix');

/**
 * Keys the API never reads from its own config, so their absence from the
 * template is not a gap:
 *  - VITE_* are build arguments for the browser bundles, not runtime config.
 *  - The MYSQL_* pair is consumed by the mysql image itself.
 *  - NODE_ENV/PORT are set by the compose file, not by an operator.
 *  - SHARPTALK_CLI/GATE_LABEL are set by the CLI entrypoints and the deploy
 *    script themselves (PLN-261008), never in an env file.
 */
const NOT_OPERATOR_CONFIG = new Set(['NODE_ENV', 'PORT', 'SHARPTALK_CLI', 'GATE_LABEL']);
const IGNORED_PREFIXES = ['VITE_', 'MYSQL_', 'npm_'];

/** `config.get('X')`, `config.get<T>('X')`, `process.env.X`, `process.env['X']`, `envNumber('X', d)`. */
const PATTERNS = [
  /config\.get(?:<[^>]*>)?\(\s*'([A-Z][A-Z0-9_]{2,})'/g,
  /configService\.get(?:<[^>]*>)?\(\s*'([A-Z][A-Z0-9_]{2,})'/g,
  /process\.env\.([A-Z][A-Z0-9_]{2,})/g,
  /process\.env\[\s*'([A-Z][A-Z0-9_]{2,})'\s*\]/g,
  // Numeric settings go through envNumber('X', d) since FIX-260930.
  /envNumber\(\s*'([A-Z][A-Z0-9_]{2,})'/g,
];

async function sourceFiles(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...(await sourceFiles(full)));
      continue;
    }
    // Tests set env vars to exercise branches; that is not deployment config.
    if (!entry.name.endsWith('.ts') || entry.name.endsWith('.spec.ts')) continue;
    out.push(full);
  }
  return out;
}

function ignored(key) {
  return NOT_OPERATOR_CONFIG.has(key) || IGNORED_PREFIXES.some((p) => key.startsWith(p));
}

async function keysFromCode() {
  const found = new Map(); // key -> Set(file)
  for (const file of await sourceFiles(API_SRC)) {
    const text = await readFile(file, 'utf8');
    for (const pattern of PATTERNS) {
      for (const match of text.matchAll(pattern)) {
        const key = match[1];
        if (ignored(key)) continue;
        if (!found.has(key)) found.set(key, new Set());
        found.get(key).add(path.relative(ROOT, file));
      }
    }
  }
  return found;
}

/** Keys declared in the template — commented-out ones count as declared. */
async function keysFromTemplate() {
  if (!existsSync(TEMPLATE)) return null;
  const text = await readFile(TEMPLATE, 'utf8');
  const keys = new Set();
  for (const line of text.split('\n')) {
    const match = /^\s*#?\s*([A-Z][A-Z0-9_]{2,})\s*=/.exec(line);
    if (match) keys.add(match[1]);
  }
  return keys;
}

const code = await keysFromCode();

if (listOnly) {
  for (const key of [...code.keys()].sort()) console.log(key);
  process.exit(0);
}

const template = await keysFromTemplate();
if (!template) {
  console.error(`env template not found: ${path.relative(ROOT, TEMPLATE)}`);
  process.exit(1);
}

const missing = [...code.keys()].filter((k) => !template.has(k)).sort();
const stray = [...template].filter((k) => !code.has(k) && !ignored(k)).sort();

console.log(`\nenv template vs. apps/api/src`);
console.log(`  read by code : ${code.size}`);
console.log(`  in template  : ${template.size}`);

if (fix && missing.length) {
  const text = await readFile(TEMPLATE, 'utf8');
  const block = [
    '',
    '# ---- unclassified (added by `npm run env:check -- --fix`) -----------------',
    '# Sort these into the sections above; the section decides what an operator',
    '# must fill in versus what only turns a feature off.',
    ...missing.map((k) => `# ${k}=`),
  ].join('\n');
  await writeFile(TEMPLATE, `${text.replace(/\s*$/, '')}\n${block}\n`, 'utf8');
  console.log(`\n  appended ${missing.length} key(s) to the template — sort them by hand.`);
  process.exit(0);
}

if (missing.length) {
  console.log(`\n  MISSING from the template (${missing.length}):`);
  for (const key of missing) {
    const [first] = [...code.get(key)];
    console.log(`    ${key.padEnd(34)} ${first}`);
  }
}

// A stray key is documentation debt rather than a deployment risk: it tells an
// operator to set something nothing reads. Reported, but never fatal — a key
// may legitimately be consumed by a sibling app or the compose file.
if (stray.length) {
  console.log(`\n  in the template but not read by the API (${stray.length}):`);
  console.log(`    ${stray.join(', ')}`);
}

if (missing.length) {
  console.log(`\nFAIL — an operator cannot set what the template does not mention.\n`);
  process.exit(1);
}
console.log(`\nOK — every variable the API reads is in the template.\n`);

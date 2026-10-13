// PLN-261012 SG-80: scripts/deploy-self-hosted.sh — first-install migration gate, --dry-run,
// --bundle, golden gate. The script runs against a FAKE docker (see helpers/sandbox.mjs):
// what matters here is which docker calls it makes, in what order, and when it refuses.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { Sandbox } from './helpers/sandbox.mjs';

const SCRIPT = 'scripts/deploy-self-hosted.sh';
const FIXTURE_SQL = {
  '260901-a.sql': 'ALTER TABLE `tenants` ADD COLUMN `a` int NULL;\n-- Rollback: ALTER TABLE `tenants` DROP COLUMN `a`;\n',
  '260902-b.sql': 'ALTER TABLE `tenants` ADD COLUMN `b` int NULL;\n',
};
const FIXTURE_ROWS = ['260901-a.sql\tcolumn\ttenants\ta', '260902-b.sql\tcolumn\ttenants\tb'];
const COMPLETE_SCHEMA = ['table\ttenants\t-', 'column\ttenants\ta', 'column\ttenants\tb'];
const INCOMPLETE_SCHEMA = ['table\ttenants\t-', 'column\ttenants\ta'];

function make({ schema = COMPLETE_SCHEMA, env = {} } = {}) {
  const sb = new Sandbox({ realSql: false });
  sb.setSqlFixture(FIXTURE_SQL, FIXTURE_ROWS);
  sb.writeEnv(env);
  const schemaPath = sb.setSchema(schema);
  return { sb, schemaPath };
}

const dockerEnv = (schemaPath, extra = {}) => ({ FAKE_SCHEMA: schemaPath, ...extra });
const idx = (sb, re) => sb.firstCall(re);

test('--dry-run prints every action and makes NO docker call and writes NO file', () => {
  const { sb } = make();
  try {
    const r = sb.run(SCRIPT, ['--dry-run', '--version', '1.2.3', '--pre-backup', '--golden-gate'], { GOLDEN_GATE: '4:10' });
    assert.equal(r.status, 0, r.out);
    assert.match(r.out, /DRY RUN/);
    assert.match(r.out, /\[dry-run\] docker compose -f docker\/self-hosted\/docker-compose\.self-hosted\.yml --env-file \S+ up -d --build/);
    assert.match(r.out, /\[dry-run\] .*up -d --no-deps --force-recreate nginx/);
    assert.match(r.out, /\[dry-run\] if this is a first install:/);
    assert.match(r.out, /\[dry-run\] .*backup-self-hosted\.sh/);
    assert.match(r.out, /\[dry-run\] docker exec -d -e GATE_LABEL=1\.2\.3 .*golden-gate\.js/);
    assert.match(r.out, /would append to .*releases\.log/);
    assert.match(r.out, /nothing was changed/);
    assert.deepEqual(sb.calls(), [], 'a dry run must not even ask docker a question');
    assert.equal(sb.exists('docker/self-hosted/widget-config.js'), false);
    assert.equal(sb.exists('docker/self-hosted/releases.log'), false);
  } finally {
    sb.cleanup();
  }
});

test('--check on a first install changes nothing: no compose, no widget-config.js', () => {
  const { sb, schemaPath } = make();
  try {
    const r = sb.run(SCRIPT, ['--check', '--version', '1.2.3'], dockerEnv(schemaPath));
    assert.equal(r.status, 0, r.out);
    assert.match(r.out, /first install/i);
    assert.match(r.out, /Check-only mode: nothing was deployed/);
    assert.equal(sb.calls().filter((c) => /compose|load|build|exec/.test(c)).length, 0);
    assert.equal(sb.exists('docker/self-hosted/widget-config.js'), false);
  } finally {
    sb.cleanup();
  }
});

test('FIRST INSTALL runs the migration gate: database alone first, gate, THEN the app containers', () => {
  const { sb, schemaPath } = make({ schema: COMPLETE_SCHEMA });
  try {
    const r = sb.run(SCRIPT, ['--version', '1.2.3'], dockerEnv(schemaPath));
    assert.equal(r.status, 0, r.out);
    const mysqlUp = idx(sb, /compose .* up -d mysql$/);
    const gate = idx(sb, /information_schema\.COLUMNS/);
    const appUp = idx(sb, /compose .* up -d --build$/);
    assert.ok(mysqlUp >= 0, 'the database is started on its own first');
    assert.ok(gate > mysqlUp, 'the gate runs after the database is up');
    assert.ok(appUp > gate, 'the app containers only start after the gate passed');
    assert.match(r.out, /First install/);
    assert.match(r.out, /OK — every schema migration is present/);
    assert.match(r.out, /Deployed 1\.2\.3/);
    // widget runtime config + release record
    assert.match(sb.read('docker/self-hosted/widget-config.js'), /apiBase: "https:\/\/talk\.example\.com\/api\/v1"/);
    const log = sb.read('docker/self-hosted/releases.log').trim().split('\n');
    assert.equal(log.length, 1);
    const [, version, mode, , action] = log[0].split('\t');
    assert.deepEqual([version, mode, action], ['1.2.3', 'build', 'deployed']);
    const tsv = sb.read('docker/self-hosted/releases/1.2.3/migrations.tsv');
    assert.match(tsv, /^260901-a\.sql\tadditive\tyes$/m);
    assert.match(tsv, /^260902-b\.sql\tadditive\tno$/m);
    // the up --build call carried the version, so the images are tagged for a rollback
    assert.match(sb.calls()[appUp], /^VER=1\.2\.3 ::/);
  } finally {
    sb.cleanup();
  }
});

test('FIRST INSTALL with an init-sql that is behind sql/ STOPS before the app containers (D-18)', () => {
  const { sb, schemaPath } = make({ schema: INCOMPLETE_SCHEMA });
  try {
    const r = sb.run(SCRIPT, ['--version', '1.2.3'], dockerEnv(schemaPath));
    assert.equal(r.status, 1, r.out);
    assert.match(r.out, /FIRST INSTALL STOPPED: docker\/init-sql is behind sql\//);
    assert.match(r.out, /sql\/260902-b\.sql/);
    assert.ok(idx(sb, /compose .* up -d mysql$/) >= 0);
    assert.equal(idx(sb, /up -d --build/), -1, 'no app container may start on a drifted schema');
    assert.equal(sb.exists('docker/self-hosted/releases.log'), false);
  } finally {
    sb.cleanup();
  }
});

test('an UPGRADE (database running) stops on outstanding SQL and starts nothing', () => {
  const { sb, schemaPath } = make({ schema: INCOMPLETE_SCHEMA });
  try {
    const r = sb.run(SCRIPT, ['--version', '1.2.3'], dockerEnv(schemaPath, { FAKE_DOCKER_PS: 'sharptalk_mysql' }));
    assert.equal(r.status, 1, r.out);
    assert.match(r.out, /Apply the SQL above, then run this script again/);
    assert.equal(idx(sb, /compose .* up/), -1);
  } finally {
    sb.cleanup();
  }
});

test('an UPGRADE that is clean builds and starts, never re-starting the database on its own', () => {
  const { sb, schemaPath } = make();
  try {
    const r = sb.run(SCRIPT, ['--version', '1.2.3', '--pre-backup'], dockerEnv(schemaPath, { FAKE_DOCKER_PS: 'sharptalk_mysql sharptalk_api' }));
    assert.equal(r.status, 0, r.out);
    assert.equal(idx(sb, /compose .* up -d mysql$/), -1);
    const gate = idx(sb, /information_schema\.COLUMNS/);
    const backup = idx(sb, /mysqldump/);
    const up = idx(sb, /compose .* up -d --build$/);
    assert.ok(gate >= 0 && backup > gate && up > backup, 'gate, then the pre-release backup, then the deploy');
    // the pre-release backup is labelled with the version it precedes
    assert.match(r.out, /_pre-1\.2\.3/);
  } finally {
    sb.cleanup();
  }
});

test('--skip-migration-check is announced loudly and skips the gate', () => {
  const { sb, schemaPath } = make({ schema: INCOMPLETE_SCHEMA });
  try {
    const r = sb.run(SCRIPT, ['--version', '1.2.3', '--skip-migration-check'], dockerEnv(schemaPath, { FAKE_DOCKER_PS: 'sharptalk_mysql' }));
    assert.equal(r.status, 0, r.out);
    assert.match(r.out, /Skipping the migration check/);
    assert.equal(idx(sb, /information_schema/), -1);
  } finally {
    sb.cleanup();
  }
});

test('post-deploy verification fails the deploy and records it when the stack is not serving', () => {
  const { sb, schemaPath } = make();
  try {
    const r = sb.run(SCRIPT, ['--version', '1.2.3'], dockerEnv(schemaPath, { FAKE_HTTP_CODE: '502' }));
    assert.equal(r.status, 1, r.out);
    assert.match(r.out, /FAIL — the stack started but is not serving/);
    assert.match(sb.read('docker/self-hosted/releases.log'), /\t1\.2\.3\tbuild\t[^\t]*\tfailed\t/);
  } finally {
    sb.cleanup();
  }

  // 401 on a protected route = deployed and serving; 404 = the OLD code is still answering.
  const old = make();
  try {
    const r = old.sb.run(SCRIPT, ['--version', '1.2.3'], dockerEnv(old.schemaPath, { FAKE_AUTH_ME_CODE: '404' }));
    assert.equal(r.status, 1, r.out);
    assert.match(r.out, /api route: 404 {2}\(401 = deployed and serving/);
  } finally {
    old.sb.cleanup();
  }
});

test('configuration refusals: missing env file, wrong UPLOAD_DIR, half-configured seed identity', () => {
  const missing = new Sandbox({ realSql: false });
  try {
    const r = missing.run(SCRIPT, ['--dry-run']);
    assert.equal(r.status, 1);
    assert.match(r.out, /\.env\.self-hosted not found/);
  } finally {
    missing.cleanup();
  }

  const badUpload = make({ env: { UPLOAD_DIR: './.uploads' } });
  try {
    const r = badUpload.sb.run(SCRIPT, ['--dry-run']);
    assert.equal(r.status, 1);
    assert.match(r.out, /UPLOAD_DIR is '\.\/\.uploads'/);
  } finally {
    badUpload.sb.cleanup();
  }

  const noDomain = make({ env: { SEED_ON_BOOT: 'true', SEED_TENANT_SLUG: 'go2joy' } });
  try {
    const r = noDomain.sb.run(SCRIPT, ['--dry-run']);
    assert.equal(r.status, 1);
    assert.match(r.out, /SEED_TENANT_SLUG=go2joy needs SEED_TENANT_DOMAIN/);
  } finally {
    noDomain.sb.cleanup();
  }

  const noEmails = make({ env: { SEED_ON_BOOT: 'true', SEED_TENANT_SLUG: 'go2joy', SEED_TENANT_DOMAIN: 'app.go2joy.vn' } });
  try {
    const r = noEmails.sb.run(SCRIPT, ['--dry-run']);
    assert.equal(r.status, 1);
    assert.match(r.out, /needs SEED_ADMIN_EMAIL and SEED_MASTER_EMAIL/);
  } finally {
    noEmails.sb.cleanup();
  }
});

test('seed + alert hints: generated-password note and the no-recipient warning', () => {
  const { sb } = make({ env: { SEED_ON_BOOT: 'true', ALERT_EMAIL_TO: undefined, AI_ALERT_EMAIL: undefined } });
  try {
    const r = sb.run(SCRIPT, ['--dry-run']);
    assert.equal(r.status, 0, r.out);
    assert.match(r.out, /one-time password is generated and printed ONCE/);
    assert.match(r.out, /neither AI_ALERT_EMAIL nor ALERT_EMAIL_TO is set/);
  } finally {
    sb.cleanup();
  }
});

test('--golden-gate starts the regression gate inside the API container, in the background', () => {
  const { sb, schemaPath } = make({ env: { GOLDEN_GATE: '4:10' } });
  try {
    const r = sb.run(SCRIPT, ['--version', '1.2.3', '--golden-gate'], dockerEnv(schemaPath));
    assert.equal(r.status, 0, r.out);
    const call = sb.calls().find((c) => /exec -d -e GATE_LABEL=1\.2\.3 -w \/app\/apps\/api sharptalk_api/.test(c));
    assert.ok(call, 'docker exec -d … golden-gate.js was not issued');
    assert.match(call, /node dist\/database\/golden-gate\.js/);
    assert.match(r.out, /started in the background/);
  } finally {
    sb.cleanup();
  }

  const off = make({ env: { GOLDEN_GATE: '' } });
  try {
    const r = off.sb.run(SCRIPT, ['--version', '1.2.3', '--golden-gate'], dockerEnv(off.schemaPath));
    assert.equal(r.status, 0, r.out);
    assert.match(r.out, /GOLDEN_GATE is empty/);
    assert.equal(off.sb.calls().filter((c) => /golden-gate/.test(c)).length, 0);
  } finally {
    off.sb.cleanup();
  }

  // Without the flag the gate never runs, even when GOLDEN_GATE is set (default OFF).
  const noFlag = make({ env: { GOLDEN_GATE: '4:10' } });
  try {
    const r = noFlag.sb.run(SCRIPT, ['--version', '1.2.3'], dockerEnv(noFlag.schemaPath));
    assert.equal(r.status, 0, r.out);
    assert.equal(noFlag.sb.calls().filter((c) => /golden-gate/.test(c)).length, 0);
  } finally {
    noFlag.sb.cleanup();
  }
});

// ---- bundles ---------------------------------------------------------------------

function makeBundle(sb, { version = '2.0.0', prefix = 'acme', apiBase = '/api/v1', tamper = false } = {}) {
  mkdirSync(path.join(sb.root, 'images'), { recursive: true });
  writeFileSync(path.join(sb.root, 'images', 'app-api.tar'), 'api image bytes');
  writeFileSync(path.join(sb.root, 'images', '3p-mysql.tar'), 'mysql image bytes');
  writeFileSync(path.join(sb.root, 'VERSION'), `${version}\n`);
  writeFileSync(path.join(sb.root, 'build.env'), `SHARPTALK_IMAGE_PREFIX=${prefix}\nVITE_API_BASE_URL=${apiBase}\n`);
  writeFileSync(
    path.join(sb.root, 'migrations.tsv'),
    '260901-a.sql\tadditive\tyes\n260902-b.sql\tadditive\tno\n',
  );
  const sums = ['VERSION', 'build.env', 'images/app-api.tar', 'images/3p-mysql.tar', 'migrations.tsv']
    .map((f) => `${createHash('sha256').update(readFileSync(path.join(sb.root, f))).digest('hex')}  ${f}`)
    .join('\n');
  writeFileSync(path.join(sb.root, 'SHA256SUMS'), `${sums}\n`);
  if (tamper) writeFileSync(path.join(sb.root, 'images', 'app-api.tar'), 'api image bytes (edited in transit)');
}

test('--bundle --dry-run verifies the checksums, then lists every load/start without running any of them', () => {
  const { sb } = make();
  try {
    makeBundle(sb);
    const r = sb.run(SCRIPT, ['--bundle', '.', '--dry-run']);
    assert.equal(r.status, 0, r.out);
    assert.match(r.out, /Verifying the bundle's checksums/);
    assert.match(r.out, /images\/app-api\.tar: OK/);
    assert.match(r.out, /version : 2\.0\.0 {3}\(images acme\/\{api,web,widget\}:2\.0\.0\)/);
    assert.match(r.out, /\[dry-run\] docker load -i .*images\/app-api\.tar/);
    assert.match(r.out, /\[dry-run\] docker load -i .*images\/3p-mysql\.tar/);
    assert.match(r.out, /up -d --no-build/);
    assert.doesNotMatch(r.out, /up -d --build/);
    assert.deepEqual(sb.calls(), []);
  } finally {
    sb.cleanup();
  }
});

test('--bundle refuses a bundle whose files do not match SHA256SUMS, before touching docker', () => {
  const { sb } = make();
  try {
    makeBundle(sb, { tamper: true });
    const r = sb.run(SCRIPT, ['--bundle', '.']);
    assert.equal(r.status, 1, r.out);
    assert.match(r.out, /images\/app-api\.tar: FAILED/);
    assert.match(r.out, /checksum verification failed — do not deploy this bundle/);
    assert.deepEqual(sb.calls(), []);
  } finally {
    sb.cleanup();
  }
});

test('--bundle deploys without a build: loads every tar, starts with --no-build, records the migration list', () => {
  const { sb, schemaPath } = make();
  try {
    makeBundle(sb);
    const r = sb.run(SCRIPT, ['--bundle', '.'], dockerEnv(schemaPath));
    assert.equal(r.status, 0, r.out);
    const loads = sb.calls().filter((c) => /^VER=2\.0\.0 :: load -i /.test(c));
    assert.equal(loads.length, 2);
    assert.equal(idx(sb, /up -d --build/), -1, 'a bundle deploy never builds');
    const mysqlUp = idx(sb, /up -d mysql$/);
    const noBuild = idx(sb, /up -d --no-build$/);
    assert.ok(idx(sb, /load -i/) < mysqlUp, 'images are loaded before the database container is started');
    assert.ok(noBuild > idx(sb, /information_schema\.COLUMNS/));
    assert.match(r.out, /image {4}: acme\/api:2\.0\.0 {2}\(expected acme\/api:2\.0\.0\)/);
    // the bundle's own migration list becomes the release record
    assert.equal(sb.read('docker/self-hosted/releases/2.0.0/migrations.tsv'), '260901-a.sql\tadditive\tyes\n260902-b.sql\tadditive\tno\n');
  } finally {
    sb.cleanup();
  }
});

test('--bundle built for one API base refuses an env file that points at another', () => {
  const { sb } = make();
  try {
    makeBundle(sb, { apiBase: 'https://elsewhere.example.org/api/v1' });
    const r = sb.run(SCRIPT, ['--bundle', '.', '--dry-run']);
    assert.equal(r.status, 1, r.out);
    assert.match(r.out, /console was built for API base https:\/\/elsewhere\.example\.org\/api\/v1/);
  } finally {
    sb.cleanup();
  }
});

test('--bundle pointing at ANOTHER directory re-runs that bundle\'s own copy of the script (its own sql/ gate)', () => {
  const { sb } = make();
  try {
    // a second, self-contained "bundle" inside the sandbox
    const inner = path.join(sb.root, 'unpacked', 'sharptalk-9.9.9');
    mkdirSync(path.join(inner, 'scripts', 'lib'), { recursive: true });
    mkdirSync(path.join(inner, 'docker', 'self-hosted'), { recursive: true });
    writeFileSync(path.join(inner, 'scripts', 'deploy-self-hosted.sh'), '#!/usr/bin/env bash\necho "INNER COPY RAN WITH: $*"\n');
    writeFileSync(path.join(inner, 'VERSION'), '9.9.9\n');
    writeFileSync(path.join(inner, 'SHA256SUMS'), '');
    const r = sb.run(SCRIPT, ['--bundle', 'unpacked/sharptalk-9.9.9', '--dry-run']);
    assert.equal(r.status, 0, r.out);
    assert.match(r.out, /Re-running the deploy script from inside the bundle/);
    assert.match(r.out, /INNER COPY RAN WITH: --bundle unpacked\/sharptalk-9\.9\.9 --dry-run/);
  } finally {
    sb.cleanup();
  }
});

test('unknown options and a bundle that is not a bundle are refused', () => {
  const { sb } = make();
  try {
    assert.equal(sb.run(SCRIPT, ['--frobnicate']).status, 2);
    mkdirSync(path.join(sb.root, 'not-a-bundle'));
    const r = sb.run(SCRIPT, ['--bundle', 'not-a-bundle']);
    assert.equal(r.status, 1);
    assert.match(r.out, /is not a release bundle/);
    const help = sb.run(SCRIPT, ['--help']);
    assert.equal(help.status, 0);
    assert.match(help.stdout, /--bundle <dir>/);
  } finally {
    sb.cleanup();
  }
});

test('compose is handed an ABSOLUTE env file path, so a config kept outside the release directory is not ignored', () => {
  const { sb, schemaPath } = make();
  try {
    // configuration lives outside the "release" directory, as the bundle README says
    const outside = sb.write('etc/sharptalk/.env.self-hosted', readFileSync(path.join(sb.root, 'docker/self-hosted/.env.self-hosted'), 'utf8'));
    const r = sb.run(SCRIPT, ['--version', '1.2.3'], dockerEnv(schemaPath, { SHARPTALK_ENV_FILE: outside }));
    assert.equal(r.status, 0, r.out);
    const seen = new Set(sb.composeEnvFiles());
    assert.equal(seen.size, 1);
    const [one] = [...seen];
    assert.ok(path.isAbsolute(one) || /^[A-Za-z]:|^\//.test(one), `not absolute: ${one}`);
    assert.match(one.split(path.sep).join('/'), /etc\/sharptalk\/\.env\.self-hosted$/);
  } finally {
    sb.cleanup();
  }
});

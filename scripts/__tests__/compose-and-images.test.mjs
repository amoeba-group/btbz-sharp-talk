// PLN-261012 SG-80/81: the declarative half of the hosting work — Dockerfiles, compose files, env
// templates, build-step scripts, scheduler files — checked as files and, where Docker is available,
// by rendering the compose files (`docker compose config` only: nothing is built or started).
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { REPO, Sandbox } from './helpers/sandbox.mjs';

const read = (rel) => readFileSync(path.join(REPO, rel), 'utf8').replace(/\r\n/g, '\n');
const dockerAvailable = spawnSync('docker', ['compose', 'version'], { encoding: 'utf8' }).status === 0;

// ---- Dockerfiles ---------------------------------------------------------------------

const DOCKERFILES = ['Dockerfile.api', 'Dockerfile.web', 'Dockerfile.widget'].map((f) => `docker/self-hosted/${f}`);

test('self-hosted Dockerfiles use `npm ci` (never `npm install`) and a lockfile that exists', () => {
  for (const f of DOCKERFILES) {
    const text = read(f);
    assert.match(text, /^RUN npm ci$/m, `${f} must install with npm ci`);
    assert.doesNotMatch(text, /^RUN npm install/m, `${f} still runs npm install`);
    assert.match(text, /COPY package\.json package-lock\.json/, `${f} must copy the lockfile for npm ci`);
  }
  assert.ok(readFileSync(path.join(REPO, 'package-lock.json')).length > 1000, 'package-lock.json must be committed');
});

test('self-hosted Dockerfiles pin their base images: every FROM goes through an ARG whose default is an explicit version', () => {
  for (const f of DOCKERFILES) {
    const text = read(f);
    const froms = [...text.matchAll(/^FROM (\S+)/gm)].map((m) => m[1]);
    assert.ok(froms.length >= 2, `${f}: expected a build and a runtime stage`);
    for (const from of froms) assert.match(from, /^\$\{(NODE_IMAGE|NGINX_IMAGE)\}$/, `${f}: FROM ${from} bypasses the pinned ARG`);
    for (const m of text.matchAll(/^ARG (NODE_IMAGE|NGINX_IMAGE)=(\S+)$/gm)) {
      const [, name, value] = m;
      assert.match(value, /:\d+\.\d+(\.\d+)?(-[a-z0-9.]+)?$/, `${f}: ${name}=${value} is not an explicit version`);
      assert.doesNotMatch(value, /:(latest|alpine|lts)$/);
      assert.doesNotMatch(value, /@sha256/, 'no digest may be invented: it cannot be verified offline');
    }
  }
});

test('the Dockerfile ARG defaults and the compose build-arg defaults are the same pins', () => {
  const compose = read('docker/self-hosted/docker-compose.self-hosted.yml');
  const nodeDefaults = new Set([...compose.matchAll(/NODE_IMAGE: \$\{SHARPTALK_NODE_IMAGE:-([^}]+)\}/g)].map((m) => m[1]));
  const nginxDefaults = new Set([...compose.matchAll(/(?:NGINX_IMAGE|image): \$\{SHARPTALK_NGINX_IMAGE:-([^}]+)\}/g)].map((m) => m[1]));
  assert.equal(nodeDefaults.size, 1, 'compose passes one node image everywhere');
  assert.equal(nginxDefaults.size, 1, 'compose uses one nginx image everywhere');
  for (const f of DOCKERFILES) {
    const text = read(f);
    const node = text.match(/^ARG NODE_IMAGE=(\S+)$/m)?.[1];
    const nginx = text.match(/^ARG NGINX_IMAGE=(\S+)$/m)?.[1];
    assert.equal(node, [...nodeDefaults][0], `${f} NODE_IMAGE differs from compose`);
    if (nginx) assert.equal(nginx, [...nginxDefaults][0], `${f} NGINX_IMAGE differs from compose`);
  }
});

test('the web Dockerfile wires the Amoeba-host removal build steps', () => {
  const text = read('docker/self-hosted/Dockerfile.web');
  assert.match(text, /^ARG CONSOLE_FRAME_ANCESTORS=$/m, 'frame-ancestors defaults to none');
  assert.match(text, /rewrite-manual-host\.sh apps\/web\/dist\/manual "\$MANUAL_HOST"/);
  assert.match(text, /render-frame-ancestors\.sh \/etc\/nginx\/conf\.d\/default\.conf "\$CONSOLE_FRAME_ANCESTORS"/);
  assert.match(text, /^ARG VITE_WIDGET_URL=$/m);
  assert.match(read('docker/self-hosted/nginx.web.conf'), /frame-ancestors __CONSOLE_FRAME_ANCESTORS__/);
});

// ---- no Amoeba-bound defaults in what a customer runs -----------------------------------

function nonComment(text, marker = '#') {
  return text
    .split('\n')
    .filter((l) => !l.trim().startsWith(marker))
    .join('\n');
}

test('nothing a customer runs defaults to an Amoeba host or mailbox (comments excluded)', () => {
  const pattern = /(shoptalk|sharptalk)\.amoeba\.site|ama\.amoeba\.site|@amoeba\.group|ivyusa\.local|messenger\.amoeba\.site/;
  const files = [
    'docker/self-hosted/docker-compose.self-hosted.yml',
    'docker/self-hosted/Dockerfile.api',
    'docker/self-hosted/Dockerfile.web',
    'docker/self-hosted/Dockerfile.widget',
    'docker/self-hosted/nginx.conf',
    'docker/self-hosted/nginx.web.conf',
    'docker/self-hosted/nginx.widget.conf',
    'docker/self-hosted/build-steps/render-frame-ancestors.sh',
    ...readdirSync(path.join(REPO, 'docker/self-hosted/ops')).map((f) => `docker/self-hosted/ops/${f}`),
  ];
  for (const f of files) {
    const stripped = nonComment(read(f));
    // rewrite-manual-host.sh legitimately NAMES the hosts it replaces; it is not in this list
    assert.doesNotMatch(stripped, pattern, `${f} carries an Amoeba-bound default`);
  }
  for (const f of ['apps/api/src/infrastructure/external/mailer.service.ts', 'apps/api/src/infrastructure/external/ai/ai-credit-alert.service.ts', 'apps/api/src/database/golden-gate.ts']) {
    const code = read(f)
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split('\n')
      .filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*'))
      .join('\n');
    assert.doesNotMatch(code, pattern, `${f} carries an Amoeba-bound default`);
  }
});

// ---- env templates -------------------------------------------------------------------

test('the self-hosted env template documents every new variable (and env:check still passes)', () => {
  const env = read('docker/self-hosted/.env.self-hosted.example');
  for (const key of [
    'SEED_TENANT_SLUG', 'SEED_TENANT_NAME', 'SEED_TENANT_DOMAIN', 'SEED_ADMIN_EMAIL', 'SEED_MASTER_EMAIL', 'SEED_ADMIN_PASSWORD',
    'SHARPTALK_IMAGE_PREFIX', 'SHARPTALK_VERSION', 'LOG_MAX_SIZE', 'LOG_MAX_FILE', 'CONSOLE_FRAME_ANCESTORS', 'VITE_WIDGET_URL',
    'AI_ALERT_EMAIL', 'ALERT_EMAIL_TO', 'ALERT_EMAIL_FROM',
  ]) {
    assert.match(env, new RegExp(`^#?\\s*${key}=`, 'm'), `${key} is not in the env template`);
  }
  assert.doesNotMatch(env, /Blank = dev@amoeba\.group/, 'the template must not promise an Amoeba recipient any more');
  const gate = spawnSync(process.execPath, [path.join(REPO, 'scripts', 'env-inventory.mjs')], { encoding: 'utf8', cwd: REPO });
  assert.equal(gate.status, 0, gate.stdout + gate.stderr);
});

test('the Go2Joy profile sets the single-tenant identity instead of inheriting Amoeba\'s', () => {
  const env = read('deploy/profiles/SharpTalk-VN-Go2Joy/.env.SharpTalk-VN-Go2Joy.example');
  assert.match(env, /^SEED_TENANT_SLUG=go2joy$/m);
  assert.match(env, /^SEED_TENANT_NAME=Go2Joy$/m);
  assert.match(env, /^SEED_TENANT_DOMAIN=\S+$/m);
  assert.match(env, /^SEED_ADMIN_EMAIL=$/m);
  assert.match(env, /^SEED_MASTER_EMAIL=$/m);
  assert.doesNotMatch(env, /Blank = dev@amoeba\.group/);
  assert.match(env, /^CONSOLE_FRAME_ANCESTORS=$/m, 'Go2Joy frames nothing: no Amoeba portal in its CSP');
});

// ---- build steps ---------------------------------------------------------------------

function sh(script, args) {
  return spawnSync('sh', [script, ...args], { encoding: 'utf8', env: { ...process.env, MSYS_NO_PATHCONV: '1' } });
}

function lfCopy(rel, dir) {
  const dst = path.join(dir, path.basename(rel));
  writeFileSync(dst, read(rel));
  return dst;
}

test('rewrite-manual-host.sh replaces both Amoeba hosts in html/md manuals and rejects a bad host', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'manual-'));
  try {
    const script = lfCopy('docker/self-hosted/build-steps/rewrite-manual-host.sh', dir);
    const man = path.join(dir, 'manual');
    mkdirSync(man);
    writeFileSync(path.join(man, 'a.html'), '<code>https://shoptalk.amoeba.site/user/&lt;slug&gt;</code> and https://sharptalk.amoeba.site');
    writeFileSync(path.join(man, 'b.md'), 'Use `https://shoptalk.amoeba.site/widget/embed.js`');
    writeFileSync(path.join(man, 'c.png'), 'binary shoptalk.amoeba.site untouched');
    const ok = sh(script, [man, 'talk.go2joy.vn']);
    assert.equal(ok.status, 0, ok.stderr);
    assert.match(readFileSync(path.join(man, 'a.html'), 'utf8'), /https:\/\/talk\.go2joy\.vn\/user\/&lt;slug&gt;.*https:\/\/talk\.go2joy\.vn$/);
    assert.match(readFileSync(path.join(man, 'b.md'), 'utf8'), /https:\/\/talk\.go2joy\.vn\/widget\/embed\.js/);
    assert.match(readFileSync(path.join(man, 'c.png'), 'utf8'), /shoptalk\.amoeba\.site/, 'only html/md are rewritten');
    assert.equal(sh(script, [man, 'bad host;']).status, 1);
    assert.equal(sh(script, [path.join(dir, 'missing'), 'talk.go2joy.vn']).status, 0, 'a trimmed build without manuals is fine');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('render-frame-ancestors.sh: default is exactly \'self\'; listed origins are appended; anything else is refused', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'frame-'));
  try {
    const script = lfCopy('docker/self-hosted/build-steps/render-frame-ancestors.sh', dir);
    const render = (extra) => {
      const conf = path.join(dir, `nginx-${Math.random().toString(36).slice(2)}.conf`);
      writeFileSync(conf, read('docker/self-hosted/nginx.web.conf'));
      // The value goes through a FILE: on Windows the MSYS runtime re-parses a command line and
      // would swallow a lone quote character before the script ever saw it.
      const valueFile = `${conf}.value`;
      const driver = path.join(dir, 'driver.sh');
      writeFileSync(valueFile, extra);
      writeFileSync(driver, 'sh "$1" "$2" "$(cat "$3")"\n');
      const r = sh(driver, [script, conf, valueFile]);
      return { r, text: readFileSync(conf, 'utf8') };
    };
    const none = render('');
    assert.equal(none.r.status, 0, none.r.stderr);
    assert.match(none.text, /Content-Security-Policy "frame-ancestors 'self'" always;/);
    assert.doesNotMatch(none.text, /amoeba|__CONSOLE/);

    const some = render('  https://portal.example.com   https://*.example.org ');
    assert.match(some.text, /frame-ancestors 'self' https:\/\/portal\.example\.com https:\/\/\*\.example\.org" always;/);

    for (const bad of ['x; evil', 'a"b', "o'r", '$(id)', 'a|b']) {
      const { r } = render(bad);
      assert.equal(r.status, 1, `"${bad}" must be refused`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---- compose -------------------------------------------------------------------------

function renderCompose(kind, extraEnv = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), `compose-${kind}-`));
  try {
    const sub = kind === 'self-hosted' ? 'docker/self-hosted' : 'docker/production';
    mkdirSync(path.join(dir, sub), { recursive: true });
    const composeName = kind === 'self-hosted' ? 'docker-compose.self-hosted.yml' : 'docker-compose.production.yml';
    writeFileSync(path.join(dir, sub, composeName), read(`${sub}/${composeName}`));
    const envName = kind === 'self-hosted' ? '.env.self-hosted' : '.env.production';
    const exampleName = kind === 'self-hosted' ? '.env.self-hosted.example' : '.env.production.example';
    let env = read(`${sub}/${exampleName}`);
    // the required values a real env file has (secrets are not rendered by `config`, but must exist)
    env += `\nDB_PASSWORD=x\nDB_ROOT_PASSWORD=y\nRABBITMQ_PASSWORD=z\nVITE_API_BASE_URL=https://talk.example.com/api/v1\n`;
    writeFileSync(path.join(dir, sub, envName), env);
    if (kind === 'self-hosted') writeFileSync(path.join(dir, sub, 'widget-config.js'), '');
    const r = spawnSync('docker', ['compose', '-f', path.join(dir, sub, composeName), '--env-file', path.join(dir, sub, envName), 'config', '--format', 'json'], {
      encoding: 'utf8',
      env: { ...process.env, ...extraEnv },
    });
    assert.equal(r.status, 0, r.stderr);
    return JSON.parse(r.stdout);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('self-hosted compose renders: every service rotates its logs; app images are named and versioned', { skip: !dockerAvailable && 'docker compose not available' }, () => {
  const cfg = renderCompose('self-hosted', { SHARPTALK_VERSION: '', SHARPTALK_IMAGE_PREFIX: '' });
  const names = Object.keys(cfg.services).sort();
  assert.deepEqual(names, ['api', 'mysql', 'nginx', 'qdrant', 'rabbitmq', 'redis', 'web', 'widget']);
  for (const [name, svc] of Object.entries(cfg.services)) {
    assert.equal(svc.logging?.driver, 'json-file', `${name}: no log driver set`);
    assert.equal(svc.logging?.options?.['max-size'], '20m', `${name}: no log rotation`);
    assert.equal(svc.logging?.options?.['max-file'], '5', `${name}: no log retention`);
  }
  assert.equal(cfg.services.api.image, 'sharptalk/api:local');
  assert.equal(cfg.services.web.image, 'sharptalk/web:local');
  assert.equal(cfg.services.widget.image, 'sharptalk/widget:local');
  assert.ok(cfg.services.api.build, 'build: stays next to image: so one file serves both delivery modes');
  assert.equal(cfg.services.mysql.image, 'mysql:8.0.44');
  assert.equal(cfg.services.redis.image, 'redis:7.4.9-alpine');
  assert.equal(cfg.services.rabbitmq.image, 'rabbitmq:3.13.7-management-alpine');
  assert.equal(cfg.services.qdrant.image, 'qdrant/qdrant:v1.15.1');
  for (const img of Object.values(cfg.services).map((s) => s.image)) assert.doesNotMatch(img, /:(latest|alpine)$/, `${img} floats`);
  assert.equal(cfg.services.web.build.args.CONSOLE_FRAME_ANCESTORS, '');
  assert.equal(cfg.services.web.build.args.VITE_WIDGET_URL, '');
  assert.equal(cfg.services.web.build.args.NODE_IMAGE, 'node:20.19.0-alpine3.21');
  assert.equal(cfg.services.mysql.ports[0].host_ip, '127.0.0.1', 'MySQL stays loopback-only');
});

test('self-hosted compose: a bundle\'s prefix and version select the images; third-party images can be mirrored', { skip: !dockerAvailable && 'docker compose not available' }, () => {
  const cfg = renderCompose('self-hosted', {
    SHARPTALK_VERSION: '1.4.0',
    SHARPTALK_IMAGE_PREFIX: 'registry.go2joy.vn/sharptalk',
    MYSQL_IMAGE: 'registry.go2joy.vn/mirror/mysql:8.0.44',
    LOG_MAX_SIZE: '50m',
    LOG_MAX_FILE: '10',
  });
  assert.equal(cfg.services.api.image, 'registry.go2joy.vn/sharptalk/api:1.4.0');
  assert.equal(cfg.services.widget.image, 'registry.go2joy.vn/sharptalk/widget:1.4.0');
  assert.equal(cfg.services.mysql.image, 'registry.go2joy.vn/mirror/mysql:8.0.44');
  assert.equal(cfg.services.api.logging.options['max-size'], '50m');
  assert.equal(cfg.services.nginx.logging.options['max-file'], '10');
});

test('self-hosted compose reads the api environment from SHARPTALK_ENV_FILE when set (config outside the bundle)', { skip: !dockerAvailable && 'docker compose not available' }, () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'compose-envfile-'));
  try {
    mkdirSync(path.join(dir, 'docker/self-hosted'), { recursive: true });
    writeFileSync(path.join(dir, 'docker/self-hosted/docker-compose.self-hosted.yml'), read('docker/self-hosted/docker-compose.self-hosted.yml'));
    writeFileSync(path.join(dir, 'docker/self-hosted/widget-config.js'), '');
    const outside = path.join(dir, 'etc-sharptalk.env');
    writeFileSync(outside, `${read('docker/self-hosted/.env.self-hosted.example')}
DB_PASSWORD=x
DB_ROOT_PASSWORD=y
RABBITMQ_PASSWORD=z
MARKER_FROM_OUTSIDE_THE_BUNDLE=yes
`);
    const run = (env) =>
      spawnSync('docker', ['compose', '-f', path.join(dir, 'docker/self-hosted/docker-compose.self-hosted.yml'), '--env-file', outside, 'config', '--format', 'json'], {
        encoding: 'utf8',
        env: { ...process.env, ...env },
      });
    const withVar = run({ SHARPTALK_ENV_FILE: outside });
    assert.equal(withVar.status, 0, withVar.stderr);
    assert.equal(JSON.parse(withVar.stdout).services.api.environment.MARKER_FROM_OUTSIDE_THE_BUNDLE, 'yes');
    // without the variable it falls back to the file next to the compose file (absent here)
    const without = run({ SHARPTALK_ENV_FILE: '' });
    assert.notEqual(without.status, 0, 'no file next to the compose file: compose must complain, not guess');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('production compose renders and rotates the logs of every service', { skip: !dockerAvailable && 'docker compose not available' }, () => {
  const cfg = renderCompose('production');
  assert.equal(Object.keys(cfg.services).length, 8);
  for (const [name, svc] of Object.entries(cfg.services)) {
    assert.equal(svc.logging?.driver, 'json-file', `${name}: no log driver set`);
    assert.equal(svc.logging?.options?.['max-size'], '20m', `${name}: no log rotation`);
  }
});

// ---- schedulers ----------------------------------------------------------------------

test('systemd units and the cron file are well-formed and point at the scripts that exist', () => {
  const ops = 'docker/self-hosted/ops';
  const backupSvc = read(`${ops}/sharptalk-backup.service`);
  const drillSvc = read(`${ops}/sharptalk-restore-drill.service`);
  for (const [svc, script] of [[backupSvc, 'backup-self-hosted.sh'], [drillSvc, 'restore-drill-self-hosted.sh']]) {
    assert.match(svc, /^\[Unit\]$/m);
    assert.match(svc, /^\[Service\]$/m);
    assert.match(svc, /^Type=oneshot$/m);
    assert.match(svc, /^EnvironmentFile=\/etc\/sharptalk\/backup\.env$/m);
    assert.match(svc, new RegExp(`^ExecStart=/usr/bin/bash scripts/${script.replace(/\./g, '\\.')}`, 'm'));
    assert.ok(readFileSync(path.join(REPO, 'scripts', script)).length > 0, `scripts/${script} must exist`);
  }
  assert.match(drillSvc, /--latest \$\{BACKUP_ROOT\}/);
  for (const t of ['sharptalk-backup.timer', 'sharptalk-restore-drill.timer']) {
    const text = read(`${ops}/${t}`);
    assert.match(text, /^\[Timer\]$/m);
    assert.match(text, /^OnCalendar=.+UTC$/m, 'times are explicit about the time zone');
    assert.match(text, /^Persistent=true$/m, 'a run missed while the host was off is made up');
    assert.match(text, /^WantedBy=timers\.target$/m);
  }
  assert.match(read(`${ops}/sharptalk-backup.timer`), /^OnCalendar=\*-\*-\* 02:30:00 UTC$/m);
  assert.match(read(`${ops}/sharptalk-restore-drill.timer`), /^OnCalendar=\*-01,04,07,10-01 03:30:00 UTC$/m);

  const cron = read(`${ops}/sharptalk-backup.cron`);
  const jobs = cron.split('\n').filter((l) => /^\d/.test(l));
  assert.equal(jobs.length, 2);
  for (const job of jobs) {
    const fields = job.split(/\s+/);
    assert.ok(fields.length > 7, `cron.d lines need five time fields and a user: ${job}`);
    assert.equal(fields[5], 'sharptalk');
    assert.match(job, /backup\.env/);
  }
  assert.match(cron, /backup-self-hosted\.sh/);
  assert.match(cron, /restore-drill-self-hosted\.sh --latest "\$BACKUP_ROOT"/);

  const envExample = read(`${ops}/backup.env.example`);
  for (const k of ['BACKUP_ROOT', 'BACKUP_ENCRYPT_KEY_FILE', 'BACKUP_KEEP_DAYS', 'BACKUP_QDRANT']) assert.match(envExample, new RegExp(`^${k}=`, 'm'));
});

// ---- shell syntax ----------------------------------------------------------------------

test('every shell script parses (bash -n)', () => {
  const scripts = [];
  const walk = (rel) => {
    for (const e of readdirSync(path.join(REPO, rel), { withFileTypes: true })) {
      const r = `${rel}/${e.name}`;
      if (e.isDirectory()) {
        if (e.name !== '__tests__' && e.name !== 'node_modules') walk(r);
      } else if (e.name.endsWith('.sh')) scripts.push(r);
    }
  };
  walk('scripts');
  walk('docker/self-hosted');
  for (const f of ['docker/production/deploy-production.sh', 'docker/staging/deploy-staging.sh']) scripts.push(f);
  assert.ok(scripts.length >= 15, `expected the hosting scripts, found ${scripts.length}`);
  for (const rel of scripts) {
    const r = spawnSync('bash', ['-n'], { input: read(rel), encoding: 'utf8' });
    assert.equal(r.status, 0, `${rel}: ${r.stderr}`);
  }
});

test('the sandbox harness itself starts from a repository without CR line endings in the copied scripts', () => {
  const sb = new Sandbox({ realSql: false });
  try {
    for (const f of ['scripts/deploy-self-hosted.sh', 'scripts/lib/migrations.sh', 'docker/self-hosted/build-steps/render-frame-ancestors.sh']) {
      assert.doesNotMatch(sb.read(f), /\r/, `${f} still has CRs`);
    }
    copyFileSync(path.join(sb.root, 'scripts/lib/migrations.sh'), path.join(sb.root, 'scripts/lib/migrations.copy'));
  } finally {
    sb.cleanup();
  }
});

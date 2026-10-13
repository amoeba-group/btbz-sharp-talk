// PLN-261012 SG-80: scripts/build-release-bundle.sh. The real build (docker build/save, minutes,
// internet) is NOT run here and was not run at all for this change — these tests run the script
// against a fake docker: --dry-run must print every step without running any, and a fake-docker
// build must assemble a bundle whose checksums, manifest and migration list are correct and
// which the deploy script then accepts.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { REPO, Sandbox } from './helpers/sandbox.mjs';

const SCRIPT = 'scripts/build-release-bundle.sh';

function sandbox() {
  const sb = new Sandbox({ realSql: true });
  // the bundle script copies init-sql and the Dockerfiles (Dockerfiles come with docker/self-hosted)
  sb.write('docker/init-sql/01-schema.sql', readFileSync(path.join(REPO, 'docker/init-sql/01-schema.sql'), 'utf8').replace(/\r\n/g, '\n'));
  return sb;
}

test('--dry-run prints the whole plan and executes none of it', () => {
  const sb = sandbox();
  try {
    const r = sb.run(SCRIPT, ['--version', '1.4.0', '--dry-run']);
    assert.equal(r.status, 0, r.out);
    assert.match(r.out, /DRY RUN — nothing below is executed or written/);
    assert.match(r.out, /\[dry-run\] docker manifest inspect node:20\.19\.0-alpine3\.21/);
    for (const svc of ['api', 'web', 'widget']) {
      assert.match(r.out, new RegExp(`\\[dry-run\\] docker build -f docker/self-hosted/Dockerfile\\.${svc} .*-t sharptalk/${svc}:1\\.4\\.0 -t sharptalk/${svc}:sha-`));
      assert.match(r.out, new RegExp(`\\[dry-run\\] docker save -o dist/releases/sharptalk-1\\.4\\.0/images/app-${svc}\\.tar sharptalk/${svc}:1\\.4\\.0`));
    }
    assert.match(r.out, /--build-arg NODE_IMAGE=node:20\.19\.0-alpine3\.21/);
    assert.match(r.out, /--build-arg VITE_API_BASE_URL=\/api\/v1/);
    for (const img of ['mysql:8.0.44', 'redis:7.4.9-alpine', 'rabbitmq:3.13.7-management-alpine', 'qdrant/qdrant:v1.15.1', 'nginx:1.27.5-alpine']) {
      assert.match(r.out, new RegExp(`\\[dry-run\\] docker pull ${img.replace(/[.]/g, '\\.')}`));
      assert.match(r.out, new RegExp(`docker save -o .*3p-.*${img.split(':')[0].split('/').pop()}`));
    }
    assert.match(r.out, /103 migration file\(s\)|\d+ migration file\(s\)/);
    assert.deepEqual(sb.calls(), [], 'a dry run must not call docker at all');
    assert.equal(sb.exists('dist'), false);
  } finally {
    sb.cleanup();
  }
});

test('input validation: version tag, image prefix, host, api base', () => {
  const sb = sandbox();
  try {
    assert.equal(sb.run(SCRIPT, ['--dry-run']).status, 2);
    assert.equal(sb.run(SCRIPT, ['--version', 'bad tag', '--dry-run']).status, 2);
    assert.equal(sb.run(SCRIPT, ['--version', '-x', '--dry-run']).status, 2);
    assert.equal(sb.run(SCRIPT, ['--version', '1.0', '--image-prefix', 'Bad Prefix', '--dry-run']).status, 2);
    assert.equal(sb.run(SCRIPT, ['--version', '1.0', '--manual-host', 'a b', '--dry-run']).status, 2);
    assert.equal(sb.run(SCRIPT, ['--version', '1.0', '--api-base', 'ftp://x', '--dry-run']).status, 2);
    assert.equal(sb.run(SCRIPT, ['--version', '1.0', '--bogus']).status, 2);
  } finally {
    sb.cleanup();
  }
});

test('options reach the build: prefix, api base, base-image overrides, skip-third-party', () => {
  const sb = sandbox();
  try {
    const r = sb.run(SCRIPT, [
      '--version', '2.0.0', '--image-prefix', 'registry.go2joy.vn/sharptalk', '--api-base', 'https://talk.go2joy.vn/api/v1',
      '--node-image', 'mirror.go2joy.vn/node:20', '--nginx-image', 'mirror.go2joy.vn/nginx:1', '--manual-host', 'talk.go2joy.vn',
      '--frame-ancestors', 'https://portal.go2joy.vn', '--skip-third-party', '--dry-run',
    ]);
    assert.equal(r.status, 0, r.out);
    assert.match(r.out, /-t registry\.go2joy\.vn\/sharptalk\/api:2\.0\.0/);
    assert.match(r.out, /--build-arg NODE_IMAGE=mirror\.go2joy\.vn\/node:20/);
    assert.match(r.out, /--build-arg NGINX_IMAGE=mirror\.go2joy\.vn\/nginx:1/);
    assert.match(r.out, /--build-arg VITE_API_BASE_URL=https:\/\/talk\.go2joy\.vn\/api\/v1/);
    assert.match(r.out, /--build-arg MANUAL_HOST=talk\.go2joy\.vn/);
    assert.match(r.out, /--build-arg CONSOLE_FRAME_ANCESTORS=https:\/\/portal\.go2joy\.vn/);
    assert.doesNotMatch(r.out, /docker pull/);
    assert.doesNotMatch(r.out, /3p-/);
  } finally {
    sb.cleanup();
  }
});

test('a fake-docker build assembles a complete, self-consistent bundle', () => {
  const sb = sandbox();
  try {
    const r = sb.run(SCRIPT, ['--version', '1.4.0', '--allow-dirty', '--out', 'out']);
    assert.equal(r.status, 0, r.out);
    const bundle = path.join(sb.root, 'out', 'sharptalk-1.4.0');

    assert.equal(readFileSync(path.join(bundle, 'VERSION'), 'utf8').trim(), '1.4.0');
    const top = readdirSync(bundle).sort();
    for (const f of ['README.md', 'SHA256SUMS', 'VERSION', 'build.env', 'docker', 'images', 'manifest.json', 'migrations.tsv', 'release-order.txt', 'scripts', 'sql']) {
      assert.ok(top.includes(f), `${f} missing from the bundle`);
    }
    const images = readdirSync(path.join(bundle, 'images')).sort();
    assert.ok(images.includes('app-api.tar') && images.includes('app-web.tar') && images.includes('app-widget.tar'));
    assert.equal(images.filter((i) => i.startsWith('3p-')).length, 5);

    // the operator-facing scripts and the first-boot schema ride along
    for (const f of ['deploy-self-hosted.sh', 'rollback-self-hosted.sh', 'backup-self-hosted.sh', 'restore-self-hosted.sh', 'restore-drill-self-hosted.sh', 'check-migrations.sh', 'lib/migrations.sh', 'lib/backup-common.sh', 'lib/qdrant-snapshot.mjs']) {
      assert.ok(readdirSync(path.join(bundle, 'scripts'), { recursive: true }).map((x) => String(x).replace(/\\/g, '/')).includes(f), `scripts/${f} missing`);
    }
    assert.ok(readdirSync(path.join(bundle, 'docker', 'init-sql')).includes('01-schema.sql'));
    assert.ok(readdirSync(path.join(bundle, 'docker', 'self-hosted', 'ops')).includes('sharptalk-backup.timer'));

    // SHA256SUMS covers every file but itself and verifies
    const sums = spawnSync('sha256sum', ['-c', 'SHA256SUMS'], { cwd: bundle, encoding: 'utf8' });
    assert.equal(sums.status, 0, sums.stderr + sums.stdout);
    const listed = readFileSync(path.join(bundle, 'SHA256SUMS'), 'utf8').trim().split('\n').map((l) => l.split(/\s+/)[1].replace(/^\*/, '')); // sha256sum marks binary mode with a leading "*" on Windows
    assert.ok(listed.includes('manifest.json') && listed.includes('images/app-api.tar') && listed.includes('VERSION'));
    assert.ok(!listed.includes('SHA256SUMS'));

    // manifest.json is valid JSON and agrees with the files
    const manifest = JSON.parse(readFileSync(path.join(bundle, 'manifest.json'), 'utf8'));
    assert.equal(manifest.version, '1.4.0');
    assert.equal(typeof manifest.dirty, 'boolean');
    assert.equal(manifest.build.api_base, '/api/v1');
    assert.equal(manifest.build.image_prefix, 'sharptalk');
    assert.equal(manifest.images.length, images.length);
    const sqlFiles = readdirSync(path.join(REPO, 'sql')).filter((f) => f.endsWith('.sql'));
    assert.equal(manifest.migrations.length, sqlFiles.length);
    assert.ok(manifest.migrations.every((m) => ['additive', 'additive-data', 'data', 'breaking', 'destructive', 'unknown'].includes(m.class)));

    // migrations.tsv and release-order.txt are the same list, in the same order
    const tsv = readFileSync(path.join(bundle, 'migrations.tsv'), 'utf8').trim().split('\n').map((l) => l.split('\t'));
    const order = readFileSync(path.join(bundle, 'release-order.txt'), 'utf8').trim().split('\n');
    assert.deepEqual(tsv.map((r) => r[0]), order);
    assert.equal(tsv.length, sqlFiles.length);

    // the build used the pinned images and the domain-agnostic API base
    const build = readFileSync(path.join(bundle, 'build.env'), 'utf8');
    assert.match(build, /^VITE_API_BASE_URL=\/api\/v1$/m);
    assert.match(build, /^NODE_IMAGE=node:20\.19\.0-alpine3\.21$/m);
    assert.ok(sb.calls().some((c) => /build -f docker\/self-hosted\/Dockerfile\.api .*-t sharptalk\/api:1\.4\.0/.test(c)));
    assert.ok(sb.calls().some((c) => /manifest inspect node:20\.19\.0-alpine3\.21/.test(c)));
  } finally {
    sb.cleanup();
  }
});

test('the bundle it builds is accepted by deploy-self-hosted.sh --bundle (checksums, version, image tags)', () => {
  const sb = sandbox();
  try {
    assert.equal(sb.run(SCRIPT, ['--version', '1.4.0', '--allow-dirty', '--out', 'out']).status, 0);
    const bundleRel = 'out/sharptalk-1.4.0';
    // the deploy script is run from INSIDE the bundle, exactly as the README says
    const inner = new Sandbox({ realSql: false });
    try {
      // lay the bundle over a fresh sandbox root so REPO_ROOT == bundle root
      spawnSync('cp', ['-r', `${sb.root}/${bundleRel}/.`, inner.root]);
      inner.writeEnv({ VITE_API_BASE_URL: 'https://talk.example.com/api/v1' });
      const r = inner.run('scripts/deploy-self-hosted.sh', ['--bundle', '.', '--dry-run']);
      assert.equal(r.status, 0, r.out);
      assert.match(r.out, /version : 1\.4\.0/);
      assert.match(r.out, /images\/app-api\.tar: OK/);
      assert.match(r.out, /\[dry-run\] docker load -i .*3p-mysql_8\.0\.44\.tar/);
    } finally {
      inner.cleanup();
    }
  } finally {
    sb.cleanup();
  }
});

// Shared test harness for the hosting scripts (PLN-261012 SG-80/81).
//
// The scripts are meant to run on a customer's Linux host against a real Docker. Tests
// run them in a SANDBOX instead: a temp directory laid out like a release (scripts/,
// sql/, docker/self-hosted/ …) with CR stripped from every script (a Windows checkout
// is CRLF; bash would choke on it) and a fake `docker` / `curl` / `sleep` first on PATH.
//
// The fake docker never starts anything. It records every call, answers the handful of
// read-only questions the scripts ask (what is running, is it healthy, what does the
// schema look like), and keeps a tiny state directory so `compose up -d mysql` makes the
// next `docker ps` list the database. Tests then assert on exit codes, on the output, and
// — most importantly — on WHICH docker calls were made and in what ORDER.
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

const stripCr = (text) => text.replace(/\r\n/g, '\n');

function copyTreeLf(from, to, filter = () => true) {
  mkdirSync(to, { recursive: true });
  for (const entry of readdirSync(from, { withFileTypes: true })) {
    const src = path.join(from, entry.name);
    const dst = path.join(to, entry.name);
    if (!filter(src, entry)) continue;
    if (entry.isDirectory()) copyTreeLf(src, dst, filter);
    else if (/\.(sh|mjs|yml|yaml|tsv|sql|conf|service|timer|cron|example|md|txt|json)$/i.test(entry.name) || entry.name.startsWith('.env')) {
      writeFileSync(dst, stripCr(readFileSync(src, 'utf8')));
    } else copyFileSync(src, dst);
  }
}

const FAKE_DOCKER = `#!/usr/bin/env bash
# Fake docker for script tests. Records every call; answers read-only questions.
S="\${FAKE_DOCKER_STATE:?}"
mkdir -p "$S"
printf '%s\\n' "VER=\${SHARPTALK_VERSION:-} :: $*" >> "$S/calls.log"
touch "$S/ps"

case "$1" in
  ps)
    # running containers = state file + FAKE_DOCKER_PS (space separated)
    cat "$S/ps"
    for n in \${FAKE_DOCKER_PS:-}; do echo "$n"; done
    ;;
  inspect)
    case "$*" in
      *Health.Status*) echo "\${FAKE_HEALTH:-healthy}" ;;
      *Mounts*) echo "\${FAKE_VOLUME:-fake_uploads_volume}" ;;
      *Config.Image*)
        if [ -f "$S/image_of_$(printf '%s' "$*" | awk '{print $NF}')" ]; then cat "$S/image_of_$(printf '%s' "$*" | awk '{print $NF}')"; else echo "\${FAKE_IMAGE:-}"; fi ;;
    esac
    ;;
  compose)
    echo "\${SHARPTALK_ENV_FILE:-}" >> "$S/envfile.log"
    case "$*" in
      *"up -d mysql"*) echo sharptalk_mysql >> "$S/ps" ;;
      *"up -d --build"*|*"up -d --no-build"*) echo sharptalk_mysql >> "$S/ps"; echo sharptalk_api >> "$S/ps"
        # what a real compose would leave running: the api container on the requested image
        echo "\${SHARPTALK_IMAGE_PREFIX:-sharptalk}/api:\${SHARPTALK_VERSION:-local}" > "$S/image_of_sharptalk_api" ;;
    esac
    [ -n "\${FAKE_COMPOSE_FAIL:-}" ] && case "$*" in *"\${FAKE_COMPOSE_FAIL}"*) exit 1 ;; esac
    exit 0
    ;;
  logs) echo "[Nest] Nest application successfully started" ;;
  image)
    case "$2" in
      inspect)
        # FAKE_IMAGES_PRESENT = space separated image refs that exist; unset = all exist
        if [ -z "\${FAKE_IMAGES_PRESENT+x}" ]; then exit 0; fi
        for i in \${FAKE_IMAGES_PRESENT}; do [ "$i" = "$3" ] && exit 0; done
        exit 1 ;;
    esac
    ;;
  save)
    # docker save -o <file> <image…>
    out=""; while [ $# -gt 0 ]; do [ "$1" = "-o" ] && out="$2"; shift; done
    [ -n "$out" ] && printf 'fake image tar for %s\\n' "$out" > "$out"
    ;;
  exec)
    all="$*"
    case "$all" in
      *"information_schema.COLUMNS"*) grep -E "^column$(printf '\\t')" "\${FAKE_SCHEMA:-/dev/null}" || true ;;
      *"information_schema.STATISTICS"*) grep -E "^index$(printf '\\t')" "\${FAKE_SCHEMA:-/dev/null}" || true ;;
      *"information_schema.TABLES"*) grep -E "^table$(printf '\\t')" "\${FAKE_SCHEMA:-/dev/null}" || true ;;
      *mysqldump*)
        [ -n "\${FAKE_DUMP_FAIL:-}" ] && exit 1
        echo "-- fake mysqldump"; echo "CREATE TABLE t (id int);" ;;
      *"COUNT(*) FROM message_attachments"*) echo "\${FAKE_ATTACH_ROWS:-2}" ;;
      *"find /data/uploads"*) echo "\${FAKE_UPLOAD_FILES:-3}" ;;
      *"tar czf"*) printf 'uploads-bytes' | gzip ;;
      *"QDRANT_URL"*) echo "\${FAKE_QDRANT_URL:-http://qdrant:6333}" ;;
      *"node --input-type=module"*)
        case "$all" in
          *" backup "*) [ -n "\${FAKE_QDRANT_FAIL:-}" ] && exit 1
                       echo "QDRANT_COLLECTION kb_documents points=12 bytes=100"
                       echo "QDRANT_COLLECTION reuse_questions points=3 bytes=50" ;;
          *" restore "*) echo "QDRANT_COLLECTION kb_documents points=12 bytes=100" ;;
        esac ;;
      *"tar cf -"*) printf 'qdrant-tar-bytes' ;;
      *) : ;;
    esac
    # SQL on stdin (table counts) – only when asked
    if [ -t 0 ]; then :; else
      input="$(cat || true)"
      case "$input" in *"FROM tenants UNION ALL"*) printf 'tenants\\t1\\nusers\\t2\\nsessions\\t3\\nconversations\\t4\\nmessages\\t5\\nkb_documents\\t6\\n' ;; esac
    fi
    ;;
  *) : ;;
esac
exit 0
`;

const FAKE_CURL = `#!/usr/bin/env bash
printf '%s\\n' "curl $*" >> "\${FAKE_DOCKER_STATE:-/tmp}/calls.log"
case "$*" in
  *"/auth/me"*) echo "\${FAKE_AUTH_ME_CODE:-401}" ;;
  *"-w"*) echo "\${FAKE_HTTP_CODE:-200}" ;;
  *) echo '{"success":true,"data":{"status":"ok","db":"up"}}' ;;
esac
exit 0
`;

export class Sandbox {
  constructor({ realSql = true } = {}) {
    this.root = mkdtempSync(path.join(tmpdir(), 'sharptalk-sb-'));
    this.state = path.join(this.root, '.fake-docker-state');
    this.bin = path.join(this.root, '.fake-bin');
    mkdirSync(this.state, { recursive: true });
    mkdirSync(this.bin, { recursive: true });
    for (const [name, body] of [['docker', FAKE_DOCKER], ['curl', FAKE_CURL], ['sleep', '#!/usr/bin/env bash\nexit 0\n']]) {
      writeFileSync(path.join(this.bin, name), body);
      chmodSync(path.join(this.bin, name), 0o755);
    }
    copyTreeLf(path.join(REPO, 'scripts'), path.join(this.root, 'scripts'), (src, entry) => entry.name !== '__tests__');
    copyTreeLf(path.join(REPO, 'docker', 'self-hosted'), path.join(this.root, 'docker', 'self-hosted'));
    if (realSql) copyTreeLf(path.join(REPO, 'sql'), path.join(this.root, 'sql'));
    else mkdirSync(path.join(this.root, 'sql'), { recursive: true });
    mkdirSync(path.join(this.root, 'docker', 'init-sql'), { recursive: true });
  }

  /** Write a file (LF) relative to the sandbox root. */
  write(rel, content, mode) {
    const p = path.join(this.root, rel);
    mkdirSync(path.dirname(p), { recursive: true });
    writeFileSync(p, content);
    if (mode) chmodSync(p, mode);
    return p;
  }

  read(rel) {
    return readFileSync(path.join(this.root, rel), 'utf8');
  }

  exists(rel) {
    return existsSync(path.join(this.root, rel));
  }

  /** A complete, valid env file (what `cp .env.self-hosted.example` + gen-secrets would give). */
  writeEnv(overrides = {}) {
    const base = {
      NODE_ENV: 'production',
      UPLOAD_DIR: '/data/uploads',
      JWT_ACCESS_SECRET: 'a'.repeat(40),
      JWT_REFRESH_SECRET: 'b'.repeat(40),
      CRED_ENC_KEY: 'c'.repeat(44),
      DB_PASSWORD: 'dbpass',
      DB_ROOT_PASSWORD: 'rootpass',
      DB_NAME: 'db_sharptalk',
      DB_USER: 'sharptalk',
      RABBITMQ_USER: 'sharptalk',
      RABBITMQ_PASSWORD: 'rabbitpass',
      APP_PUBLIC_URL: 'https://talk.example.com',
      VITE_API_BASE_URL: 'https://talk.example.com/api/v1',
      HTTP_PORT: '8080',
      SEED_ON_BOOT: 'false',
      ALERT_EMAIL_TO: 'ops@example.com',
    };
    const merged = { ...base, ...overrides };
    const text = Object.entries(merged)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => `${k}=${v}`)
      .join('\n');
    this.write('docker/self-hosted/.env.self-hosted', `${text}\n`);
  }

  /** Replace sql/ with a tiny fixture: files = { 'name.sql': 'ALTER …' }, plus its manifest rows. */
  setSqlFixture(files, manifestRows) {
    rmSync(path.join(this.root, 'sql'), { recursive: true, force: true });
    mkdirSync(path.join(this.root, 'sql'), { recursive: true });
    for (const [name, body] of Object.entries(files)) this.write(`sql/${name}`, body);
    this.write('sql/artefacts.tsv', `# file\tkind\ttable\tname\n${manifestRows.join('\n')}\n`);
  }

  /** What the fake database "contains": lines like "column\ttenants\tslug". */
  setSchema(lines) {
    return this.write('.schema.tsv', `${lines.join('\n')}\n`);
  }

  run(script, args = [], env = {}, opts = {}) {
    const result = spawnSync('bash', [script, ...args], {
      cwd: this.root,
      encoding: 'utf8',
      input: opts.input,
      timeout: opts.timeout ?? 120000,
      env: {
        ...process.env,
        PATH: `${this.bin}${path.delimiter}${process.env.PATH}`,
        FAKE_DOCKER_STATE: this.state,
        MSYS_NO_PATHCONV: '1',
        // The key file permission check cannot be satisfied on a filesystem without Unix modes.
        ...(process.platform === 'win32' ? { BACKUP_SKIP_KEY_PERMS_CHECK: '1' } : {}),
        ...env,
      },
    });
    return {
      status: result.status,
      stdout: result.stdout ?? '',
      stderr: result.stderr ?? '',
      out: `${result.stdout ?? ''}${result.stderr ?? ''}`,
    };
  }

  /** Every recorded docker/curl call, in order, as plain strings. */
  calls() {
    const p = path.join(this.state, 'calls.log');
    return existsSync(p) ? readFileSync(p, 'utf8').split('\n').filter(Boolean) : [];
  }

  /** SHARPTALK_ENV_FILE as each `docker compose` call saw it. */
  composeEnvFiles() {
    const p = path.join(this.state, 'envfile.log');
    return existsSync(p) ? readFileSync(p, 'utf8').split('\n').filter(Boolean) : [];
  }

  dockerCalls() {
    return this.calls().filter((c) => !c.startsWith('curl '));
  }

  clearCalls() {
    rmSync(path.join(this.state, 'calls.log'), { force: true });
  }

  /** Index of the first recorded call matching `re`, or -1. */
  firstCall(re) {
    return this.calls().findIndex((c) => re.test(c));
  }

  cleanup() {
    rmSync(this.root, { recursive: true, force: true });
  }
}

export function fileExists(p) {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
}

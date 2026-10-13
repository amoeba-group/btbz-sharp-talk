#!/usr/bin/env bash
# SharpTalk — build a RELEASE BUNDLE for a customer's own infrastructure (PLN-261012 SG-80).
#
#   bash scripts/build-release-bundle.sh --version 1.4.0                 # build everything
#   bash scripts/build-release-bundle.sh --version 1.4.0 --dry-run       # print every step, run none
#
# Run it on a BUILD machine (Docker + internet + a clean checkout of the commit to ship),
# never on the customer's host. The result is a directory the customer copies over and
# deploys with no registry, no internet and no build:
#
#   <out>/sharptalk-<version>/
#     VERSION  README.md  manifest.json  build.env  SHA256SUMS
#     images/*.tar            api, web, widget (built here) + mysql, redis, rabbitmq, qdrant, nginx
#     scripts/                deploy / rollback / backup / restore / restore-drill / check-migrations / gen-secrets
#     sql/  release-order.txt  migrations.tsv      schema changes, in RELEASE order, classified
#     docker/self-hosted/     compose, nginx.conf, env example, ops/ (cron + systemd), Dockerfiles
#     docker/init-sql/        first-boot schema
#
# On the customer host:   cd sharptalk-<version> && bash scripts/deploy-self-hosted.sh --bundle .
# (README.md in the bundle says it step by step.)
#
# Options
#   --version V            required; [A-Za-z0-9._-], becomes the image tag
#   --out DIR              where the bundle directory is created (default dist/releases)
#   --image-prefix P       image name prefix (default sharptalk) — must match the customer's
#                          SHARPTALK_IMAGE_PREFIX if they set one
#   --api-base URL         VITE_API_BASE_URL baked into the console/widget. DEFAULT /api/v1: a
#                          same-origin relative base, so ONE bundle serves any domain. Give an
#                          absolute URL only for a deployment whose console and API differ in
#                          origin; deploy-self-hosted.sh then refuses a mismatching env file.
#   --manual-host H        host cited by the bundled manuals (default talk.example.com)
#   --frame-ancestors "…"  extra origins allowed to frame the console (default none)
#   --node-image / --nginx-image   override the pinned base images (private mirror)
#   --skip-third-party     do not pull/save mysql, redis, rabbitmq, qdrant, nginx
#   --allow-dirty          build from a working tree with uncommitted changes (NOT for releases)
#   --dry-run              print every action, run none
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"
# shellcheck source=lib/migrations.sh
. "$SCRIPT_DIR/lib/migrations.sh"

version=""
out_dir="dist/releases"
image_prefix="${SHARPTALK_IMAGE_PREFIX:-sharptalk}"
api_base="/api/v1"
manual_host="talk.example.com"
frame_ancestors=""
node_image=""
nginx_image=""
third_party=true
allow_dirty=false
dry_run=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --version) version="${2:-}"; shift ;;
    --out) out_dir="${2:-}"; shift ;;
    --image-prefix) image_prefix="${2:-}"; shift ;;
    --api-base) api_base="${2:-}"; shift ;;
    --manual-host) manual_host="${2:-}"; shift ;;
    --frame-ancestors) frame_ancestors="${2:-}"; shift ;;
    --node-image) node_image="${2:-}"; shift ;;
    --nginx-image) nginx_image="${2:-}"; shift ;;
    --skip-third-party) third_party=false ;;
    --allow-dirty) allow_dirty=true ;;
    --dry-run) dry_run=true ;;
    -h|--help) awk 'NR > 1 && /^#/ { sub(/^# ?/, ""); print; next } NR > 1 { exit }' "$0"; exit 0 ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
  shift
done

# ---- validate ---------------------------------------------------------------------
[[ -n "$version" ]] || { echo "ERROR: --version is required (e.g. --version 1.4.0)" >&2; exit 2; }
[[ "$version" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$ ]] || { echo "ERROR: --version '$version' is not a valid image tag" >&2; exit 2; }
[[ "$image_prefix" =~ ^[a-z0-9][a-z0-9._/-]*$ ]] || { echo "ERROR: --image-prefix '$image_prefix' is not a valid image name prefix" >&2; exit 2; }
[[ "$manual_host" =~ ^[A-Za-z0-9.-]+$ ]] || { echo "ERROR: --manual-host must be a bare host name" >&2; exit 2; }
[[ -z "$api_base" || "$api_base" =~ ^(/|https?://) ]] || { echo "ERROR: --api-base must be a path (/api/v1) or an http(s) URL" >&2; exit 2; }

dockerfile_default() { # <Dockerfile> <ARG name>
  sed -n "s/^ARG $2=\(.*\)$/\1/p" "$1" | head -1 | tr -d '\r'
}
[[ -n "$node_image" ]] || node_image="$(dockerfile_default docker/self-hosted/Dockerfile.api NODE_IMAGE)"
[[ -n "$nginx_image" ]] || nginx_image="$(dockerfile_default docker/self-hosted/Dockerfile.web NGINX_IMAGE)"
[[ -n "$node_image" && -n "$nginx_image" ]] || { echo "ERROR: could not read the pinned base images from the Dockerfiles" >&2; exit 1; }

git_sha_full="$(git rev-parse HEAD 2>/dev/null || echo unknown)"
git_sha="$(git rev-parse --short=10 HEAD 2>/dev/null || echo unknown)"
dirty="$(git status --porcelain --untracked-files=no 2>/dev/null | head -1 || true)"
if [[ -n "$dirty" && "$allow_dirty" != true ]]; then
  echo "ERROR: the working tree has uncommitted changes. A release must be reproducible from a commit." >&2
  echo "       Commit (or stash) them, or pass --allow-dirty for a throwaway build." >&2
  exit 1
fi

bundle="$out_dir/sharptalk-$version"
built_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

act() {
  if [[ "$dry_run" == true ]]; then printf '    [dry-run] %s\n' "$*"; else "$@"; fi
}
step() { printf '\n==> %s\n' "$1"; }

# Third-party images come from the compose file's own defaults, so the bundle ships exactly
# what the stack runs: `image: ${MYSQL_IMAGE:-mysql:8.0.44}` -> mysql:8.0.44. A variable set
# in the environment wins, the same precedence compose uses.
third_party_images() {
  local compose="docker/self-hosted/docker-compose.self-hosted.yml" var def val
  while IFS='|' read -r var def; do
    [[ -n "$var" ]] || continue
    val="${!var:-$def}"
    printf '%s\n' "$val"
  done < <(sed -n 's/^[[:space:]]*image:[[:space:]]*\${\([A-Z_]*\):-\([^}]*\)}.*$/\1|\2/p' "$compose" | tr -d '\r' \
            | grep -v '^SHARPTALK_IMAGE_PREFIX|')
}

echo "SharpTalk release bundle"
echo "    version      : $version"
echo "    commit       : $git_sha${dirty:+  (DIRTY working tree — not a release)}"
echo "    image prefix : $image_prefix"
echo "    api base     : ${api_base:-<empty>}"
echo "    base images  : $node_image · $nginx_image"
echo "    output       : $bundle"
[[ "$dry_run" == true ]] && echo "DRY RUN — nothing below is executed or written."

# ---- 1. base images exist ---------------------------------------------------------
step "Checking the pinned base images exist (a wrong tag fails here, not an hour into a build)"
for img in "$node_image" "$nginx_image"; do
  if [[ "$dry_run" == true ]]; then
    echo "    [dry-run] docker manifest inspect $img"
  elif docker manifest inspect "$img" >/dev/null 2>&1; then
    echo "    found  $img"
  else
    echo "ERROR: base image '$img' was not found in its registry (wrong tag?). Pass --node-image/--nginx-image," >&2
    echo "       or fix the ARG in docker/self-hosted/Dockerfile.*." >&2
    exit 1
  fi
done

# ---- 2. build ---------------------------------------------------------------------
step "Building the application images (npm ci, pinned bases)"
labels=(--label "org.opencontainers.image.version=$version" --label "org.opencontainers.image.revision=$git_sha_full")
common=(--build-arg "NODE_IMAGE=$node_image")
act docker build -f docker/self-hosted/Dockerfile.api "${common[@]}" "${labels[@]}" \
  -t "$image_prefix/api:$version" -t "$image_prefix/api:sha-$git_sha" .
act docker build -f docker/self-hosted/Dockerfile.web "${common[@]}" --build-arg "NGINX_IMAGE=$nginx_image" \
  --build-arg "VITE_API_BASE_URL=$api_base" --build-arg "VITE_WIDGET_URL=" \
  --build-arg "MANUAL_HOST=$manual_host" --build-arg "CONSOLE_FRAME_ANCESTORS=$frame_ancestors" "${labels[@]}" \
  -t "$image_prefix/web:$version" -t "$image_prefix/web:sha-$git_sha" .
act docker build -f docker/self-hosted/Dockerfile.widget "${common[@]}" --build-arg "NGINX_IMAGE=$nginx_image" \
  --build-arg "VITE_API_BASE_URL=$api_base" --build-arg "VITE_BASE=/widget/" "${labels[@]}" \
  -t "$image_prefix/widget:$version" -t "$image_prefix/widget:sha-$git_sha" .

# ---- 3. third-party images --------------------------------------------------------
tp_images=()
if [[ "$third_party" == true ]]; then
  step "Pulling the third-party images the stack runs"
  while IFS= read -r img; do [[ -n "$img" ]] && tp_images+=("$img"); done < <(third_party_images)
  tp_images+=("$nginx_image")
  # nginx appears once: the edge uses the same pinned tag as the console/widget runtime.
  mapfile -t tp_images < <(printf '%s\n' "${tp_images[@]}" | sort -u)
  for img in "${tp_images[@]}"; do act docker pull "$img"; done
fi

# ---- 4. assemble ------------------------------------------------------------------
step "Assembling $bundle"
act rm -rf "$bundle"
act mkdir -p "$bundle/images" "$bundle/scripts/lib" "$bundle/sql" "$bundle/docker/self-hosted" "$bundle/docker/init-sql"

fname() { printf '%s' "$1" | tr '/:' '__'; }
act docker save -o "$bundle/images/app-api.tar" "$image_prefix/api:$version" "$image_prefix/api:sha-$git_sha"
act docker save -o "$bundle/images/app-web.tar" "$image_prefix/web:$version" "$image_prefix/web:sha-$git_sha"
act docker save -o "$bundle/images/app-widget.tar" "$image_prefix/widget:$version" "$image_prefix/widget:sha-$git_sha"
for img in "${tp_images[@]:-}"; do
  [[ -n "$img" ]] || continue
  act docker save -o "$bundle/images/3p-$(fname "$img").tar" "$img"
done

# Only what an operator runs — not the monorepo. (The Dockerfiles ride along so an auditor can
# see exactly how the images were built; compose never builds from a bundle.)
for f in deploy-self-hosted.sh rollback-self-hosted.sh backup-self-hosted.sh restore-self-hosted.sh \
         restore-drill-self-hosted.sh check-migrations.sh gen-secrets.sh; do
  act cp "scripts/$f" "$bundle/scripts/$f"
done
act cp scripts/lib/migrations.sh scripts/lib/backup-common.sh scripts/lib/qdrant-snapshot.mjs "$bundle/scripts/lib/"
act cp docker/self-hosted/docker-compose.self-hosted.yml docker/self-hosted/nginx.conf \
  docker/self-hosted/.env.self-hosted.example docker/self-hosted/Dockerfile.api docker/self-hosted/Dockerfile.web \
  docker/self-hosted/Dockerfile.widget docker/self-hosted/nginx.web.conf docker/self-hosted/nginx.widget.conf \
  "$bundle/docker/self-hosted/"
act cp -r docker/self-hosted/ops docker/self-hosted/build-steps "$bundle/docker/self-hosted/"
act cp docker/init-sql/01-schema.sql "$bundle/docker/init-sql/"
act cp -r sql/. "$bundle/sql/"

# ---- 5. migrations: release order + classification --------------------------------
step "Recording the migration list (release order, classified)"
if [[ "$dry_run" == true ]]; then
  echo "    [dry-run] $(migration_release_order sql | wc -l | tr -d '[:space:]') migration file(s) in sql/ would be frozen to release-order.txt and classified into migrations.tsv"
else
  migration_release_order sql > "$bundle/release-order.txt"
  : > "$bundle/migrations.tsv"
  while IFS= read -r f; do
    [[ -f "sql/$f" ]] || continue
    printf '%s\t%s\t%s\n' "$f" "$(migration_class "sql/$f")" "$(migration_has_rollback "sql/$f")" >> "$bundle/migrations.tsv"
  done < "$bundle/release-order.txt"
  echo "    $(wc -l < "$bundle/migrations.tsv" | tr -d '[:space:]') migration(s); blocking classes: $(awk -F'\t' '$2 ~ /^(breaking|destructive|unknown)$/ {n++} END {print n+0}' "$bundle/migrations.tsv")"
fi

# ---- 6. metadata ------------------------------------------------------------------
step "Writing VERSION, build.env, manifest.json, README.md"
if [[ "$dry_run" == true ]]; then
  echo "    [dry-run] VERSION, build.env, manifest.json (version, commit, images with sha256, migrations), README.md"
else
  printf '%s\n' "$version" > "$bundle/VERSION"
  cat > "$bundle/build.env" <<BUILDENV
# What this bundle was built with. deploy-self-hosted.sh reads it.
SHARPTALK_IMAGE_PREFIX=$image_prefix
VITE_API_BASE_URL=$api_base
MANUAL_HOST=$manual_host
CONSOLE_FRAME_ANCESTORS=$frame_ancestors
NODE_IMAGE=$node_image
NGINX_IMAGE=$nginx_image
BUILDENV

  sha_of() { if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | cut -d' ' -f1; else shasum -a 256 "$1" | cut -d' ' -f1; fi; }
  {
    printf '{\n'
    printf '  "version": "%s",\n' "$version"
    printf '  "commit": "%s",\n' "$git_sha_full"
    printf '  "dirty": %s,\n' "$([[ -n "$dirty" ]] && echo true || echo false)"
    printf '  "built_at": "%s",\n' "$built_at"
    printf '  "build": { "image_prefix": "%s", "api_base": "%s", "manual_host": "%s", "node_image": "%s", "nginx_image": "%s" },\n' \
      "$image_prefix" "$api_base" "$manual_host" "$node_image" "$nginx_image"
    printf '  "images": [\n'
    first=true
    for t in "$bundle"/images/*.tar; do
      [[ -f "$t" ]] || continue
      $first || printf ',\n'
      first=false
      printf '    { "file": "images/%s", "bytes": %s, "sha256": "%s" }' "$(basename "$t")" "$(wc -c < "$t" | tr -d '[:space:]')" "$(sha_of "$t")"
    done
    printf '\n  ],\n'
    printf '  "migrations": [\n'
    first=true
    while IFS=$'\t' read -r f klass rb; do
      [[ -n "$f" ]] || continue
      $first || printf ',\n'
      first=false
      printf '    { "file": "%s", "class": "%s", "rollback_documented": %s }' "$f" "$klass" "$([[ "$rb" == yes ]] && echo true || echo false)"
    done < "$bundle/migrations.tsv"
    printf '\n  ]\n}\n'
  } > "$bundle/manifest.json"

  cat > "$bundle/README.md" <<README
# SharpTalk release $version

Commit \`$git_sha\`, built $built_at. Domain-agnostic build: the console and widget use a
same-origin API base (\`${api_base:-<empty>}\`), so this bundle runs behind any host name.

## Install or upgrade

\`\`\`bash
# 1. Verify (also done again by the deploy script)
cd sharptalk-$version && sha256sum -c SHA256SUMS

# 2. Configuration lives OUTSIDE the bundle so it survives upgrades
sudo mkdir -p /etc/sharptalk /var/lib/sharptalk
sudo cp docker/self-hosted/.env.self-hosted.example /etc/sharptalk/.env.self-hosted   # first install only
bash scripts/gen-secrets.sh                      # paste the values into that file
export SHARPTALK_ENV_FILE=/etc/sharptalk/.env.self-hosted
export SHARPTALK_STATE_DIR=/var/lib/sharptalk    # releases.log lives here: a rollback needs it

# 3. Look first, then do
bash scripts/deploy-self-hosted.sh --bundle . --dry-run
bash scripts/deploy-self-hosted.sh --bundle . --pre-backup
\`\`\`

The deploy script stops when schema changes are outstanding, loads the images from \`images/\`
(no registry, no internet), starts the stack and checks what is actually running.

## Roll back

\`\`\`bash
bash scripts/rollback-self-hosted.sh --dry-run   # shows the migrations in between; refuses if one is unsafe
bash scripts/rollback-self-hosted.sh
\`\`\`

## Contents

| Path | What |
|---|---|
| \`images/*.tar\` | application images (\`$image_prefix/{api,web,widget}:$version\`) and the third-party images |
| \`manifest.json\` | version, commit, image checksums, the migration list with its class |
| \`sql/\`, \`release-order.txt\`, \`migrations.tsv\` | schema changes in the order they were released |
| \`docker/self-hosted/ops/\` | cron and systemd timer examples for backups and the restore drill |
README

  # Last, so the list covers every file above (and never itself).
  ( cd "$bundle" && find . -type f ! -name SHA256SUMS | sed 's#^\./##' | LC_ALL=C sort | while IFS= read -r f; do
      if command -v sha256sum >/dev/null 2>&1; then sha256sum "$f"; else shasum -a 256 "$f"; fi
    done > SHA256SUMS )
  echo "    $(wc -l < "$bundle/SHA256SUMS" | tr -d '[:space:]') file(s) listed in SHA256SUMS"
fi

step "Done"
if [[ "$dry_run" == true ]]; then
  echo "    Dry run: nothing was built or written."
else
  echo "    $bundle ready. Copy the directory to the customer host (scp -r / rsync), then:"
  echo "    cd sharptalk-$version && bash scripts/deploy-self-hosted.sh --bundle . --dry-run"
fi

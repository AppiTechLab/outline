#!/usr/bin/env bash
#
# Nightly export of every Outline collection into a GitLab wiki repository.
#
# Triggers collections.export_all, waits for the job, downloads the markdown
# zip, and commits the result to a GitLab wiki repo. The wiki then holds a
# plain-markdown mirror of the whole workspace, versioned, on infrastructure
# that has nothing to do with this VM.
#
# This is a *portability* copy, not a backup. It is not a substitute for
# pg_dump: it has no comments, no revision history, no permissions, and cannot
# be restored into Outline. Its value is that it stays readable if this server
# goes away.
#
# Requires: curl, jq, unzip, git, rsync
#
# Usage:
#   export-to-gitlab-wiki.sh
#
# Configuration comes from environment variables, see below.

set -euo pipefail

# ── Configuration ────────────────────────────────────────────────────────────

: "${OUTLINE_URL:?set OUTLINE_URL, e.g. https://wiki.appitech.hevs.ch}"
: "${OUTLINE_API_TOKEN:?set OUTLINE_API_TOKEN (Settings -> API and Access)}"
: "${WIKI_REPO:?set WIKI_REPO, e.g. https://oauth2:TOKEN@gitlab.com/group/project.wiki.git}"

# Include private collections in the export. Defaults to true — the point is a
# complete mirror. Set to false if the wiki repo is more widely readable than
# the Outline workspace.
INCLUDE_PRIVATE="${INCLUDE_PRIVATE:-true}"

# Attachments are excluded by default: the convention is that real files live
# in SharePoint, so the zip should carry only inline images.
INCLUDE_ATTACHMENTS="${INCLUDE_ATTACHMENTS:-false}"

WORK_DIR="${WORK_DIR:-/srv/data/outline/wiki-export}"
POLL_INTERVAL="${POLL_INTERVAL:-10}"
POLL_MAX="${POLL_MAX:-180}"   # 30 minutes at 10s

# ── Helpers ──────────────────────────────────────────────────────────────────

log() { printf '%s  %s\n' "$(date -Is)" "$*"; }
die() { log "ERROR: $*" >&2; exit 1; }

api() {
  local endpoint="$1" body="${2:-\{\}}"
  curl -fsS -X POST "${OUTLINE_URL%/}/api/${endpoint}" \
    -H "Authorization: Bearer ${OUTLINE_API_TOKEN}" \
    -H "Content-Type: application/json" \
    -d "${body}"
}

# ── 1. Trigger the export ────────────────────────────────────────────────────

log "Requesting export (private=${INCLUDE_PRIVATE}, attachments=${INCLUDE_ATTACHMENTS})"

# collections.export_all is rate limited to five per hour, so a nightly run has
# plenty of headroom but a retry loop would not.
response=$(api "collections.export_all" "$(cat <<JSON
{
  "format": "outline-markdown",
  "includeAttachments": ${INCLUDE_ATTACHMENTS},
  "includePrivate": ${INCLUDE_PRIVATE}
}
JSON
)") || die "export_all failed — check the token has admin rights"

operation_id=$(echo "$response" | jq -r '.data.fileOperation.id')
[ "$operation_id" != "null" ] || die "no fileOperation id in response: $response"

log "Export job ${operation_id} created"

# ── 2. Wait for it ───────────────────────────────────────────────────────────

for ((i = 1; i <= POLL_MAX; i++)); do
  state=$(api "fileOperations.info" "{\"id\":\"${operation_id}\"}" \
    | jq -r '.data.state')

  case "$state" in
    complete) log "Export ready after $((i * POLL_INTERVAL))s"; break ;;
    error)    die "Outline reported the export failed" ;;
    expired)  die "Export expired before it could be downloaded" ;;
    creating|uploading) sleep "$POLL_INTERVAL" ;;
    *)        die "Unexpected state '${state}'" ;;
  esac

  [ "$i" -lt "$POLL_MAX" ] || die "Export still '${state}' after $((POLL_MAX * POLL_INTERVAL))s"
done

# ── 3. Download and unpack ───────────────────────────────────────────────────

mkdir -p "$WORK_DIR"
zip_path="${WORK_DIR}/export.zip"
extract_dir="${WORK_DIR}/extracted"

log "Downloading"
# -L because fileOperations.redirect is a redirect to the stored file.
curl -fsSL -X POST "${OUTLINE_URL%/}/api/fileOperations.redirect" \
  -H "Authorization: Bearer ${OUTLINE_API_TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{\"id\":\"${operation_id}\"}" \
  -o "$zip_path" || die "download failed"

# A truncated or error-page download would otherwise be committed as garbage.
unzip -tq "$zip_path" >/dev/null 2>&1 || die "downloaded file is not a valid zip"

rm -rf "$extract_dir"
mkdir -p "$extract_dir"
unzip -qq "$zip_path" -d "$extract_dir"

file_count=$(find "$extract_dir" -name '*.md' | wc -l)
[ "$file_count" -gt 0 ] || die "export contained no markdown files — refusing to commit"
log "Extracted ${file_count} markdown files"

# ── 4. Sync into the wiki repo ───────────────────────────────────────────────

repo_dir="${WORK_DIR}/wiki"

if [ -d "${repo_dir}/.git" ]; then
  git -C "$repo_dir" fetch --quiet origin
  git -C "$repo_dir" reset --quiet --hard origin/HEAD
else
  rm -rf "$repo_dir"
  git clone --quiet "$WIKI_REPO" "$repo_dir"
fi

# --delete so pages removed in Outline disappear from the wiki. Everything
# except .git is considered ours to manage.
rsync -a --delete --exclude '.git' "${extract_dir}/" "${repo_dir}/"

# ── 5. Commit ────────────────────────────────────────────────────────────────

cd "$repo_dir"
git config user.email "outline-export@appitech.hevs.ch"
git config user.name "Outline export"

if git diff --quiet && git diff --cached --quiet && [ -z "$(git status --porcelain)" ]; then
  log "No changes since last run"
  exit 0
fi

git add -A
git commit --quiet -m "Outline export $(date -I)"
git push --quiet origin HEAD

changed=$(git diff --stat HEAD~1 HEAD -- . | tail -1)
log "Pushed: ${changed}"

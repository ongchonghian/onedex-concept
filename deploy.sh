#!/usr/bin/env bash
# Syncs portal-app/ into dist/ then deploys dist/ to Cloudflare Pages
# project "onedex-concept". portal-prototype.html (legacy single-file prototype
# at the workspace root) is preserved alongside the synced portal-app build.
# Reads CLOUDFLARE_API_TOKEN from .env (alongside this script) if not already
# set in the environment. .env is in .gitignore — never commit it.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT="onedex-concept"
SRC_DIR="$SCRIPT_DIR/portal-app"
DIST_DIR="$SCRIPT_DIR/dist"
ENV_FILE="$SCRIPT_DIR/.env"

# Load .env if present and the token isn't already exported.
if [[ -z "${CLOUDFLARE_API_TOKEN:-}" && -f "$ENV_FILE" ]]; then
  # shellcheck disable=SC1090
  set -a
  source "$ENV_FILE"
  set +a
fi

if [[ -z "${CLOUDFLARE_API_TOKEN:-}" ]]; then
  echo "ERROR: CLOUDFLARE_API_TOKEN not set."
  echo "  Create $ENV_FILE with:"
  echo "    CLOUDFLARE_API_TOKEN=your-token-here"
  echo "  Or export it: export CLOUDFLARE_API_TOKEN='your-token-here'"
  exit 1
fi

if [[ ! -d "$SRC_DIR" ]]; then
  echo "ERROR: $SRC_DIR not found — nothing to sync."
  exit 1
fi

# Mirror portal-app/ → dist/ so the deploy always ships current source.
# --delete prunes files removed from portal-app/. portal-prototype.html lives
# at the workspace root (legacy single-file prototype) and is preserved in
# dist/ via --exclude so it stays reachable at /portal-prototype.html.
mkdir -p "$DIST_DIR"
echo "→ Syncing $SRC_DIR/ → $DIST_DIR/"
rsync -a --delete --exclude='portal-prototype.html' "$SRC_DIR/" "$DIST_DIR/"

# Refresh the legacy prototype copy if it exists at the workspace root.
if [[ -f "$SCRIPT_DIR/portal-prototype.html" ]]; then
  cp "$SCRIPT_DIR/portal-prototype.html" "$DIST_DIR/portal-prototype.html"
fi

echo "→ Deploying $DIST_DIR to Cloudflare Pages project: $PROJECT"
# Pinned to wrangler 3.x — supports Node 18+. wrangler 4.x requires Node 22.
npx --yes wrangler@3 pages deploy "$DIST_DIR" \
  --project-name="$PROJECT" \
  --branch=main \
  --commit-dirty=true

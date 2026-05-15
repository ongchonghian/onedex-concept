#!/usr/bin/env bash
# Deploys the staged dist/ folder to Cloudflare Pages project "onedex-concept".
# Token is passed in via env. Do NOT commit this token to git.

set -euo pipefail

PROJECT="onedex-concept"
DIST_DIR="$(cd "$(dirname "$0")" && pwd)/dist"

if [[ -z "${CLOUDFLARE_API_TOKEN:-}" ]]; then
  echo "ERROR: CLOUDFLARE_API_TOKEN not set."
  echo "Run:  export CLOUDFLARE_API_TOKEN='<your-token>'"
  exit 1
fi

if [[ ! -d "$DIST_DIR" ]]; then
  echo "ERROR: $DIST_DIR not found."
  exit 1
fi

echo "→ Deploying $DIST_DIR to Cloudflare Pages project: $PROJECT"
# Pinned to wrangler 3.x — supports Node 18+. wrangler 4.x requires Node 22.
npx --yes wrangler@3 pages deploy "$DIST_DIR" \
  --project-name="$PROJECT" \
  --branch=main \
  --commit-dirty=true

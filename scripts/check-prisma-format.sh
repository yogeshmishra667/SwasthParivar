#!/usr/bin/env bash
# Verify apps/server/prisma/schema.prisma is `prisma format`-clean.
#
# `prisma format` rewrites the file in place; there is no --check flag.
# We mimic --check by running format on a copy and diffing.
#
# Used by:
#   - scripts/preflight.sh (pre-push gate)
#   - .github/workflows/ci.yml format job (parity with local)

set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

SCHEMA=apps/server/prisma/schema.prisma
if [ ! -f "$SCHEMA" ]; then
  echo "::error::schema not found at $SCHEMA"
  exit 1
fi

TMP=$(mktemp -t swasth-schema.XXXXXX.prisma)
trap 'rm -f "$TMP"' EXIT
cp "$SCHEMA" "$TMP"

# `prisma format` only prints "Formatted ... in Nms" — silenced. A
# non-zero exit here is a real parse failure (different problem).
pnpm --filter @swasth/server exec prisma format --schema "$TMP" >/dev/null

if ! diff -q "$SCHEMA" "$TMP" >/dev/null 2>&1; then
  echo "::error::schema.prisma is not prisma format-clean"
  echo ""
  echo "Diff (expected → actual):"
  diff -u "$SCHEMA" "$TMP" || true
  echo ""
  echo "Fix: pnpm --filter @swasth/server exec prisma format"
  exit 1
fi

echo "✅ schema.prisma is prisma format-clean"

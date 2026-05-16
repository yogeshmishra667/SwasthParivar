#!/usr/bin/env bash
# Verify any change to apps/server/prisma/schema.prisma is paired with
# at least one new migration folder. Catches the
# schema-without-migration drift bug.
#
# Inputs (env, both optional):
#   BASE_REF — base to diff against. Default: merge-base origin/main HEAD.
#   HEAD_REF — head ref. Default: HEAD.
#
# Used by:
#   - scripts/preflight.sh (pre-push)
#   - .github/workflows/ci.yml migration-check job (pull_request only)

set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

HEAD_REF=${HEAD_REF:-HEAD}

if [ -z "${BASE_REF:-}" ]; then
  # On main itself there's nothing to diff against; succeed silently.
  current_branch=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "")
  if [ "$current_branch" = "main" ]; then
    echo "On main — migration parity check skipped."
    exit 0
  fi
  # Fall back to local main if origin/main isn't fetched yet.
  if git rev-parse --verify origin/main >/dev/null 2>&1; then
    BASE_REF=$(git merge-base origin/main "$HEAD_REF")
  elif git rev-parse --verify main >/dev/null 2>&1; then
    BASE_REF=$(git merge-base main "$HEAD_REF")
  else
    echo "::warning::no main/origin/main found — migration parity check skipped"
    exit 0
  fi
fi

# Nothing changed between BASE_REF and HEAD_REF (e.g. preflight running
# on a freshly-branched but never-committed branch).
if [ "$(git rev-parse "$BASE_REF")" = "$(git rev-parse "$HEAD_REF")" ]; then
  echo "No commits since $BASE_REF — migration parity check skipped."
  exit 0
fi

SCHEMA_TOUCHED=$(git diff --name-only "$BASE_REF" "$HEAD_REF" -- apps/server/prisma/schema.prisma || true)
NEW_MIG=$(git diff --name-only --diff-filter=A "$BASE_REF" "$HEAD_REF" -- 'apps/server/prisma/migrations/*/migration.sql' || true)

if [ -z "$SCHEMA_TOUCHED" ]; then
  echo "✅ no schema changes — migration parity not required"
  exit 0
fi

if [ -n "$NEW_MIG" ]; then
  echo "✅ schema change pairs with new migration(s):"
  printf '  %s\n' $NEW_MIG
  exit 0
fi

# Schema touched but no new migration. Could still be valid:
# `prisma format`, comment edits, attribute reorderings produce no
# datamodel diff. Use `prisma migrate diff` to compare the BASE_REF
# version of the schema against HEAD_REF semantically — exit 0 means
# no datamodel change, exit 2 means real change (which requires a
# migration), anything else is an unexpected error.

OLD_SCHEMA=$(mktemp -t swasth-schema.old.XXXXXX.prisma)
trap 'rm -f "$OLD_SCHEMA" "${DIFF_OUT:-}"' EXIT

if ! git show "$BASE_REF:apps/server/prisma/schema.prisma" > "$OLD_SCHEMA" 2>/dev/null; then
  # Schema didn't exist at BASE_REF — definitely a real addition.
  echo "::error::schema.prisma changed (introduced) but no migration added."
  echo "Fix: pnpm --filter @swasth/server exec prisma migrate dev --name <slug>"
  exit 1
fi

# We invoke `prisma` directly (not via `pnpm --filter exec`) because
# pnpm collapses prisma's exit-code 2 ("non-empty diff") to 1, losing
# the signal we depend on. Running from apps/server/ cwd keeps the
# relative path for the new schema and lets prisma find the prisma
# config.
DIFF_OUT=$(mktemp -t swasth-prisma-diff.XXXXXX.sql)
set +e
(cd apps/server && npx --no-install prisma migrate diff \
  --from-schema "$OLD_SCHEMA" \
  --to-schema prisma/schema.prisma \
  --exit-code \
  --script) > "$DIFF_OUT" 2>/dev/null
DIFF_STATUS=$?
set -e

case "$DIFF_STATUS" in
  0)
    echo "✅ schema.prisma changed but no datamodel diff (format / comment / reorder only)"
    ;;
  2)
    echo "::error::schema.prisma changed (datamodel diff present) but no new migration added."
    echo ""
    echo "Diff range: $BASE_REF .. $HEAD_REF"
    echo "Required migration SQL:"
    sed 's/^/  /' "$DIFF_OUT"
    echo ""
    echo "Fix: pnpm --filter @swasth/server exec prisma migrate dev --name <slug>"
    rm -f "$DIFF_OUT"
    exit 1
    ;;
  *)
    echo "::error::prisma migrate diff failed unexpectedly (status $DIFF_STATUS)"
    exit 1
    ;;
esac

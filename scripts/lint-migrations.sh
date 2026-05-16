#!/usr/bin/env bash
# Lint newly-added Postgres migrations with squawk.
#
# Single source of truth for the rule exclusions used by BOTH local
# preflight and CI. Add/remove from EXCLUDED_RULES below, never inline
# them in callers.
#
# Inputs (env, both optional):
#   BASE_REF — base to diff against. Default: merge-base origin/main HEAD.
#   HEAD_REF — head ref. Default: HEAD.
#
# Used by:
#   - scripts/preflight.sh (pre-push)
#   - .github/workflows/ci.yml migration-lint job (pull_request only)
#
# Squawk binary is cached at ~/.cache/swasth-preflight/squawk-<version>.
# CI installs into /tmp via the same logic — we let it re-download per
# run because GHA's runner FS is ephemeral.

set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

# Bump in lockstep with .github/workflows/ci.yml. Squawk v1.x is EOL;
# the v2.x asset is `squawk-<os>-<arch>`.
SQUAWK_VERSION="${SQUAWK_VERSION:-2.52.1}"

# Source of truth — keep in sync with the explanation block in
# .github/workflows/ci.yml (migration-lint job).
EXCLUDED_RULES="prefer-text-field,require-concurrent-index-creation,prefer-robust-stmts,constraint-missing-not-valid,adding-foreign-key-constraint,disallowed-unique-constraint,require-timeout-settings,prefer-bigint-over-int,prefer-timestamp-tz"

# ─────────────────────────────────────────────────────────────
# Resolve diff range
# ─────────────────────────────────────────────────────────────

HEAD_REF=${HEAD_REF:-HEAD}

if [ -z "${BASE_REF:-}" ]; then
  current_branch=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "")
  if [ "$current_branch" = "main" ]; then
    echo "On main — migration lint skipped (no new migrations)."
    exit 0
  fi
  if git rev-parse --verify origin/main >/dev/null 2>&1; then
    BASE_REF=$(git merge-base origin/main "$HEAD_REF")
  elif git rev-parse --verify main >/dev/null 2>&1; then
    BASE_REF=$(git merge-base main "$HEAD_REF")
  else
    echo "::warning::no main/origin/main found — squawk skipped"
    exit 0
  fi
fi

if [ "$(git rev-parse "$BASE_REF")" = "$(git rev-parse "$HEAD_REF")" ]; then
  echo "No commits since $BASE_REF — squawk skipped."
  exit 0
fi

NEW_MIG=$(git diff --name-only --diff-filter=A "$BASE_REF" "$HEAD_REF" -- 'apps/server/prisma/migrations/*/migration.sql' || true)

if [ -z "$NEW_MIG" ]; then
  echo "No new migrations between $BASE_REF .. $HEAD_REF — squawk skipped."
  exit 0
fi

# ─────────────────────────────────────────────────────────────
# Resolve squawk binary
# ─────────────────────────────────────────────────────────────

# Allow callers (CI) to pre-install and pass a path.
SQUAWK_BIN="${SQUAWK_BIN:-}"

if [ -z "$SQUAWK_BIN" ]; then
  case "$(uname -s)-$(uname -m)" in
    Linux-x86_64)   SQUAWK_ASSET=squawk-linux-x64 ;;
    Darwin-x86_64)  SQUAWK_ASSET=squawk-darwin-x64 ;;
    Darwin-arm64)   SQUAWK_ASSET=squawk-darwin-arm64 ;;
    *)
      echo "::warning::squawk asset not available for $(uname -s)/$(uname -m) — local check skipped (CI still runs it)"
      exit 0
      ;;
  esac

  CACHE_DIR="$HOME/.cache/swasth-preflight"
  SQUAWK_BIN="$CACHE_DIR/squawk-$SQUAWK_VERSION"
  if [ ! -x "$SQUAWK_BIN" ]; then
    mkdir -p "$CACHE_DIR"
    echo "downloading squawk v$SQUAWK_VERSION ($SQUAWK_ASSET) → $SQUAWK_BIN"
    if ! curl -sSLf -o "$SQUAWK_BIN" \
      "https://github.com/sbdchd/squawk/releases/download/v${SQUAWK_VERSION}/${SQUAWK_ASSET}"; then
      rm -f "$SQUAWK_BIN"
      echo "::warning::squawk download failed — local check skipped (CI still runs it)"
      exit 0
    fi
    chmod +x "$SQUAWK_BIN"
  fi
fi

# ─────────────────────────────────────────────────────────────
# Lint
# ─────────────────────────────────────────────────────────────

failed=0
while IFS= read -r f; do
  [ -z "$f" ] && continue
  echo "::group::squawk $f"
  if ! "$SQUAWK_BIN" --exclude "$EXCLUDED_RULES" "$f"; then
    failed=1
  fi
  echo "::endgroup::"
done <<< "$NEW_MIG"

if [ "$failed" -ne 0 ]; then
  echo "::error::squawk flagged unsafe SQL in one or more new migrations"
  echo "Rule reference: https://squawkhq.com/docs/rules"
  exit 1
fi

echo "✅ squawk: all new migrations passed"

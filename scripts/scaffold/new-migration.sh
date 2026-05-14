#!/usr/bin/env bash
# Wraps `prisma migrate dev --name <name>` with the slug guard the rest
# of the codebase uses. Forwards to the server workspace.
#
# Usage: pnpm new-migration <slug>
#   e.g. pnpm new-migration add_bp_pulse_column
set -eu

NAME="${1:-}"
if [ -z "$NAME" ]; then
  echo "Usage: pnpm new-migration <slug>" >&2
  exit 2
fi

if ! printf '%s' "$NAME" | grep -Eq '^[a-z][a-z0-9_]*$'; then
  echo "Migration slug must be lowercase letters / digits / underscores." >&2
  echo "Got: $NAME" >&2
  exit 2
fi

# Reminder before we mutate schema state.
cat <<MSG
About to run: prisma migrate dev --name $NAME

Safety checklist (per CLAUDE.md + Danger.js migration rules):
  - Adding a NOT NULL column? Provide a DEFAULT or split into two steps.
  - Renaming a column? Add the new one + backfill before dropping.
  - Touching a TimescaleDB hypertable? Confirm hypertable invariants.
  - The squawk CI job will lint the generated SQL — review its output.

Press Enter to continue, Ctrl-C to abort.
MSG
read -r _

exec pnpm --filter @swasth/server exec prisma migrate dev --name "$NAME"

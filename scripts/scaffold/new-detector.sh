#!/usr/bin/env bash
# Scaffolds a pure-function detector under
# packages/domain-logic/src/detectors/<name>.ts with a paired .test.ts.
#
# Detectors are pure functions: input → DetectorResult | null. No DB,
# no time/random (purity is enforced by tsconfig path blocks + the CI
# purity script).
#
# Usage: pnpm new-detector <name>
#   e.g. pnpm new-detector morning-rise
set -eu

NAME="${1:-}"
if [ -z "$NAME" ]; then
  echo "Usage: pnpm new-detector <name>" >&2
  exit 2
fi

if ! printf '%s' "$NAME" | grep -Eq '^[a-z][a-z0-9-]*$'; then
  echo "Detector name must be lowercase letters / digits / hyphens." >&2
  exit 2
fi

DIR="packages/domain-logic/src/detectors"
FILE="$DIR/$NAME.ts"
TEST="$DIR/$NAME.test.ts"

if [ -f "$FILE" ] || [ -f "$TEST" ]; then
  echo "Detector already exists: $FILE" >&2
  exit 1
fi

mkdir -p "$DIR"

# Camel-case the export name from the kebab-case slug.
EXPORT_NAME=$(printf '%s' "$NAME" | awk -F- '{ for(i=1;i<=NF;i++){ $i=toupper(substr($i,1,1)) substr($i,2) } } 1' OFS='')
EXPORT_NAME="detect${EXPORT_NAME}"

cat > "$FILE" <<TS
import type { DetectorResult } from "./types.js";

interface Input {
  // TODO: shape this. Detectors should accept exactly the data they
  // need and nothing else — keeps tests cheap and the purity check
  // honest.
  readonly readings: ReadonlyArray<{ valueMgDl: number; measuredAtIso: string }>;
}

/**
 * $EXPORT_NAME — TODO describe the pattern this detector spots and
 * the minimum-data rule (CLAUDE.md Insight Engine section).
 *
 * Returns null when there isn't enough data; never throws.
 */
export const $EXPORT_NAME = (input: Input): DetectorResult | null => {
  if (input.readings.length < 7) return null;
  // TODO: implement
  return null;
};
TS

cat > "$TEST" <<TS
import { describe, it, expect } from "vitest";
import { $EXPORT_NAME } from "./$NAME.js";

describe("$EXPORT_NAME", () => {
  it("returns null when there is not enough data", () => {
    expect($EXPORT_NAME({ readings: [] })).toBeNull();
  });

  // TODO: add positive + edge cases. Coverage targets are enforced
  // per-file by packages/domain-logic/vitest.config.ts — match the
  // ratchet floor at minimum.
});
TS

echo "✅ Created:"
echo "   $FILE"
echo "   $TEST"
echo
echo "Next steps:"
echo "  1. Re-export from packages/domain-logic/src/detectors/index.ts"
echo "  2. Set a ratchet floor in packages/domain-logic/vitest.config.ts"
echo "  3. Confirm the detector meets CLAUDE.md's minimum-data rule before shipping."

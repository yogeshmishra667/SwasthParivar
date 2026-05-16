#!/usr/bin/env bash
# Preflight — simulate a fresh CI checkout locally before push.
#
# WHY THIS EXISTS:
#   Running `pnpm typecheck` on a developer laptop can pass while CI
#   fails for the same SHA. The gap is contamination: stale `dist/`,
#   `.tsbuildinfo`, shell env vars (DATABASE_URL, NODE_ENV), gitignored
#   files that exist on disk but not in HEAD. Three audit-PR rounds of
#   CI red was 100% caused by this kind of drift.
#
# WHAT THIS DOES:
#   1. Wipe every build artefact + tsbuildinfo
#   2. Reinstall from the lockfile (frozen) — matches CI exactly
#   3. Run every static gate (typecheck, lint, format, purity)
#   4. Prisma schema/migration gates (format, schema↔migration parity,
#      squawk SQL safety on newly-added migrations)
#   5. Run unit tests (domain-logic coverage)
#   6. Optionally run Docker image build + /health probe (--with-docker)
#   7. Optionally run integration tests (--with-integration; needs Docker)
#
#   Each step prints a banner; exits non-zero on first failure.
#
# WIRED INTO:
#   .husky/pre-push — runs by default before any push.
#   Override with `git push --no-verify` for genuine emergencies only.
#   The hook runs the static-only variant by default (fast). Pass
#   PREFLIGHT_FULL=1 to include integration + Docker.

set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

WITH_DOCKER=0
WITH_INTEGRATION=0
for arg in "$@"; do
  case "$arg" in
    --with-docker) WITH_DOCKER=1 ;;
    --with-integration) WITH_INTEGRATION=1 ;;
    --full) WITH_DOCKER=1; WITH_INTEGRATION=1 ;;
  esac
done

banner() {
  printf '\n\033[1;36m▶ %s\033[0m\n' "$1"
}

fail() {
  printf '\n\033[1;31m✗ preflight failed at: %s\033[0m\n' "$1" >&2
  exit 1
}

banner "1/11 wipe build artefacts (dist + tsbuildinfo)"
pnpm -r run clean >/dev/null 2>&1 || true
find . -name ".tsbuildinfo" -not -path "*/node_modules/*" -delete 2>/dev/null || true
find packages -type d -name "dist" -not -path "*/node_modules/*" -exec rm -rf {} + 2>/dev/null || true
find apps -type d -name "dist" -not -path "*/node_modules/*" -exec rm -rf {} + 2>/dev/null || true

# Confirm we actually cleaned. If anything is left, fail loudly — silent
# contamination is exactly what this script exists to prevent.
remaining=$(find . \( -name "dist" -type d -o -name "*.tsbuildinfo" \) -not -path "*/node_modules/*" 2>/dev/null | head -1 || true)
if [ -n "$remaining" ]; then
  fail "leftover artefact after clean: $remaining"
fi

banner "2/11 frozen pnpm install (matches CI exactly)"
pnpm install --frozen-lockfile --prefer-offline 2>&1 | tail -3 || fail "install"

banner "3/11 workspace typecheck (5 projects)"
pnpm typecheck >/dev/null || fail "typecheck"

banner "4/11 workspace lint (max-warnings=0)"
pnpm lint >/dev/null || fail "lint"

banner "5/11 prettier format:check"
pnpm format:check >/dev/null || fail "format:check"

banner "6/11 prisma schema format"
bash scripts/check-prisma-format.sh >/dev/null || fail "prisma format"

banner "7/11 schema ↔ migration parity"
bash scripts/check-migration-parity.sh || fail "migration parity"

banner "8/11 migration lint (squawk) on new migrations"
bash scripts/lint-migrations.sh || fail "squawk"

banner "9/11 domain-logic purity"
node scripts/check-domain-purity.mjs >/dev/null || fail "purity"

banner "10/11 domain-logic test:coverage (per-file ratchets)"
pnpm --filter @swasth/domain-logic test:coverage >/dev/null || fail "domain-logic tests"

if [ "$WITH_INTEGRATION" = "1" ]; then
  banner "11a/11 server integration tests (Testcontainers — needs Docker)"
  if ! docker info >/dev/null 2>&1; then
    fail "Docker daemon down — integration tests need it"
  fi
  pnpm --filter @swasth/server test:integration >/dev/null || fail "integration tests"
fi

if [ "$WITH_DOCKER" = "1" ]; then
  banner "11b/11 docker build + /health smoke (matches CI image-smoke job)"
  if ! docker info >/dev/null 2>&1; then
    fail "Docker daemon down"
  fi
  docker rm -f swasth-preflight 2>/dev/null || true
  docker rmi swasth-server:preflight 2>/dev/null || true
  docker build -f apps/server/Dockerfile -t swasth-server:preflight . >/dev/null 2>&1 \
    || fail "docker build"
  docker run -d --name swasth-preflight -p 14001:4000 \
    -e NODE_ENV=test -e PORT=4000 \
    -e DATABASE_URL="postgresql://stub:stub@127.0.0.1:65432/stub" \
    -e REDIS_URL="redis://127.0.0.1:65433" \
    -e JWT_SECRET="preflight-jwt-secret-preflight-jwt-secret-32c" \
    -e JWT_REFRESH_SECRET="preflight-refresh-preflight-refresh-32c-12345" \
    -e OTP_SECRET="preflight-otp-secret-preflight-otp-secret-32c" \
    swasth-server:preflight >/dev/null
  ok=0
  for i in $(seq 1 30); do
    if curl -fsS http://127.0.0.1:14001/health >/dev/null 2>&1; then
      ok=1
      break
    fi
    sleep 1
  done
  docker rm -f swasth-preflight >/dev/null 2>&1 || true
  docker rmi swasth-server:preflight >/dev/null 2>&1 || true
  [ "$ok" = "1" ] || fail "/health did not respond within 30s"
fi

printf '\n\033[1;32m✓ preflight complete — safe to push\033[0m\n'

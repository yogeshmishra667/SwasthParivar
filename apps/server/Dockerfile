# Multi-stage build for the Express server. Output is a slim Node image
# running as a non-root user with the production node_modules and the
# Prisma client baked in. The image expects DATABASE_URL / REDIS_URL /
# JWT_SECRET etc. at runtime — never bake secrets at build time.
#
# Built and smoke-tested in CI. See .github/workflows/ci.yml job:
# `image-smoke` which calls `docker build` then probes /health on a
# running container.

# --- stage 1: workspace dependencies (pnpm + Prisma) ------------------
FROM node:22.18.0-bookworm-slim AS deps
WORKDIR /repo

ENV PNPM_HOME=/pnpm \
    PATH="/pnpm:$PATH" \
    CI=1

RUN corepack enable && corepack prepare pnpm@9.12.0 --activate

# Copy only the manifests + lockfile + workspace catalog first to keep
# the dep layer cacheable across source changes.
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json .npmrc ./
COPY apps/server/package.json apps/server/package.json
COPY packages/domain-logic/package.json packages/domain-logic/package.json
COPY packages/shared-types/package.json packages/shared-types/package.json
COPY packages/test-factories/package.json packages/test-factories/package.json
COPY apps/mobile/package.json apps/mobile/package.json

RUN pnpm install --frozen-lockfile --ignore-scripts

# Bring in source for the projects the server actually needs.
# Note: root `tsconfig.json` is gitignored on this project (Expo legacy)
# — apps/server/tsconfig.build.json extends tsconfig.base.json directly,
# so we only need to copy the base.
COPY tsconfig.base.json ./
COPY apps/server apps/server
COPY packages/domain-logic packages/domain-logic
COPY packages/shared-types packages/shared-types

# Prisma client must be generated before tsc runs so import types resolve.
# Prisma 7's `prisma.config.ts` uses strict env() which throws if
# DATABASE_URL is missing — but `prisma generate` doesn't actually
# connect anywhere, so a stub URL is enough to satisfy the parser at
# image-build time. The runtime container is started with a real
# DATABASE_URL by the deploy platform.
RUN DATABASE_URL="postgresql://build:build@build/build" \
    pnpm --filter @swasth/server exec prisma generate

# --- stage 2: build ---------------------------------------------------
FROM deps AS build
WORKDIR /repo

# Build shared packages first (server depends on them by workspace ref),
# then build the server itself. Each `tsc -p tsconfig.build.json` emits
# to its package's dist/.
RUN pnpm --filter @swasth/shared-types run build \
 && pnpm --filter @swasth/domain-logic run build \
 && pnpm --filter @swasth/server run build

# --- stage 3: runtime (slim, non-root) -------------------------------
FROM node:22.18.0-bookworm-slim AS runtime
WORKDIR /app

ENV NODE_ENV=production \
    PORT=4000

# Non-root user. Default `node` user (uid 1000) ships with the base image.
USER node

# Bring in only what the runtime needs. The server's build output is in
# apps/server/dist; node_modules carries the production deps + Prisma
# client; the schema is needed for `prisma migrate deploy` if that's run
# from this container in an init job.
COPY --from=build --chown=node:node /repo/node_modules ./node_modules
COPY --from=build --chown=node:node /repo/apps/server/node_modules ./apps/server/node_modules
COPY --from=build --chown=node:node /repo/apps/server/dist ./apps/server/dist
COPY --from=build --chown=node:node /repo/apps/server/package.json ./apps/server/package.json
COPY --from=build --chown=node:node /repo/apps/server/prisma ./apps/server/prisma
COPY --from=build --chown=node:node /repo/packages/domain-logic/dist ./packages/domain-logic/dist
COPY --from=build --chown=node:node /repo/packages/domain-logic/package.json ./packages/domain-logic/package.json
COPY --from=build --chown=node:node /repo/packages/shared-types/dist ./packages/shared-types/dist
COPY --from=build --chown=node:node /repo/packages/shared-types/package.json ./packages/shared-types/package.json
COPY --from=build --chown=node:node /repo/package.json ./package.json

# Healthcheck against the cheap `/health` endpoint — used by docker, k8s
# liveness probes, and CI smoke. The deep check (/health/deep) hits the
# DB+Redis and would fail before they're wired, so we use the simple one.
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "require('node:http').get('http://127.0.0.1:'+process.env.PORT+'/health',r=>{process.exit(r.statusCode===200?0:1)}).on('error',()=>process.exit(1))"

EXPOSE 4000

CMD ["node", "apps/server/dist/index.js"]

# Security Policy

SwasthParivar handles health data for chronic-condition patients. We take
security and privacy seriously, even at this early stage of the project.

## Reporting a vulnerability

**Do not open a public GitHub issue for security vulnerabilities.**

Please report security issues privately via either:

- **GitHub Security Advisories** (preferred):
  <https://github.com/yogeshmishra667/SwasthParivar/security/advisories/new>
  — uses end-to-end encrypted communication with the maintainer.
- **Email:** `yogeshmishra667@gmail.com` with subject prefix `[SECURITY]`.

Please include:

1. A clear description of the issue.
2. Steps to reproduce (or a proof-of-concept).
3. The affected version / commit SHA.
4. Your assessment of the impact (data exposure, auth bypass, RCE, etc.).

You should expect an acknowledgement within **3 business days** and a
status update within **7 business days**. We aim to ship a patch within
**30 days** of confirmation for HIGH/CRITICAL issues, and within the
next minor release for MEDIUM/LOW issues.

## Scope

In scope:

- This repository (`yogeshmishra667/SwasthParivar`) — server (`apps/server`),
  mobile app (`apps/mobile`), shared packages (`packages/*`).
- Production deployment endpoints (if/when published).

Out of scope:

- Vulnerabilities in third-party services we depend on (Firebase, Expo,
  PostgreSQL, Redis, Cloudflare R2) — please report those upstream.
- Findings that require physical access to a device or social engineering.
- Findings that only impact users of unsupported / outdated app versions.

## Supported versions

The project is pre-1.0 and is currently rolling-release on `main`. Only
the latest commit on `main` is supported for security fixes. Once a `v1.0.0`
tag is cut, this section will be updated with a version-support matrix.

## Dependency audit exceptions

CI fails on any HIGH/CRITICAL advisory in the production dependency graph
(`pnpm audit --prod --audit-level=high`). Fixable advisories are fixed
through `pnpm.overrides` in the root `package.json`. The advisories below
are listed in `pnpm.auditConfig.ignoreGhsas` because no safe fix exists
**and** the vulnerable code never runs in the shipped server or mobile app.
Re-check each one on every Expo SDK / Prisma upgrade and remove it as soon
as a compatible patched version ships.

| Advisory                                 | Package                      | Why it is accepted                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ---------------------------------------- | ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GHSA-86w9-cpqp-85rv                      | `node-forge` ≤ 1.4.0         | No patched version published. Only used by the Expo CLI dev server; not bundled into the app or the server.                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| GHSA-5p2g-fcmc-qvqq, GHSA-w3rx-r6r6-pgpr | `image-size` 1.x             | Fixed only in 2.x, which can't be forced: Metro (`metro/src/Assets.js`) passes image _file paths_, and 2.x only accepts buffers — overriding breaks every image asset in the bundle (verified). Metro only reads this repo's own image assets at build time; the server uses `sharp` for uploads. Clears with the next Expo SDK / Metro upgrade.                                                                                                                                                                                              |
| GHSA-vcc3-ghjq-m6fr                      | `decode-uri-component` 0.2.2 | Bundled in the app via `@react-navigation/core` → `query-string` 7, but never called: React Navigation's `getStateFromPath` is the only caller (`queryString.parse`), and expo-router replaces it with its own parser (`expo-router/build/getLinkingConfig.js`), which uses the built-in `decodeURIComponent`. expo-router itself only calls `queryString.stringify`, which doesn't decode. The fix (0.5.x) is ESM-only and `query-string` 7 `require()`s it, so it can't be forced. Clears when React Navigation moves off `query-string` 7. |

## Acknowledgements

We will credit reporters in release notes (with permission) unless
anonymity is requested. There is no monetary bounty program at this stage.

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

| Advisory                                 | Package                           | Why it is accepted                                                                                                                                                                                                                                                                             |
| ---------------------------------------- | --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GHSA-vfj7-8cjw-p6xm                      | `braces` ≤ 3.0.3                  | No patched version published. Only reached through glob matching in build tooling (Metro, Danger); never processes user input.                                                                                                                                                                 |
| GHSA-86w9-cpqp-85rv                      | `node-forge` ≤ 1.4.0              | No patched version published. Only used by the Expo CLI dev server; not bundled into the app or the server.                                                                                                                                                                                    |
| GHSA-5p2g-fcmc-qvqq, GHSA-w3rx-r6r6-pgpr | `image-size` 1.x                  | Fixed only in 2.x (breaking API). Used by Metro to read dimensions of the repo's own image assets at build time; the server uses `sharp` for uploads.                                                                                                                                          |
| GHSA-ggr8-5vv4-36mx                      | `deepmerge-ts` 7.x                | Prisma 7 pins 7.1.5 exactly (`@prisma/config`). Merges Prisma's own config at CLI time, never request data.                                                                                                                                                                                    |
| GHSA-mrhx-c7xc-m3w5                      | `zod` 3.x (mobile app, puppeteer) | No 3.x fix exists (fixed only in 4.6.6+; moving the app to zod 4 is an API migration). On the phone zod only validates the patient's own form input; puppeteer uses it for its own config. The **server and admin are on zod ≥ 4.6.7**, which is where untrusted request bodies are validated. |

## Acknowledgements

We will credit reporters in release notes (with permission) unless
anonymity is requested. There is no monetary bounty program at this stage.

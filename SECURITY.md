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

## Acknowledgements

We will credit reporters in release notes (with permission) unless
anonymity is requested. There is no monetary bounty program at this stage.

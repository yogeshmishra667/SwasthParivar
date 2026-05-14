# Rollback runbook

> When a production deploy is misbehaving — bad release, regressed migration,
> third-party outage triggered by the new code — work through this in order.
> Each section is a self-contained block: read the **trigger**, decide if it
> matches, then do the steps. Don't skip the safety asserts at the bottom of
> each block.
>
> Owners on-call: see CODEOWNERS at the top level. Two reviewers required
> for any rollback PR per `.github/PULL_REQUEST_TEMPLATE.md`.

## RTO / RPO targets

| Target                         | Value          | Notes                                                              |
| ------------------------------ | -------------- | ------------------------------------------------------------------ |
| RTO (recovery time objective)  | **30 minutes** | Time from incident declared → traffic restored on healthy version. |
| RPO (recovery point objective) | **5 minutes**  | Maximum acceptable data loss on a Postgres point-in-time restore.  |

These numbers are aspirational until the DR drill below is rehearsed; treat them as the bar to hit, not as a guarantee.

---

## 1. Image revert (bad code, schema unchanged)

**Trigger.** New image deployed, `/health/deep` flaps or product behaviour
broken, but the database schema is unchanged (no migration in the
deploy).

**Steps.**

1. Identify the previous green image tag from the last green CI run on
   `main`. CI tags images with the commit SHA — `git log -1 --format=%H`
   on the last commit that was green before the bad merge.
2. Re-deploy that image (host-specific — Render dashboard / Fly CLI /
   k8s `kubectl rollout undo`).
3. Wait for `/health/deep` to return 200 from the new replicas.
4. Verify a real end-to-end flow: POST a glucose reading with a test
   account, confirm 201 + worker fired (check Sentry breadcrumb).
5. Open a PR reverting the bad commit on `main` — never leave HEAD
   pointing at code that's not running in prod for more than one
   working day. Use `git revert <sha>` (not `git reset --hard`).

**Safety asserts.**

- Did the bad release add any new env vars? If yes, the old image will
  refuse to boot — env schema is fail-fast (see
  `apps/server/src/config/env.ts`). Add the var to the old deploy
  before rolling back, OR roll back env first.
- Did the bad release publish any push notifications with bad copy?
  Notifications already sent are unrecoverable. Note the count, file
  a separate incident report.

---

## 2. Migration revert (bad schema change)

**Trigger.** A migration ran (deploy includes a new file under
`apps/server/prisma/migrations/`) and the new code is broken in a way
that touches the schema. `/health/deep` may be reporting Postgres
errors.

**Steps.**

1. **Stop new writes.** Set the maintenance flag — see
   `apps/server/src/shared/flags/`:
   ```
   curl -X PUT https://api.swasthparivar.com/admin/flags/maintenance_mode \
     -H "Authorization: Bearer $ADMIN_API_TOKEN" \
     -H "X-Admin-Actor: $(whoami)" \
     -d '{"value": true}'
   ```
   Then in `apps/server/src/app.ts` add a maintenance-mode guard that
   reads this flag and returns 503 for write routes. (TODO: this guard
   is not yet implemented — add it the first time this step is needed.)
2. **Determine if the migration is _recoverable_ or _destructive_.**
   - Recoverable: added a column, added an index, created a new table.
     The old code ignores the new state. → Skip to step 4.
   - Destructive: dropped a column, renamed a column, changed a type,
     converted nullable to NOT NULL. The old code will crash on the
     new shape. → Step 3.
3. **Hand-write a reverse migration.** Prisma does not auto-generate
   down migrations. Author the SQL by hand, get a second reviewer per
   CODEOWNERS, then apply via:
   ```
   pnpm --filter @swasth/server exec prisma db execute --file ./revert.sql
   ```
   Then mark the original migration as rolled back:
   ```
   pnpm --filter @swasth/server exec prisma migrate resolve --rolled-back <migration_name>
   ```
4. **Re-deploy the prior image** (Section 1, steps 2–4).
5. **Clear the maintenance flag:**
   ```
   curl -X PUT https://api.swasthparivar.com/admin/flags/maintenance_mode \
     -H "Authorization: Bearer $ADMIN_API_TOKEN" \
     -H "X-Admin-Actor: $(whoami)" \
     -d '{"value": false}'
   ```

**Safety asserts.**

- The TimescaleDB hypertables (`glucose_readings`, `bp_readings`) use
  a composite PK `[id, measured_at]` — never let a migration rewrite
  the partition key. If that's what broke, **stop** and call the next
  reviewer.
- For destructive migrations, take a `pg_dump --schema-only` snapshot
  before applying the reverse SQL. Store it under `docs/incidents/`
  with the incident date so the next on-call can see what happened.

---

## 3. Provider kill switch (push / SMS / WhatsApp / voice outage)

**Trigger.** A third-party provider is rate-limiting, misbehaving, or
down. The product is otherwise healthy.

**Steps.**

1. Set the relevant flag via the admin API. Example: MSG91 SMS is
   broken, route OTPs through WhatsApp only:
   ```
   curl -X PUT https://api.swasthparivar.com/admin/flags/sms_msg91_enabled \
     -H "Authorization: Bearer $ADMIN_API_TOKEN" \
     -d '{"value": false}'
   ```
2. Read the flag back to confirm:
   ```
   curl https://api.swasthparivar.com/admin/flags/sms_msg91_enabled \
     -H "Authorization: Bearer $ADMIN_API_TOKEN"
   ```
3. Wait up to 30 seconds for in-process flag caches across replicas to
   invalidate (pubsub does this — see `apps/server/src/shared/flags/flags.ts`).
4. Verify behaviour via a real flow.
5. When the provider recovers, set the flag back to `true`. The audit
   log captures who toggled what — review via:
   ```
   curl https://api.swasthparivar.com/admin/flags/sms_msg91_enabled/audit \
     -H "Authorization: Bearer $ADMIN_API_TOKEN"
   ```

**Safety asserts.**

- **Critical-bypass thresholds are HARDCODED and never flagged**
  (medical safety per CLAUDE.md). The bypass _chain_ (push → SMS →
  fullscreen → call) and the `<65 / >315` thresholds cannot be turned
  off. Individual providers within a step (MSG91 inside the SMS step)
  may be flagged off — fullscreen + call button will always still fire.

---

## 4. Database PITR (catastrophic data corruption)

**Trigger.** A bug deleted/corrupted user data and the corruption is
visible in Postgres. Sentry will usually have caught the upstream
crash; the rows themselves are the question.

**Steps.**

1. **Stop writes** (Section 2, step 1 — maintenance flag).
2. From the managed Postgres console, take a manual snapshot of the
   current state to a side branch (don't overwrite the corrupted
   primary — you'll need it for forensics).
3. Identify the last-good timestamp:
   - Check Sentry / structured logs for the first error referencing the
     corruption.
   - Pick a timestamp 5–10 minutes before that.
4. Provision a PITR clone to that timestamp from the managed-DB
   dashboard. This is provider-specific; see `docs/runbooks/dr.md` for
   the per-provider command list (TODO).
5. **Do NOT promote the clone to primary yet.** Validate it: sample
   user readings, run `prisma migrate status` against it, run the
   integration tests against it with `DATABASE_URL` pointed at the
   clone.
6. Promote when validation passes. Re-deploy the server with the new
   `DATABASE_URL` env var.
7. Clear the maintenance flag.
8. Communicate impact to affected users via in-app banner + email
   (manual — no automation here yet).

**Safety asserts.**

- PITR loses everything between the recovery timestamp and the
  incident. For a 10-minute window, that's roughly N×log-rate readings.
  Note the number in the incident report.
- The `client_uuid + version` idempotency (see
  `apps/server/src/modules/readings/readings.service.ts`) means that
  once the recovery clone is live, any mobile sync replay will
  re-create the lost readings idempotently — no manual reconciliation
  needed for offline-buffered data.

---

## 5. Full-stack outage (provider unknown, everything red)

**Trigger.** `/health` itself is 500-ing, multiple replicas, every
endpoint affected.

**Steps.**

1. Page the second on-call (CODEOWNERS).
2. Check the host's status page (Render / Fly / k8s control plane).
3. Check the managed Postgres + Redis status pages.
4. Check Sentry dashboard — what's the first error timestamp?
5. If the host is genuinely down (rare): nothing to do but wait + post
   a status update.
6. If the issue is internal: roll back to the last green image
   (Section 1) **without diagnosing first**. Restoring service beats
   understanding the bug. Diagnose post-recovery.

---

## DR drill — quarterly

Run this once a quarter. **The drill is the only thing that turns the
RTO/RPO targets above from aspirations into actuals.**

### Drill checklist

- [ ] Pick an off-hours window (Sunday IST 10pm–midnight typical).
      Announce in the team channel 24h ahead.
- [ ] Spin up a `dr-drill` branch from `main`. Tag the commit so it's
      easy to find later.
- [ ] **Section 1 drill** (image revert):
  - [ ] Identify the previous green image tag in CI history.
  - [ ] Time the operation: from "decision to revert" to "/health/deep
        200 on revert replica."
  - [ ] Record the time in this file's "Drill log" table below.
- [ ] **Section 2 drill** (migration revert):
  - [ ] On `dr-drill`, write a deliberate bad migration that adds a
        NOT NULL column without a default.
  - [ ] Apply it to a staging clone of prod data.
  - [ ] Hand-write the reverse SQL, apply, `prisma migrate resolve`.
  - [ ] Time it. Record below.
- [ ] **Section 3 drill** (flag kill switch):
  - [ ] Toggle `sms_msg91_enabled = false`, verify the audit entry,
        toggle back. Time it.
- [ ] **Section 4 drill** (PITR):
  - [ ] Restore a Postgres PITR clone to a 5-minutes-ago timestamp on
        staging. Validate the schema and a sample row.
  - [ ] Time it.
- [ ] Update each section above with anything that didn't match
      reality (provider UI changed, command argument changed, etc.).
- [ ] Update the RTO/RPO targets at the top of this file with the
      _actual_ worst-case time observed during the drill.
- [ ] Close out: write a one-paragraph postmortem of what surprised
      you. The surprises are the value; smooth drills don't teach much.

### Drill log

| Date                   | Section 1 (image) | Section 2 (migration) | Section 3 (flag) | Section 4 (PITR) | Notes                                    |
| ---------------------- | ----------------- | --------------------- | ---------------- | ---------------- | ---------------------------------------- |
| _next due: 2026-08-14_ | —                 | —                     | —                | —                | First quarterly drill after audit landed |

---
description: Verify, commit, push, and open PR with the SwasthParivar safety checklist.
allowed-tools:
  - Bash
  - Read
  - Grep
  - Glob
---

Ship a change. Do not take shortcuts on safety.

## Step 1 — Pre-flight

- Confirm `/verify` has passed in this session. If not, run `/verify` first and stop on any failure.
- Run `git status` and `git diff --stat` to show the user what will ship.
- Run `git log -5 --oneline` to match the repo's commit message style.

## Step 2 — Stage

Stage modified files **by name**. Never `git add -A` or `git add .` — those can pull in `.env`, credentials, or large binaries.

If untracked files are present, list them and ask the user which to include.

## Step 3 — Commit

Use a conventional commit (`feat:`, `fix:`, `refactor:`, `test:`, `docs:`, `chore:`). Keep subject under 72 chars. Use a HEREDOC to avoid quoting issues. Always end with the Co-Authored-By trailer.

## Step 4 — Push + PR

Push the branch with `-u` if it has no upstream. Then:

```
gh pr create --title "<title>" --body "$(cat <<'EOF'
## Summary
- <1-3 bullets on what changed>

## Phase compliance
- Target phase: Phase <N>
- Tables/endpoints/jobs stay within that phase's allow-list.

## Safety checklist
- [ ] Glucose thresholds untouched (hardcoded 65 / 315)
- [ ] Critical bypass chain still fires all 4 steps in parallel
- [ ] packages/domain-logic/ remains pure (no Prisma/Redis/BullMQ imports, no Date.now())
- [ ] New PostHog events added for any new flow + documented in CLAUDE.md metrics section
- [ ] Fail-safe UI paths covered (offline, backend down, push fail)
- [ ] Elderly UX: 48dp targets, 14px+ body, 20px+ numbers, ≤3 taps on core flows
- [ ] Sync: client_uuid + version used on any new reading type
- [ ] Tests added; coverage thresholds met

## Test plan
- [ ] <how a reviewer can verify>

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Do not push to `main` directly. Do not force-push. Do not use `--no-verify`.

Report the PR URL when done.

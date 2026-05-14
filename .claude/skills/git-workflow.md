---
name: git-workflow
description: Branch naming, conventional commits, and PR guidelines. Load when creating branches, writing commits, or opening PRs.
---

# Skill: Git Workflow

> Read this skill whenever you're creating branches, writing commits, or opening PRs.

---

## Branch Naming

Pattern: `type/short-description`

```
feat/product-filter-drawer
feat/cart-slide-over
fix/mobile-nav-overflow
fix/product-image-aspect-ratio
style/homepage-hero-spacing
refactor/cart-state-to-zustand
chore/update-dependencies
docs/add-api-readme
```

Rules:

- All lowercase, hyphens only (no underscores, no spaces)
- Short but descriptive — someone should know what it does from the branch name alone
- Always branch off `main`, never off another feature branch
- One feature per branch — don't pile unrelated changes

```bash
# Create and switch in one command
git checkout -b feat/product-filter-drawer

# Or with newer git
git switch -c feat/product-filter-drawer
```

---

## Commit Message Format

Conventional Commits — required on every commit.

```
<type>(<scope>): <description>

[optional body — WHY, not WHAT]

[optional footer — Closes #N]
```

### Types

| Type       | When                                  |
| ---------- | ------------------------------------- |
| `feat`     | New feature or user-visible change    |
| `fix`      | Bug fix                               |
| `style`    | CSS/UI changes — no logic change      |
| `refactor` | Code restructure — no behavior change |
| `types`    | TypeScript type changes only          |
| `chore`    | Config, deps, tooling                 |
| `test`     | Adding or fixing tests                |
| `docs`     | README, comments, documentation       |

### Scopes for Jewelry Project

`product` `cart` `auth` `checkout` `order` `category` `layout` `nav` `ui` `api` `db` `hooks` `types` `config`

### Examples

```
feat(product): add mobile filter drawer

Replaces sidebar with slide-in drawer on screens below md breakpoint.
Fixes layout overflow on 375px identified during Figma review.

Closes #42
```

```
fix(cart): prevent duplicate items on rapid add clicks

Disable add-to-cart button during API call to prevent race condition
where same item could be added twice.
```

```
style(product): update card hover to match Figma spec

Scale image to 1.05 on hover with 300ms ease transition.
```

```
refactor(checkout): extract address form to separate component

No behavior change — splits CheckoutPage into smaller components
to make the form logic easier to follow.
```

### Rules

- Imperative mood: "add filter" not "added filter" or "adding filter"
- Under 72 characters in the subject line
- Body explains WHY — the diff shows WHAT
- No period at the end of the subject line

---

## PR Conventions

### Title — same format as commit message

```
feat(product): add mobile filter drawer with category support
fix(cart): resolve duplicate item race condition
style(layout): update header spacing to match Figma v2
```

### PR Description Template

```markdown
## What changed

[2-3 sentences: what was built and the user-visible impact]

## How to test

1. Go to [specific page]
2. Do [specific action]
3. Expected result: [what should happen]

## Screenshots

| Mobile (375px) | Desktop (1280px) |
| -------------- | ---------------- |
| [screenshot]   | [screenshot]     |

## Checklist

- [ ] `npm run type-check` passes
- [ ] `npm run build` passes
- [ ] Tested on mobile (375px)
- [ ] Tested on desktop (1280px)
- [ ] No console.log in production code
```

### PR Size Guidelines

- **Small (ideal):** 1 focused feature or fix, under 200 lines changed
- **Medium (acceptable):** Related changes, under 500 lines
- **Large (split it):** Over 500 lines — break into smaller PRs

### When to Open a Draft PR

Open a draft PR early when:

- You want feedback on the approach before finishing
- It's a large feature spanning multiple sessions
- You want CI to run on the branch

```bash
gh pr create --draft --title "feat(product): add filter drawer" --body "WIP"
```

---

## Everyday Commands

```bash
# Start new feature
git checkout main && git pull
git checkout -b feat/your-feature

# During work — commit often
git add -A
git commit -m "feat(scope): description"

# Push and set upstream (first push on a new branch)
git push --set-upstream origin feat/your-feature

# Subsequent pushes
git push

# Keep branch up to date with main
git fetch origin
git rebase origin/main

# Open PR
gh pr create --title "feat(scope): description" --body "$(cat .github/pr-template.md)"

# Check PR status
gh pr status

# Merge (after approval)
gh pr merge --squash --delete-branch
```

---

## Merge Strategy — Squash and Merge

Always use squash merge when merging PRs. This keeps `main` history clean — one commit per feature, not 20 "WIP" commits.

```bash
gh pr merge --squash --delete-branch
```

The squash commit message should follow the same conventional commit format:

```
feat(product): add mobile filter drawer with category support (#42)
```

---

## What to Never Do

```bash
# Never force push to main
git push --force origin main  # ❌

# Never commit directly to main
git checkout main
git commit ...  # ❌

# Never merge main into a feature branch (rebase instead)
git merge main  # ❌ use: git rebase origin/main

# Never commit secrets or env files
git add .env  # ❌ — .env must be in .gitignore
```

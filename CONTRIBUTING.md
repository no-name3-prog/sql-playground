# Contributing

Thanks for contributing to **SQL Query Playground**.

## Golden rule

**No feature or fix is complete until CI is green.**

Before opening a PR (and before merging anything to `main`):

```bash
npm run setup   # first time
npm run check   # typecheck + tests + build (all packages)
```

`npm run check` is the same gate CI enforces (plus Docker build in GitHub Actions).


## Branch policy (enforced on GitHub)

**Direct pushes to `main` are blocked** for everyone (including admins).

| Rule | Setting |
|------|---------|
| Require pull request | Yes |
| Required CI check | `All checks passed` |
| Branch must be up to date | Yes |
| Force pushes | Disabled |
| Branch deletion | Disabled |
| Apply to admins | Yes |
| Linear history | Yes |

### Correct workflow

```bash
git checkout main
git pull origin main
git checkout -b feature/my-change

# ... implement, then:
npm run check

git add -A
git commit -m "Describe the change clearly"
git push -u origin HEAD

gh pr create --fill
# wait for CI → merge via GitHub (squash/rebase as allowed)
```

Do **not**:

```bash
git push origin main   # rejected by branch protection
```

## Development

```bash
npm run setup
npm run dev          # API :3001 · UI :5173
```

### Useful scripts

| Command | What it does |
|---------|----------------|
| `npm run typecheck` | TypeScript check backend + frontend |
| `npm test` | Backend unit/integration tests |
| `npm run build` | Production builds |
| `npm run check` / `npm run ci` | Full local quality gate |
| `npm run sample --prefix backend` | Re-seed sample DBs |

## Adding a feature

1. Create a branch from up-to-date `main`
2. Implement with clear separation (drivers / analysis / optimization / UI)
3. Add or update tests under `backend/tests/` for engine parsers, analysis, or optimization
4. Run `npm run check`
5. Open a PR using the template and wait for **All checks passed**

### Plan / optimizer changes

- Prefer fixture-based tests for all four engines
- Recommendations must include `planReferences` to real plan nodes
- Do not rely only on SQL string heuristics without plan evidence


## Automatic tests on pull requests

When you **open or update a PR**, GitHub Actions runs CI **automatically** (no manual step):

1. Backend **typecheck + unit/integration tests + build**
2. Frontend **typecheck + build**
3. **Docker** production image build
4. Aggregate gate **All checks passed** (required to merge)
5. A **CI report comment** is posted/updated on the PR

Triggers: `opened`, `synchronize` (new commits), `reopened`, `ready_for_review`.

```bash
git push -u origin HEAD
gh pr create --fill    # CI starts immediately
gh pr checks --watch   # optional: watch from terminal
```

## CI (GitHub Actions)

Workflow: [`.github/workflows/ci.yml`](.github/workflows/ci.yml)

| Job | Checks |
|-----|--------|
| **Backend** | install → seed samples → typecheck → test → build |
| **Frontend** | install → typecheck → build |
| **Docker** | multi-stage production image build |
| **All checks passed** | aggregate gate required for merge |
| **Audit** | npm audit (informational) |

Pushes and pull requests to `main` trigger CI. Branch protection on `main` requires the aggregate check before merge.

## Commit style

Use clear, complete sentences in commit messages (what + why).

## Code of collaboration

- Prefer small, reviewable PRs
- Do not commit `node_modules`, built `dist/`, or secrets
- Keep sample seed data deterministic for tests

## Email notifications (CI / PR failures)

GitHub emails for failed Actions runs are controlled by **your account**, not the workflow file. To stop emails when a PR check fails:

1. Open **[Notification settings](https://github.com/settings/notifications)**
2. Scroll to **Actions**
3. Under **Email**, **uncheck** the Actions email option  
   (or choose not to receive “failed workflows” mail if that sub-option is shown)
4. Click **Save** if prompted

Optional (less noise overall for this repo):

1. Open the repo → **Watch** (top right) → **Participating and @mentions**  
   (avoid **All Activity**)

You will still see red ❌ checks on the PR page and in the Actions tab; only the **email** is turned off.

> There is no repository YAML flag that can disable GitHub’s “workflow failed” emails for your account. That is always a personal notification preference.

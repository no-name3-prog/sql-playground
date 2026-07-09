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

#!/usr/bin/env bash
# Local quality gate — mirrors GitHub Actions CI (except Docker).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "==> Backend typecheck"
npm run typecheck --prefix backend

echo "==> Backend tests"
npm test --prefix backend

echo "==> Backend build"
npm run build --prefix backend

echo "==> Frontend typecheck"
npm run typecheck --prefix frontend

echo "==> Frontend build"
npm run build --prefix frontend

echo ""
echo "✓ All local checks passed. Safe to open a PR / merge after CI is green."

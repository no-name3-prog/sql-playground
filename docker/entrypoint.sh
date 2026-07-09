#!/bin/sh
set -e
cd /app/backend

export DATA_DIR="${DATA_DIR:-/app/backend/data}"
export SERVE_STATIC="${SERVE_STATIC:-true}"
export STATIC_DIR="${STATIC_DIR:-/app/frontend/dist}"
mkdir -p "$DATA_DIR"

if [ ! -f "$DATA_DIR/ecommerce.db" ] || [ ! -f "$DATA_DIR/analytics.duckdb" ]; then
  echo "→ Seeding sample databases into $DATA_DIR ..."
  if [ -f dist/sample/seed.js ]; then
    node dist/sample/seed.js
  else
    ./node_modules/.bin/tsx src/sample/seed.ts
  fi
  echo "→ Sample databases ready."
fi

echo "→ SQL Query Playground listening on :${PORT:-3001}"
exec node dist/index.js

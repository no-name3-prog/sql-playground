# SQL Query Playground

> A modern, multi-engine SQL playground focused on **understanding and optimizing** queries — not just running them.

![Node.js](https://img.shields.io/badge/Node.js-18%2B-339933?logo=node.js&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?logo=typescript&logoColor=white)
![React](https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=black)
![Docker](https://img.shields.io/badge/Docker-ready-2496ED?logo=docker&logoColor=white)
![License](https://img.shields.io/badge/License-MIT-yellow)

**Engines:** PostgreSQL · MySQL · SQLite · DuckDB

---

## Why this project?

Most SQL UIs stop at “run query → table.” This playground goes further:

1. **Execute** against sample or user-provided databases  
2. **Explain** the real execution plan as a visual operator tree  
3. **Optimize** with an AI-style assistant that **grounds every tip in plan operators** (not SQL-only heuristics)

Ideal for learning query planning, teaching performance, and iterating on indexes and rewrites with immediate feedback.

---

## Features

### Query workspace
- Monaco **SQL editor** with syntax highlighting and schema-aware autocomplete  
- **Multi-tab** editor sessions  
- Query **execution** with formatted results, **row count**, and **execution time**  
- **Query history** (reopen past statements in a new tab)  
- **Dark / light** themes (persisted)  
- Resizable editor / results split  

### Multi-engine backend
Modular driver architecture (`BaseDriver`) with first-class support for:

| Engine | Sample / usage |
|--------|----------------|
| **SQLite** | Bundled e-commerce sample (`customers`, `products`, `orders`, …) |
| **DuckDB** | Bundled analytics sample (`users`, `sessions`, `events`) |
| **PostgreSQL** | Connect via host / port / credentials |
| **MySQL** | Connect via host / port / credentials |

### Execution plan analysis
On every successful explainable query:

- Fetch native plans (`EXPLAIN QUERY PLAN`, `EXPLAIN (FORMAT JSON)`, etc.)  
- Normalize into a unified **operator tree**  
- Color-code **scans, joins, sorts, aggregates**, filters, …  
- **Plain-English** explanation per operator  
- **Cost share** estimates and **hot-spot** highlighting  
- UI built for **large plans**: collapse, search, category filters, “hot only” mode  

### AI optimization assistant
Plan-grounded recommendations:

- Detect **anti-patterns** (e.g. sort fed by sequential scan)  
- Suggest **indexes** with `CREATE INDEX` DDL  
- Recommend **query rewrites** (LIMIT, SELECT *, keyset pagination, …)  
- Explain **why** each change helps  
- Estimate **performance improvement** ranges  
- Warn about unnecessary **scans, sorts, and joins**  
- Every card cites **plan node IDs + cost %**  

Optional LLM enrichment: set `XAI_API_KEY` or `OPENAI_API_KEY` so the assistant can propose extra rewrites that still **must reference existing plan nodes**.

---

## Architecture

```
sql-playground/
├── backend/                 # Express + TypeScript API
│   └── src/
│       ├── drivers/         # sqlite | duckdb | postgresql | mysql
│       ├── analysis/        # EXPLAIN parsers, cost, English
│       ├── optimization/    # Plan-grounded recommendation engine
│       ├── routes/          # REST endpoints
│       ├── services/        # connections, query, history
│       └── sample/          # seed sample DBs
├── frontend/                # React + Vite + Zustand + Monaco
├── docker/                  # container entrypoint
├── Dockerfile               # production image (API + UI)
├── Dockerfile.dev           # optional full-stack dev image
└── docker-compose.yml
```

**Separation of concerns**

| Layer | Responsibility |
|-------|----------------|
| Drivers | Connect, execute, EXPLAIN, schema |
| Analysis | Parse plans → tree, costs, narrative |
| Optimization | Rules (+ optional LLM) → recommendations |
| Routes / services | HTTP + orchestration |
| Frontend | Editor, results, plan viz, optimize UI |

---

## Quick start (local)

### Prerequisites
- **Node.js 18+** (20/22 recommended)
- Optional: PostgreSQL / MySQL for remote connections  
- Optional: Docker for containerized run  

### Install & run

```bash
git clone https://github.com/no-name3-prog/sql-playground.git
cd sql-playground
npm run setup          # install root + backend + frontend, seed samples
npm run dev            # API :3001  ·  UI :5173
```

Open **http://localhost:5173**

| Script | Description |
|--------|-------------|
| `npm run setup` | Install deps + seed SQLite/DuckDB samples |
| `npm run dev` | Concurrent backend + frontend |
| `npm run build` | Production builds |
| `npm test` | Backend unit/integration tests |
| `npm run sample --prefix backend` | Re-seed sample databases |

---

## Docker

### Production image (recommended)

Single container serves **API + built UI** on port **3001**.

```bash
# Build
docker build -t sql-playground:latest .

# Run
docker run --rm -p 3001:3001 --name sql-playground sql-playground:latest
```

Open **http://localhost:3001**

### Docker Compose

```bash
docker compose up --build
```

- Image: `sql-playground:latest`  
- Port: `3001`  
- Volume: `sql-playground-data` → `/app/backend/data` (sample DBs persist)  
- Healthcheck hits `/api/health`  

```bash
# stop
docker compose down

# optional env
PORT=3001 CORS_ORIGIN=* docker compose up --build
```

### Optional LLM inside Docker

```bash
docker run --rm -p 3001:3001 \
  -e XAI_API_KEY=your_key \
  sql-playground:latest
```

### Dev image (hot reload)

```bash
docker build -f Dockerfile.dev -t sql-playground:dev .
docker run --rm -p 3001:3001 -p 5173:5173 sql-playground:dev
```

### Image layout

| Path in container | Contents |
|-------------------|----------|
| `/app/backend/dist` | Compiled API |
| `/app/frontend/dist` | Static SPA (served when `SERVE_STATIC=true`) |
| `/app/backend/data` | SQLite / DuckDB files |

---

## Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3001` | API port |
| `CORS_ORIGIN` | `http://localhost:5173` | CORS origin (`*` allowed in Docker) |
| `SERVE_STATIC` | unset / `true` in Docker | Serve frontend build from API |
| `STATIC_DIR` | auto-detected | Path to `index.html` build |
| `DATA_DIR` | `backend/data` | Sample / file DB directory |
| `XAI_API_KEY` | — | Optional xAI enrichment for optimizer |
| `OPENAI_API_KEY` | — | Optional OpenAI enrichment |
| `SQL_OPTIMIZER_MODEL` | `grok-3` / `gpt-4o-mini` | Model override |

Copy examples:

```bash
cp backend/.env.example backend/.env
```

---

## API overview

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/health` | Health + supported engines |
| `GET` | `/api/connections` | List connections |
| `POST` | `/api/connections` | Create / test connection |
| `DELETE` | `/api/connections/:id` | Remove (non-sample) |
| `POST` | `/api/query/execute` | Run SQL → results + **analysis** + **optimization** |
| `POST` | `/api/query/analyze` | Plan analysis only |
| `POST` | `/api/query/optimize` | Optimization report (plan-grounded) |
| `GET` | `/api/query/schema/:id` | Schema introspection |
| `GET` | `/api/history` | Query history |
| `DELETE` | `/api/history` | Clear history |

### Execute response shape (abridged)

```json
{
  "success": true,
  "result": { "columns": [], "rows": [], "rowCount": 0, "executionTimeMs": 1.2 },
  "analysis": { "root": {}, "expensiveNodes": [], "summary": "..." },
  "optimization": {
    "score": 72,
    "recommendations": [
      {
        "type": "index",
        "severity": "high",
        "title": "Sequential scan is a plan hotspot",
        "planReferences": [{ "nodeId": "sqlite-2", "label": "SCAN", "costPercent": 24.5 }],
        "ddl": "CREATE INDEX ...",
        "estimatedImprovement": { "summary": "..." }
      }
    ]
  }
}
```

---

## Sample databases

Seeded by `npm run setup` / Docker entrypoint:

### E-Commerce (SQLite)
`customers`, `products`, `orders`, `order_items`

```sql
SELECT c.name, COUNT(o.id) AS orders, ROUND(SUM(o.total), 2) AS revenue
FROM customers c
JOIN orders o ON o.customer_id = c.id
WHERE o.status = 'completed'
GROUP BY c.name
ORDER BY revenue DESC;
```

### Analytics (DuckDB)
`users`, `sessions`, `events`

```sql
SELECT u.username, u.plan, COUNT(e.id) AS events
FROM users u
LEFT JOIN events e ON e.user_id = u.id
GROUP BY u.username, u.plan
ORDER BY events DESC;
```

---

## Testing

```bash
cd backend
npm test
```

Coverage includes:

- Plan parsers for **all four engines** (fixture-based)  
- Live EXPLAIN for **SQLite** + **DuckDB**  
- Optimization **plan-grounding** invariants (every recommendation cites real node IDs)  
- Optional live Postgres/MySQL when `TEST_PG_*` / `TEST_MYSQL_*` are set  

---

## UI guide

| Tab | Purpose |
|-----|---------|
| **Results** | Table output, timing, row counts |
| **Analysis** | Operator tree, costs, English explanations |
| **Optimize** | Health score, anti-patterns, indexes, rewrites |

Tips:

- `⌘/Ctrl + Enter` — run query  
- Double-click a table in **Schema** — insert `SELECT *`  
- **Apply to editor** on a rewrite card — load suggested SQL  

---

## Project scripts (root)

```json
{
  "dev": "backend + frontend concurrently",
  "setup": "install all workspaces + seed",
  "build": "build backend and frontend",
  "test": "backend test suite",
  "start": "start production backend"
}
```

---

## Roadmap ideas

- [ ] Persist history to disk / DB  
- [ ] Side-by-side plan comparison after rewrite  
- [ ] Export results (CSV / JSON)  
- [ ] Auth and multi-user workspaces  
- [ ] Deeper EXPLAIN ANALYZE timings when safe  

---

## Contributing

1. Fork & clone  
2. `npm run setup && npm run dev`  
3. Keep drivers, analysis parsers, and optimization rules covered by tests  
4. Open a PR with a clear description  

---


---

## Continuous Integration & quality gates

Every push and pull request to `main` runs **GitHub Actions** (`.github/workflows/ci.yml`):

| Check | What runs |
|-------|-----------|
| **Backend** | `typecheck` → `test` (all engines fixtures + live SQLite/DuckDB) → `build` |
| **Frontend** | `typecheck` → production `build` |
| **Docker** | Multi-stage production image build |
| **All checks passed** | Aggregate job required before merge |
| **Audit** | `npm audit` (informational) |

### Local gate (run before any feature PR)

```bash
npm run check
# or
./scripts/check.sh
```

This mirrors CI (typecheck + tests + build). **Do not merge features without a green CI run.**

**`main` is protected:** direct pushes are blocked. Open a pull request; CI must pass before merge. See [CONTRIBUTING.md](./CONTRIBUTING.md).

See [CONTRIBUTING.md](./CONTRIBUTING.md) for the full workflow and PR checklist.

## License

[MIT](./LICENSE) © 2026 Sarthak Vaish

---

## Author

**Sarthak Vaish** · [github.com/no-name3-prog](https://github.com/no-name3-prog)

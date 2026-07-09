# ─── Stage 1: build frontend ───────────────────────────────────────────────
FROM node:22-bookworm-slim AS frontend-build
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# ─── Stage 2: build backend ────────────────────────────────────────────────
FROM node:22-bookworm-slim AS backend-build
WORKDIR /app/backend
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ ca-certificates \
    && rm -rf /var/lib/apt/lists/*
COPY backend/package.json backend/package-lock.json ./
RUN npm ci
COPY backend/ ./
RUN npm run build \
 && npm prune --omit=dev \
 && npm install --no-save tsx@4.19.2

# ─── Stage 3: production runtime ───────────────────────────────────────────
FROM node:22-bookworm-slim AS runtime
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates libstdc++6 \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd -r app && useradd -r -g app -m app

COPY --from=backend-build /app/backend/package.json ./backend/package.json
COPY --from=backend-build /app/backend/node_modules ./backend/node_modules
COPY --from=backend-build /app/backend/dist ./backend/dist
COPY --from=backend-build /app/backend/src ./backend/src
COPY --from=frontend-build /app/frontend/dist ./frontend/dist

COPY docker/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh \
    && mkdir -p /app/backend/data \
    && chown -R app:app /app

ENV NODE_ENV=production \
    PORT=3001 \
    CORS_ORIGIN=* \
    SERVE_STATIC=true \
    STATIC_DIR=/app/frontend/dist \
    DATA_DIR=/app/backend/data

WORKDIR /app/backend
USER app
EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=25s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3001)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/entrypoint.sh"]

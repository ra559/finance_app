# syntax=docker/dockerfile:1

# ── Production dependencies (native SQLite is compiled here) ──
FROM node:22-bookworm-slim AS deps
WORKDIR /app
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

# ── Web build ─────────────────────────────────────────────────
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build

# ── Runtime ───────────────────────────────────────────────────
FROM node:22-bookworm-slim AS runtime

ENV NODE_ENV=production \
    PORT=3000 \
    DATA_DIR=/data

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends tini curl ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /data \
    && chown -R node:node /data

COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
COPY server ./server
COPY scripts ./scripts

USER node

EXPOSE 3000
VOLUME ["/data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "server/index.js"]

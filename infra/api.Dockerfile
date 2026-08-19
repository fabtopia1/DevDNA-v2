# syntax=docker/dockerfile:1
#
# Multi-stage so the runtime image carries no compiler, no test tooling and no
# source: the API handles device identifiers, and a smaller image is a smaller
# thing to audit.

FROM node:22-bookworm-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY packages/core/package.json packages/core/
COPY apps/api/package.json apps/api/
COPY apps/bridge/package.json apps/bridge/
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile

FROM deps AS build
COPY tsconfig.base.json ./
COPY packages/core packages/core
COPY apps/api apps/api
RUN pnpm --filter @devdna/core build \
 && pnpm --filter @devdna/api exec prisma generate \
 && pnpm --filter @devdna/api build

FROM base AS runtime
ENV NODE_ENV=production
# OpenSSL is required by Prisma's query engine.
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages/core/dist ./packages/core/dist
COPY --from=build /app/packages/core/package.json ./packages/core/package.json
COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY --from=build /app/apps/api/package.json ./apps/api/package.json
COPY --from=build /app/apps/api/prisma ./apps/api/prisma

RUN useradd --system --uid 10001 devdna \
 && mkdir -p /var/lib/devdna/reports \
 && chown -R devdna /var/lib/devdna
USER devdna
WORKDIR /app/apps/api
EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:4000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# Migrations run as a separate task in production (see the deployment doc);
# applying them here is safe because `migrate deploy` is idempotent and never
# generates new migrations.
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/main.js"]

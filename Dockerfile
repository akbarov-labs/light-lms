# Multi-stage build: deps -> source -> web (Next standalone) | worker (bundled files) | tools (migrate, seed, scripts).

FROM node:22.23-alpine AS base
RUN apk add --no-cache libc6-compat
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

# openssl only where the Prisma CLI runs: its schema engine (migrate) is still a native binary, chosen by
# the openssl version at install time. The web and worker images have no Prisma engine at all (Prisma 7).
FROM base AS deps
RUN apk add --no-cache openssl
COPY package.json package-lock.json prisma.config.ts ./
COPY prisma/schema.prisma ./prisma/schema.prisma
# postinstall runs `prisma generate` (client → src/generated/prisma)
RUN npm ci --no-audit --no-fund

# Full source + generated Prisma client, shared by the build, worker-build and tools stages.
# No second `prisma generate`: the deps stage already generated from the same schema.prisma, and
# .dockerignore excludes src/generated, so `COPY . .` adds the source next to that client without touching it.
FROM deps AS source
COPY . .

FROM source AS build
RUN npm run build

# Worker: src/worker (+ src/lib, the Prisma client with its query compiler, pg, grammY, node-cron, zod,
# the demo seed …) bundled by esbuild; the two entry points share chunks. No node_modules at runtime.
FROM source AS worker-build
RUN npx esbuild src/worker/index.ts src/worker/run-job.ts --bundle --splitting --platform=node --target=node22 --format=esm \
      --outdir=dist/worker --out-extension:.js=.mjs "--chunk-names=chunks/[name]-[hash]" --external:pg-native --sourcemap \
      --log-level=warning "--banner:js=import { createRequire as __lmsCR } from 'node:module'; const require = __lmsCR(import.meta.url);"

# Migrations, the demo seed and one-off scripts run from the full source with tsx:
#   docker compose run --rm migrate npx tsx scripts/reset-password.ts 901234567
FROM source AS tools
ENV NODE_ENV=production
USER node
CMD ["sh", "-c", "npx prisma migrate deploy && npx tsx prisma/seed-if-empty.ts"]

FROM base AS worker
ENV NODE_ENV=production
COPY --from=worker-build /app/dist/worker ./
USER node
# a job by hand: docker compose exec worker node run-job.mjs nightly [YYYY-MM-DD]
CMD ["node", "--enable-source-maps", "index.mjs"]

FROM base AS web
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
COPY --from=build --chown=node:node /app/public ./public
USER node
EXPOSE 3000
CMD ["node", "server.js"]

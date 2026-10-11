# Multi-stage build: deps -> build (Next standalone) -> web runtime; "tools" runs migrations, seed and the worker.

FROM node:22-alpine AS base
RUN apk add --no-cache openssl libc6-compat
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

FROM base AS deps
COPY package.json package-lock.json ./
COPY prisma/schema.prisma ./prisma/schema.prisma
RUN npm ci --no-audit --no-fund

FROM deps AS build
COPY . .
RUN npx prisma generate && npm run build

# Migrations, seed and the worker (bot + cron jobs) run from the full source with tsx.
FROM deps AS tools
ENV NODE_ENV=production
COPY . .
RUN npx prisma generate && chown -R node:node /app
USER node
CMD ["npx", "tsx", "src/worker/index.ts"]

FROM base AS web
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
COPY --from=build --chown=node:node /app/public ./public
USER node
EXPOSE 3000
CMD ["node", "server.js"]

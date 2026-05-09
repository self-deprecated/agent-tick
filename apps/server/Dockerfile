FROM docker.io/library/node:24-bookworm-slim AS build

WORKDIR /src
RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/package.json
COPY packages/sdk/package.json packages/sdk/package.json
COPY packages/db/package.json packages/db/package.json
COPY apps/server/package.json apps/server/package.json
COPY apps/admin/package.json apps/admin/package.json
COPY apps/admin/svelte.config.js apps/admin/vite.config.ts apps/admin/tsconfig.json apps/admin/index.html apps/admin/

RUN pnpm install --frozen-lockfile

COPY packages packages
COPY apps/server apps/server
COPY apps/admin apps/admin

RUN pnpm --filter @agent-tick/shared build \
  && pnpm --filter @agent-tick/sdk build \
  && pnpm --filter @agent-tick/db build \
  && pnpm --filter @agent-tick/server build \
  && pnpm --filter agent-tick-admin build \
  && pnpm --filter @agent-tick/server deploy --prod --legacy /app-runtime \
  && rm -rf /app-runtime/src /app-runtime/test /app-runtime/public/admin \
  && mkdir -p /app-runtime/public \
  && cp -R apps/server/public/admin /app-runtime/public/admin

FROM docker.io/library/node:24-bookworm-slim AS runtime

ENV NODE_ENV=production \
  AGENT_TICK_HOST=0.0.0.0 \
  AGENT_TICK_PORT=8787 \
  AGENT_TICK_DATABASE_URL=file:/data/agent-tick.db

WORKDIR /app

COPY --from=build /app-runtime ./

RUN mkdir -p /data && chown -R node:node /data /app
USER node

EXPOSE 8787

CMD ["node", "dist/index.js"]

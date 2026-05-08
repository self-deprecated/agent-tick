FROM docker.io/library/node:24-bookworm-slim AS build

WORKDIR /src
RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/package.json
COPY packages/sdk/package.json packages/sdk/package.json
COPY packages/db/package.json packages/db/package.json
COPY apps/server-ts/package.json apps/server-ts/package.json
COPY apps/admin/package.json apps/admin/package.json
COPY apps/admin/svelte.config.js apps/admin/vite.config.ts apps/admin/tsconfig.json apps/admin/index.html apps/admin/

RUN pnpm install --frozen-lockfile

COPY packages packages
COPY apps/server-ts apps/server-ts
COPY apps/admin apps/admin

RUN pnpm --filter @agent-tick/shared build \
  && pnpm --filter @agent-tick/sdk build \
  && pnpm --filter @agent-tick/db build \
  && pnpm --filter @agent-tick/server build \
  && pnpm --filter agent-tick-admin build

FROM docker.io/library/node:24-bookworm-slim AS runtime

ENV NODE_ENV=production \
  AGENT_TICK_HOST=0.0.0.0 \
  AGENT_TICK_PORT=8787 \
  AGENT_TICK_DATABASE_URL=file:/data/agent-tick.db

WORKDIR /app

COPY --from=build /src/package.json /src/pnpm-lock.yaml /src/pnpm-workspace.yaml ./
COPY --from=build /src/node_modules ./node_modules
COPY --from=build /src/packages ./packages
COPY --from=build /src/apps/server-ts ./apps/server-ts

RUN mkdir -p /data && chown -R node:node /data /app
USER node

EXPOSE 8787

CMD ["node", "apps/server-ts/dist/index.js"]

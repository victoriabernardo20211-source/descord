# ── build ────────────────────────────────────────────────────────────────────
FROM node:22-bookworm-slim AS build
WORKDIR /app

# Build não tem terminal interativo. Sem isto, o pnpm se recusa a limpar o
# node_modules ao trocar para o modo produção e aborta com ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY.
ENV CI=true

RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ openssl \
  && rm -rf /var/lib/apt/lists/*
RUN corepack enable

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml turbo.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/server/package.json apps/server/
RUN pnpm install --frozen-lockfile --filter @nexus/server... --filter @nexus/shared

COPY packages/shared packages/shared
COPY apps/server apps/server
RUN pnpm --filter @nexus/shared build \
  && pnpm --filter @nexus/server exec prisma generate \
  && pnpm --filter @nexus/server exec nest build

# Reinstala só as dependências de produção para a imagem final.
RUN pnpm install --frozen-lockfile --prod --filter @nexus/server... --filter @nexus/shared \
  && pnpm --filter @nexus/server exec prisma generate

# ── runtime ──────────────────────────────────────────────────────────────────
FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages/shared/dist ./packages/shared/dist
COPY --from=build /app/packages/shared/package.json ./packages/shared/package.json
COPY --from=build /app/apps/server/dist ./apps/server/dist
COPY --from=build /app/apps/server/node_modules ./apps/server/node_modules
COPY --from=build /app/apps/server/package.json ./apps/server/package.json
COPY --from=build /app/apps/server/prisma ./apps/server/prisma
COPY infrastructure/docker/entrypoint.sh /entrypoint.sh

RUN mkdir -p /data/storage && chown -R node:node /data
USER node
EXPOSE 4000
ENTRYPOINT ["/bin/sh", "/entrypoint.sh"]

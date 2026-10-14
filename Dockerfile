# Svalin API — production image. Build from the repo root:
#   docker build -t svalin-api .
FROM node:22-slim AS build
WORKDIR /repo
RUN corepack enable
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json turbo.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/chain-config/package.json packages/chain-config/
COPY apps/api/package.json apps/api/
RUN pnpm install --frozen-lockfile --filter @svalin-agent/api...
COPY packages/shared packages/shared
COPY packages/chain-config packages/chain-config
COPY apps/api apps/api
RUN pnpm --filter @svalin-agent/api... build \
 && pnpm --filter @svalin-agent/api deploy --prod --legacy /out

FROM node:22-slim
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /out .
USER node
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=3s CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/index.js"]

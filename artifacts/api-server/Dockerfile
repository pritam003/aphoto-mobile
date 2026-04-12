FROM node:22-alpine AS builder
WORKDIR /app

# Copy workspace manifests
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./
COPY artifacts/api-server/package.json ./artifacts/api-server/
COPY lib/db/package.json ./lib/db/
COPY lib/api-spec/package.json ./lib/api-spec/
COPY lib/api-zod/package.json ./lib/api-zod/
COPY lib/api-client-react/package.json ./lib/api-client-react/

RUN corepack enable && pnpm install --frozen-lockfile

COPY artifacts/api-server ./artifacts/api-server
COPY lib ./lib

RUN node artifacts/api-server/build.mjs

# ---- runtime ----
FROM node:22-alpine
WORKDIR /app

COPY --from=builder /app/artifacts/api-server/dist ./dist
# Merge workspace root node_modules first, then overlay api-server node_modules
# so @azure/* and other externalized packages are resolvable from /app/node_modules
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/artifacts/api-server/node_modules ./node_modules

ENV NODE_ENV=production
EXPOSE 3000

CMD ["node", "--enable-source-maps", "dist/index.mjs"]

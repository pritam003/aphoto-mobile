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

# Build the app (outputs to artifacts/api-server/dist)
RUN node artifacts/api-server/build.mjs

# Use pnpm deploy to create a self-contained folder with all resolved node_modules
# (includes .pnpm store so symlinks resolve correctly)
RUN pnpm --filter @workspace/api-server deploy --prod --legacy /app/deploy

# Copy the built dist into the deploy folder (pnpm deploy copies source files including dist)
# dist is already included by pnpm deploy since it copies repo files

# ---- runtime ----
FROM node:22-alpine
WORKDIR /app

COPY --from=builder /app/deploy ./

ENV NODE_ENV=production
EXPOSE 3000

CMD ["node", "--enable-source-maps", "dist/index.mjs"]

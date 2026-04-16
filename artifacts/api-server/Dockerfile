FROM node:22-alpine AS builder
WORKDIR /app

# Build tools for native modules (canvas: cairo/pango; tfjs-node: python/make/g++)
RUN apk add --no-cache python3 make g++ \
    cairo-dev pango-dev giflib-dev librsvg-dev pixman-dev

# Copy workspace manifests
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./
COPY artifacts/api-server/package.json ./artifacts/api-server/
COPY lib/db/package.json ./lib/db/
COPY lib/api-spec/package.json ./lib/api-spec/
COPY lib/api-zod/package.json ./lib/api-zod/
COPY lib/api-client-react/package.json ./lib/api-client-react/

RUN corepack enable && pnpm install --frozen-lockfile

# Build native modules in the workspace so they are available in /app/node_modules.
# sharp uses the prebuilt @img/sharp-linuxmusl-x64 binary from the lockfile.
RUN pnpm rebuild canvas @tensorflow/tfjs-node

COPY artifacts/api-server ./artifacts/api-server
COPY lib ./lib

# Build the app (outputs to artifacts/api-server/dist)
RUN node artifacts/api-server/build.mjs

# Use pnpm deploy to create a self-contained folder with all resolved node_modules
# (includes .pnpm store so symlinks resolve correctly)
RUN pnpm --filter @workspace/api-server deploy --prod --legacy /app/deploy

# pnpm deploy reinstalls packages and may skip lifecycle scripts for native modules.
# Rebuild canvas and tfjs-node inside the deploy directory using build tools already present.
WORKDIR /app/deploy
# pnpm rebuild can silently fail in the deploy dir (no lockfile); npm rebuild is more reliable here.
RUN npm rebuild canvas @tensorflow/tfjs-node 2>&1 || true
WORKDIR /app

# ---- runtime ----
FROM node:22-alpine
WORKDIR /app

# Runtime shared libraries required by canvas, tfjs-node, and sharp
RUN apk add --no-cache cairo pango giflib librsvg pixman vips

COPY --from=builder /app/deploy ./

ENV NODE_ENV=production
EXPOSE 3000

CMD ["node", "--enable-source-maps", "dist/index.mjs"]

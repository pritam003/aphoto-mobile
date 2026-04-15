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

COPY artifacts/api-server ./artifacts/api-server
COPY lib ./lib

# Build the app (outputs to artifacts/api-server/dist)
RUN node artifacts/api-server/build.mjs

# Use pnpm deploy to create a self-contained folder with all resolved node_modules
# (includes .pnpm store so symlinks resolve correctly)
RUN pnpm --filter @workspace/api-server deploy --prod --legacy /app/deploy

# Rebuild native modules for linux/alpine (macOS .node files won't work here)
# sharp uses prebuilt @img/sharp-linux-musl-x64 from lockfile — no source build needed
WORKDIR /app/deploy
RUN npm rebuild canvas @tensorflow/tfjs-node --build-from-source

# ---- runtime ----
FROM node:22-alpine
WORKDIR /app

# Runtime shared libraries required by canvas, tfjs-node, and sharp
RUN apk add --no-cache cairo pango giflib librsvg pixman vips

COPY --from=builder /app/deploy ./

ENV NODE_ENV=production
EXPOSE 3000

CMD ["node", "--enable-source-maps", "dist/index.mjs"]

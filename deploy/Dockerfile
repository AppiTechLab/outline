# Self-contained build of Outline from this source tree.
#
# The repo's own Dockerfile expects a prebuilt `outlinewiki/outline-base` image.
# This file inlines that base stage (from ../Dockerfile.base) so the whole thing
# builds in one `docker compose build`. Build context is the repo root.

ARG APP_PATH=/opt/outline

# ---------------------------------------------------------------------------
# Stage 1: install dependencies and build the app (mirrors ../Dockerfile.base)
# ---------------------------------------------------------------------------
FROM node:26.3.0 AS base

ARG APP_PATH
WORKDIR $APP_PATH

COPY ./package.json ./yarn.lock ./.yarnrc.yml ./
COPY ./patches ./patches

RUN apt-get update && apt-get install -y cmake && rm -rf /var/lib/apt/lists/*

# The Vite client build is memory hungry. Raise this if the build is killed
# partway through; also raise Docker Desktop's memory limit to match.
ARG NODE_BUILD_MEMORY=8192
ENV NODE_OPTIONS="--max-old-space-size=${NODE_BUILD_MEMORY}"

RUN npm install -g corepack && corepack enable

RUN yarn install --immutable --network-timeout 1000000 && yarn cache clean

COPY . .

ARG CDN_URL
RUN yarn build

# Drop devDependencies from node_modules before copying into the runner.
RUN yarn workspaces focus --production && yarn cache clean

# ---------------------------------------------------------------------------
# Stage 2: slim runtime image (mirrors ../Dockerfile)
# ---------------------------------------------------------------------------
FROM node:26.3.0-slim AS runner

LABEL org.opencontainers.image.source="https://github.com/outline/outline"

ARG APP_PATH
WORKDIR $APP_PATH

ENV NODE_ENV=production

# Limit glibc malloc arenas, which default to 8 per CPU. Each arena can hold
# onto 64MB of virtual memory and freed allocations, which inflates resident
# memory in multi-threaded Node.js processes for no performance benefit here.
ENV MALLOC_ARENA_MAX=2

RUN addgroup --gid 1001 nodejs && \
    adduser --uid 1001 --ingroup nodejs nodejs && \
    mkdir -p /var/lib/outline && \
    chown -R nodejs:nodejs /var/lib/outline && \
    chown -R nodejs:nodejs $APP_PATH

# wget is used by the healthcheck below.
RUN apt-get update && \
    apt-get install -y --no-install-recommends wget && \
    rm -rf /var/lib/apt/lists/*

COPY --from=base --chown=nodejs:nodejs $APP_PATH/build ./build
COPY --from=base --chown=nodejs:nodejs $APP_PATH/server ./server
COPY --from=base --chown=nodejs:nodejs $APP_PATH/public ./public
COPY --from=base --chown=nodejs:nodejs $APP_PATH/.sequelizerc ./.sequelizerc
COPY --from=base --chown=nodejs:nodejs $APP_PATH/node_modules ./node_modules
COPY --from=base --chown=nodejs:nodejs $APP_PATH/package.json ./package.json

ENV FILE_STORAGE_LOCAL_ROOT_DIR=/var/lib/outline/data
RUN mkdir -p "$FILE_STORAGE_LOCAL_ROOT_DIR" && \
    chown -R nodejs:nodejs "$FILE_STORAGE_LOCAL_ROOT_DIR" && \
    chmod 1777 "$FILE_STORAGE_LOCAL_ROOT_DIR"

VOLUME /var/lib/outline/data

USER nodejs

HEALTHCHECK --interval=1m --start-period=60s \
  CMD wget -qO- "http://localhost:${PORT:-3000}/_health" | grep -q "OK" || exit 1

EXPOSE 3000

CMD ["node", "build/server/index.js"]

# LootDen server image (API + web UI).
# Build: docker build -t lootden .

FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/server/package.json packages/server/
COPY packages/client/package.json packages/client/
COPY packages/web/package.json packages/web/
COPY packages/desktop/package.json packages/desktop/
RUN npm ci --ignore-scripts
COPY packages/shared packages/shared
COPY packages/server packages/server
COPY packages/web packages/web
# Your logos (see brand/README.md); the web build falls back to the built-in ones.
COPY brand brand
RUN npx tsc -b packages/shared packages/server && npm run build -w @lootden/web

FROM node:22-alpine
LABEL org.opencontainers.image.title="LootDen" \
      org.opencontainers.image.description="Self-hosted game library: browse, download and play the games you own" \
      org.opencontainers.image.source="https://github.com/Spacegoose02/lootden"
# The server defaults to /games, /data and port 8080; LOOTDEN_GAMES_DIR, LOOTDEN_DATA_DIR and
# LOOTDEN_PORT (or the older GM_ names) change them.
ENV NODE_ENV=production \
    PUID=99 \
    PGID=100
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/server/package.json packages/server/
COPY packages/client/package.json packages/client/
COPY packages/web/package.json packages/web/
COPY packages/desktop/package.json packages/desktop/
RUN npm ci --omit=dev --ignore-scripts --workspace @lootden/server --workspace @lootden/shared \
    && npm cache clean --force \
    && rm -rf packages/client packages/web/package.json packages/desktop
COPY --from=build /app/packages/shared/dist packages/shared/dist
COPY --from=build /app/packages/server/dist/src packages/server/dist/src
COPY --from=build /app/packages/web/dist packages/web/dist
COPY docker-entrypoint.sh /usr/local/bin/
# 7-Zip unpacks and re-zips finished downloads during import. The entrypoint is made
# executable with Unix line endings here, because a Windows checkout can lose both.
RUN apk add --no-cache 7zip && mkdir -p /games /data \
    && sed -i 's/\r$//' /usr/local/bin/docker-entrypoint.sh \
    && chmod 755 /usr/local/bin/docker-entrypoint.sh
EXPOSE 8080
VOLUME ["/data"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD wget -qO- "http://127.0.0.1:${LOOTDEN_PORT:-${GM_PORT:-8080}}/api/health" >/dev/null || exit 1
ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
CMD ["node", "--disable-warning=ExperimentalWarning", "packages/server/dist/src/index.js"]

FROM mirror.gcr.io/library/node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY index.html manifest.webmanifest sw.js ./
COPY app ./app
COPY admin ./admin
COPY data ./data
COPY media ./media
COPY server/src ./server/src
COPY server/migrations ./server/migrations
COPY scripts/build-server-web.mjs scripts/catalog-cli.mjs scripts/validate-catalog.mjs scripts/backup.mjs scripts/restore.mjs ./scripts/
COPY scripts/lib ./scripts/lib
# Cache for legacy MySQL-backed image blobs and subtitle uploads. New catalog/Broadcast photos are stored in R2;
# this volume only avoids re-reading legacy files from the database after a restart.
RUN mkdir -p /app/uploads /app/backups /app/.build && chown -R node:node /app/uploads /app/backups /app/.build
VOLUME ["/app/uploads", "/app/backups"]
EXPOSE 3000
USER node
RUN npm run build:server-web
CMD ["node", "server/src/index.js"]

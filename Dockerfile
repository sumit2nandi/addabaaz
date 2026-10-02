FROM node:22-alpine
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
COPY scripts/catalog-cli.mjs scripts/validate-catalog.mjs scripts/backup.mjs scripts/restore.mjs ./scripts/
# Local cache of admin-uploaded images and subtitles. The real copies are stored in MySQL, so losing this folder loses nothing;
# a volume (see docker-compose.yml) only saves re-reading them from the database after a restart.
RUN mkdir -p /app/uploads /app/backups && chown node:node /app/uploads /app/backups
VOLUME ["/app/uploads", "/app/backups"]
EXPOSE 3000
USER node
CMD ["node", "server/src/index.js"]

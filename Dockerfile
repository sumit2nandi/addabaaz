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
COPY scripts/catalog-cli.mjs scripts/validate-catalog.mjs ./scripts/
# Admin-uploaded images live here — mount a persistent volume (see docker-compose.yml).
RUN mkdir -p /app/uploads && chown node:node /app/uploads
VOLUME ["/app/uploads"]
EXPOSE 3000
USER node
CMD ["node", "server/src/index.js"]

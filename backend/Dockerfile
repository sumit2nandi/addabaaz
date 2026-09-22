FROM node:22-bookworm-slim
WORKDIR /app/backend
COPY backend/package*.json ./
RUN npm ci --omit=dev
COPY backend/src ./src
COPY backend/scripts ./scripts
COPY backend/migrations ./migrations
COPY backend/seed ./seed
COPY backend/media ./media
COPY shared /app/shared
COPY frontend /app/frontend
RUN chown -R node:node /app/backend/media
USER node
EXPOSE 3000
CMD ["sh", "-c", "npm run migrate && npm start"]

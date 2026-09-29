FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY index.html manifest.webmanifest sw.js ./
COPY app ./app
COPY data ./data
COPY media ./media
COPY server/src ./server/src
COPY server/migrations ./server/migrations
EXPOSE 3000
USER node
CMD ["node", "server/src/index.js"]

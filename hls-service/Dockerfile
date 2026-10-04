# ADDABAAZ HLS converter — standalone, self-contained image.
# ffmpeg/ffprobe come from Alpine, so nothing has to be installed on the host and the service runs
# identically on a laptop, a VPS or a platform like Render/Fly.
FROM node:22-alpine

# tini reaps ffmpeg if the container is stopped mid-encode, so SIGTERM still shuts down cleanly.
RUN apk add --no-cache ffmpeg tini \
 && ffmpeg -version | head -n 1 \
 && ffprobe -version | head -n 1

ENV NODE_ENV=production \
    PORT=8080 \
    HOST=0.0.0.0 \
    DATA_DIR=/app/data

WORKDIR /app

# Dependencies first — this layer is reused when only the code changes.
# The service's only runtime dependency is express.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

COPY src ./src
COPY public ./public
# The runtime scripts only (the dev helpers stay out of the image).
COPY scripts/doctor.mjs scripts/get-ffmpeg.mjs ./scripts/

# Staged uploads, encoded packages and jobs.json all live here — mount a volume so they survive.
RUN mkdir -p /app/data && chown -R node:node /app/data
VOLUME ["/app/data"]
USER node

EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "src/index.js"]

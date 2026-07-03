# Single image for api + clips/alerts workers (command overridden in compose).
FROM node:22-bookworm-slim

# ffmpeg + DejaVu font: clips worker cuts video and draws watermark
RUN apt-get update && apt-get install -y --no-install-recommends \
        ffmpeg fonts-dejavu-core curl && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json drizzle.config.ts ./
COPY db ./db
COPY src ./src

ENV NODE_ENV=production
EXPOSE 3000
CMD ["npm", "run", "start"]

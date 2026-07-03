# Build from the repo root (web imports ../shared):
#   docker build -f web/Dockerfile --build-arg NEXT_PUBLIC_WS_URL=wss://example.com .
FROM node:22-alpine AS build
WORKDIR /repo

COPY web/package.json web/package-lock.json ./web/
RUN cd web && npm ci

COPY shared ./shared
COPY web ./web

# NEXT_PUBLIC_* and rewrite destinations are baked in at build time
ARG NEXT_PUBLIC_WS_URL
ARG API_URL=http://api:3000
ARG GO2RTC_URL=http://host.docker.internal:1984
ENV NEXT_PUBLIC_WS_URL=$NEXT_PUBLIC_WS_URL \
    API_URL=$API_URL \
    GO2RTC_URL=$GO2RTC_URL \
    NEXT_TELEMETRY_DISABLED=1
RUN cd web && npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=3001 HOSTNAME=0.0.0.0

# standalone output is rooted at the repo dir (outputFileTracingRoot=..)
COPY --from=build /repo/web/.next/standalone ./
COPY --from=build /repo/web/.next/static ./web/.next/static

EXPOSE 3001
CMD ["node", "web/server.js"]

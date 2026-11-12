ARG NODE_VERSION=22-alpine

FROM node:${NODE_VERSION} AS deps
RUN apk add --no-cache libc6-compat
WORKDIR /app
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci --no-audit --no-fund

FROM node:${NODE_VERSION} AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

ARG NEXT_PUBLIC_FINNHUB_API_KEY=
ARG NEXT_PUBLIC_SITE_URL=http://localhost:3000
ENV NEXT_PUBLIC_FINNHUB_API_KEY=$NEXT_PUBLIC_FINNHUB_API_KEY
ENV NEXT_PUBLIC_SITE_URL=$NEXT_PUBLIC_SITE_URL

RUN --mount=type=cache,target=/app/.next/cache \
    npm run build \
    && npm prune --omit=dev

FROM node:${NODE_VERSION} AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000

LABEL org.opencontainers.image.title="order-flow-tracker" \
      org.opencontainers.image.description="Real-time order flow terminal for crypto and FX" \
      org.opencontainers.image.source="https://github.com/zadescoxp/order-flow-screener" \
      org.opencontainers.image.licenses="Apache-2.0" \
      org.opencontainers.image.url="https://github.com/zadescoxp/order-flow-screener"

RUN apk add --no-cache libc6-compat

COPY --from=builder --chown=node:node /app/package.json ./package.json
COPY --from=builder --chown=node:node /app/next.config.ts ./next.config.ts
COPY --from=builder --chown=node:node /app/public ./public
COPY --from=builder --chown=node:node /app/.next ./.next
COPY --from=builder --chown=node:node /app/node_modules ./node_modules

USER node
EXPOSE 3000

CMD ["sh", "-c", "./node_modules/.bin/next start -H 0.0.0.0 -p ${PORT:-3000}"]

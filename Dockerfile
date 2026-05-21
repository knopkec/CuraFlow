FROM node:22-slim AS frontend_builder

WORKDIR /app

ENV npm_config_fetch_retries=5 \
    npm_config_fetch_retry_factor=2 \
    npm_config_fetch_retry_mintimeout=20000 \
    npm_config_fetch_retry_maxtimeout=120000

COPY package*.json ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci --no-audit --prefer-offline

COPY src ./src
COPY public ./public
COPY index.html master.html vite.config.js jsconfig.json postcss.config.js tailwind.config.js components.json ./
RUN npm run build

FROM node:22-slim AS runtime

WORKDIR /app/server

ENV npm_config_fetch_retries=5 \
    npm_config_fetch_retry_factor=2 \
    npm_config_fetch_retry_mintimeout=20000 \
    npm_config_fetch_retry_maxtimeout=120000

RUN apt-get update \
 && apt-get install -y --no-install-recommends poppler-utils \
 && rm -rf /var/lib/apt/lists/*

COPY server/package*.json ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci --omit=dev --no-audit --prefer-offline

COPY server/ ./
COPY --from=frontend_builder /app/dist /app/dist
COPY docker/entrypoint.sh /usr/local/bin/curaflow-entrypoint.sh
RUN chmod +x /usr/local/bin/curaflow-entrypoint.sh

ENV NODE_ENV=production

EXPOSE 3000

ENTRYPOINT ["/usr/local/bin/curaflow-entrypoint.sh"]
CMD ["node", "index.js"]

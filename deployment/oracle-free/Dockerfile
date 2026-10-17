# Multi-platform official Node and Playwright browser packages; no x64 emulation in production.
FROM node:24-bookworm AS build
WORKDIR /app
COPY package*.json ./
RUN ELECTRON_SKIP_BINARY_DOWNLOAD=1 npm ci --no-audit --no-fund
COPY desktop ./desktop
COPY renderer ./renderer
COPY cloud ./cloud
COPY scripts ./scripts
COPY tsconfig.json vite.config.ts ./
RUN npm run build && npm prune --omit=dev
FROM node:24-bookworm
ENV DEBIAN_FRONTEND=noninteractive PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
RUN apt-get update && apt-get install -y --no-install-recommends xvfb xauth x11vnc novnc websockify openbox util-linux procps ca-certificates \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
RUN ./node_modules/.bin/playwright install --with-deps chromium \
    && chmod -R a+rX /ms-playwright && rm -rf /var/lib/apt/lists/*
COPY --from=build /app/dist ./dist
COPY cloud/oracle/public ./cloud/oracle/public
COPY tools ./tools
COPY deployment/oracle-free/start.sh /app/start.sh
RUN useradd --uid 10001 --create-home browsermgr && mkdir -p /data /reports && chown browsermgr:browsermgr /data /reports
USER 10001:10001
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000 DATA_DIR=/data HOME=/tmp/home XDG_CACHE_HOME=/tmp/cache DISPLAY=:99 CHROMIUM_SANDBOX=1
HEALTHCHECK --interval=15s --timeout=4s --start-period=60s --retries=3 CMD node -e "fetch('http://127.0.0.1:3000/health/live').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["bash","/app/start.sh"]

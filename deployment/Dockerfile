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
FROM mcr.microsoft.com/playwright:v1.64.1-noble
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY cloud/public ./cloud/public
COPY scripts/cloud-worker.sh ./scripts/cloud-worker.sh
RUN useradd -m -u 10001 browsermgr && mkdir -p /data && chown browsermgr:browsermgr /data && command -v flock && command -v xvfb-run
USER 10001:10001
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000 DATA_DIR=/data XDG_CACHE_HOME=/tmp/cache
HEALTHCHECK --interval=15s --timeout=4s --start-period=60s --retries=3 CMD node -e "fetch('http://127.0.0.1:3000/health/live').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["xvfb-run","-a","bash","scripts/cloud-worker.sh"]

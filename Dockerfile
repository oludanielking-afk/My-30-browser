FROM node:22-bookworm AS build
WORKDIR /app
COPY package*.json ./
RUN ELECTRON_SKIP_BINARY_DOWNLOAD=1 npm ci --no-audit --no-fund
COPY desktop ./desktop
COPY cloud ./cloud
COPY renderer ./renderer
COPY scripts ./scripts
COPY tsconfig.json vite.config.ts ./
RUN npm run build && npm prune --omit=dev
FROM mcr.microsoft.com/playwright:v1.64.1-noble
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
COPY src ./src
COPY public ./public
RUN useradd -m -u 10001 browsermgr && mkdir -p /app/data && chown -R browsermgr:browsermgr /app
USER browsermgr
ENV DATA_DIR=/app/data HOST=0.0.0.0 PORT=3000 MAX_ACTIVE=5
EXPOSE 3000
CMD ["xvfb-run", "-a", "node", "dist/worker.cjs"]

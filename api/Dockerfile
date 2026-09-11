# Build context = repo root:  docker build -f api/Dockerfile -t bond-desk-api .
# Stage 1: the web app (Vite) reads ABIs from api/src/abi and addresses from deployments/ at build time.
FROM node:22-alpine AS web
WORKDIR /repo
COPY web/package.json web/package-lock.json ./web/
# --ignore-scripts: skip node-gyp builds of optional native helpers (bufferutil) pulled in by wallet SDKs; they have JS fallbacks
RUN cd web && npm ci --no-audit --no-fund --ignore-scripts
COPY web ./web
COPY api/src/abi ./api/src/abi
COPY deployments ./deployments
RUN cd web && npm run typecheck && npm run build   # -> /repo/api/public

# Stage 2: the API serves its routes and the built app (SPA fallback for browser navigations).
FROM node:22-alpine
WORKDIR /app
COPY api/package.json api/package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY api/src ./src
COPY deployments ./deployments
COPY --from=web /repo/api/public ./public
ENV PORT=8787 DEPLOYMENTS_FILE=/app/deployments/testnet.json PUBLIC_DIR=/app/public
EXPOSE 8787
CMD ["node", "--experimental-strip-types", "src/index.ts"]

# Build context = repo root:  docker build -f api/Dockerfile -t bond-desk-api .
FROM node:22-alpine
WORKDIR /app
COPY api/package.json api/package-lock.json ./
RUN npm ci --omit=dev
COPY api/src ./src
COPY deployments ./deployments
ENV PORT=8787 DEPLOYMENTS_FILE=/app/deployments/testnet.json
EXPOSE 8787
CMD ["node", "--experimental-strip-types", "src/index.ts"]

# GTM Factory server: the API and the scheduler, running the core of this repository.
# Build from the repository root: docker build -f apps/server/Dockerfile .
# Node 24: isolated-vm ships a prebuilt binary for it (no compiler in the image).
FROM node:24-slim
RUN npm install -g pnpm@10.33.0 --no-audit --no-fund
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile --prod --filter "@gtm-factory/server..."
WORKDIR /app/apps/server
# isolated-vm needs Node's startup snapshot off.
ENV NODE_ENV=production PORT=8080 NODE_OPTIONS=--no-node-snapshot
EXPOSE 8080
CMD ["node", "--no-node-snapshot", "--import", "tsx", "src/index.ts"]

# GTM Factory dashboard on a hosted server: the api data source, Next standalone.
# Build from the repository root: docker build -f apps/dashboard/Dockerfile .
FROM node:22-slim AS build
RUN npm install -g pnpm@10.33.0 --no-audit --no-fund
WORKDIR /src
COPY . .
RUN pnpm install --frozen-lockfile --filter "dashboard..."
ENV NEXT_PUBLIC_DATA_SOURCE=api NEXT_PUBLIC_BASE_PATH="" NEXT_PUBLIC_FACTORY_API_URL=/api NEXT_OUTPUT=standalone NEXT_TELEMETRY_DISABLED=1
# A deploy health check asks GET /health on 8080.
RUN echo ok > apps/dashboard/public/health && pnpm --filter dashboard build

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production PORT=8080 HOSTNAME=0.0.0.0 NEXT_TELEMETRY_DISABLED=1
COPY --from=build /src/apps/dashboard/.next/standalone ./
COPY --from=build /src/apps/dashboard/.next/static ./apps/dashboard/.next/static
COPY --from=build /src/apps/dashboard/public ./apps/dashboard/public
EXPOSE 8080
CMD ["node", "apps/dashboard/server.js"]

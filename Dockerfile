# syntax=docker/dockerfile:1
# OpenArch self-hosted server: build the web app, serve it from Fastify.
# Usage: docker build -t openarch . && docker run -p 8080:8080 -v openarch-data:/app/data openarch

FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8080
ENV OPENARCH_DATA=/app/data/models.json
COPY package.json package-lock.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apps/web/dist ./apps/web/dist
COPY --from=build /app/apps/server ./apps/server
COPY --from=build /app/packages ./packages
COPY --from=build /app/tsconfig.json ./tsconfig.json
RUN mkdir -p /app/data
VOLUME ["/app/data"]
EXPOSE 8080
# tsx is needed until server/package.json has a compiled target; it is part of
# the root install. Healthcheck hits the API the app proxies to itself.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD wget -q -O /dev/null http://127.0.0.1:8080/health || exit 1
CMD ["npx", "tsx", "apps/server/src/index.ts"]

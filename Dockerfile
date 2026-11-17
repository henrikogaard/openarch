FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/
COPY apps/server/package.json apps/server/
COPY apps/cli/package.json apps/cli/
COPY apps/mcp/package.json apps/mcp/
COPY packages/core/package.json packages/core/
COPY packages/repository/package.json packages/repository/
COPY packages/exporters/package.json packages/exporters/
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-alpine
WORKDIR /app
COPY --from=build /app ./
ENV NODE_ENV=production PORT=8080 OPENARCH_DATA=/data/models.json
VOLUME /data
EXPOSE 8080
CMD ["npx", "tsx", "apps/server/src/index.ts"]

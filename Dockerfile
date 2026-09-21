FROM node:22-bookworm-slim AS build

WORKDIR /src

COPY package.json tsconfig.json ./
COPY src ./src

RUN npm install --no-audit --no-fund
RUN npm run build

FROM node:22-bookworm-slim AS runtime

ENV NODE_ENV=production
WORKDIR /app

COPY --from=build /src/dist ./dist
COPY package.json LICENSE README.md ./

RUN mkdir -p /config /data && chown -R node:node /app /config /data

USER node

EXPOSE 8787

CMD ["node", "dist/cli.js", "serve", "--host", "0.0.0.0", "--port", "8787", "--config", "/config/ai-spend-firewall.config.json"]

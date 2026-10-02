FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build
FROM node:24-bookworm-slim
WORKDIR /app
ENV HOST=0.0.0.0 PORT=3000 DB_PATH=/app/data/store.sqlite
COPY --from=build /app/dist ./dist
COPY --from=build /app/public/catalog.json ./public/catalog.json
COPY --from=build /app/server ./server
RUN mkdir data && chown -R node:node /app
USER node
VOLUME ["/app/data"]
EXPOSE 3000
CMD ["node", "server/index.mjs"]

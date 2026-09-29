# Imagen única: API Node + cliente React compilado
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json* ./
COPY client/package.json client/
COPY server/package.json server/
RUN npm ci --workspaces --include-workspace-root
COPY . .
RUN npm run build -w client

FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/server ./server
COPY --from=build /app/client/dist ./client/dist
EXPOSE 4000
CMD ["node", "server/src/index.js"]

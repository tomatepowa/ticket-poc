# ---- Stage 1 : build (outils de compilation pour better-sqlite3, build du front Vue) ----
FROM node:20-alpine AS builder
WORKDIR /app
RUN apk add --no-cache python3 make g++
COPY package.json package-lock.json ./
RUN npm ci
COPY vite.config.mjs ./
COPY web ./web
RUN npm run build && npm prune --omit=dev

# ---- Stage 2 : image finale, minimale ----
FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY package.json ./
COPY server.js auth.js ./
COPY sources ./sources

# Le dossier data/ est monté en volume (docker-compose) pour persister la simulation EV
RUN mkdir -p /app/data

EXPOSE 3000
CMD ["node", "server.js"]

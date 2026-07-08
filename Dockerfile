# syntax=docker/dockerfile:1

# ---- build ----
# node:24-slim: Node's built-in SQLite (node:sqlite) works here with no experimental flag and no
# native build step.
FROM node:24-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
# `npm install` (not `npm ci`): the committed lockfile is generated on macOS and omits
# Linux-only optional deps (@emnapi/*), which makes strict `npm ci` fail on a Linux build.
RUN npm install --no-audit --no-fund
COPY . .
RUN npm run build
RUN npm prune --omit=dev

# ---- runtime ----
FROM node:24-slim
WORKDIR /app
ENV NODE_ENV=production
# DB lives on a mounted volume (see docker-compose.yml). PORT/ORIGIN are set at deploy time.
ENV ROSTER_DB=/data/roster.db
COPY --from=build /app/build ./build
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
EXPOSE 3000
# --disable-warning hides the (harmless) node:sqlite ExperimentalWarning from the logs.
CMD ["node", "--disable-warning=ExperimentalWarning", "build"]

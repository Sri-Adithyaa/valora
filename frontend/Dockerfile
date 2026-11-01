# syntax=docker/dockerfile:1
# ── build: compile the Vite/React app ─────────────────────────────────────────
FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
# The browser always calls same-origin /api; nginx proxies it to the API container.
# (VITE_API_PROXY from docker-compose is accepted for compatibility; only the dev server uses it.)
ARG VITE_API_PROXY
RUN npm run build

# ── runtime: nginx serves dist/ with SPA fallback and proxies /api ────────────
FROM nginx:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1/ >/dev/null || exit 1

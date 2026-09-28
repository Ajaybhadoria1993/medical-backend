# syntax=docker/dockerfile:1
FROM node:22-slim AS builder
WORKDIR /app

# Use cache mount for npm to speed up installs even when package.json changes
COPY package*.json ./
RUN --mount=type=cache,target=/root/.npm npm ci

COPY . .
RUN npm run build

# ---------------- Runtime ----------------
FROM node:22-slim
WORKDIR /app

# Set environment variables for production
ENV HUSKY=0 \
    NODE_ENV=production

# Install minimal system deps required by @sparticuz/chromium
# (much lighter than full chromium — no X11, no dbus needed)
RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt,sharing=locked \
    rm -f /etc/apt/apt.conf.d/docker-clean && \
    apt-get update --fix-missing && apt-get install -y \
    ca-certificates \
    fonts-liberation \
    fonts-noto-color-emoji \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libcairo2 \
    libcups2 \
    libdrm2 \
    libgbm1 \
    libnspr4 \
    libnss3 \
    libpango-1.0-0 \
    libx11-xcb1 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxrandr2 \
    libxshmfence1 \
    wget \
    --no-install-recommends \
    --fix-missing && \
    rm -rf /var/lib/apt/lists/*

COPY package*.json ./

# Use cache mount for production dependencies
RUN --mount=type=cache,target=/root/.npm \
    npm ci --omit=dev

# Copy only the necessary build artifacts from the builder stage
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/public ./public
COPY --from=builder /app/src/drizzle/migrations ./src/drizzle/migrations
EXPOSE 5000

CMD ["node", "dist/server.js"]

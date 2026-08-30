# ── Build stage ────────────────────────────────────────────────────────────
FROM node:20-alpine AS build

WORKDIR /app

# Install pnpm (faster installs than npm)
RUN corepack enable && corepack prepare pnpm@latest --activate

# Copy package files first for better layer caching
COPY package*.json ./
COPY pnpm-lock.yaml* ./

# Install ALL dependencies (including devDependencies for build)
RUN pnpm install --frozen-lockfile || npm install

# Copy source code
COPY . .

# Run any build step if present (skip if no build script)
RUN npm run build --if-present || true

# ── Production stage ───────────────────────────────────────────────────────
FROM node:20-alpine AS production

WORKDIR /app

# Create non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

# Copy package files
COPY package*.json ./
COPY pnpm-lock.yaml* ./

# Install ONLY production dependencies
RUN corepack enable && corepack prepare pnpm@latest --activate && \
    pnpm install --prod --frozen-lockfile || npm install --omit=dev

# Copy built artifacts from build stage
COPY --from=build /app ./

# Copy node_modules with production deps
COPY --from=build /app/node_modules ./node_modules

# Security: run as non-root user
USER nodejs

# Expose the port (from .env.example or default 3000)
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://localhost:3000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# Start the app
CMD ["node", "server.js"]
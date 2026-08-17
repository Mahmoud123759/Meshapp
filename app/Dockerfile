# syntax=docker/dockerfile:1.7

# ============================================================
# Build stage
# ============================================================
FROM node:20-alpine AS builder

WORKDIR /app

# Copy dependency manifests first for Docker layer caching.
COPY package.json package-lock.json ./

# Install exactly what's in package-lock.json.
# No dev dependencies in the production image.
RUN npm ci --omit=dev && npm cache clean --force

# Copy application source.
COPY index.js tracing.js ./


# ============================================================
# Runtime stage
# ============================================================
FROM node:20-alpine AS runtime

# Production environment
ENV NODE_ENV=production

WORKDIR /app

# Run as the non-root node user.
USER node

# Copy application and already-installed dependencies
COPY --from=builder --chown=node:node /app /app

# Application port
EXPOSE 3000

# tracing.js must load BEFORE index.js so OpenTelemetry
# instrumentation can hook HTTP/PG modules.
ENV NODE_OPTIONS="--require=/app/tracing.js"

# Start the application directly.
CMD ["node", "/app/index.js"]
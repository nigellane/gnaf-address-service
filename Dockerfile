# Production-optimized Dockerfile for G-NAF Address Service
# Multi-stage build for optimal image size and security

# Stage 1: Build stage
FROM node:20-alpine AS builder

# Set working directory
WORKDIR /app

# Create non-root user for build process
RUN addgroup -g 1001 -S nodejs && \
    adduser -S gnaf -u 1001 -G nodejs

# Install build dependencies
RUN apk add --no-cache \
    python3 \
    make \
    g++ \
    git \
    && rm -rf /var/cache/apk/*

# Copy package files
COPY package*.json ./
COPY tsconfig.json ./

# Install dependencies (including dev dependencies for build)
RUN npm ci --only=production --ignore-scripts && \
    npm ci --only=development --ignore-scripts

# Copy source code
COPY src/ ./src/
COPY docs/ ./docs/

# Build TypeScript
RUN npm run build

# Remove dev dependencies
RUN npm prune --production

# Stage 2: Runtime stage
FROM node:20-alpine AS runtime

# Install security updates and required runtime packages
RUN apk upgrade --no-cache && \
    apk add --no-cache \
    dumb-init \
    curl \
    && rm -rf /var/cache/apk/*

# Create non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S gnaf -u 1001 -G nodejs

# Set working directory
WORKDIR /app

# Create necessary directories with proper permissions
RUN mkdir -p logs && \
    chown -R gnaf:nodejs /app

# Copy built application from builder stage
COPY --from=builder --chown=gnaf:nodejs /app/dist ./dist
COPY --from=builder --chown=gnaf:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=gnaf:nodejs /app/package*.json ./

# Copy configuration files
COPY --chown=gnaf:nodejs .env.example ./.env
COPY --chown=gnaf:nodejs docs/operational-runbooks ./docs/operational-runbooks

# Health check script
COPY --chown=gnaf:nodejs <<EOF /app/healthcheck.js
const http = require('http');
const options = {
  host: 'localhost',
  port: process.env.PORT || 3000,
  path: '/api/v1/health/live',
  timeout: 10000
};

const request = http.request(options, (res) => {
  if (res.statusCode === 200) {
    console.log('Health check passed');
    process.exit(0);
  } else {
    console.log('Health check failed with status:', res.statusCode);
    process.exit(1);
  }
});

request.on('error', (err) => {
  console.log('Health check error:', err.message);
  process.exit(1);
});

request.on('timeout', () => {
  console.log('Health check timeout');
  process.exit(1);
});

request.end();
EOF

# Set proper permissions for health check
RUN chmod +x /app/healthcheck.js

# Switch to non-root user
USER gnaf

# Environment variables
ENV NODE_ENV=production
ENV PORT=3000
ENV LOG_LEVEL=info
ENV LOG_TO_FILE=true

# Resource limits
ENV NODE_OPTIONS="--max-old-space-size=1024"

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD node /app/healthcheck.js

# Use dumb-init to handle signals properly
ENTRYPOINT ["/usr/bin/dumb-init", "--"]

# Start the application
CMD ["node", "dist/server.js"]

# Labels for metadata
LABEL maintainer="G-NAF Address Service Team"
LABEL version="1.0.0"
LABEL description="Production-ready G-NAF Address Service with PostGIS and Redis"
LABEL org.opencontainers.image.source="https://github.com/your-org/gnaf-address-service"
LABEL org.opencontainers.image.description="Australian G-NAF (Geocoded National Address File) address validation and geocoding service"
LABEL org.opencontainers.image.licenses="MIT"
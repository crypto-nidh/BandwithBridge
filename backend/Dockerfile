# Bandwidth Bridge – Backend Dockerfile
# Multi-stage: install deps then run production server

FROM node:18-alpine AS base
WORKDIR /app

# Install dependencies
COPY package.json .
RUN npm install --production

# Copy source
COPY src/ ./src/

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=45s --retries=3 \
    CMD wget -qO- http://localhost:3001/health || exit 1

EXPOSE 3001
CMD ["node", "src/index.js"]

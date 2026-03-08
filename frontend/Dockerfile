# Bandwidth Bridge – Frontend Dockerfile (Production Build)

# Stage 1: Build the React application
FROM node:18-alpine AS build
WORKDIR /app

# Install dependencies
COPY package.json package-lock.json* ./
RUN npm install --frozen-lockfile || npm install

# Copy source and build
COPY . .
ENV REACT_APP_API_URL=/api
RUN npm run build

# Stage 2: Serve static files with Nginx
FROM nginx:alpine
COPY --from=build /app/build /usr/share/nginx/html

# Custom Nginx configuration to handle SPA routing
RUN echo 'server { \
    listen 80; \
    location / { \
        root /usr/share/nginx/html; \
        index index.html index.htm; \
        try_files $uri $uri/ /index.html; \
    } \
    location /api/ { \
        proxy_pass http://backend:3001/; \
        proxy_http_version 1.1; \
        proxy_set_header Upgrade $http_upgrade; \
        proxy_set_header Connection "upgrade"; \
        proxy_set_header Host $host; \
        proxy_cache_bypass $http_upgrade; \
    } \
}' > /etc/nginx/conf.d/default.conf

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]

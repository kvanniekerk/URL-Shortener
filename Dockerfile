FROM node:22-slim

ENV NODE_ENV=production \
    PORT=3000 \
    DATABASE_PATH=/app/data/urls.db

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY server.js ./
COPY src ./src
COPY views ./views
COPY public ./public

RUN mkdir -p /app/data && chown node:node /app/data
USER node

VOLUME ["/app/data"]
EXPOSE 3000

CMD ["node", "server.js"]

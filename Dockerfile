# One image for Railway, DigitalOcean App Platform, or any container host.
FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY . .
# Ads and their pictures are saved under /app/data. To keep them across deploys, mount a volume there (Railway: see README).
# The process runs as root on purpose: Railway mounts volumes owned by root, and a non-root user could not write to it.
EXPOSE 3000
CMD ["node", "src/server.mjs"]

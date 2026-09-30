FROM node:24-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
ENV PORT=3000 DATA_DIR=/data NODE_ENV=production
VOLUME ["/data"]
EXPOSE 3000
CMD ["node", "server.js"]

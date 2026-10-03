FROM node:22-bookworm-slim
WORKDIR /app
COPY package.json package-lock.json ./
COPY applymate/contracts ./applymate/contracts
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund
COPY applymate/server/dist ./applymate/server/dist
COPY applymate/client/dist ./applymate/client/dist
ENV NODE_ENV=production PORT=8080
EXPOSE 8080
CMD ["node", "applymate/server/dist/index.js"]

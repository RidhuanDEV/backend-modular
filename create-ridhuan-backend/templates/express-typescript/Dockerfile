FROM node:24.15.0-alpine AS builder
WORKDIR /app
ARG DB_PROVIDER=postgresql
ENV DB_PROVIDER=$DB_PROVIDER
ENV DATABASE_URL=${DB_PROVIDER}://build:build@localhost/build
ENV JWT_SECRET=build_only_secret_do_not_use_at_runtime_1234567890
COPY package.json package-lock.json ./
RUN npm ci
COPY prisma ./prisma
COPY prisma.config.ts ./
RUN npx prisma generate
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:24.15.0-alpine
WORKDIR /app
ARG DB_PROVIDER=postgresql
ENV DB_PROVIDER=$DB_PROVIDER
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY prisma ./prisma
COPY prisma.config.ts ./
RUN DATABASE_URL="${DB_PROVIDER}://build:build@localhost/build" npx prisma generate
COPY --from=builder /app/dist ./dist
RUN mkdir -p /app/uploads && chown node:node /app/uploads
EXPOSE 3000
USER node
CMD ["node", "dist/server.js"]

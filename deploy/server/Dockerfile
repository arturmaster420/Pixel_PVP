# Server container for Be_Try Arena BR
FROM node:20-alpine

WORKDIR /app

# Copy only what the server needs
COPY packages/core ./packages/core
COPY apps/server/package.json apps/server/package-lock.json ./apps/server/

# Install server deps (includes local file dependency be-try-core)
RUN npm --prefix apps/server ci --omit=dev

# Copy server source
COPY apps/server/src ./apps/server/src

ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080

CMD ["node", "apps/server/src/index.js"]

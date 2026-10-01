FROM node:20.15.0-alpine AS build
WORKDIR /app
COPY package.json ./
COPY tsconfig.json tsconfig.build.json ./
COPY prisma ./prisma
COPY scripts ./scripts
COPY src ./src
RUN npm install
RUN npm run build

FROM node:20.15.0-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/scripts ./scripts
# scripts/*.ts (provisionDbRoles, rotateEncryptionKey, manageStaffAccount)
# are run via `tsx`, not the compiled dist/ -- and they import from
# '../src/...'. Without this, they resolve fine on a host checkout (full
# src/ tree on disk) but fail with MODULE_NOT_FOUND inside this image,
# which is exactly how the offline install runs them (no host Node.js
# needed -- see ops/install_offline.sh).
COPY --from=build /app/src ./src
COPY --from=build /app/tsconfig.json /app/tsconfig.build.json ./

EXPOSE 4000
CMD ["node", "dist/index.js"]

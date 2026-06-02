FROM node:22-alpine AS deps

WORKDIR /app
RUN corepack enable
RUN apk add --no-cache python3 make g++

COPY package.json pnpm-lock.yaml ./
# patches/ holds pnpm patch files referenced by package.json's
# patchedDependencies (e.g. the cuer border:0 fix). pnpm install reads
# them during install, so they must be present before this step or it
# fails with ENOENT on the .patch file.
COPY patches ./patches
RUN pnpm install --frozen-lockfile --prod

FROM node:22-alpine

WORKDIR /app
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=7101

RUN corepack enable

COPY --from=deps /app/node_modules ./node_modules
COPY package.json pnpm-lock.yaml ./
COPY server ./server

EXPOSE 7101

CMD ["pnpm", "start"]

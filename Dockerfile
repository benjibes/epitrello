FROM oven/bun:1.3.7-alpine AS deps
WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

FROM oven/bun:1.3.7-alpine AS build
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN bun run build

FROM oven/bun:1.3.7-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY --from=build /app/package.json ./package.json
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/.svelte-kit ./.svelte-kit
COPY --from=build /app/build ./build

EXPOSE 4173
CMD ["bun", "run", "preview", "--host", "0.0.0.0", "--port", "4173"]

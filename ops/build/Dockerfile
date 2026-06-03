FROM oven/bun:1.3 AS deps
WORKDIR /workspace

COPY package.json bun.lock tsconfig.json bunfig.toml build.ts ./
COPY src ./src

RUN bun install --frozen-lockfile

FROM oven/bun:1.3 AS runtime
WORKDIR /workspace

COPY --from=deps /workspace /workspace

ENV NODE_ENV=production

EXPOSE 3000
USER bun

FROM oven/bun:1.3 AS deps
WORKDIR /workspace

COPY package.json bun.lock tsconfig.json bunfig.toml build.ts ./
COPY src ./src
COPY styles ./styles

RUN bun install --frozen-lockfile

ARG BUN_PUBLIC_POSTHOG_KEY=""
ARG BUN_PUBLIC_POSTHOG_HOST="https://eu.i.posthog.com"
ENV BUN_PUBLIC_POSTHOG_KEY=$BUN_PUBLIC_POSTHOG_KEY
ENV BUN_PUBLIC_POSTHOG_HOST=$BUN_PUBLIC_POSTHOG_HOST

RUN bun run build

FROM oven/bun:1.3 AS runtime
WORKDIR /workspace

COPY --from=deps /workspace /workspace

ENV NODE_ENV=production

EXPOSE 3000
USER bun

CMD ["bun", "run", "start"]

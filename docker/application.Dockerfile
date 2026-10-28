FROM oven/bun:1.4.2@sha256:9114c058aeae42162ee16dd5084b95fe9473970bb6bcb5b232ab1630f0546895 AS bun
FROM node:22.16.0-bookworm-slim@sha256:048ed02c5fd52e86fda6fbd2f6a76cf0d4492fd6c6fee9e2c463ed5108da0e34
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates procps \
    && rm -rf /var/lib/apt/lists/*
COPY --from=bun /usr/local/bin/bun /usr/local/bin/bun
WORKDIR /app
COPY package.json bun.lock bunfig.toml ./
COPY .cache/sdk/camenae-opencode-0.2.0-b2c0d67d6050.tgz .cache/sdk/camenae-opencode-0.2.0-b2c0d67d6050.tgz
RUN echo 'b2c0d67d6050055115dcbda4bb1f7b94ef57417ba90b42d9f7afa21c6c49fa03  .cache/sdk/camenae-opencode-0.2.0-b2c0d67d6050.tgz' | sha256sum -c -
RUN bun install --frozen-lockfile
COPY docker/opencode-runtime/package.json docker/opencode-runtime/bun.lock docker/opencode-runtime/
RUN cd docker/opencode-runtime && bun install --frozen-lockfile
COPY src/opencode-worker.ts docker/opencode-runtime/
COPY src/opencode-plugin.ts docker/opencode-runtime/plugin/index.ts
COPY docker/opencode-runtime/console-free.json docker/opencode-runtime/
COPY src/ src/
COPY scripts/ scripts/
COPY tests/ tests/
COPY tsconfig.json ./
COPY data/quotes/quotes.jsonl data/quotes/quotes.jsonl
RUN bun run typecheck
RUN bun run build:app
RUN mkdir -p /data/workspace /data/skills /data/opencode-state /data/tmp && chown -R node:node /data
USER node
ENV NODE_ENV=production
CMD ["bun", "src/main.ts"]

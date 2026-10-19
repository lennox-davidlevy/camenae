FROM oven/bun:1.4.2@sha256:9114c058aeae42162ee16dd5084b95fe9473970bb6bcb5b232ab1630f0546895 AS bun
FROM node:22.16.0-bookworm-slim@sha256:048ed02c5fd52e86fda6fbd2f6a76cf0d4492fd6c6fee9e2c463ed5108da0e34
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates procps \
    && rm -rf /var/lib/apt/lists/*
COPY --from=bun /usr/local/bin/bun /usr/local/bin/bun
WORKDIR /app
COPY package.json bun.lock bunfig.toml ./
COPY .cache/sdk/camenae-bob-0.5.0-managed-modes-fce9502efaf7.tgz .cache/sdk/camenae-bob-0.5.0-managed-modes-fce9502efaf7.tgz
RUN echo 'fce9502efaf7314d48bc67af86728e0cb51f174af2b78a115adebef3f11eb4d2  .cache/sdk/camenae-bob-0.5.0-managed-modes-fce9502efaf7.tgz' | sha256sum -c -
COPY .cache/sdk/camenae-opencode-0.1.0-b24e73923802.tgz .cache/sdk/camenae-opencode-0.1.0-b24e73923802.tgz
RUN echo 'b24e7392380263b72f1db9cdcb266b677dbd3ceddcc9bfe35dafc1d8f7839e22  .cache/sdk/camenae-opencode-0.1.0-b24e73923802.tgz' | sha256sum -c -
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
RUN bun run typecheck
RUN bun run build:ui
RUN mkdir -p /data/workspace /data/bob-state /data/opencode-state /data/tmp /run/bob /run/camenae-mcp && chown -R node:node /data /run/bob /run/camenae-mcp && chmod 0700 /run/bob /run/camenae-mcp
USER node
ENV NODE_ENV=production
CMD ["bun", "src/main.ts"]

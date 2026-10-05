# Deliberately the same installed package and OS for both runtime checks.
# These are development probe images, not production release pins.
ARG BUN_VERSION=1.4.2
FROM oven/bun:${BUN_VERSION} AS bun
FROM node:22.16.0-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates procps \
    && rm -rf /var/lib/apt/lists/*
COPY --from=bun /usr/local/bin/bun /usr/local/bin/bun
WORKDIR /app
COPY package.json bun.lock ./
COPY .cache/sdk/camenae-bob-0.5.0-managed-modes-fce9502efaf7.tgz .cache/sdk/camenae-bob-0.5.0-managed-modes-fce9502efaf7.tgz
RUN echo 'fce9502efaf7314d48bc67af86728e0cb51f174af2b78a115adebef3f11eb4d2  .cache/sdk/camenae-bob-0.5.0-managed-modes-fce9502efaf7.tgz' | sha256sum -c -
RUN bun install --frozen-lockfile
COPY scripts/ scripts/
COPY src/ src/
COPY tests/ tests/
COPY tsconfig.json ./
RUN bun run typecheck
RUN mkdir /probe && chown node:node /probe
USER node
ENV HOME=/probe/home XDG_CONFIG_HOME=/probe/config XDG_CACHE_HOME=/probe/cache \
    XDG_DATA_HOME=/probe/data XDG_STATE_HOME=/probe/state XDG_RUNTIME_DIR=/probe/run \
    TMPDIR=/probe/tmp TMP=/probe/tmp TEMP=/probe/tmp OFFICECLI_SKIP_UPDATE=1
CMD ["bun", "scripts/runtime-probe.ts"]

# Local consumer verification: install from the tarball in a fresh Linux filesystem.
FROM node:24.19.0-bookworm-slim AS node
FROM golang:1.27.1-bookworm AS go
FROM ghcr.io/astral-sh/uv:0.12.21 AS uv
FROM mcr.microsoft.com/dotnet/sdk:10.0.401 AS dotnet-consumer
RUN apt-get update && apt-get install -y --no-install-recommends python3 && rm -rf /var/lib/apt/lists/*
COPY --from=node /usr/local/bin/node /usr/local/bin/node
COPY --from=node /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/npm
RUN ln -s /usr/local/lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm
RUN ln -s /usr/local/lib/node_modules/npm/bin/npx-cli.js /usr/local/bin/npx
WORKDIR /verification
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY dist ./dist
COPY scripts ./scripts
ENTRYPOINT ["node", "scripts/verify-consumer.mjs"]

FROM dotnet-consumer AS full-consumer
COPY --from=go /usr/local/go /usr/local/go
COPY --from=uv /uv /usr/local/bin/uv
ENV PATH="/usr/local/go/bin:/usr/local/bin:$PATH" GOMAXPROCS=2 GOMEMLIMIT=512MiB UV_LINK_MODE=copy UV_PYTHON_INSTALL_DIR=/opt/python
RUN uv python install 3.13.3
ENV PATH="/opt/python/cpython-3.13-linux-x86_64-gnu/bin:$PATH"

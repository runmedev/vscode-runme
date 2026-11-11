ARG BUN_IMAGE=oven/bun:1.4.4@sha256:1d22548f177f4ff38e0c15baa3c2c46c6c2060ba2d1bc573bb4720b407548f1d
ARG NODE_IMAGE=node:22-bookworm-slim@sha256:18052396bf1d0c6e0a8c58181b5c1457da19409efbd5032a3f4d86974e74d13c

FROM ${BUN_IMAGE} AS bun
FROM ${NODE_IMAGE}

LABEL org.opencontainers.image.source="https://github.com/runmedev/vscode-runme"
LABEL org.opencontainers.image.title="vscode-runme build environment"
LABEL org.opencontainers.image.description="Build and test environment for the Runme VS Code extension."
LABEL org.opencontainers.image.licenses="Apache-2.0"

ENV HOME=/root
ENV SHELL=/bin/bash

COPY --from=bun /usr/local/bin/bun /usr/local/bin/bun

RUN apt-get update \
    && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
        ca-certificates \
        curl \
    && install -d -m 0755 /etc/apt/keyrings \
    && curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
        -o /etc/apt/keyrings/githubcli-archive-keyring.gpg \
    && chmod a+r /etc/apt/keyrings/githubcli-archive-keyring.gpg \
    && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
        > /etc/apt/sources.list.d/github-cli.list \
    && apt-get update \
    && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
        bash \
        g++ \
        gh \
        git \
        libappindicator3-1 \
        libasound2 \
        libatk-bridge2.0-0 \
        libatk1.0-0 \
        libcups2 \
        libdbus-1-3 \
        libgbm1 \
        libgdk-pixbuf-xlib-2.0-0 \
        libgtk-3-0 \
        libnspr4 \
        libnss3 \
        libpangocairo-1.0-0 \
        libxcomposite1 \
        libxrandr2 \
        libxss1 \
        make \
        python3 \
        unzip \
        xauth \
        xvfb \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /workspace

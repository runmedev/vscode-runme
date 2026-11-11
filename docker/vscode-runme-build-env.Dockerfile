ARG RUNME_BUILD_ENV=ghcr.io/runmedev/runme-build-env:latest@sha256:bbb6483cfe7f0fffdb86c4fb9b297c7e3b72a8158c0bb8c6f8660845412a6e70
FROM ${RUNME_BUILD_ENV}

LABEL org.opencontainers.image.source="https://github.com/runmedev/vscode-runme"
LABEL org.opencontainers.image.title="vscode-runme build environment"
LABEL org.opencontainers.image.description="Build and test environment for the Runme VS Code extension."
LABEL org.opencontainers.image.licenses="Apache-2.0"

RUN install -d -m 0755 /etc/apt/keyrings \
    && curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
        -o /etc/apt/keyrings/githubcli-archive-keyring.gpg \
    && chmod a+r /etc/apt/keyrings/githubcli-archive-keyring.gpg \
    && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
        > /etc/apt/sources.list.d/github-cli.list \
    && apt-get update \
    && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
        gh \
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
    && rm -rf /var/lib/apt/lists/*

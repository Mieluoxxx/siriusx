# SiriusX single-box control plane. Built from the product workspace, never from
# the upstream DSH checkout.
FROM debian:bookworm-slim AS build
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl xz-utils git \
  && rm -rf /var/lib/apt/lists/*
RUN curl -fsSLo /tmp/node.tar.xz https://nodejs.org/dist/v24.22.2/node-v24.22.2-linux-x64.tar.xz \
  && tar -xJf /tmp/node.tar.xz -C /usr/local --strip-components=1 \
  && rm /tmp/node.tar.xz \
  && npm install -g pnpm@11.28.5
WORKDIR /app
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/autobot/package.json apps/autobot/package.json
COPY apps/control-plane/package.json apps/control-plane/package.json
COPY packages/app-contract/package.json packages/app-contract/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/executor-local/package.json packages/executor-local/package.json
COPY packages/fake-kernel/package.json packages/fake-kernel/package.json
COPY packages/kernel-api/package.json packages/kernel-api/package.json
COPY packages/kernel-dsh/package.json packages/kernel-dsh/package.json
RUN pnpm install --frozen-lockfile

COPY apps/autobot apps/autobot
COPY apps/control-plane apps/control-plane
COPY packages packages
RUN mkdir -p /data/tenants

FROM debian:bookworm-slim
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl xz-utils \
  && rm -rf /var/lib/apt/lists/* \
  && curl -fsSLo /tmp/node.tar.xz https://nodejs.org/dist/v24.22.2/node-v24.22.2-linux-x64.tar.xz \
  && tar -xJf /tmp/node.tar.xz -C /usr/local --strip-components=1 \
  && rm /tmp/node.tar.xz \
  && npm install -g pnpm@11.28.5
WORKDIR /app
COPY --from=build /app /app
ENV NODE_ENV=production
ENV SIRIUSX_DB=/data/control-plane.sqlite
ENV SIRIUSX_DATA_DIR=/data
EXPOSE 4320 4321
VOLUME ["/data"]
CMD ["node", "--import", "tsx", "apps/control-plane/src/cli.ts", "serve", "--port", "4320", "--gateway-port", "4321", "--db", "/data/control-plane.sqlite", "--data-dir", "/data"]

ARG NODE_IMAGE=node@sha256:9e04e3f9c9164cb2c913593ba0733fbd0caf4e9bea474d743ca8a32aa36d98c9

FROM ${NODE_IMAGE} AS build

ARG PNPM_VERSION=11.8.0
ENV CI=true HUSKY=0
WORKDIR /workspace

RUN corepack enable && corepack prepare "pnpm@${PNPM_VERSION}" --activate
COPY . .
RUN pnpm install --frozen-lockfile --ignore-scripts --filter @a2amesh/registry... \
  && pnpm --filter @a2amesh/registry... run build \
  && pnpm --filter @a2amesh/registry deploy --prod /opt/a2amesh/registry \
  && node scripts/prune-container-deploy.mjs registry

FROM ${NODE_IMAGE} AS registry

ARG VERSION=0.0.0-dev
ARG REVISION=unknown
ARG CREATED=unknown
LABEL org.opencontainers.image.title="A2A Mesh Registry" \
  org.opencontainers.image.description="Production image for the A2A Mesh registry service" \
  org.opencontainers.image.source="https://github.com/oaslananka/a2amesh" \
  org.opencontainers.image.url="https://github.com/oaslananka/a2amesh" \
  org.opencontainers.image.documentation="https://oaslananka.github.io/a2amesh/operations/deployment" \
  org.opencontainers.image.licenses="Apache-2.0" \
  org.opencontainers.image.version="${VERSION}" \
  org.opencontainers.image.revision="${REVISION}" \
  org.opencontainers.image.created="${CREATED}"

ENV NODE_ENV=production \
  HOME=/home/a2amesh \
  TMPDIR=/tmp \
  PORT=3099

RUN addgroup -S -g 10001 a2amesh \
  && adduser -S -D -H -u 10001 -G a2amesh a2amesh \
  && mkdir -p /home/a2amesh \
  && chown -R 10001:10001 /home/a2amesh \
  && rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack /opt/yarn-v1.22.22 \
  && rm -f /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack /usr/local/bin/yarn /usr/local/bin/yarnpkg

WORKDIR /app
COPY --from=build --chown=10001:10001 /opt/a2amesh/registry/ ./

USER 10001:10001
EXPOSE 3099
STOPSIGNAL SIGTERM
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || '3099') + '/health').then((response) => { if (!response.ok) process.exit(1); }).catch(() => process.exit(1))"

CMD ["node", "dist/bin/start.js"]

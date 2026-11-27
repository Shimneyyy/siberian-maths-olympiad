# syntax=docker/dockerfile:1
FROM node:24-bookworm-slim@sha256:dc26ae92c9fb15cf6b1d63e20f0944b2efe0f115b20e00be48fb23fceb061c54
WORKDIR /inspector
COPY infra/pdf-inspector/package.json infra/pdf-inspector/package-lock.json ./
RUN --mount=type=secret,id=npm_ca \
    if [ -f /run/secrets/npm_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/npm_ca; fi; \
    npm ci --omit=dev --ignore-scripts --no-audit --no-fund && npm cache clean --force
COPY scripts/check-passive-pdf.mjs ./check-passive-pdf.mjs
COPY infra/pdf-inspector/server.mjs ./server.mjs
COPY infra/pdf-inspector/relay.mjs ./relay.mjs
RUN chmod -R a=rX /inspector && test -x /usr/bin/prlimit && node -e 'require("pdf-lib")'
USER 10001:10001
CMD ["node", "--jitless", "--max-old-space-size=64", "server.mjs"]

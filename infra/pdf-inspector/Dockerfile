FROM node:24-bookworm-slim@sha256:dc26ae92c9fb15cf6b1d63e20f0944b2efe0f115b20e00be48fb23fceb061c54
WORKDIR /inspector
COPY node_modules/pdf-lib ./node_modules/pdf-lib
COPY node_modules/@pdf-lib ./node_modules/@pdf-lib
COPY node_modules/pako ./node_modules/pako
COPY node_modules/tslib ./node_modules/tslib
COPY scripts/check-passive-pdf.mjs ./check-passive-pdf.mjs
COPY infra/pdf-inspector/server.mjs ./server.mjs
COPY infra/pdf-inspector/relay.mjs ./relay.mjs
RUN chmod -R a=rX /inspector && test -x /usr/bin/prlimit && node -e 'if(require("pdf-lib/package.json").version!=="1.17.1")process.exit(1)'
USER 10001:10001
CMD ["node", "--jitless", "--max-old-space-size=64", "server.mjs"]

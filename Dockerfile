FROM node:22-alpine@sha256:16e22a550f3863206a3f701448c45f7912c6896a62de43add43bb9c86130c3e2

ARG APP_VERSION
ARG VCS_REF
ARG DATA_RELEASE
ARG IDENTITY_RELEASE

LABEL org.opencontainers.image.title="mibvendor" \
      org.opencontainers.image.source="https://github.com/ta2jam/mibvendor" \
      org.opencontainers.image.version="${APP_VERSION}" \
      org.opencontainers.image.revision="${VCS_REF}" \
      io.mibvendor.data-release="${DATA_RELEASE}" \
      io.mibvendor.identity-release="${IDENTITY_RELEASE}"

ENV NODE_ENV=production \
    PORT=8080 \
    APP_VERSION="${APP_VERSION}" \
    VCS_REF="${VCS_REF}" \
    DATA_RELEASE="${DATA_RELEASE}" \
    IDENTITY_RELEASE="${IDENTITY_RELEASE}"

WORKDIR /app
COPY --chown=101:101 server.mjs VERSION package.json ./
COPY --chown=101:101 src/ ./src/
COPY --chown=101:101 data/iana-private-enterprise-numbers.json data/mib-catalog.json data/mib-objects.json data/source-catalog.json data/publication-controls.json ./data/
COPY --chown=101:101 data/device-identities/ ./data/device-identities/
COPY --chown=101:101 data/mibs/redistributable/ ./data/mibs/redistributable/
COPY --chown=101:101 scripts/canonical-json.mjs ./scripts/canonical-json.mjs
COPY --chown=101:101 prototype/ ./prototype/
COPY --chown=101:101 docs/research/demand/phase0-openapi.json ./docs/research/demand/phase0-openapi.json

USER 101:101
EXPOSE 8080
CMD ["node", "server.mjs"]

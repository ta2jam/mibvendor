FROM nginxinc/nginx-unprivileged:stable-alpine@sha256:b3f2436575bd5be7386518084d842dac414ab4962712afa31e99e0942a56e3b2

ARG APP_VERSION
ARG VCS_REF
ARG DATA_RELEASE

LABEL org.opencontainers.image.title="mibvendor" \
      org.opencontainers.image.source="https://github.com/ta2jam/mibvendor" \
      org.opencontainers.image.version="${APP_VERSION}" \
      org.opencontainers.image.revision="${VCS_REF}" \
      io.mibvendor.data-release="${DATA_RELEASE}"

USER root
RUN rm -rf /usr/share/nginx/html/*
COPY --chown=101:101 prototype/ /usr/share/nginx/html/
COPY --chown=101:101 VERSION /usr/share/nginx/html/version.txt
COPY --chown=101:101 deploy/nginx.conf /etc/nginx/conf.d/default.conf
RUN printf '{"schema_version":1,"version":"%s","commit":"%s","data_release":"%s"}\n' "$APP_VERSION" "$VCS_REF" "$DATA_RELEASE" \
      > /usr/share/nginx/html/.release.json \
    && chown 101:101 /usr/share/nginx/html/.release.json

USER 101:101
EXPOSE 8080

# Hierro — PocketBase + app web estática
# Funciona en Raspberry Pi (arm64 o armv7) y en PCs (amd64).
FROM alpine:3.20

ARG PB_VERSION=0.40.4
ARG TARGETARCH
ARG TARGETVARIANT

RUN apk add --no-cache ca-certificates unzip wget tzdata \
 && case "${TARGETARCH}${TARGETVARIANT}" in \
      amd64)  PB_ARCH=amd64 ;; \
      arm64*) PB_ARCH=arm64 ;; \
      armv7|arm) PB_ARCH=armv7 ;; \
      *) echo "Arquitectura no soportada: ${TARGETARCH}${TARGETVARIANT}" && exit 1 ;; \
    esac \
 && wget -q "https://github.com/pocketbase/pocketbase/releases/download/v${PB_VERSION}/pocketbase_${PB_VERSION}_linux_${PB_ARCH}.zip" -O /tmp/pb.zip \
 && unzip /tmp/pb.zip pocketbase -d /pb \
 && rm /tmp/pb.zip \
 && apk del unzip wget

WORKDIR /pb
COPY pb_migrations /pb/pb_migrations
COPY pb_hooks      /pb/pb_hooks
COPY pb_public     /pb/pb_public

EXPOSE 8090
VOLUME /pb/pb_data

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD wget -qO- http://127.0.0.1:8090/api/health || exit 1

CMD ["/pb/pocketbase", "serve", "--http=0.0.0.0:8090", "--dir=/pb/pb_data", "--migrationsDir=/pb/pb_migrations", "--hooksDir=/pb/pb_hooks", "--publicDir=/pb/pb_public"]

# Local S3 fixture built from official release source: registry images are unavailable.
FROM golang:1.27.1-alpine AS server-build
ENV GOMAXPROCS=2 GOMEMLIMIT=512MiB
RUN apk add --no-cache ca-certificates git
WORKDIR /src
RUN wget -qO source.tar.gz https://codeload.github.com/minio/minio/tar.gz/9e49d5e7a648f00e26f2246f4dc28e6b07f8c84a && \
    tar -xzf source.tar.gz --strip-components=1 && rm source.tar.gz
RUN --mount=type=cache,id=modular-go-minio-modules,target=/go/pkg/mod \
    --mount=type=cache,id=modular-go-minio-build,target=/root/.cache/go-build \
    CGO_ENABLED=0 go build -p 1 -trimpath -o /out/minio .

FROM golang:1.27.1-alpine AS client-build
ENV GOMAXPROCS=2 GOMEMLIMIT=512MiB
RUN apk add --no-cache ca-certificates git
WORKDIR /src
RUN wget -qO source.tar.gz https://codeload.github.com/minio/mc/tar.gz/7394ce0dd2a80935aded936b09fa12cbb3cb8096 && \
    tar -xzf source.tar.gz --strip-components=1 && rm source.tar.gz
RUN --mount=type=cache,id=modular-go-minio-modules,target=/go/pkg/mod \
    --mount=type=cache,id=modular-go-minio-build,target=/root/.cache/go-build \
    CGO_ENABLED=0 go build -p 1 -trimpath -o /out/mc .

FROM alpine:3.22 AS client
RUN apk add --no-cache ca-certificates && addgroup -S app && adduser -S -G app app
COPY --from=client-build /out/mc /usr/local/bin/mc
USER app
ENTRYPOINT ["mc"]

FROM alpine:3.22 AS server
RUN apk add --no-cache ca-certificates && addgroup -S app && adduser -S -G app app && mkdir /data && chown app:app /data
COPY --from=server-build /out/minio /usr/local/bin/minio
USER app
ENTRYPOINT ["minio"]

# Build the pinned community MinIO release from its official source because registry images are unavailable.
FROM golang:1.27.1-alpine AS build
ENV GOMAXPROCS=2 GOMEMLIMIT=512MiB
RUN apk add --no-cache ca-certificates git
WORKDIR /src
RUN wget -qO source.tar.gz https://codeload.github.com/minio/minio/tar.gz/9e49d5e7a648f00e26f2246f4dc28e6b07f8c84a && \
    tar -xzf source.tar.gz --strip-components=1 && rm source.tar.gz
RUN --mount=type=cache,id=modular-nestjs-minio-modules,target=/go/pkg/mod \
    --mount=type=cache,id=modular-nestjs-minio-build,target=/root/.cache/go-build \
    CGO_ENABLED=0 go build -p 1 -trimpath -o /out/minio .

FROM alpine:3.22
RUN apk add --no-cache ca-certificates && addgroup -S app && adduser -S -G app app && mkdir /data && chown app:app /data
COPY --from=build /out/minio /usr/local/bin/minio
USER app
ENTRYPOINT ["minio"]

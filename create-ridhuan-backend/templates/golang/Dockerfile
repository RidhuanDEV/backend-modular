FROM golang:1.27.1-alpine AS build
ENV GOMAXPROCS=2 GOMEMLIMIT=512MiB
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN --mount=type=cache,id=modular-go-app-build,target=/root/.cache/go-build \
    CGO_ENABLED=0 go build -p 1 -trimpath -o /out/api ./cmd/api && \
    CGO_ENABLED=0 go build -p 1 -trimpath -o /out/migrate ./cmd/migrate && \
    CGO_ENABLED=0 go build -p 1 -trimpath -o /out/seed ./cmd/seed && \
    CGO_ENABLED=0 go build -p 1 -trimpath -o /out/cleanup-uploads ./cmd/cleanup-uploads

FROM alpine:3.22
RUN apk add --no-cache ca-certificates tzdata && addgroup -S app && adduser -S -G app app
WORKDIR /app
COPY --from=build /out/ /usr/local/bin/
RUN mkdir /app/uploads && chown app:app /app/uploads
USER app
EXPOSE 3000
ENTRYPOINT ["api"]

.PHONY: run migrate seed worker cleanup test verify sqlc

run:
	go run ./cmd/api

migrate:
	go run ./cmd/migrate

seed:
	go run ./cmd/seed

worker:
	go run ./cmd/worker

cleanup:
	go run ./cmd/cleanup-uploads --dry-run

test:
	go test ./...

sqlc:
	go run github.com/sqlc-dev/sqlc/cmd/sqlc@v1.31.1 generate
	go run ./cmd/generate-db-instrumentation

verify:
	test -z "$$(gofmt -l $$(find cmd internal -name '*.go'))"
	go vet ./...
	go test ./...

.PHONY: format format-check
format:
	gofmt -w cmd internal

format-check:
	test -z "$$(gofmt -l cmd internal)"

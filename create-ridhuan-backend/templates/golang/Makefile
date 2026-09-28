.PHONY: run migrate seed test verify sqlc

run:
	go run ./cmd/api

migrate:
	go run ./cmd/migrate

seed:
	go run ./cmd/seed

test:
	go test ./...

sqlc:
	go run github.com/sqlc-dev/sqlc/cmd/sqlc@v1.31.1 generate

verify:
	test -z "$$(gofmt -l $$(find cmd internal -name '*.go'))"
	go vet ./...
	go test ./...

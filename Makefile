.PHONY: run build test test-integration vet tidy migrate-up migrate-down psql db-up db-down seed snapshot

DB_URL ?= postgres://postgres:postgres@localhost:5433/stayfair?sslmode=disable

run:
	go run ./cmd/api

build:
	go build -o bin/api ./cmd/api

test:
	go test ./...

test-integration:
	TEST_DB_URL="$(DB_URL)" go test -v ./internal/ledger -run Trigger

vet:
	go vet ./...

tidy:
	go mod tidy

db-up:
	docker compose up -d postgres

db-down:
	docker compose down

migrate-up:
	migrate -path migrations -database "$(DB_URL)" up

migrate-down:
	migrate -path migrations -database "$(DB_URL)" down -all

psql:
	docker exec -it stayfair-postgres psql -U postgres -d stayfair

seed:
	docker exec -i stayfair-postgres psql -U postgres -d stayfair < testdata/seed.sql

# Compute per-account end-of-day balance snapshots for a given date.
# Default is yesterday UTC; override with: make snapshot DATE=2026-04-30
snapshot:
	go run ./cmd/snapshot $(if $(DATE),--date=$(DATE),)

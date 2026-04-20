.PHONY: run build test vet tidy migrate-up migrate-down psql db-up db-down

DB_URL ?= postgres://postgres:postgres@localhost:5433/stayfair?sslmode=disable

run:
	go run ./cmd/api

build:
	go build -o bin/api ./cmd/api

test:
	go test ./...

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

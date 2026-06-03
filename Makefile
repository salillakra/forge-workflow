SHELL := /bin/sh
MODULE := github.com/salillakra/forge

.PHONY: help dev-infra dev-api dev-worker build-api build-worker test lint migrate-up migrate-down clean

help: ## Show available targets
	@awk 'BEGIN {FS = ":.*##"; printf "\nUsage:\n  make \033[36m<target>\033[0m\n\nTargets:\n"} /^[a-zA-Z_-]+:.*##/ { printf "  \033[36m%-20s\033[0m %s\n", $$1, $$2 }' $(MAKEFILE_LIST)

# ─── Infrastructure ──────────────────────────────────────────────────────────
dev-infra: ## Start Postgres, Redis, and NATS via Docker Compose
	docker compose up -d postgres redis nats
	@echo "Waiting for infra to be healthy..."
	@sleep 3

infra-down: ## Stop infrastructure containers
	docker compose down

# ─── Run ─────────────────────────────────────────────────────────────────────
dev-api: ## Run the API server locally (requires infra)
	cp -n .env.example .env 2>/dev/null || true
	go run ./apps/api/...

dev-worker: ## Run the worker locally (requires infra)
	cp -n .env.example .env 2>/dev/null || true
	go run ./apps/worker/...

dev-scheduler: ## Run the standalone scheduler
	cp -n .env.example .env 2>/dev/null || true
	go run ./apps/scheduler/...

# ─── Build ───────────────────────────────────────────────────────────────────
build-api: ## Build the API binary
	go build -o bin/forge-api ./apps/api/...

build-worker: ## Build the worker binary
	go build -o bin/forge-worker ./apps/worker/...

build-scheduler: ## Build the scheduler binary
	go build -o bin/forge-scheduler ./apps/scheduler/...

build-all: build-api build-worker build-scheduler ## Build all binaries

# ─── Database ─────────────────────────────────────────────────────────────────
migrate-up: ## Apply all migrations to the local database
	@echo "Applying migrations..."
	PGPASSWORD=forge psql -h localhost -U forge -d forge -f migrations/001_initial_schema.sql

migrate-reset: ## Drop and recreate the local forge database
	PGPASSWORD=forge psql -h localhost -U forge -c "DROP DATABASE IF EXISTS forge;"
	PGPASSWORD=forge psql -h localhost -U forge -c "CREATE DATABASE forge;"
	$(MAKE) migrate-up

# ─── Quality ─────────────────────────────────────────────────────────────────
test: ## Run unit tests
	go test ./... -v -race -timeout 60s

lint: ## Run golangci-lint
	golangci-lint run ./...

vet: ## Run go vet
	go vet ./...

# ─── Clean ───────────────────────────────────────────────────────────────────
clean: ## Remove built binaries
	rm -rf bin/

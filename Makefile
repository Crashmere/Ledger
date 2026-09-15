.PHONY: test build linux dev
BASE_PATH ?= /
test:
	go test ./...
	npm --prefix web test
	npm --prefix web run typecheck
	node --test deploy/deploy-release.test.mjs

build:
	VITE_BASE_PATH=$(BASE_PATH) npm --prefix web run build
	go build -tags production -trimpath -o bin/ledger ./cmd/ledger

linux:
	VITE_BASE_PATH=$(BASE_PATH) npm --prefix web run build
	CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -tags production -trimpath -o bin/ledger-linux-amd64 ./cmd/ledger

dev:
	go run ./cmd/ledger serve --db var/dev.sqlite

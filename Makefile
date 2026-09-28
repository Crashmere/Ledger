.PHONY:  build linux dev
BASE_PATH ?= /
build:
	VITE_BASE_PATH=$(BASE_PATH) npm --prefix web run build
	go build -tags production -trimpath -o bin/ledger ./cmd/ledger

linux:
	VITE_BASE_PATH=$(BASE_PATH) npm --prefix web run build
	CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -tags production -trimpath -o bin/ledger-linux-amd64 ./cmd/ledger

dev:
	go run ./cmd/ledger serve --db var/dev.sqlite

.PHONY: release deploy portal rollback releases
release:
	bash deploy/release.sh build
deploy:
	bash deploy/release.sh deploy
portal:
	bash deploy/release.sh portal
rollback:
	bash deploy/release.sh rollback $(COMMIT)
releases:
	bash deploy/release.sh list

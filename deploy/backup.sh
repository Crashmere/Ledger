#!/usr/bin/env bash
set -euo pipefail
umask 077
ledger_binary="${LEDGER_BINARY:-/opt/ledger/bin/ledger}"
ledger_database="${LEDGER_DB:-/opt/ledger/data/ledger.sqlite}"
ledger_backups="${LEDGER_BACKUP_DIR:-/opt/ledger/backups}"
mkdir -p "$ledger_backups"
backup_path="$ledger_backups/daily-$(date -u +%Y%m%dT%H%M%S)-$$.sqlite"
"$ledger_binary" backup --db "$ledger_database" --out "$backup_path"

# 只有新备份成功并通过完整性检查后才轮换；手工/升级/恢复前备份不参与。
mapfile -t daily_backups < <(find "$ledger_backups" -maxdepth 1 -type f -name 'daily-*.sqlite' -printf '%f\n' | LC_ALL=C sort -r)
for ((index=14; index<${#daily_backups[@]}; index++)); do
  rm -- "$ledger_backups/${daily_backups[index]}"
done
printf 'Backup created: %s\n' "$backup_path"

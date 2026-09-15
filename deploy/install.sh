#!/usr/bin/env bash
set -euo pipefail
if [[ "$EUID" -ne 0 || $# -ne 2 ]]; then
  printf 'Usage: sudo bash deploy/install.sh <linux-binary> <verified-initial-database>\n' >&2
  exit 1
fi
ledger_binary="$(realpath "$1")"
ledger_initial="$(realpath "$2")"
ledger_deploy="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
if [[ -e /opt/ledger/ledger || -e /var/lib/ledger/ledger.sqlite ]]; then
  printf 'Existing installation found. Follow the documented upgrade procedure.\n' >&2
  exit 1
fi
"$ledger_binary" check --db "$ledger_initial"
if ! id ledger >/dev/null 2>&1; then
  useradd --system --home-dir /var/lib/ledger --shell /usr/sbin/nologin ledger
fi
install -d -m 0755 /opt/ledger
install -d -m 0700 -o ledger -g ledger /var/lib/ledger /var/backups/ledger
install -m 0755 "$ledger_binary" /opt/ledger/ledger
install -m 0755 "$ledger_deploy/backup.sh" /opt/ledger/backup.sh
# restore 创建独立一致性副本，不直接复制可能带 WAL 的源主文件。
/opt/ledger/ledger restore --from "$ledger_initial" --db /var/lib/ledger/ledger.sqlite
chown ledger:ledger /var/lib/ledger/ledger.sqlite
install -m 0644 "$ledger_deploy/ledger.service" "$ledger_deploy/ledger-backup.service" "$ledger_deploy/ledger-backup.timer" /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now ledger.service ledger-backup.timer
systemctl start ledger-backup.service
curl --fail --silent --retry 10 --retry-delay 1 --retry-connrefused http://127.0.0.1:8080/healthz

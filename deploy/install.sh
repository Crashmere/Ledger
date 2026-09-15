#!/usr/bin/env bash
set -euo pipefail
if [[ "$EUID" -ne 0 || $# -ne 2 ]]; then
  printf 'Usage: sudo bash deploy/install.sh <linux-binary> <verified-initial-database>\n' >&2
  exit 1
fi
ledger_binary="$(realpath "$1")"
ledger_initial="$(realpath "$2")"
ledger_deploy="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
if [[ -e /opt/ledger || -e /var/lib/ledger/ledger.sqlite || -e /etc/systemd/system/ledger.service ]]; then
  printf 'Existing installation found. Follow the documented upgrade procedure.\n' >&2
  exit 1
fi
"$ledger_binary" check --db "$ledger_initial"
if ss -H -ltn 'sport = :18080' | grep -q .; then
  printf 'Port 18080 is already in use. Choose a separate application port first.\n' >&2
  exit 1
fi
if ! id ledger >/dev/null 2>&1; then
  useradd --system --home-dir /opt/ledger --shell /usr/sbin/nologin ledger
fi
install -d -m 0755 /opt/ledger /opt/ledger/bin /opt/ledger/config
install -d -m 0700 -o ledger -g ledger /opt/ledger/data /opt/ledger/backups
install -m 0755 "$ledger_binary" /opt/ledger/bin/ledger
install -m 0755 "$ledger_deploy/backup.sh" /opt/ledger/bin/backup.sh
install -m 0644 "$ledger_deploy/ledger.env" "$ledger_deploy/nginx-location.conf" /opt/ledger/config/
install -m 0644 "$ledger_deploy/ledger.service" "$ledger_deploy/ledger-backup.service" "$ledger_deploy/ledger-backup.timer" /opt/ledger/config/
# restore 创建独立一致性副本，不直接复制可能带 WAL 的源主文件。
/opt/ledger/bin/ledger restore --from "$ledger_initial" --db /opt/ledger/data/ledger.sqlite
chown ledger:ledger /opt/ledger/data/ledger.sqlite
systemctl link /opt/ledger/config/ledger.service /opt/ledger/config/ledger-backup.service /opt/ledger/config/ledger-backup.timer
systemctl daemon-reload
systemctl enable --now ledger.service ledger-backup.timer
systemctl start ledger-backup.service
curl --fail --silent --retry 10 --retry-delay 1 --retry-connrefused http://127.0.0.1:18080/healthz
printf '\nLedger installed. Enable /opt/ledger/config/nginx-location.conf in the shared Nginx server after verification.\n'

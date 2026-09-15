#!/usr/bin/env bash
set -euo pipefail
if [[ $EUID -ne 0 || $# -ne 1 ]]; then
  printf 'Usage: sudo bash deploy/setup-ci.sh <deploy-public-key.pub>\n' >&2; exit 64
fi
public_key=$(realpath "$1")
scripts=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
ssh-keygen -l -f "$public_key" >/dev/null
if [[ $(wc -l < "$public_key") -ne 1 ]] || ! grep -q '^ssh-ed25519 ' "$public_key"; then
  printf 'Expected one Ed25519 public key.\n' >&2; exit 64
fi
test -x /opt/ledger/bin/ledger
if id ledger-deploy >/dev/null 2>&1 || [[ -e /etc/sudoers.d/ledger-deploy ]]; then
  printf 'CI user already exists; rotate its key explicitly instead of rerunning setup.\n' >&2; exit 1
fi
useradd --system --home-dir /opt/ledger/deploy-user --shell /bin/bash ledger-deploy
# 用户不能改 home、authorized_keys、强制命令或 root 发布脚本。
install -d -m 0755 /opt/ledger/deploy-user /opt/ledger/deploy-user/.ssh
install -m 0755 "$scripts/deploy-ssh.sh" /opt/ledger/bin/deploy-ssh.sh
install -m 0755 "$scripts/deploy-release.sh" /opt/ledger/bin/deploy-release.sh
printf 'restrict,command="/opt/ledger/bin/deploy-ssh.sh" %s\n' "$(< "$public_key")" > /opt/ledger/deploy-user/.ssh/authorized_keys
chmod 0644 /opt/ledger/deploy-user/.ssh/authorized_keys
printf 'ledger-deploy ALL=(root) NOPASSWD: /opt/ledger/bin/deploy-release.sh\n' > /etc/sudoers.d/ledger-deploy
chmod 0440 /etc/sudoers.d/ledger-deploy
visudo -cf /etc/sudoers.d/ledger-deploy
printf 'Restricted deployment user configured.\n'

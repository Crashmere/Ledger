#!/usr/bin/env bash
set -euo pipefail
export PATH=/usr/sbin:/usr/bin:/sbin:/bin
umask 077

# 此脚本由 root 安装和维护；CI 只能发送一个程序，不能更新本脚本。
if [[ $EUID -ne 0 || $# -ne 2 || ! $1 =~ ^[0-9a-f]{40}$ || ! $2 =~ ^[0-9a-f]{64}$ ]]; then
  printf 'Usage: deploy-release.sh <commit-sha> <binary-sha256> < binary\n' >&2
  exit 64
fi
commit=$1
expected=$2
app=/opt/ledger
database=$app/data/ledger.sqlite
exec 9>/run/lock/ledger-deploy.lock
flock -n 9 || { printf 'Another deployment is running.\n' >&2; exit 75; }
test -f "$database"
test -x "$app/bin/ledger"
install -d -m 0755 "$app/releases"
release=$(mktemp -d "$app/releases/$commit.XXXXXX")
chmod 0755 "$release"
stopped=false
replaced=false

healthy() {
  systemctl is-active --quiet ledger &&
    curl --fail --silent --show-error --max-time 3 http://127.0.0.1:18080/healthz | grep -q '"status":"ok"' &&
    curl --fail --silent --show-error --max-time 3 http://127.0.0.1/ledger/search | grep -q '/ledger/assets/'
}
wait_healthy() {
  for ((attempt=0; attempt<20; attempt++)); do
    if healthy; then return 0; fi
    sleep 1
  done
  return 1
}
finish() {
  result=$?
  trap - EXIT HUP INT TERM
  if [[ $result -ne 0 && $stopped == true ]]; then
    printf 'Deployment failed; restarting the previous program. Database is not restored.\n' >&2
    systemctl stop ledger || true
    if [[ $replaced == true ]]; then
      install -m 0755 "$release/previous" "$app/bin/ledger.rollback"
      mv -f "$app/bin/ledger.rollback" "$app/bin/ledger"
    fi
    if systemctl start ledger && wait_healthy; then
      printf 'Previous program is healthy.\n' >&2
    else
      printf 'ROLLBACK FAILED: inspect journalctl -u ledger.\n' >&2
    fi
  fi
  if [[ $result -eq 0 ]]; then printf 'success\n' > "$release/result";
  else printf 'failed\n' > "$release/result"; fi
  exit "$result"
}
trap finish EXIT
trap 'exit 130' INT
trap 'exit 143' HUP TERM

# 限制上传时间和大小；校验完成前不触碰运行中的程序。
timeout 90 head -c 67108865 > "$release/ledger"
size=$(stat -c %s "$release/ledger")
if ((size == 0 || size > 67108864)); then
  printf 'Binary must be between 1 byte and 64 MiB.\n' >&2; exit 65
fi
actual=$(sha256sum "$release/ledger")
if [[ ${actual%% *} != "$expected" ]]; then
  printf 'Binary checksum mismatch.\n' >&2; exit 65
fi
chmod 0755 "$release/ledger"
cp "$app/bin/ledger" "$release/previous"
chmod 0755 "$release/previous"
printf 'commit=%s\nsha256=%s\n' "$commit" "$expected" > "$release/metadata"

# 旧程序备份，候选程序校验；两者都以 ledger 身份运行，绝不以 root 执行上传内容。
backup="$app/backups/before-deploy-$(basename "$release").sqlite"
stopped=true
systemctl stop ledger
runuser -u ledger -- timeout 60 "$app/bin/ledger" backup --db "$database" --out "$backup"
runuser -u ledger -- timeout 30 "$release/ledger" check --db "$backup"
install -m 0755 "$release/ledger" "$app/bin/ledger.next"
replaced=true
mv -f "$app/bin/ledger.next" "$app/bin/ledger"
systemctl start ledger
wait_healthy
printf '%s\n' "$commit" > "$app/current-commit"
chmod 0644 "$app/current-commit"
printf 'Deployed %s; backup: %s\n' "$commit" "$backup"

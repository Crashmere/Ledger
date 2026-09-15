# 部署与维护

应用以 ledger 用户运行，Go 只监听 127.0.0.1:18080。共享 Nginx 监听公网 HTTP 80，把 /ledger/ 转发给它；/ledger 自动跳到带尾斜线的地址。其他应用使用独立路径和本机端口，不需要额外公网端口。

SQLite 不需要独立服务或全局实例：它是 Go 进程内的数据库引擎，账本是本地文件。每个应用使用各自的 SQLite 文件和备份目录，不跨应用共享数据库。

## 目录和配置

```text
/opt/ledger/
  bin/ledger                Go 程序，内嵌 Vue 静态资源
  bin/backup.sh             每日备份及轮换
  config/ledger.env         本机监听、数据库和备份路径
  config/nginx-location.conf
  config/ledger.service
  config/ledger-backup.service
  config/ledger-backup.timer
  data/ledger.sqlite        唯一正式账本，含同目录 WAL/SHM
  backups/                  每日及手工备份
  deployment/               root 私有的发布归档，不作为运行目录
  docs/                     服务器上的维护说明
```

bin/config 由 root 管理，data/backups 为 ledger 所有、权限 0700。systemd 只在 /etc/systemd/system 建到 config 的链接。Nginx 的 /etc/nginx/app-locations/ledger.conf 链接到本项目 location 配置。

共享入口 /etc/nginx/sites-available/apps 属于全局配置；它 include /etc/nginx/app-locations/*.conf。新增应用只需增加自己的 location 文件，不改 Ledger 的数据和服务。全局服务日志用 journalctl；Nginx 请求日志遵循其全局配置。

同一 IP 下的不同路径仍属浏览器同源，路径分发用于部署组织，不是应用间的安全隔离。

## 构建与首次切换

1. 完成旧系统最后一次同步并停止写入，固定最终 Git commit。
2. 按迁移工具说明生成新库并检查报告。真实快照、报告和数据库不进入源码仓库。
3. 执行以下构建，将 Linux 程序、deploy/ 和已验证数据库上传到服务器独立暂存目录。

```sh
make test
make linux BASE_PATH=/ledger/
```

BASE_PATH 是构建参数，同时影响资源、Vue 路由和 API；Go 内部路由不变。根路径本地构建使用默认值 /。如需用 Vite 调试子路径，可运行 VITE_BASE_PATH=/ledger/ npm --prefix web run dev。

在服务器暂存目录中运行：

```sh
sudo bash deploy/install.sh ./ledger-linux-amd64 ./final.sqlite
sudo systemctl status ledger
sudo systemctl list-timers ledger-backup.timer
curl --fail http://127.0.0.1:18080/healthz
```

安装脚本仅适用于首次安装；已有 /opt/ledger 或端口被占用时退出，不覆盖账本。它创建独立用户和目录，通过 restore 生成一致性副本，启用服务及每日备份并生成首备份。脚本不会安装 Nginx，也不修改共享入口。

新服务器的 Nginx 使用 Ubuntu 官方仓库包。安装后可参考 deploy/nginx-apps.conf 建立共享入口；必须先检查已有站点，保留原配置，不直接替换正在使用的站点。启用 Ledger 的路径：

```sh
sudo install -d -m 0755 /etc/nginx/app-locations
sudo ln -s /opt/ledger/config/nginx-location.conf /etc/nginx/app-locations/ledger.conf
sudo nginx -t
sudo systemctl reload nginx
curl --fail http://127.0.0.1/ledger/healthz
```

以上要求已启用共享 apps server。云安全组与主机防火墙只需放行 80，不开放 18080。公网使用 http://服务器IP/ledger/，核对账户、月份和历史交易后只在新版记账。

## 备份

ledger-backup.timer 每天北京时间 03:00 运行，错过后补一次，允许五分钟随机延迟。backup.sh 用 VACUUM INTO 生成包含已提交 WAL 的一致性快照，通过完整性/外键检查后保留最近 14 份 daily-*.sqlite；手工备份不参与轮换。

```sh
sudo systemctl start ledger-backup.service
sudo journalctl -u ledger-backup.service -n 30 --no-pager
sudo -u ledger /opt/ledger/bin/ledger backup --db /opt/ledger/data/ledger.sqlite --out /opt/ledger/backups/manual-20260916.sqlite
```

目标名必须唯一，不会覆盖已有文件。不要直接复制运行中的主库。同盘备份用于误操作恢复；异机备份仍需单独安排，可通过 SSH 下载已经完成的备份文件。网页不提供数据文件下载入口。

## 恢复

先校验并恢复到独立路径：

```sh
sudo -u ledger /opt/ledger/bin/ledger check --db /opt/ledger/backups/manual-20260916.sqlite
sudo -u ledger /opt/ledger/bin/ledger restore --from /opt/ledger/backups/manual-20260916.sqlite --db /opt/ledger/data/recovered.sqlite
```

正式替换会丢弃恢复时点后的账目，执行前先确认恢复时点。停止 timer 和应用后保存现状，再替换；以下归档目录必须不存在：

```sh
sudo systemctl stop ledger-backup.timer ledger-backup.service ledger.service
sudo -u ledger /opt/ledger/bin/ledger backup --db /opt/ledger/data/ledger.sqlite --out /opt/ledger/backups/before-restore-20260916.sqlite
sudo mkdir -m 0700 /opt/ledger/data/before-restore-20260916
sudo mv /opt/ledger/data/ledger.sqlite /opt/ledger/data/before-restore-20260916/
sudo bash -c 'for suffix in -wal -shm; do if [ -e "/opt/ledger/data/ledger.sqlite$suffix" ]; then mv "/opt/ledger/data/ledger.sqlite$suffix" /opt/ledger/data/before-restore-20260916/; fi; done'
sudo mv /opt/ledger/data/recovered.sqlite /opt/ledger/data/ledger.sqlite
sudo chown ledger:ledger /opt/ledger/data/ledger.sqlite
sudo systemctl start ledger.service ledger-backup.timer
curl --fail http://127.0.0.1/ledger/healthz
```

任一步失败先停下排查，不继续覆盖。若现库损坏无法备份，保留原库和伴随文件再处理。重启后浏览器重新加载，不从旧 GitHub 快照再次覆盖正式库。

## 更新程序

日常更新优先推送 main，GitHub Actions 检查通过后自动备份、发布并验证；权限、记录与失败回退见 [CI/CD](CICD.md)。下面保留管理员手工更新流程，用于排障或首次配置。

本地先 make test 和 make linux BASE_PATH=/ledger/。将新程序上传到独立暂存目录；停服后备份，保留旧程序，再安装：

```sh
sudo systemctl stop ledger
sudo -u ledger /opt/ledger/bin/ledger backup --db /opt/ledger/data/ledger.sqlite --out /opt/ledger/backups/before-upgrade-20260916.sqlite
sudo cp -n /opt/ledger/bin/ledger /opt/ledger/bin/ledger.previous-20260916
sudo install -m 0755 ./ledger-linux-amd64 /opt/ledger/bin/ledger
sudo systemctl start ledger
curl --fail http://127.0.0.1/ledger/healthz
```

日期示例每次应改成唯一名称。纯程序更新失败可在停服后恢复旧程序。修改 config 中的 unit 后运行 systemctl daemon-reload；修改 Nginx location 后先 nginx -t 再 reload，不影响其他应用。schema 变更需新增顺序迁移并配套升级、回退步骤，不通过重跑首次安装覆盖数据。

## 排查

```sh
sudo journalctl -u ledger -n 100 --no-pager
sudo systemctl status ledger ledger-backup.timer nginx
sudo -u ledger /opt/ledger/bin/ledger check --db /opt/ledger/data/ledger.sqlite
curl --fail http://127.0.0.1:18080/healthz
curl --fail http://127.0.0.1/ledger/healthz
```

本机端口正常而公网失败时检查 Nginx、80 端口和安全组。页面正常但资源/API 错误时核对构建 BASE_PATH 与 Nginx 前缀。缺库启动失败时检查路径和权限，不要 init 一个空账本。写请求结果不明先查账核对，不自动重试。

# 部署与维护

目标服务器为 Ubuntu x86_64，SSH 别名 ali。程序以 ledger 系统用户运行，HTTP 默认监听 0.0.0.0:8080。无域名、TLS 或反向代理依赖；可使用公网 IP 或已解析的主机名访问。公网端口需在服务器防火墙及云安全组放行。

## 首次正式切换

1. 停止旧设备继续记账，完成旧系统最后一次同步，固定最终 Git commit。
2. 按迁移工具说明下载快照、生成新库并检查报告。不要拿开发期间的试迁移库直接替代最终快照。
3. 本地执行 make linux，将 bin/ledger-linux-amd64、deploy/ 及验证后的数据库放到服务器一个独立目录。
4. 在该目录运行下面命令。安装脚本只用于首次安装，发现已有程序或数据库会退出。

```sh
chmod +x ledger-linux-amd64
sudo bash deploy/install.sh ./ledger-linux-amd64 ./final.sqlite
sudo systemctl status ledger
sudo systemctl list-timers ledger-backup.timer
curl --fail http://127.0.0.1:8080/healthz
```

安装会创建系统用户、程序目录 /opt/ledger、数据库目录 /var/lib/ledger、备份目录 /var/backups/ledger，并启用服务和每日备份。最后执行一次备份。程序和服务配置可以重新部署，数据目录应独立保留。

通过公网地址核对页面、余额、月份和几笔历史交易后开始使用。旧应用和原快照先留档，避免两个系统同时写入导致后续难以确定最新数据。

## 备份

ledger-backup.timer 每天北京时间 03:00 运行，关机错过后补一次；允许最多五分钟随机延迟。backup.sh 先生成一致性快照并做 integrity_check/foreign_key_check，再保留最近 14 个 daily-*.sqlite。手工备份不参与轮换。

```sh
sudo systemctl start ledger-backup.service
sudo journalctl -u ledger-backup.service -n 30 --no-pager
sudo -u ledger /opt/ledger/ledger backup --db /var/lib/ledger/ledger.sqlite --out /var/backups/ledger/manual-20260916.sqlite
```

文件名必须唯一，已存在则退出。备份不会出现在网站目录或 HTTP 接口中。同盘备份用于误操作恢复；异机副本目的地需按实际存储安排配置，目前脚本仅管理本机备份。可通过 SSH 下载已经生成的备份文件，不要复制运行中主库。

## 恢复演练和正式恢复

先校验并恢复到独立路径；恢复命令拒绝覆盖文件：

```sh
sudo -u ledger /opt/ledger/ledger check --db /var/backups/ledger/manual-20260916.sqlite
sudo -u ledger /opt/ledger/ledger restore --from /var/backups/ledger/manual-20260916.sqlite --db /var/lib/ledger/recovered.sqlite
```

正式替换会舍弃备份之后的当前账目，应先确定恢复时点。停止定时器和服务后，保存当前库，再替换已核对的新库。以下使用唯一归档目录，不删除当前数据库及 WAL/SHM：

```sh
sudo systemctl stop ledger-backup.timer ledger-backup.service ledger.service
sudo -u ledger /opt/ledger/ledger backup --db /var/lib/ledger/ledger.sqlite --out /var/backups/ledger/before-restore-20260916.sqlite
sudo mkdir -m 0700 /var/lib/ledger/before-restore-20260916
sudo mv /var/lib/ledger/ledger.sqlite /var/lib/ledger/before-restore-20260916/
sudo bash -c 'for suffix in -wal -shm; do if [ -e "/var/lib/ledger/ledger.sqlite$suffix" ]; then mv "/var/lib/ledger/ledger.sqlite$suffix" /var/lib/ledger/before-restore-20260916/; fi; done'
sudo mv /var/lib/ledger/recovered.sqlite /var/lib/ledger/ledger.sqlite
sudo chown ledger:ledger /var/lib/ledger/ledger.sqlite
sudo systemctl start ledger.service ledger-backup.timer
curl --fail http://127.0.0.1:8080/healthz
```

命令任一步失败先停下排查，不继续覆盖。若现库损坏而无法执行备份，保留原库及伴随文件作为故障归档后再处理。浏览器重新加载即可读取恢复后的账本。

## 更新程序

先在本地执行 make test 和 make linux。服务器停服后先备份，保留旧程序，再安装新文件：

```sh
sudo systemctl stop ledger
sudo -u ledger /opt/ledger/ledger backup --db /var/lib/ledger/ledger.sqlite --out /var/backups/ledger/before-upgrade-20260916.sqlite
sudo cp /opt/ledger/ledger /opt/ledger/ledger.previous
sudo install -m 0755 ./ledger-linux-amd64 /opt/ledger/ledger
sudo systemctl start ledger
curl --fail http://127.0.0.1:8080/healthz
```

当前 schema 为 1，服务不会自动打开未知版本。将来修改数据库结构时新增顺序迁移，并同时明确升级和回退步骤；不要通过改初始建表文件来更新已有库。纯程序更新失败可在停服后恢复旧程序；涉及 schema 变化需使用配套数据备份。

## 排查

```sh
sudo journalctl -u ledger -n 100 --no-pager
sudo systemctl status ledger ledger-backup.timer
sudo -u ledger /opt/ledger/ledger check --db /var/lib/ledger/ledger.sqlite
```

启动时报库不存在时检查 LEDGER_DB 和目录权限；不要用 init 自动补一个空库。写请求网络失败时先查交易结果，再决定是否重试。服务没有离线队列或写入自动重试。

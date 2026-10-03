# Ledger 部署与维护

公网入口使用可信 IP 证书的 HTTPS，原有 /ledger/ 路径保持。公网 HTTP 返回 308；API 客户端直接使用 HTTPS。Nginx 覆盖 `X-Forwarded-Proto`；写入来源校验只信任来自回环地址的代理头，仍拒绝跨站来源。证书、续期、回退和整机验收见 [共享 HTTPS 运维](https://github.com/Crashmere/agent-config/blob/main/skills/server-operations/references/https.md)（服务器副本 /opt/server-context/references/https.md）。本项目的后端与发布检查保留本机 HTTP，127.0.0.1:80 的代理检查入口不能从公网访问。公网已接入 ServerPortal 统一设备认证：先在 /portal/login 输入口令授权设备，随后使用同源 Secure/HttpOnly Cookie 访问；未授权 API 返回 401。本机发布检查与服务间调用保留。

本文负责 Ledger 本身。先读 [文档入口](README.md)；共享主机、Nginx server 和跨项目规则见 `/opt/server-context/SKILL.md` 或 [server-operations 源](https://github.com/Crashmere/agent-config/blob/main/skills/server-operations/SKILL.md)。不要用本项目配置覆盖其他应用的共享入口。

目录： [当前部署](#当前部署) · [只读查看](#只读查看) · [构建与首次安装](#构建与首次安装) · [备份](#备份) · [恢复](#恢复) · [程序和配置更新](#程序和配置更新) · [数据库升级](#数据库升级) · [文档同步](#文档同步) · [排查](#排查)

请求大小：Nginx 与 JSON 上限均为 2 MiB。统一认证子请求不另设 body 上限；超过 1 MiB 的请求若返回 500，按共享的[统一认证误拦大请求](https://github.com/Crashmere/agent-config/blob/main/skills/server-operations/references/common-issues.md#统一认证误拦大请求)排查。业务字段和大小校验仍由本应用负责。

## 当前部署

现场核对日期：2026-09-27。版本、PID、磁盘占用和最新备份文件名通过下文命令查看，不把不断变化的值写死在文档。

```text
浏览器 /ledger/ → 共享 Nginx HTTPS :443 → Go 127.0.0.1:18080 → SQLite 文件
```

管理员使用 SSH 别名 `ali`，真实地址由本地 SSH 配置维护。使用 IP 证书与统一设备认证，无域名；授权设备可读写。Go 二进制内嵌 Vue 页面，服务器无需前端进程、Go 编译器、Docker 或数据库服务；主机已有其他用途的软件以共享清单为准。

```text
/opt/ledger/
  AGENTS.md                  项目维护入口
  bin/ledger                 正在运行的程序，内嵌 Vue
  bin/backup.sh              每日一致性备份与轮换
  bin/deploy-ssh.sh           受限 SSH 发布入口
  bin/deploy-release.sh       root 管理的固定发布脚本
  config/ledger.env           监听、数据库、程序和备份路径
  config/nginx-location.conf  /ledger/ 的反向代理
  config/ledger.service       常驻程序
  config/ledger-backup.service
  config/ledger-backup.timer
  data/ledger.sqlite         唯一正式账本；可能伴随 -wal、-shm
  backups/                   daily、手工与发布前备份
  current-commit             当前程序对应的 Git 提交
  releases/                  每次本机发布的程序、上一版本及结果
  docs/                      当前项目文档和 SOURCE 来源标记
  deploy-user/.ssh/           本机专用发布公钥与强制命令配置
```

| 对象 | 所有者与职责 |
| --- | --- |
| bin、config、docs、AGENTS、发布目录 | root 管理；程序和配置不能由应用随意改写 |
| data、backups | ledger:ledger，目录 0700；真实数据不得进 Git |
| ledger.service | User/Group=ledger，`ExecStart=/opt/ledger/bin/ledger serve`，异常退出自动重启；systemd 只允许写 data |
| ledger-backup.service | ledger 身份执行备份，可写 data/backups，执行结束退出 |
| ledger-deploy | 专用发布身份，不是管理员交互 shell；权限见 DEPLOYMENT |

实际 env（当前不含秘密）：

```text
LEDGER_ADDR=127.0.0.1:18080
LEDGER_DB=/opt/ledger/data/ledger.sqlite
LEDGER_BINARY=/opt/ledger/bin/ledger
LEDGER_BACKUP_DIR=/opt/ledger/backups
LEDGER_FABRICWORLD_URL=http://127.0.0.1:18082
```

systemd unit 通过 `/etc/systemd/system/ledger*` 链接到 config。Nginx 的 `/etc/nginx/app-locations/ledger.conf` 链接到本项目 location；`/ledger` 返回 308 到 `/ledger/`，代理地址末尾 `/` 去掉此前缀，保留 Host。全局 server 的维护源不在 Ledger 仓库。同 IP 的不同路径仍属浏览器同源，不是安全隔离。

## 只读查看

本机先 `ssh ali`。当前管理员是 root，下列查看命令省略 sudo；普通账号可能需要授权读取日志与私有目录。

```sh
systemctl status ledger nginx --no-pager
systemctl cat ledger
cat /opt/ledger/config/ledger.env
ps -u ledger -o pid,ppid,%cpu,%mem,etime,args
journalctl -u ledger -n 50 --no-pager
curl --fail http://127.0.0.1:18080/healthz
curl --fail http://127.0.0.1/ledger/healthz
ls -lh /opt/ledger/data/
du -sh /opt/ledger/data/ /opt/ledger/backups/ /opt/ledger/releases/
cat /opt/ledger/current-commit
cat /opt/ledger/docs/SOURCE
```

两个健康接口都应返回 `{"status":"ok"}`。journal 实时跟踪使用 `journalctl -u ledger -f`，Ctrl+C 只退出查看；`less` 按 q 退出。Nginx 请求看 `/var/log/nginx/access.log`、`error.log`，不是只查 Nginx journal。

SQLite 没有单独进程/服务；当前主机未安装 sqlite3 CLI，不能默认使用它。不要 cat 数据库，不要删除 WAL/SHM，不要只复制活跃主库作备份。应用自带完整性检查不修改账目，可能涉及 SQLite 的辅助文件访问：

```sh
runuser -u ledger -- /opt/ledger/bin/ledger check --db /opt/ledger/data/ledger.sqlite
```

check 成功时无输出、退出码 0；不能因为没输出就当作没执行。

## 构建与首次安装

只适用于新的空应用目录。现有 Ledger 更新看后面的发布流程，不能重跑首次安装或拿其他快照覆盖正式数据。

在有相应工具链的开发机，按 go.mod 与 web/package-lock.json 准备依赖并构建：

```sh
make linux BASE_PATH=/ledger/
```

产物 `bin/ledger-linux-amd64` 是 Linux amd64 单文件，SQLite 纯 Go，不依赖 CGO。`BASE_PATH` 同时设置静态资源、Vue Router 和 API 前缀；Go 内部路由不变。根路径本地构建默认 `/`。

将二进制、源码 `deploy/` 和初始数据上传到独立暂存目录，先校验来源/哈希。初始数据二选一：

- 保留已有数据：使用经 Ledger 维护工具验证的一致性备份。
- 明确不要历史数据的新实例：在暂存目录用 `./ledger-linux-amd64 init --db ./initial.sqlite` 创建空库。不能在已有生产目录这样处理缺库。

在服务器暂存目录运行（以下为写操作）：

```sh
sudo bash deploy/install.sh ./ledger-linux-amd64 ./initial.sqlite
sudo systemctl status ledger --no-pager
sudo systemctl list-timers ledger-backup.timer --no-pager
curl --fail http://127.0.0.1:18080/healthz
```

初始文件名按实际调整。安装脚本遇到已有 `/opt/ledger`、旧数据位置、ledger unit 或占用的 18080 端口会退出。它创建用户、目录、配置，通过 restore 生成正式一致性副本，启用服务和 timer，执行首备份；不会安装 Nginx 或修改共享入口。

先按共享重建指南建立 apps server，再启用本应用（链接已存在时先检查，不强制覆盖）：

```sh
sudo install -d -m 0755 /etc/nginx/app-locations
sudo ln -s /opt/ledger/config/nginx-location.conf /etc/nginx/app-locations/ledger.conf
sudo nginx -t
sudo systemctl reload nginx
curl --fail http://127.0.0.1/ledger/healthz
curl --fail http://127.0.0.1/ledger/search
```

检查资源前缀和公网访问，18080 不对公网开放；云侧权限按共享指南核实。然后设置 [本机发布](DEPLOYMENT.md)，更新共享应用清单，运行 `sync-docs.sh Ledger` 同步文档。首次安装脚本不会自动配置发布身份 或同步文档。

## 备份

`ledger-backup.timer` 每天北京时间 03:00，允许五分钟随机延迟，错过后补执行。脚本使用 `VACUUM INTO` 生成包含已提交 WAL 的一致性快照，完整性/外键检查通过后保留最近 14 份 `daily-*.sqlite`；发布前备份按共享发布保留策略轮换，手工备份不自动清理。

查看调度与结果：

```sh
systemctl list-timers ledger-backup.timer --no-pager
systemctl cat ledger-backup.timer ledger-backup.service
journalctl -u ledger-backup.service -n 30 --no-pager
ls -lht /opt/ledger/backups/
```

backup service 执行完显示 inactive 正常，失败看日志与 Result。备份文件名用 UTC，可能比北京时间日期早一天。下列命令会立即创建一份 daily 备份，并按规则轮换掉最旧的一份：

```sh
sudo systemctl start ledger-backup.service
```

单独手工备份用 `ledger backup --db <正式路径> --out <不存在的唯一备份路径>`，以 ledger 身份运行；目标不能覆盖已有文件。自动备份保存在同盘；2026-09-27 已另取一份全应用数据归档下载到维护电脑并校验，见 [共享备份说明](https://github.com/Crashmere/agent-config/blob/main/skills/server-operations/references/current-state.md#手工数据归档)。本应用脚本不主动异机同步；服务器另有阿里云文件备份，范围、30 天保留与恢复限制见[主机云备份](https://github.com/Crashmere/agent-config/blob/main/skills/server-operations/references/current-state.md#云备份)。需要时仅传输已经完成的备份文件，不能上传到源码仓库或网页公开目录。

## 恢复

恢复会舍弃所选备份之后的账目，必须确认来源、时点和停机范围。不要直接对现库覆盖，也不要把自动程序回退当数据库恢复。

1. 确认没有发布在进行；协调 GitHub 发布和维护窗口。准备所有不存在的唯一目标名称。
2. 用应用 `check --db <选定备份>` 校验，再以 ledger 身份执行 `restore --from <备份> --db /opt/ledger/data/<唯一恢复文件>.sqlite`，校验新文件。
3. 停止 `ledger-backup.timer`、`ledger-backup.service` 和 `ledger.service`，避免维护时发生新的写入。
4. 用旧程序对现库生成 `before-restore-<唯一标识>.sqlite`。若现库损坏无法备份，停止并先保留主库及 WAL/SHM，不继续丢弃现场。
5. 在明确的、全新归档目录中整体保留现库及其伴随文件，再把已校验恢复文件移到正式 `ledger.sqlite`，核对 ledger 所有权与 0600 权限。不要把旧 WAL/SHM 留给新主库。
6. 启动应用与 timer，验证直连/代理健康，浏览器重新加载后只读核对账目；结果不符合预期先停止写入，不继续反复覆盖。

按本次实际路径准备并审阅命令后再执行，任一步失败先排查。归档和恢复前备份暂留供回退；清理必须明确文件范围并确认。不提供可误复制执行的固定日期删除/替换命令。

## 程序和配置更新

### FabricWorld 联动

Ledger 通过环境变量 LEDGER_FABRICWORLD_URL 调用 FabricWorld，未设置时默认 http://127.0.0.1:18082；deploy/ledger.env 记录同一默认值。显式设为空值并重启 Ledger 可暂停服务端同步（弹窗将提示未配置，账目仍能保存）。目标为 Go API 根地址（不带 /fabricworld 前缀）。两服务独立运行，无需数据库权限共享、额外端口或 Nginx 修改；页面跳转固定使用同源 /fabricworld/fabrics/:id/edit。

首次启用先发布支持 /api/integrations/ledger 的 FabricWorld，再发布 Ledger。不改变 schema；复用现有 operations 表长期保留来源以避免重复。FabricWorld 不可用时只有同步失败，记账仍成功。若回退 FabricWorld，旧版每日清理会删除超过 7 天的联动操作记录，因此停止联动后才能长期运行旧版；普通健康失败的即时程序回退不会回滚数据。恢复 FabricWorld 到旧备份可能丢失之后的布料和同步来源，恢复前需协调核对。

写入生产之前通过合成测试。服务器发布历史按共享发布保留策略自动清理。

日常更新使用 [本机发布](DEPLOYMENT.md)。管理员也可把已核验程序经标准输入交给原固定发布脚本，保留备份、校验与失败回退。

配置变更不会随二进制发布：

- unit/env/location/备份或发布脚本改动先更新本仓库 deploy，再由管理员审阅、对照现场、安装到明确路径。
- unit 改动需要 `systemctl daemon-reload`；env/程序启动参数变动需要受控重启 Ledger。
- Nginx location 变更先 `nginx -t` 再 reload，并检查全部现有应用；不要重写共享 server。涉及全局模板时同时改 agent-config。
- 当前源码的运行版本为 schema 2；schema 1 需按下节显式升级。serve、check、backup 只接受版本 2，普通发布遇到旧库会在候选检查阶段失败并重启旧程序。
- 手工回退仍需先备份、确认旧程序兼容当前 schema；数据库恢复始终走独立人工确认流程。

## 数据库升级

版本 2 完全移除标签：正式库不再包含 tag、txn_tag 及其索引。账户、分类、交易的全部字段和删除状态保留，金额、日期和余额不变。新建库直接使用 schema.sql；旧结构仅在升级工具和合成测试中保留。

升级工具只生成新文件，不改来源，也不替换正式库：

```sh
./ledger-candidate migrate --from /path/to/version-1-backup.sqlite --db /path/to/new-version-2.sqlite
./ledger-candidate check --db /path/to/new-version-2.sqlite
```

来源必须为完整的版本 1 数据库，目标必须不存在。工具用一致性快照复制，再在事务中删除两张标签表、更新 user_version，最后 VACUUM 并检查完整性和外键。失败时源库仍保留；目标可能不存在或留下待检查的副本，不用同一路径自动重试。restore 接受版本 1/2 并原样保留来源版本；新版 check 不接受旧备份，以避免发布把旧库误判为可运行。旧备份可用保留的旧程序检查，或通过 migrate 生成可供新版检查的副本。

首次从版本 1 上线属于数据库与程序的协调切换，必须确认标签信息清除和 Ledger 短暂停服。历史备份不随升级清理。普通本机发布 不执行升级，不能直接推送后期待自动成功；先准备经过测试的完整源码提交、Linux 产物及哈希，并在独立目录演练升级。

管理员按实际唯一文件名准备切换命令，检查并持有与 deploy-release.sh 相同的 /run/lock/ledger-deploy.lock；阻止并发发布。维护期间不记账，操作范围仅 Ledger：

1. 停止 ledger-backup.timer、ledger-backup.service 和 ledger.service。用当前旧程序以 ledger 身份生成 before-schema-upgrade 的一致性备份，保留旧程序和其 current-commit。
2. 用候选程序以 ledger 身份从该备份生成新的版本 2 文件，并执行 check。核对账户、分类和交易全部字段，以及余额、收支统计；不向正式账本写入测试交易。任一步失败则保留现场并启动原服务与 timer，不切换。
3. 将旧正式数据库和所有伴随 WAL/SHM 文件整体归档到新的私有目录。将已检查的版本 2 文件移到正式路径，保持 ledger:ledger/0600；不得让旧 WAL/SHM 与新库混用。通过独立的 bin/ledger.next 文件安装已核对哈希的候选程序，再原子重命名替换二进制。这里是受控 schema 切换，不通过普通发布脚本二次调用旧程序备份版本 2。
4. 启动 Ledger，验证直连与代理健康、/ledger/search 和浏览器只读账目。成功后记录候选程序的源码提交到 current-commit，恢复备份 timer，使用新版备份工具生成首份版本 2 快照；同步本项目文档与 SOURCE。此后恢复普通 本机发布。
5. 若验收失败且尚未发生新写入，停止 Ledger，分别保留失败的版本 2 文件及其伴随文件，再恢复成对归档的旧库、旧程序和提交标记，启动原服务与 timer。已经发生新写入时先备份并确认恢复时点，不自动丢弃新账目。版本 1 程序不能直接运行版本 2 数据库。

升级不会更改共享 Nginx、端口、权限方案或 FeeTable；共享服务器应用清单无需因本次 schema 调整而更新。

## 文档同步

本仓库是项目文档源；服务器 `/opt/ledger/AGENTS.md` 与 `/opt/ledger/docs` 是副本。提交并推送后运行共享脚本同步，它负责漂移检查、安装、逐文件校验、`docs/SOURCE` 和清理，用法见 [maintenance.md 文档同步](https://github.com/Crashmere/agent-config/blob/main/skills/server-operations/references/maintenance.md#文档同步)：

```sh
~/agent-config/skills/server-operations/scripts/sync-docs.sh Ledger
```

普通本机发布 不同步文档；仅自动应用经校验的 portal.json，其他运行配置仍由管理员安装。

## 排查

| 现象 | 首先检查 |
| --- | --- |
| 直连 18080 健康失败 | ledger unit/journal、env、路径/权限；不要创建空库 |
| 直连成功，/ledger/ 失败 | Nginx location/link、语法、80、安全组；根 / 的 404 正常 |
| 页面能打开但资源/API 失败 | 构建 BASE_PATH、Vue/API 前缀、代理去前缀、Host；测试深链接 |
| 发布失败 | 本机命令输出、last-deployment.json、releases/result 和服务 journal；见 DEPLOYMENT 的回退与排障。 |
| 备份服务 inactive | 先查 Result/journal 与文件，oneshot 完成后本来就退出 |
| 磁盘增长 | data/backups/releases；检查共享保留任务的保护/跳过原因，不擅自删 WAL |
| 写请求结果不明 | 先只读核对是否已保存，不自动重试写入 |

### 保存卡顿与结果不明

先统一浏览器反馈、journal、Nginx 与数据库时间为北京时间，并适当扩大反馈时间窗口。保存接口是 `POST /ledger/api/transactions`（新增）、`PUT /ledger/api/transactions/{id}`（编辑）和 `POST /ledger/api/transactions/batch`（批量）；`POST /ledger/api/transactions/query` 与 `/statistics/*` 都是查询，返回 200 不能证明交易保存成功。Nginx access.log 的时间是请求结束时间，不能直接当作点击或请求开始时间。

应用的普通请求耗时通过 `slog.Debug` 输出，默认 Info 级别下不进入 journal；journal 为空不表示没有请求。当前 Nginx 默认访问日志没有请求耗时或上游耗时，也没有浏览器侧错误记录，因此仅凭服务端日志不能还原每次页面等待的原因。499 表示客户端在响应完成前关闭请求，页面跳转、主动取消和网络中断都可能导致，不能单独据此认定服务器过载。主机历史采样可帮助判断资源压力，但不能排除采样间隔内的短时异常。

核对落库结果应使用实际写入时间 `txn.created_at` / `updated_at`（epoch 毫秒），不要只查用户可选择的账目日期 `time`；包括软删除记录，必要时再按用户提供的金额或标题确认。可以用服务器已有 Python 标准库 `sqlite3`，以 ledger 身份通过 `file:/opt/ledger/data/ledger.sqlite?mode=ro` 和 `PRAGMA query_only=ON` 查询，避免输出无关账目或把生产结果写入仓库。前端请求超时为 30 秒；连接已被标为不可用时会在发出保存请求前拒绝写入。没有保存请求日志且没有对应写入时，应继续结合当时的页面提示与客户端网络证据定位，不自动补交交易。

主机其他失败 unit、外部工具和共享问题以服务器清单和 common-issues 为入口，不在 Ledger 文档里另写处理方法。

## ServerPortal 接入材料

`deploy/portal.json` 是本应用资源说明的维护源。本机发布使用 server-operations 校验器检查，再将同一声明与二进制保存到同一本地版本目录；发布前执行 `portal-check`，发布后执行 `portal`，通过现有受限 SSH 安装到 `/opt/ledger/config/portal.json` 并核对采集器实际加载的 SHA-256。`config/portal-source.json` 记录声明来源提交；它与程序的 current-commit 各自表示不同材料的版本。

门户从 `/opt/serverportal/registry.d/ledger.json` 的受控链接发现本应用，声明成功更新后自动加载，无需重启。首次正常 本机发布也会建立链接，无需再编辑门户中央应用列表。普通发布可更新本应用的声明，其他 unit/env/Nginx/发布脚本仍由管理员安装。

源码或数据库行为变更不能使用该选项代替程序发布。

数据根、媒体、备份格式、unit、端口或访问路径变化时，同一提交维护声明及对应文档，更新共享清单并核对资源覆盖。文件、媒体、数据库表和 systemd 状态由门户自动读取；目录用途、API 说明和权限边界须由维护 agent 明确更新。共同协议、失败处置与新应用接入见 [门户维护](https://github.com/Crashmere/agent-config/blob/main/skills/server-operations/references/portal.md)。

门户 /portal/ 已统一保护公网访问，发布脚本通过回环检查应用健康，本机发布公网检查预期未授权返回 401。设备授权永久有效至主动撤销，Cookie 经共享 Nginx 随有效请求续期；本应用若新增 add_header，必须保留共享 Set-Cookie 转发，规则及验收见共享门户维护文档。门户备份使用本应用原生一致性快照；真实完整链恢复验收按用户要求暂缓，不因本次维护自动继续下载或恢复。

## 手机桌面图标

现有 apple-touch-icon.png 为 180×180；manifest.webmanifest 还声明 192/512 px 图标。Nginx 规则仅放行这几份公开文件的 GET/HEAD，保留原版本查询参数。页面、API 和用户媒体继续使用设备认证。共同原因、部署状态与手机验收见[共享排障记录](https://github.com/Crashmere/agent-config/blob/main/skills/server-operations/references/common-issues.md#统一认证后-iphone-桌面图标缺失)。

## 当前发布入口

本项目为个人使用：在本地验证本次改动即可发布，不设全量回归门槛，不默认新增或保留永久测试。界面改动检查实际使用的电脑/手机场景；数据迁移、批量写入/删除和备份恢复先用隔离副本针对性验证。

完整流程见 [本机发布与回退](DEPLOYMENT.md)。GitHub 只保存源码；本机 `make release` 构建，`make deploy` 更新生产，文档单独同步。

## 发布材料自动清理

服务器每天北京时间 05:00 按[发布材料自动保留](https://github.com/Crashmere/agent-config/blob/main/skills/server-operations/references/retention.md)保留最近 3 次成功发布、最近 5 份完整发布前备份，并保护当前版本、对应备份和待核对失败批次。共享实现、锁、回执、预览及停用命令由 server-operations 维护；本项目 deploy 保留发布脚本的 recovery 标记和每日备份的 flock 入口。首次安装先按共享文档建立 /run/lock/ali-release-retention.lock，再启用 backup timer。daily、manual、业务数据、门户 exports 和维护电脑构建材料不在此自动清理范围。

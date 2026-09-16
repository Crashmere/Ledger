# Ledger

个人记账 Web 服务：Vue 提供页面，Go 提供 API、业务计算和静态资源，SQLite 保存账本。应用只运行一个 Go 程序，不需要 Docker、Node 或独立数据库服务；多应用共用服务器时，由共享 Nginx 按 URL 路径分发。

保留概览、账户与分类/标签管理、记一笔、报告、搜索、文本批量记账。交易按页读取，余额、筛选、年化和统计在后端完成。没有登录；知道访问地址的人可以查看和修改。必须联网使用。

## 本地运行

需要 Go 1.26 和 Node 22.12+（或受 Vite 支持的更新版本）。依赖版本已锁定；Vue 类型检查工具目前配合 TypeScript 5.9。

```sh
npm --prefix web ci
go mod download
go run ./cmd/ledger init --db var/dev.sqlite
go run ./cmd/ledger serve --db var/dev.sqlite
```

另一个终端启动前端：

```sh
npm --prefix web run dev
```

打开 Vite 输出的地址（通常是 http://127.0.0.1:5173），先到账户页新建账户，再记一笔。Vite 将 /api 请求代理给 127.0.0.1:8080。初次建库只执行一次；正常启动时库缺失会报错。

如果本机 goenv 根据 go.mod 选择尚未安装的版本，可使用已有版本启动官方工具链下载，例如本次环境使用 `GOENV_VERSION=1.24.0 go ...`；这是本机版本管理器的配置，不是项目运行要求。

## 构建和测试

```sh
make test
make build
./bin/ledger serve --db var/dev.sqlite
```

构建时先生成 web/dist，再用 production tag 将它嵌入 Go。此时直接打开 http://127.0.0.1:8080 即可。开发构建不嵌入网页。`make linux` 生成服务器使用的 Linux amd64 单文件程序；SQLite 驱动是纯 Go，无 CGO 依赖。

部署到共享服务器的 `/ledger/` 路径时，使用 `make linux BASE_PATH=/ledger/`。它同时设置静态资源、Vue Router 和 API 前缀；Nginx 去掉此前缀后转发给 Go。默认构建和本地开发仍使用根路径。详见 [部署维护](docs/OPERATIONS.md)。

仓库配置了 [自动检查与部署](docs/CICD.md)：PR 只验证，推送 main 验证成功后自动发布到服务器。每次发布先备份数据库，失败回退程序，不覆盖账本。

测试使用临时合成账本，不读取个人财务数据。涵盖转账与删除、筛选、分页完整小计、历史时间、闰年、批量原子性、HTTP 表单、深链接，以及备份恢复。

真实账本迁移和服务器验收记录仅本地保存，不纳入公开仓库。

## 手机使用

手机记账页使用原生金额输入框（小数键盘、最多两位小数），点其他区域失焦后收起键盘；内容可上下滚动。电脑端保留计算器。底部导航在布局中独立占位，不覆盖交易列表。

桌面入口通过 manifest 声明 `standalone` 和整个部署目录的导航范围。它只描述启动和导航，不提供 Service Worker、离线账本或缓存写入队列。若旧的 iPhone 桌面图标切页后出现浏览器工具栏，更新后从 `/ledger/` 重新添加到主屏幕；系统可能保留旧图标的入口信息。iOS 版本、HTTP 地址及安装方式仍会影响实际显示，网页不能强制隐藏系统浏览器工具栏。

## 数据和维护

金额是整数分；交易时间保留 epoch 毫秒，账目日期固定为 Asia/Shanghai。编辑同一天的历史交易只改备注时，不会清掉原来的时分秒。删除使用 is_delete，网页不提供回收站或备份文件入口。

```sh
./bin/ledger check --db var/dev.sqlite
./bin/ledger backup --db var/dev.sqlite --out /path/to/new-backup.sqlite
./bin/ledger restore --from /path/to/new-backup.sqlite --db /path/to/new-restored.sqlite
```

备份和恢复目标都必须不存在。备份使用 SQLite 一致性快照，不能用普通文件复制代替运行中数据库的备份。正式停服替换、systemd 每日备份和更新操作见 [部署维护](docs/OPERATIONS.md)。历史数据迁移见 [迁移工具说明](tools/migrate-ivy/README.md)。

账本、备份、真实快照和对账报告都应保存在仓库之外；var/ 仅用于本地开发，已被忽略。

## 阅读顺序

维护者先看 [文档入口与已确认约定](docs/README.md) 和 [Agent 维护指引](AGENTS.md)。代码先看 [架构与两条调用链](docs/ARCHITECTURE.md)，再按需要查 [API](docs/API.md)。建议从“保存一笔”读起，然后读“筛选交易并统计”：

1. `web/src/pages/AddTxn.vue` → `web/src/api/index.ts` → `internal/httpapi/server.go` → `internal/ledger/transactions.go`。
2. `web/src/pages/Search.vue` → `internal/ledger/filters.go` → `transactions.go` / `statistics.go`。
3. `model.go` 和 `migrations/001_initial.sql` 描述类型和持久字段；`ledger_test.go` 是业务规则的具体例子。

日常维护以本 README、docs 和代码为准；变更后主动更新对应文档及服务器副本。共享主机约定由 [server-operations](https://github.com/Crashmere/agent-config/blob/main/skills/server-operations/SKILL.md) 统一维护，本地迁移审阅和验收资料不随源码提交。

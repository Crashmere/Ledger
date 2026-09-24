# Ledger 维护入口

先读 [docs/README.md](docs/README.md)，按任务导航到架构、API、运维和 CI。以当前代码和文档为准，不依赖旧聊天或历史实现推断现状。

## 服务器上下文

- 对部署、服务器排查、新应用共存或共享架构改动，先使用 `server-operations` 技能。源为 `Crashmere/agent-config/skills/server-operations/SKILL.md`，本地通常在 `~/agent-config`。
- 即使客户端未加载该技能，也要显式读取 `ssh ali 'cat /opt/AGENTS.md'`，再按导航读取共享文档；SSH 不会自动加载远端 AGENTS。
- 可能影响其他应用的共性问题（主机、网络、共享发布/备份模式等），解决方案写入 agent-config 的 `references/common-issues.md` 并覆盖全部受影响应用，本项目只留参数和链接。
- 共享入口/主机约定归 agent-config；本项目只维护 Ledger 的程序、location、unit、数据与发布。跨项目变更必须评估共享应用清单中的所有应用。
- 哪些事直接做完再告知、哪些先确认，只看 server-operations SKILL.md 的授权表。文档维护与同步、清理已知垃圾、按 common-issues 已有方案处理问题都不需要事先确认。

## 实现与验证

- 保持可读、直接、单人使用的设计。较重的统计/验证放后端；交易分页，API 面向通用筛选，不与具体页面名称绑定。避免无需求的 ORM/仓储套层/队列。
- 用户确认的业务边界见 docs 入口；不要未经请求重新加入离线账本、GitHub 数据同步、SQL 控制台、网页备份恢复或设置页。
- 用合成临时数据跑 `make test`；变更 Go 时加 `go vet ./...`，部署构建用 `make linux BASE_PATH=/ledger/`。UI 变动需实测窄屏（如 375×667）与桌面；生产只读验收，不插入测试账目。
- 数据库、备份和含真实账目的维护材料不能入 Git。缺库或写入结果不明时先调查，不创建空正式库、不自动重试写入。
- 推送 main 会触发生产 CI/CD：代码改动只在用户要求部署时推送；纯文档提交加 `[skip ci]`，可直接推送。

## 文档是完成条件

- 每次实现/维护后，主动核对并更新本项目 docs 和相关部署源文件；架构/API/交互/目录/配置/权限/备份/CI 变化都要有对应的最新说明。
- 共享状态有变化时同时更新 agent-config 的服务器上下文与其他受影响项目，不只写 Ledger。
- 覆盖过时信息、删除冗余旧方案，不在当前文档保留操作流水账；历史由 Git 保存。没有变化的文档不必机械修改日期。
- 推送后运行 `~/agent-config/skills/server-operations/scripts/sync-docs.sh Ledger` 同步服务器 `/opt/ledger/docs` 和本入口（改了共享文档就不带参数，全部同步）；普通程序 CI 不同步文档。服务器副本不能独立演进，现场编辑必须回写仓库。

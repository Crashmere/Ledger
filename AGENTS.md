# Ledger 维护入口

本项目为个人使用：在本地验证本次改动即可发布，不设全量回归门槛，不默认新增或保留永久测试。界面改动检查实际使用的电脑/手机场景；数据迁移、批量写入/删除和备份恢复先用隔离副本针对性验证。

GitHub 只备份源码和配置，推送不触发测试或部署。本机入口及回退见 [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)；共享流程由 server-operations 维护。

先读 [docs/README.md](docs/README.md)，按任务导航到架构、API、运维和发布。以当前代码和文档为准，不依赖旧聊天或历史实现推断现状。

## 服务器上下文

- 对部署、服务器排查、新应用共存或共享架构改动，先使用 `server-operations` 技能。源为 `Crashmere/agent-config/skills/server-operations/SKILL.md`，本地通常在 `~/agent-config`。
- 即使客户端未加载该技能，也要显式读取 `ssh ali 'cat /opt/AGENTS.md'`，再按导航读取共享文档；SSH 不会自动加载远端 AGENTS。
- 可能影响其他应用的共性问题（主机、网络、共享发布/备份模式等），解决方案写入 agent-config 的 `references/common-issues.md` 并覆盖全部受影响应用，本项目只留参数和链接。
- 共享入口/主机约定归 agent-config；本项目只维护 Ledger 的程序、location、unit、数据与发布。跨项目变更必须评估共享应用清单中的所有应用。
- 哪些事直接做完再告知、哪些先确认，只看 server-operations SKILL.md 的授权表。文档维护与同步、清理已知垃圾、按 common-issues 已有方案处理问题都不需要事先确认。

## 实现与验证

- 保持可读、直接、单人使用的设计。较重的统计/验证放后端；交易分页，API 面向通用筛选，不与具体页面名称绑定。避免无需求的 ORM/仓储套层/队列。
- 用户确认的业务边界见 docs 入口；不要未经请求重新加入离线账本、GitHub 数据同步、SQL 控制台、网页备份恢复或设置页。
- UI 变动需实测窄屏（如 375×667）与桌面；生产只读验收，不插入测试账目。
- 数据库、备份和含真实账目的维护材料不能入 Git。缺库或写入结果不明时先调查，不创建空正式库、不自动重试写入。

## 文档是完成条件

- 每次实现/维护后，主动核对并更新本项目 docs 和相关部署源文件；架构/API/交互/目录/配置/权限/备份/发布 变化都要有对应的最新说明。
- 共享状态有变化时同时更新 agent-config 的服务器上下文与其他受影响项目，不只写 Ledger。
- 覆盖过时信息、删除冗余旧方案，不在当前文档保留操作流水账；历史由 Git 保存。没有变化的文档不必机械修改日期。
- 推送后运行 `~/agent-config/skills/server-operations/scripts/sync-docs.sh Ledger` 同步服务器 `/opt/ledger/docs` 和本入口（改了共享文档就不带参数，全部同步）；本机程序发布不同步文档。服务器副本不能独立演进，现场编辑必须回写仓库。

## 门户资源同步

- 修改网站图标或认证时，同时核对 iPhone 的 apple-touch-icon、构建后路径及匿名 GET/HEAD；只允许明确的品牌图标/公开 manifest 例外，页面、API 和用户媒体仍须认证。统一排障与验收见 server-operations 的 common-issues；实际启用状态以 current-state 为准。

- 本项目的 `deploy/portal.json` 是 ServerPortal 资源声明的维护源，记录目录用途、数据库、运行用户、端口、unit、访问路径、API 与备份类型。新增/迁移/删除数据根、接口或运行材料时，必须同步修改声明、对应 docs 与共享应用清单。
- 声明部署在 `/opt/ledger/config/portal.json`，root 管理；本机发布共用 server-operations 校验器，发布前预检，发布后通过受限 SSH 自动同步并核对门户加载哈希。`registry.d/ledger.json` 自动登记链接，更新无需重启门户。
- 统一认证由共享 Nginx 与门户负责，不在本项目另存设备白名单；本机调用和发布健康检查按共享约定保留。生产已启用设备认证；变更后同步 server-operations current-state。
- 门户只读展示不替代本项目原生一致性备份；备份格式或媒体生命周期变化时，针对受影响的备份与恢复契约做隔离验证。真实业务数据、凭据和备份仍不得进入 Git。

本机发布自动预检和同步同提交的 `deploy/portal.json`；仅更新声明运行 `make portal`，保留业务程序版本。

网页默认拦截 Tab / Shift+Tab 控件切换并取消焦点高亮；只保留用户明确要求的例外。维护与验证按 [server-operations 网页键盘与焦点约定](https://github.com/Crashmere/agent-config/blob/main/skills/server-operations/references/conventions.md#网页键盘与焦点) 执行。
Ledger 当前快捷键、三字段循环与面板焦点行为已获用户确认，除非用户另提要求，否则保持现状。

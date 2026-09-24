# 自动检查与部署

GitHub Actions 的 CI and deploy 工作流负责日常发布：

- Pull Request：运行 Go/前端/发布脚本测试、类型检查、go vet 和 /ledger/ 生产构建；不使用生产密钥。
- 推送 main：同样检查通过后上传 Linux 程序，通过 SSH 更新服务器。
- Actions 页面也可手动运行；只有 main 允许部署。过期提交在发布前会被跳过。同一分支工作流串行，服务器再用 flock 防止两次发布重叠。

Ledger 不需要服务器安装 Go、Node、Docker 或 GitHub Runner；主机已有其他用途的工具不属于本项目依赖，也不要因此删除。Actions 使用 GitHub 官方托管 runner，官方 actions 固定到 commit SHA。

## 发布做什么

1. CI 构建 make linux BASE_PATH=/ledger/，产物只含程序与内嵌网页，保留 7 天。
2. SSH 将程序从标准输入传给受限入口，同时传入代码 commit 和文件 SHA-256。
3. 服务器限制上传大小 64 MiB、超时 90 秒，校验哈希后才开始切换。
4. 保存旧程序、停止 Ledger，用旧程序生成升级前一致性备份。
5. 候选程序校验备份，原子替换程序并启动，检查本机 /healthz 与 Nginx 下 /ledger/search。
6. 成功后记录 /opt/ledger/current-commit；失败则恢复旧程序并重启，返回失败使 Actions 标红。

通常只有备份与重启期间短暂停服。不会上传或覆盖数据库，不更新 Nginx、systemd、环境配置或发布脚本本身。没有数据库自动回退：候选程序若改变 schema，需要单独设计迁移和恢复流程，不能指望旧程序一定兼容。

当前程序要求 schema 2。版本 1 首次移除标签须先按 [数据库升级](OPERATIONS.md#数据库升级) 完成管理员协调切换，普通 CI 不删表也不迁移正式库。若提前触发发布，候选 check 会拒绝版本 1 备份，发布停止并重启旧程序，正式库保留原状。升级后不能只回退到版本 1 二进制；需要配套旧库且确认恢复时点。

文档也不随二进制自动上传。当前任何 main 推送（包括只改 Markdown）都会执行检查和发布；只更新文档且不需要发布时可使用 GitHub 支持的 `[skip ci]` 提交标记，先确认本次确实没有运行代码或部署逻辑改动。共享/项目文档需管理员按 [OPERATIONS.md](OPERATIONS.md) 的同步流程更新服务器副本，不能只推 GitHub 就认为服务器文档已更新。

## 权限与密钥

production 环境仅允许 main，保存四个 secrets：SSH_HOST、SSH_USER、SSH_PRIVATE_KEY、SSH_KNOWN_HOSTS。主机公钥经现有受信 SSH 连接核对，部署时开启 StrictHostKeyChecking，不临时盲信 ssh-keyscan。

ledger-deploy 用户的 SSH 公钥设置 restrict 和强制命令，只接受 deploy <commit-sha> <binary-sha256>，不允许 shell、scp、端口转发。home、authorized_keys、两个发布脚本均由 root 管理；sudo 只允许固定 deploy-release.sh。

上传的程序以及备份命令始终以 ledger 用户执行，不以 root 执行。该密钥有发布任意 Ledger 程序的能力，因此等同于 Ledger 应用/数据权限，不等同于整台服务器管理员权限。勿把不可信代码合入 main。

首次配置由管理员运行 deploy/setup-ci.sh <public-key.pub>，随后设置 GitHub secrets。它拒绝覆盖已有账户；轮换密钥时显式替换 authorized_keys 和 SSH_PRIVATE_KEY。变更发布脚本需管理员审阅后安装，不能由一次普通发布自行替换。

## 查看状态和回退

GitHub 仓库 Actions 页面查看测试、构建和 SSH 日志。服务器保存：

```text
/opt/ledger/current-commit
/opt/ledger/releases/<commit>.<随机后缀>/
  ledger        本次程序
  previous      部署前程序
  metadata      commit 和校验和
  result        success / failed
/opt/ledger/backups/before-deploy-<发布目录名>.sqlite
```

成功的发布历史和升级前备份暂不自动清理，不受每日 14 份备份轮换影响。定期检查磁盘，确认无需回退后再按明确目录清理。result 为 failed 且没有 metadata 的发布目录是在上传或哈希校验阶段中止的，从未停服、没有对应备份，只含不完整程序，确认后直接删除。

失败先看 Actions 和 journalctl -u ledger。若日志显示 Previous program is healthy，旧程序已恢复，账本未回退。若显示 ROLLBACK FAILED，按 OPERATIONS.md 排查。手工回退程序也应先停服和备份；数据库恢复需人工确认恢复时点。

## GitHub 上传过慢时的备用发布

托管 runner 在境外，到服务器的跨境线路偶尔会降到几十 KB/s，而服务器只等待 90 秒上传。正常上传只需约 10 秒；遇到上传超时就不再重跑 deploy 作业，直接由管理员从受信终端把同一次 CI 产物交给同一个发布脚本。备份、候选校验、健康检查和失败回退与 CI 完全相同。

只在以下情况全部成立时使用：deploy 的 SSH 步骤以 exit code 124 结束；最新发布目录 result 为 failed 且没有 metadata；current-commit 仍是旧提交且服务健康；该 run 的 commit 仍是 main 最新提交；verify 作业成功。哈希不符、候选 check 失败、健康检查失败等其他错误先排查原因，不用本方案绕过。

1. 确认现场状态，并找出 CI 传给服务器的哈希（受限入口的 sudo 日志中）：

   ```bash
   ssh ali 'cat /opt/ledger/current-commit; systemctl is-active ledger
     d=$(ls -1t /opt/ledger/releases | head -1); echo $d; cat /opt/ledger/releases/$d/result; ls /opt/ledger/releases/$d
     journalctl --since today --no-pager | grep "deploy-release.sh <commit>" | tail -1'
   ```

2. 下载同一次 run 的产物并核对：本地 SHA-256 必须等于 sudo 日志中的第二个参数；服务器已安装的脚本须与仓库 `deploy/deploy-release.sh` 哈希一致。不要改用本地构建的程序。

   ```bash
   gh run download <run-id> -n ledger-linux -D var/deploy-artifact
   shasum -a 256 var/deploy-artifact/ledger-linux-amd64 deploy/deploy-release.sh
   ssh ali 'sha256sum /opt/ledger/bin/deploy-release.sh'
   ```

3. 以管理员身份发布。输出 `Deployed <commit>; backup: ...` 即成功；启动初期可能出现一次 18080 连接失败，是脚本等待健康前的探测。

   ```bash
   ssh ali '/opt/ledger/bin/deploy-release.sh <commit> <sha256>' < var/deploy-artifact/ledger-linux-amd64
   ```

4. 只读验收：current-commit 为新提交，`systemctl is-active ledger`、`/ledger/healthz` 与 `/ledger/search` 正常，按改动核对页面或 API，不写测试账目。
5. 清理：删除本次超时留下的 failed 且无 metadata 的发布目录（逐个确认后按完整目录名删除），删除本地 `var/deploy-artifact`。保留成功发布目录和 before-deploy 备份。

该 run 在 Actions 中仍显示失败，这是预期结果；发布后不要再重跑它，否则会以同一程序再停服、备份一次。

测试命令 node --test deploy/deploy-release.test.mjs 使用隔离目录和合成命令，覆盖成功、上传哈希错误、候选校验失败、健康检查失败；不会连接生产或读取真实数据，已纳入 make test。

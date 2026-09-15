# 一次性旧账本迁移

工具只接受 ivy-wallet 的 formatVersion=1 / dbUserVersion=3 快照。旧格式逻辑不进入服务器和网页。

将输入、输出数据库及报告放在仓库之外。示例：

```sh
go run ./tools/migrate-ivy \
  --source /private/path/ivy-wallet-snapshot.json \
  --out /private/path/final.sqlite \
  --report /private/path/final-report.json \
  --source-commit <固定Git提交>
```

输出库和报告路径必须不存在。工具在临时库中用一个事务写入，检查成功后才生成目标文件，重复执行不会追加数据。

映射保留 ID、分金额、原始 time/created_at/updated_at、图标、颜色、排序、专项周期、归档和标签关联。kind=null 映射 normal；updated_at=null 回填 created_at；deleted_at 非空映射 is_delete=1。删除时间留在原快照，不进入新版表。setting 忽略；快照中旧合并器附带于无关实体的账户字段也不迁移。

检查包括类型、整数范围、非空 ID、重复主键、日期、转账约束、外键、有效账户关联、分类归属、逐字段对比、SQLite 完整性。另用输入快照独立累计账户余额、全期与逐月收支、分类、年化，与新服务计算结果对账。

报告记录源 commit、SHA-256、数量、忽略设置数、余额与统计。它包含财务汇总，和源数据一样保存在仓库外，不提交 Git。错误停止迁移，不静默跳行或修复金额。

开发试迁移只验证转换能力。正式切换前需要停止旧系统写入，重新固定最终快照并再次迁移对账。

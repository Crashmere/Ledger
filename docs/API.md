# HTTP API

同源 /api，JSON 使用 camelCase。金额为整数分，epoch 时间为毫秒，日期字符串为北京时间 YYYY-MM-DD。无登录。所有 API 响应 Cache-Control: no-store，成功返回 200。

挂载到 /ledger/ 时，浏览器使用 /ledger/api；Nginx 去掉 /ledger 前缀再转发。下文资源地址均相对 API 根路径。

错误示例：

```json
{"error":{"code":"VALIDATION","message":"请选择有效账户","field":"accountId"}}
```

VALIDATION=400、NOT_FOUND=404、RESTRICT=409、ORIGIN=403、INTERNAL=500。未知字段、无效 JSON、超出 2MiB 的请求被拒绝。写请求要求完整表单字段；可空字段显式传 null。连接中断不能据此判断是否提交成功，客户端不自动重试写请求。

交易响应包含只读 fabricWorldEligible：有效账户名为“副业”、有效所属分类名为“纺织”的 expense 为 true。POST /transactions/:id/fabricworld 仅接受满足条件的已有交易，由服务器读取字段并请求 FabricWorld；成功返回 fabricId 和同源 editUrl，失败返回 FABRICWORLD（502，上游不可用/失败；503，未配置）。此接口可手动安全重试，交易本身不会再次保存。批量保存响应额外包含 fabricWorldTransactions（目标交易数组，无目标时省略），预览不包含已保存交易。

## 资源

| 方法与地址 | 输入 / 返回 |
| --- | --- |
| GET /ledger/info | timezone、today、earliestMonth（空账本为 null） |
| GET /accounts | {items: Account[], totalBalance}，每个账户含实时 balance |
| POST /accounts | 完整 AccountInput，返回 Account |
| PUT /accounts/:id | 完整 AccountInput，返回 Account |
| DELETE /accounts/:id | 没有有效分类和交易时标记删除 |
| POST /accounts/reorder | {ids: [...]}，包含全部有效账户 |
| GET /categories?accountId=... | Category[]；省略 accountId 返回全部有效分类 |
| POST /categories | {name,color,accountId} |
| PUT /categories/:id | {name,color}，不能更换所属账户 |
| DELETE /categories/:id | 解除有效交易引用并标记删除 |
| POST /accounts/:id/categories/reorder | {ids: [...]}，包含该账户全部有效分类 |
| GET /transactions/:id | 含 date 的完整交易 |
| POST /transactions | 完整 TransactionInput |
| POST /transactions/:id/fabricworld | 已保存的目标交易同步到 FabricWorld，返回 {fabricId,editUrl} |
| PUT /transactions/:id | 完整 TransactionInput |
| DELETE /transactions/:id | 标记删除 |

删除和排序返回 {ok:true}。账户、分类 ID 由服务器生成。AccountInput：

```json
{"name":"现金","color":-1,"initialBalance":10000,"includeInBalance":true,"kind":"normal","periodStart":null,"periodEnd":null,"archived":false}
```

kind 为 normal/project；periodStart/periodEnd 输入是日期，账户响应保留 epoch 毫秒。archived 输入是布尔值，响应为 archivedAt 时间或 null。编辑不会覆盖图标、排序或创建时间。

TransactionInput：

```json
{"type":"expense","amount":1230,"accountId":"账户ID","toAccountId":null,"categoryId":null,"date":"2026-09-15","title":"午餐","note":null}
```

type 为 income/expense/transfer。转账必须有不同的转入账户，categoryId 必须为 null；普通收支的 toAccountId 为 null。金额必须为正整数，最多 9007199254740991 分。新交易取北京零点；编辑日期没变时保留历史时间。

交易响应使用 Transaction，不包含 tags。标签资源已移除，/tags 及其子路径返回 404；交易表单和筛选中的 tagIds 按未知字段返回 400，searchFields 中的 tag 也返回 400。升级后旧页面须重新加载以使用当前契约。

## 共享筛选

TransactionFilter 可被列表和三个统计接口复用；不同维度取交集，同一维度多选取并集。

| 字段 | 语义 |
| --- | --- |
| dateFrom/dateTo | 含首尾日期，可单侧省略 |
| types | 收入/支出/转账数组 |
| accountIds | 任一端账户命中 |
| categoryIds | 分类 ID，跨账户同名分类可一起提交 |
| amountMin/amountMax | 含上下界，单位分 |
| keyword | 去首尾空白，Unicode 不区分大小写的字面子串；% 和 _ 无特殊含义 |
| searchFields | title/note/category/amount；有关键词时必须选 1–4 项。amount 把关键词按元解析（最多两位小数，忽略 ¥/￥、千分位逗号、空格和正负号）并精确匹配交易金额；无法解析时该字段不命中 |
| excludedIds | 从列表及所有统计排除，最多 500 个 |
| projectScope | all（默认）；exclude 排除任一端涉及专项；selected 只放开明确选中的专项相关交易 |

空数组表示不限制该维度。大部分 ID 数组上限 500；关键词 200 字符、名称 100、标题 500、备注 10000。

## 分页与统计

POST /transactions/query：

```json
{"filter":{"dateFrom":"2026-09-01","dateTo":"2026-09-30","projectScope":"exclude"},"page":1,"pageSize":50,"sortBy":"time","sortDir":"desc","includeDayTotals":true}
```

返回 {items,page,pageSize,totalCount,dayTotals?}。page 从 1 开始，pageSize 默认 50、最大 200。sortBy 支持 time/amount，方向 asc/desc；同值依次按同方向 createdAt、id 稳定排序。超出末页返回空 items。

dayTotals 是 date → {income,expense,count}，只含本页涉及日期，金额覆盖完整筛选集，不是当前页求和。搜索不分日展示时可省略。

| 地址（均 POST） | 输入 | 返回 |
| --- | --- | --- |
| /statistics/summary | {filter,flowAccountId?} | income/expense/net、totalCount/incomeCount/expenseCount/transferCount、inflow/outflow、annual |
| /statistics/categories | {filter,groupBy:"id"或"name",direction:"income"或"expense"} | 分类聚合数组，含 id/name/income/expense/incomeCount/expenseCount/latest |
| /statistics/daily | {filter} | days、startWeekday、weekCount、total、activeDays |

summary 的金额不含转账；flowAccountId 指定时 inflow/outflow 包含该账户的转账。annual={amount,spanDays,count}，至少两笔支出且首末时间跨度四舍五入后大于 0 天才返回年化金额，否则 amount=null。

categories 的 direction 决定排序，返回有收支的全部分类及两个方向金额，前端绘单方向图时去掉该方向为 0 的组。groupBy=name 跨账户按名合并，id 返回 null；未分类名为“未分类”。

daily 必须提供 dateFrom/dateTo，最多 3661 天。days 补齐每日 {date,time,income,expense,incomeCount,expenseCount,transferCount,level}，level 为 0–8。startWeekday 从周日=0 开始；total 是支出合计。

## 文本批量记账

POST /transactions/batch/preview 只校验；POST /transactions/batch 再校验并整体提交。两者输入相同：

```json
{"rows":[{"line":1,"amountInput":"12.30","title":"午餐","note":"","accountId":"账户ID","categoryId":null,"date":"2026-09-15"}]}
```

1–500 行。金额 + 表示收入，负号或无符号表示支出，最多两位小数；批量标题必填。预览返回 {rows:[{line,transaction,errors}],income,expense,valid,count}，非法行 transaction=null，合计只含有效行。保存失败整批回滚；响应丢失需自行查询核对。

GET /healthz 位于 /api 外，用于部署健康检查，返回 {status:"ok"}。

子路径部署的公网健康检查地址为 /ledger/healthz；Go 本机端口仍使用 /healthz。

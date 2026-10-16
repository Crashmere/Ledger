# HTTP API

Same-origin `/api`; JSON uses camelCase. Amounts are integer cents, epoch timestamps are milliseconds, and date strings are Beijing-time `YYYY-MM-DD`. Public APIs require the shared device-authentication Cookie. The local backend is for trusted callers only. Every API response uses `Cache-Control: no-store`; successful requests return 200.

When mounted at `/ledger/`, the browser uses `/ledger/api`. Nginx strips the `/ledger` prefix before proxying. The sections below list complete internal paths in the Go service. `{id}` is a path parameter; query parameters and request bodies are described separately.

Error example:

```json
{"error":{"code":"VALIDATION","message":"请选择有效账户","field":"accountId"}}
```

`VALIDATION`=400, `NOT_FOUND`=404, `RESTRICT`=409, `ORIGIN`=403, and `INTERNAL`=500. Unknown fields, invalid JSON, and requests larger than 2 MiB are rejected. Write requests require all form fields; nullable fields must explicitly send `null`. A disconnected connection does not establish whether a request committed successfully, and the client does not automatically retry write requests.

Transaction responses include the read-only field `fabricWorldEligible`: it is `true` for an `expense` whose active account is named “副业” and whose active owning category is named “纺织”. `POST /api/transactions/{id}/fabricworld` accepts only an existing eligible transaction. The server reads the fields and requests FabricWorld; success returns `fabricId` and a same-origin `editUrl`, while failure returns `FABRICWORLD` (502 for upstream unavailability/failure; 503 when not configured). This endpoint can be retried manually and safely; the transaction itself is not saved again. Batch-save responses additionally include `fabricWorldTransactions` (an array of target transactions, omitted when there are none); previews do not include saved transactions.

## Resources

| Method and address | Input / return value |
| --- | --- |
| GET /healthz | Database-connection health; returns {status:"ok"} |
| GET /api/ledger/info | `timezone`, `today`, and `earliestMonth` (`null` for an empty ledger) |
| GET /api/accounts | {items: Account[], totalBalance}; every account includes its live `balance` |
| POST /api/accounts | Complete `AccountInput`; returns `Account` |
| PUT /api/accounts/{id} | Complete `AccountInput`; returns `Account` |
| DELETE /api/accounts/{id} | Marks the account deleted when it has no active categories or transactions |
| POST /api/accounts/reorder | {ids: [...]}, containing every active account |
| GET /api/categories | `Category[]`; optional `accountId` query parameter, or every active category when omitted |
| POST /api/categories | {name,color,accountId} |
| PUT /api/categories/{id} | {name,color}; the owning account cannot be changed |
| DELETE /api/categories/{id} | Removes references from active transactions and marks the category deleted |
| POST /api/accounts/{id}/categories/reorder | {ids: [...]}, containing every active category for that account |
| GET /api/transactions/{id} | Complete transaction, including `date` |
| POST /api/transactions | Complete `TransactionInput` |
| POST /api/transactions/{id}/fabricworld | Synchronizes a saved eligible transaction to FabricWorld; returns {fabricId,editUrl} |
| PUT /api/transactions/{id} | Complete `TransactionInput` |
| DELETE /api/transactions/{id} | Marks the transaction deleted |
| POST /api/transactions/query | General filtering, pagination, and sorting; returns details and optional full-day subtotals |
| POST /api/statistics/summary | Income, expenses, net amount, counts, account inflow/outflow, and annualized spending within the filter |
| POST /api/statistics/categories | Aggregates income, expenses, and counts by category ID or name |
| POST /api/statistics/daily | Daily income/expenses and heatmap levels for the specified date range |
| POST /api/transactions/batch/preview | Validates 1–500 lines of text-based batch entries; returns per-line results and totals without writing |
| POST /api/transactions/batch | Validates again and atomically saves the entire batch |

This table covers the current business and health interfaces. Keep `deploy/portal.json.apis` aligned with it. Register each method and path separately; put parameters in the purpose or contracts below instead of appending them to path fields. See the [shared troubleshooting guide](https://github.com/Crashmere/agent-config/blob/main/skills/server-operations/references/common-issues.md#门户-api-列表与服务不一致) for checking and synchronization.

Delete and reorder operations return {ok:true}. The server generates account and category IDs. `AccountInput`:

```json
{"name":"现金","color":-1,"initialBalance":10000,"includeInBalance":true,"kind":"normal","periodStart":null,"periodEnd":null,"archived":false}
```

`kind` is `normal` or `project`. `periodStart` and `periodEnd` inputs are dates; account responses retain epoch milliseconds. The `archived` input is Boolean; the response uses an `archivedAt` timestamp or `null`. Editing does not overwrite the icon, sort order, or creation time.

`TransactionInput`:

```json
{"type":"expense","amount":1230,"accountId":"账户ID","toAccountId":null,"categoryId":null,"date":"2026-09-15","title":"午餐","note":null}
```

`type` is `income`, `expense`, or `transfer`. A transfer requires a different destination account and `categoryId` must be `null`; ordinary income and expenses require `toAccountId` to be `null`. The amount must be a positive integer no greater than 9007199254740991 cents. A new transaction uses Beijing midnight; an edit preserves the historical time when the date is unchanged.

Transaction responses use `Transaction` and do not contain `tags`. Tag resources have been removed: `/api/tags` and its subpaths return 404; `tagIds` in transaction forms and filters is rejected as an unknown field with 400, as is `tag` in `searchFields`. Old pages must reload after the upgrade to use the current contract.

## Shared Filters

`TransactionFilter` is shared by the list and all three statistics interfaces. Different dimensions are intersected; multiple choices within one dimension are unioned.

| Field | Semantics |
| --- | --- |
| dateFrom/dateTo | Inclusive start/end dates; either side may be omitted |
| types | Array of income/expense/transfer types |
| accountIds | Matches an account on either end |
| categoryIds | Category IDs; same-name categories from multiple accounts may be submitted together |
| amountMin/amountMax | Inclusive bounds in cents |
| keyword | Trimmed literal Unicode substring, case-insensitive; `%` and `_` have no special meaning |
| searchFields | `title`/`note`/`category`/`amount`; when a keyword is present, 1–4 fields must be selected. `amount` parses the keyword as yuan (at most two decimal places; ignores ¥/￥, thousands-separator commas, spaces, and signs) and requires an exact transaction-amount match. If parsing fails, that field does not match |
| excludedIds | Excluded from the list and every statistic; at most 500 IDs |
| projectScope | `all` (default); `exclude` removes transactions involving a project account on either end; `selected` includes only project-related transactions explicitly selected |

An empty array means that dimension is unrestricted. Most ID arrays have a limit of 500. The keyword limit is 200 characters, names 100, titles 500, and notes 10000.

## Pagination and Statistics

`POST /api/transactions/query`:

```json
{"filter":{"dateFrom":"2026-09-01","dateTo":"2026-09-30","projectScope":"exclude"},"page":1,"pageSize":50,"sortBy":"time","sortDir":"desc","includeDayTotals":true}
```

Returns {items,page,pageSize,totalCount,dayTotals?}. `page` starts at 1. `pageSize` defaults to 50 and has a maximum of 200. `sortBy` supports `time`/`amount`, and direction supports `asc`/`desc`; equal values are then sorted stably by `createdAt` and `id` in the same direction. A page beyond the end returns empty `items`.

`dayTotals` maps `date` → {income,expense,count}. It includes only dates represented on the current page, but amounts cover the complete filtered set rather than summing the page. It may be omitted when search results are not grouped by day.

| Address (all POST) | Input | Return value |
| --- | --- | --- |
| /api/statistics/summary | {filter,flowAccountId?} | `income`/`expense`/`net`, `totalCount`/`incomeCount`/`expenseCount`/`transferCount`, `inflow`/`outflow`, and `annual` |
| /api/statistics/categories | {filter,groupBy:"id" or "name",direction:"income" or "expense"} | Category aggregation array with `id`/`name`/`income`/`expense`/`incomeCount`/`expenseCount`/`latest` |
| /api/statistics/daily | {filter} | `days`, `startWeekday`, `weekCount`, `total`, and `activeDays` |

Summary amounts exclude transfers. When `flowAccountId` is specified, `inflow`/`outflow` include transfers involving that account. `annual`={amount,spanDays,count}; an annualized amount is returned only when there are at least two expenses and their first-to-last time span rounds to more than 0 days, otherwise `amount=null`.

For categories, `direction` controls sorting. The response contains every category with income or expenses and amounts in both directions; when the frontend draws a one-direction chart, it omits groups whose amount in that direction is 0. `groupBy=name` merges same-name categories across accounts and returns `id` as `null`. The name for uncategorized transactions is “未分类”.

Daily statistics require `dateFrom` and `dateTo` and allow at most 3661 days. `days` fills every day with {date,time,income,expense,incomeCount,expenseCount,transferCount,level}; `level` is 0–8. `startWeekday` starts with Sunday=0. `total` is total expenses.

## Text-Based Batch Entry

`POST /api/transactions/batch/preview` validates only; `POST /api/transactions/batch` validates again and commits the entire batch. Both use the same input:

```json
{"rows":[{"line":1,"amountInput":"12.30","title":"午餐","note":"","accountId":"账户ID","categoryId":null,"date":"2026-09-15"}]}
```

There must be 1–500 lines. A `+` amount means income; a minus sign or no sign means an expense; at most two decimal places are allowed. Batch titles are required. Preview returns {rows:[{line,transaction,errors}],income,expense,valid,count}; an invalid line has `transaction=null`, and totals include only valid lines. If saving fails, the entire batch rolls back. If the response is lost, query and verify the result yourself.

`GET /healthz` is outside `/api` and is used for deployment health checks. It returns {status:"ok"}.

For the subpath deployment, the public health-check address is `/ledger/healthz`; the Go service's local port still uses `/healthz`.

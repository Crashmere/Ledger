package ledger

import (
	"context"
	"database/sql"
	"slices"
	"time"
)

const transactionColumns = `t.id,t.type,t.amount,t.account_id,t.to_account_id,
 CASE WHEN c.is_delete=0 THEN t.category_id ELSE NULL END,t.time,t.title,t.note,t.created_at,t.updated_at,
 EXISTS(SELECT 1 FROM account a WHERE a.id=t.account_id AND a.is_delete=0 AND a.name='副业'
 AND t.type='expense' AND c.is_delete=0 AND c.account_id=a.id AND c.name='纺织')`
const transactionJoin = " FROM txn t LEFT JOIN category c ON c.id=t.category_id "

func readTransactions(ctx context.Context, q querier, query string, args ...any) ([]Transaction, error) {
	result := []Transaction{}
	rows, err := q.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var t Transaction
		if err = rows.Scan(&t.ID, &t.Type, &t.Amount, &t.AccountID, &t.ToAccountID, &t.CategoryID, &t.Time, &t.Title, &t.Note, &t.CreatedAt, &t.UpdatedAt, &t.FabricWorldEligible); err != nil {
			rows.Close()
			return nil, err
		}
		t.Date = DateOf(t.Time)
		result = append(result, t)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return nil, err
	}
	return result, nil
}
func (s *Store) Transaction(ctx context.Context, id string) (Transaction, error) {
	var result Transaction
	err := s.transaction(ctx, func(tx *sql.Tx) error {
		items, e := readTransactions(ctx, tx, "SELECT "+transactionColumns+transactionJoin+" WHERE t.id=? AND t.is_delete=0", id)
		if e != nil {
			return e
		}
		if len(items) == 0 {
			return notFound()
		}
		result = items[0]
		return nil
	})
	return result, err
}
func validateTransaction(ctx context.Context, tx *sql.Tx, input TransactionInput) (int64, error) {
	if !slices.Contains([]string{"income", "expense", "transfer"}, input.Type) {
		return 0, invalid("type", "交易类型无效")
	}
	if input.Amount <= 0 || input.Amount > MaxCents {
		return 0, invalid("amount", "金额须为安全范围内的正整数分")
	}
	date, err := ParseDate(input.Date)
	if err != nil {
		return 0, err
	}
	if err = exists(ctx, tx, "account", input.AccountID); err != nil {
		return 0, invalid("accountId", "请选择有效账户")
	}
	if input.Type == "transfer" {
		if input.CategoryID != nil {
			return 0, invalid("categoryId", "转账不能设置分类")
		}
		if input.ToAccountID == nil || *input.ToAccountID == input.AccountID {
			return 0, invalid("toAccountId", "请选择不同的转入账户")
		}
		if err = exists(ctx, tx, "account", *input.ToAccountID); err != nil {
			return 0, invalid("toAccountId", "转入账户无效")
		}
	} else if input.ToAccountID != nil {
		return 0, invalid("toAccountId", "收支交易不能带转入账户")
	}
	if input.CategoryID != nil {
		var accountID string
		if err = tx.QueryRowContext(ctx, "SELECT account_id FROM category WHERE id=? AND is_delete=0", *input.CategoryID).Scan(&accountID); err != nil || accountID != input.AccountID {
			return 0, invalid("categoryId", "分类不存在或不属于当前账户")
		}
	}
	if err = validateText("title", input.Title, 500); err != nil {
		return 0, err
	}
	if err = validateText("note", input.Note, 10000); err != nil {
		return 0, err
	}
	return date.UnixMilli(), nil
}
func saveTransaction(ctx context.Context, tx *sql.Tx, id string, input TransactionInput) (string, error) {
	ms, err := validateTransaction(ctx, tx, input)
	if err != nil {
		return "", err
	}
	now := time.Now().UnixMilli()
	if id == "" {
		id = newID()
		_, err = tx.ExecContext(ctx, `INSERT INTO txn(id,type,amount,account_id,to_account_id,category_id,time,title,note,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)`, id, input.Type, input.Amount, input.AccountID, input.ToAccountID, input.CategoryID, ms, input.Title, input.Note, now, now)
	} else {
		var original int64
		if err = tx.QueryRowContext(ctx, "SELECT time FROM txn WHERE id=? AND is_delete=0", id).Scan(&original); err == sql.ErrNoRows {
			return "", notFound()
		} else if err != nil {
			return "", err
		}
		// 编辑日期没变时保留历史时分秒，不能因为改备注而改变排序和年化跨度。
		if DateOf(original) == input.Date {
			ms = original
		}
		err = affected(tx.ExecContext(ctx, "UPDATE txn SET type=?,amount=?,account_id=?,to_account_id=?,category_id=?,time=?,title=?,note=?,updated_at=? WHERE id=? AND is_delete=0", input.Type, input.Amount, input.AccountID, input.ToAccountID, input.CategoryID, ms, input.Title, input.Note, now, id))
	}
	if err != nil {
		return "", err
	}
	return id, nil
}
func (s *Store) SaveTransaction(ctx context.Context, id string, input TransactionInput) (Transaction, error) {
	var result Transaction
	err := s.transaction(ctx, func(tx *sql.Tx) error {
		var e error
		id, e = saveTransaction(ctx, tx, id, input)
		if e != nil {
			return e
		}
		items, e := readTransactions(ctx, tx, "SELECT "+transactionColumns+transactionJoin+" WHERE t.id=?", id)
		if e != nil {
			return e
		}
		result = items[0]
		return nil
	})
	return result, err
}
func (s *Store) DeleteTransaction(ctx context.Context, id string) error {
	return affected(s.db.ExecContext(ctx, "UPDATE txn SET is_delete=1,updated_at=? WHERE id=? AND is_delete=0", time.Now().UnixMilli(), id))
}
func (s *Store) QueryTransactions(ctx context.Context, input TransactionQuery) (TransactionPage, error) {
	result := TransactionPage{Items: []Transaction{}}
	if input.Page == 0 {
		input.Page = 1
	}
	if input.PageSize == 0 {
		input.PageSize = 50
	}
	if input.Page < 1 || input.Page > 100000000 || input.PageSize < 1 || input.PageSize > 200 {
		return result, invalid("page", "页码须为正数，每页 1 至 200 条")
	}
	if input.SortBy == "" {
		input.SortBy = "time"
	}
	if input.SortDir == "" {
		input.SortDir = "desc"
	}
	if !slices.Contains([]string{"time", "amount"}, input.SortBy) || !slices.Contains([]string{"asc", "desc"}, input.SortDir) {
		return result, invalid("sortBy", "排序方式无效")
	}
	where, args, err := buildFilter(input.Filter)
	if err != nil {
		return result, err
	}
	result.Page = input.Page
	result.PageSize = input.PageSize
	err = s.transaction(ctx, func(tx *sql.Tx) error {
		if e := tx.QueryRowContext(ctx, "SELECT COUNT(*) FROM txn t WHERE "+where, args...).Scan(&result.TotalCount); e != nil {
			return e
		}
		pageArgs := append(append([]any{}, args...), input.PageSize, int64(input.Page-1)*int64(input.PageSize))
		order := " ORDER BY t." + input.SortBy + " " + input.SortDir + ",t.created_at " + input.SortDir + ",t.id " + input.SortDir
		var e error
		result.Items, e = readTransactions(ctx, tx, "SELECT "+transactionColumns+transactionJoin+" WHERE "+where+order+" LIMIT ? OFFSET ?", pageArgs...)
		if e != nil {
			return e
		}
		if input.IncludeDayTotals {
			result.DayTotals = map[string]DayTotal{}
			dates := []string{}
			for _, t := range result.Items {
				if !slices.Contains(dates, t.Date) {
					dates = append(dates, t.Date)
				}
			}
			if len(dates) > 0 {
				dayArgs := append([]any{}, args...)
				for _, date := range dates {
					dayArgs = append(dayArgs, date)
				}
				rows, e := tx.QueryContext(ctx, `SELECT ledger_date(t.time),COALESCE(SUM(CASE WHEN t.type='income' THEN t.amount ELSE 0 END),0),COALESCE(SUM(CASE WHEN t.type='expense' THEN t.amount ELSE 0 END),0),COUNT(*) FROM txn t WHERE `+where+" AND ledger_date(t.time) IN ("+placeholders(len(dates))+") GROUP BY ledger_date(t.time)", dayArgs...)
				if e != nil {
					return e
				}
				defer rows.Close()
				for rows.Next() {
					var date string
					var d DayTotal
					if e = rows.Scan(&date, &d.Income, &d.Expense, &d.Count); e != nil {
						return e
					}
					if e = safeCents(d.Income); e != nil {
						return e
					}
					if e = safeCents(d.Expense); e != nil {
						return e
					}
					result.DayTotals[date] = d
				}
				return rows.Err()
			}
		}
		return nil
	})
	return result, err
}

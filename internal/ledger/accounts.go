package ledger

import (
	"context"
	"database/sql"
	"strings"
	"time"
)

func (s *Store) Accounts(ctx context.Context) (AccountsResult, error) {
	return readAccounts(ctx, s.db)
}
func readAccounts(ctx context.Context, q querier) (AccountsResult, error) {
	result := AccountsResult{Items: []Account{}}
	// 转账生成一笔转出和一笔转入，仅用于计算，不保存第二条交易。
	rows, err := q.QueryContext(ctx, `WITH flows AS (
 SELECT account_id AS id, CASE WHEN type='income' THEN amount ELSE -amount END AS delta FROM txn WHERE is_delete=0
 UNION ALL SELECT to_account_id AS id,amount FROM txn WHERE is_delete=0 AND type='transfer'
 ), totals AS (SELECT id,SUM(delta) AS delta FROM flows GROUP BY id)
 SELECT a.id,a.name,a.color,a.icon,a.initial_balance,a.include_in_balance,a.order_num,a.kind,
 a.period_start,a.period_end,a.archived_at,a.created_at,a.updated_at,COALESCE(t.delta,0)
 FROM account a LEFT JOIN totals t ON t.id=a.id WHERE a.is_delete=0 ORDER BY a.order_num,a.id`)
	if err != nil {
		return result, err
	}
	defer rows.Close()
	for rows.Next() {
		var a Account
		var delta int64
		if err = rows.Scan(&a.ID, &a.Name, &a.Color, &a.Icon, &a.InitialBalance, &a.IncludeInBalance, &a.OrderNum, &a.Kind, &a.PeriodStart, &a.PeriodEnd, &a.ArchivedAt, &a.CreatedAt, &a.UpdatedAt, &delta); err != nil {
			return result, err
		}
		if a.Balance, err = addCents(a.InitialBalance, delta); err != nil {
			return result, err
		}
		if a.IncludeInBalance {
			if result.TotalBalance, err = addCents(result.TotalBalance, a.Balance); err != nil {
				return result, err
			}
		}
		result.Items = append(result.Items, a)
	}
	return result, rows.Err()
}
func (s *Store) SaveAccount(ctx context.Context, id string, input AccountInput) (Account, error) {
	var result Account
	if err := validateName(input.Name, input.Color); err != nil {
		return result, err
	}
	if err := safeCents(input.InitialBalance); err != nil {
		return result, err
	}
	if input.Kind != "normal" && input.Kind != "project" {
		return result, invalid("kind", "账户类型无效")
	}
	start, err := optionalDate(input.PeriodStart)
	if err != nil {
		return result, err
	}
	end, err := optionalDate(input.PeriodEnd)
	if err != nil {
		return result, err
	}
	if start != nil && end != nil && *start > *end {
		return result, invalid("periodEnd", "结束日期不能早于开始日期")
	}
	now := time.Now().UnixMilli()
	err = s.transaction(ctx, func(tx *sql.Tx) error {
		var archived *int64
		if id != "" {
			if e := tx.QueryRowContext(ctx, "SELECT archived_at FROM account WHERE id=? AND is_delete=0", id).Scan(&archived); e == sql.ErrNoRows {
				return notFound()
			} else if e != nil {
				return e
			}
		}
		if !input.Archived {
			archived = nil
		} else if archived == nil {
			archived = &now
		}
		if id == "" {
			id = newID()
			_, e := tx.ExecContext(ctx, `INSERT INTO account(id,name,color,initial_balance,include_in_balance,order_num,kind,period_start,period_end,archived_at,created_at,updated_at)
    VALUES(?,?,?,?,?,(SELECT COALESCE(MAX(order_num),-1)+1 FROM account),?,?,?,?,?,?)`, id, strings.TrimSpace(input.Name), input.Color, input.InitialBalance, input.IncludeInBalance, input.Kind, start, end, archived, now, now)
			if e != nil {
				return e
			}
		} else if e := affected(tx.ExecContext(ctx, `UPDATE account SET name=?,color=?,initial_balance=?,include_in_balance=?,kind=?,period_start=?,period_end=?,archived_at=?,updated_at=? WHERE id=? AND is_delete=0`, strings.TrimSpace(input.Name), input.Color, input.InitialBalance, input.IncludeInBalance, input.Kind, start, end, archived, now, id)); e != nil {
			return e
		}
		accounts, err := readAccounts(ctx, tx)
		if err != nil {
			return err
		}
		for _, a := range accounts.Items {
			if a.ID == id {
				result = a
				return nil
			}
		}
		return notFound()
	})
	return result, err
}
func (s *Store) DeleteAccount(ctx context.Context, id string) error {
	return s.transaction(ctx, func(tx *sql.Tx) error {
		if err := exists(ctx, tx, "account", id); err != nil {
			return err
		}
		var count int64
		if err := tx.QueryRowContext(ctx, `SELECT (SELECT COUNT(*) FROM category WHERE account_id=? AND is_delete=0)+(SELECT COUNT(*) FROM txn WHERE is_delete=0 AND (account_id=? OR to_account_id=?))`, id, id, id).Scan(&count); err != nil {
			return err
		}
		if count > 0 {
			return &Error{Code: "RESTRICT", Message: "账户仍有关联交易或分类，请先处理"}
		}
		return affected(tx.ExecContext(ctx, "UPDATE account SET is_delete=1,updated_at=? WHERE id=? AND is_delete=0", time.Now().UnixMilli(), id))
	})
}
func (s *Store) ReorderAccounts(ctx context.Context, ids []string) error {
	return s.reorder(ctx, "account", "", ids)
}
func (s *Store) ReorderCategories(ctx context.Context, accountID string, ids []string) error {
	return s.reorder(ctx, "category", accountID, ids)
}
func (s *Store) reorder(ctx context.Context, table, accountID string, ids []string) error {
	unique, err := uniqueIDs(ids)
	if err != nil {
		return err
	}
	if len(unique) != len(ids) {
		return invalid("ids", "排序 ID 不能重复")
	}
	return s.transaction(ctx, func(tx *sql.Tx) error {
		where := "is_delete=0"
		args := []any{}
		if table == "category" {
			if e := exists(ctx, tx, "account", accountID); e != nil {
				return e
			}
			where += " AND account_id=?"
			args = append(args, accountID)
		}
		rows, e := tx.QueryContext(ctx, "SELECT id FROM "+table+" WHERE "+where, args...)
		if e != nil {
			return e
		}
		expected := map[string]bool{}
		for rows.Next() {
			var id string
			if e = rows.Scan(&id); e != nil {
				rows.Close()
				return e
			}
			expected[id] = true
		}
		e = rows.Err()
		rows.Close()
		if e != nil {
			return e
		}
		if len(expected) != len(ids) {
			return invalid("ids", "排序必须包含该范围的全部有效记录")
		}
		for _, id := range ids {
			if !expected[id] {
				return invalid("ids", "排序记录不属于该范围")
			}
		}
		now := time.Now().UnixMilli()
		for index, id := range ids {
			if _, e = tx.ExecContext(ctx, "UPDATE "+table+" SET order_num=?,updated_at=? WHERE id=?", index, now, id); e != nil {
				return e
			}
		}
		return nil
	})
}

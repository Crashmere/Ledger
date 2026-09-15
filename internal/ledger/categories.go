package ledger

import (
	"context"
	"database/sql"
	"strings"
	"time"
)

func (s *Store) Categories(ctx context.Context, accountID string) ([]Category, error) {
	result := []Category{}
	where := "c.is_delete=0 AND a.is_delete=0"
	args := []any{}
	if accountID != "" {
		where += " AND c.account_id=?"
		args = append(args, accountID)
	}
	rows, err := s.db.QueryContext(ctx, "SELECT c.id,c.account_id,c.name,c.color,c.icon,c.order_num,c.created_at FROM category c JOIN account a ON a.id=c.account_id WHERE "+where+" ORDER BY c.order_num,c.id", args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var c Category
		if err = rows.Scan(&c.ID, &c.AccountID, &c.Name, &c.Color, &c.Icon, &c.OrderNum, &c.CreatedAt); err != nil {
			return nil, err
		}
		result = append(result, c)
	}
	return result, rows.Err()
}
func (s *Store) SaveCategory(ctx context.Context, id string, input CategoryInput) (Category, error) {
	var result Category
	if err := validateName(input.Name, input.Color); err != nil {
		return result, err
	}
	err := s.transaction(ctx, func(tx *sql.Tx) error {
		if id == "" {
			if e := exists(ctx, tx, "account", input.AccountID); e != nil {
				return invalid("accountId", "请选择有效账户")
			}
			id = newID()
			now := time.Now().UnixMilli()
			if _, e := tx.ExecContext(ctx, `INSERT INTO category(id,account_id,name,color,order_num,created_at,updated_at) VALUES(?,?,?,?,(SELECT COALESCE(MAX(order_num),-1)+1 FROM category WHERE account_id=?),?,?)`, id, input.AccountID, strings.TrimSpace(input.Name), input.Color, input.AccountID, now, now); e != nil {
				return e
			}
		} else {
			var accountID string
			if e := tx.QueryRowContext(ctx, "SELECT account_id FROM category WHERE id=? AND is_delete=0", id).Scan(&accountID); e == sql.ErrNoRows {
				return notFound()
			} else if e != nil {
				return e
			}
			if input.AccountID != "" && input.AccountID != accountID {
				return invalid("accountId", "分类不能更换所属账户")
			}
			if e := affected(tx.ExecContext(ctx, "UPDATE category SET name=?,color=?,updated_at=? WHERE id=? AND is_delete=0", strings.TrimSpace(input.Name), input.Color, time.Now().UnixMilli(), id)); e != nil {
				return e
			}
		}
		return tx.QueryRowContext(ctx, "SELECT id,account_id,name,color,icon,order_num,created_at FROM category WHERE id=?", id).Scan(&result.ID, &result.AccountID, &result.Name, &result.Color, &result.Icon, &result.OrderNum, &result.CreatedAt)
	})
	return result, err
}
func (s *Store) DeleteCategory(ctx context.Context, id string) error {
	return s.transaction(ctx, func(tx *sql.Tx) error {
		if e := exists(ctx, tx, "category", id); e != nil {
			return e
		}
		now := time.Now().UnixMilli()
		// 软删不触发 ON DELETE SET NULL，因此显式解除存活交易的分类引用。
		if _, e := tx.ExecContext(ctx, "UPDATE txn SET category_id=NULL,updated_at=? WHERE category_id=? AND is_delete=0", now, id); e != nil {
			return e
		}
		return affected(tx.ExecContext(ctx, "UPDATE category SET is_delete=1,updated_at=? WHERE id=? AND is_delete=0", now, id))
	})
}

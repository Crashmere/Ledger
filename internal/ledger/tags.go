package ledger

import (
	"context"
	"database/sql"
	"strings"
	"time"
)

func (s *Store) Tags(ctx context.Context) ([]Tag, error) {
	result := []Tag{}
	rows, err := s.db.QueryContext(ctx, "SELECT id,name,color,icon,order_num,created_at FROM tag WHERE is_delete=0 ORDER BY order_num,id")
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var t Tag
		if err = rows.Scan(&t.ID, &t.Name, &t.Color, &t.Icon, &t.OrderNum, &t.CreatedAt); err != nil {
			return nil, err
		}
		result = append(result, t)
	}
	return result, rows.Err()
}
func (s *Store) SaveTag(ctx context.Context, id string, input NamedInput) (Tag, error) {
	var result Tag
	if err := validateName(input.Name, input.Color); err != nil {
		return result, err
	}
	err := s.transaction(ctx, func(tx *sql.Tx) error {
		now := time.Now().UnixMilli()
		if id == "" {
			id = newID()
			if _, e := tx.ExecContext(ctx, "INSERT INTO tag(id,name,color,order_num,created_at,updated_at) VALUES(?,?,?,(SELECT COALESCE(MAX(order_num),-1)+1 FROM tag),?,?)", id, strings.TrimSpace(input.Name), input.Color, now, now); e != nil {
				return e
			}
		} else if e := affected(tx.ExecContext(ctx, "UPDATE tag SET name=?,color=?,updated_at=? WHERE id=? AND is_delete=0", strings.TrimSpace(input.Name), input.Color, now, id)); e != nil {
			return e
		}
		return tx.QueryRowContext(ctx, "SELECT id,name,color,icon,order_num,created_at FROM tag WHERE id=?", id).Scan(&result.ID, &result.Name, &result.Color, &result.Icon, &result.OrderNum, &result.CreatedAt)
	})
	return result, err
}
func (s *Store) DeleteTag(ctx context.Context, id string) error {
	return affected(s.db.ExecContext(ctx, "UPDATE tag SET is_delete=1,updated_at=? WHERE id=? AND is_delete=0", time.Now().UnixMilli(), id))
}

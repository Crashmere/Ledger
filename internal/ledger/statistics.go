package ledger

import (
	"context"
	"database/sql"
	"math"
	"time"
)

func (s *Store) Summary(ctx context.Context, input SummaryQuery) (Summary, error) {
	var result Summary
	where, args, err := buildFilter(input.Filter)
	if err != nil {
		return result, err
	}
	err = s.transaction(ctx, func(tx *sql.Tx) error {
		var first, last sql.NullInt64
		e := tx.QueryRowContext(ctx, `SELECT
   COALESCE(SUM(CASE WHEN t.type='income' THEN t.amount ELSE 0 END),0),
   COALESCE(SUM(CASE WHEN t.type='expense' THEN t.amount ELSE 0 END),0),
   COUNT(*),COUNT(CASE WHEN t.type='income' THEN 1 END),COUNT(CASE WHEN t.type='expense' THEN 1 END),COUNT(CASE WHEN t.type='transfer' THEN 1 END),
   MIN(CASE WHEN t.type='expense' THEN t.time END),MAX(CASE WHEN t.type='expense' THEN t.time END)
   FROM txn t WHERE `+where, args...).Scan(&result.Income, &result.Expense, &result.TotalCount, &result.IncomeCount, &result.ExpenseCount, &result.TransferCount, &first, &last)
		if e != nil {
			return e
		}
		if e = safeCents(result.Income); e != nil {
			return e
		}
		if e = safeCents(result.Expense); e != nil {
			return e
		}
		if result.Net, e = addCents(result.Income, -result.Expense); e != nil {
			return e
		}
		result.Annual.Count = result.ExpenseCount
		if first.Valid && last.Valid {
			result.Annual.SpanDays = int64(math.Round(float64(last.Int64-first.Int64) / 86400000))
		}
		if result.ExpenseCount >= 2 && result.Annual.SpanDays > 0 {
			annual := math.Round(float64(result.Expense) / float64(result.Annual.SpanDays) * 365)
			if annual > float64(MaxCents) {
				return invalid("amount", "年化金额超出安全范围")
			}
			value := int64(annual)
			result.Annual.Amount = &value
		}
		if input.FlowAccountID != "" {
			if e = exists(ctx, tx, "account", input.FlowAccountID); e != nil {
				return e
			}
			flowArgs := []any{input.FlowAccountID, input.FlowAccountID, input.FlowAccountID}
			flowArgs = append(flowArgs, args...)
			e = tx.QueryRowContext(ctx, `SELECT
    COALESCE(SUM(CASE WHEN (t.type='income' AND t.account_id=?) OR (t.type='transfer' AND t.to_account_id=?) THEN t.amount ELSE 0 END),0),
    COALESCE(SUM(CASE WHEN t.type IN ('expense','transfer') AND t.account_id=? THEN t.amount ELSE 0 END),0)
    FROM txn t WHERE `+where, flowArgs...).Scan(&result.Inflow, &result.Outflow)
			if e != nil {
				return e
			}
			if e = safeCents(result.Inflow); e != nil {
				return e
			}
			return safeCents(result.Outflow)
		}
		return nil
	})
	return result, err
}
func (s *Store) CategoryStatistics(ctx context.Context, input CategoryQuery) ([]CategoryTotal, error) {
	if input.GroupBy == "" {
		input.GroupBy = "name"
	}
	if input.Direction == "" {
		input.Direction = "expense"
	}
	if input.GroupBy != "id" && input.GroupBy != "name" {
		return nil, invalid("groupBy", "分类分组方式无效")
	}
	if input.Direction != "income" && input.Direction != "expense" {
		return nil, invalid("direction", "统计方向无效")
	}
	where, args, err := buildFilter(input.Filter)
	if err != nil {
		return nil, err
	}
	idExpr := "c.id"
	group := "c.id"
	if input.GroupBy == "name" {
		idExpr = "NULL"
		group = "COALESCE(c.name,'未分类')"
	}
	rows, err := s.db.QueryContext(ctx, `SELECT `+idExpr+`,COALESCE(c.name,'未分类'),
  COALESCE(SUM(CASE WHEN t.type='income' THEN t.amount ELSE 0 END),0) AS income,
  COALESCE(SUM(CASE WHEN t.type='expense' THEN t.amount ELSE 0 END),0) AS expense,
  COUNT(CASE WHEN t.type='income' THEN 1 END),COUNT(CASE WHEN t.type='expense' THEN 1 END),MAX(t.time)
  FROM txn t LEFT JOIN category c ON c.id=t.category_id AND c.is_delete=0 WHERE `+where+" AND t.type IN ('income','expense') GROUP BY "+group+" ORDER BY "+input.Direction+" DESC,MAX(t.time) DESC,COALESCE(c.name,'未分类'),"+idExpr, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := []CategoryTotal{}
	for rows.Next() {
		var c CategoryTotal
		if err = rows.Scan(&c.ID, &c.Name, &c.Income, &c.Expense, &c.IncomeCount, &c.ExpenseCount, &c.Latest); err != nil {
			return nil, err
		}
		if err = safeCents(c.Income); err != nil {
			return nil, err
		}
		if err = safeCents(c.Expense); err != nil {
			return nil, err
		}
		result = append(result, c)
	}
	return result, rows.Err()
}
func (s *Store) DailyStatistics(ctx context.Context, input DailyQuery) (DailyResult, error) {
	result := DailyResult{Days: []DailyTotal{}}
	start, err := ParseDate(input.Filter.DateFrom)
	if err != nil {
		return result, err
	}
	end, err := ParseDate(input.Filter.DateTo)
	if err != nil {
		return result, err
	}
	if end.Before(start) || end.Sub(start) > 3660*24*time.Hour {
		return result, invalid("dateTo", "每日统计范围最多 3661 天")
	}
	where, args, err := buildFilter(input.Filter)
	if err != nil {
		return result, err
	}
	rows, err := s.db.QueryContext(ctx, `SELECT ledger_date(t.time),
  COALESCE(SUM(CASE WHEN t.type='income' THEN t.amount ELSE 0 END),0),COALESCE(SUM(CASE WHEN t.type='expense' THEN t.amount ELSE 0 END),0),
  COUNT(CASE WHEN t.type='income' THEN 1 END),COUNT(CASE WHEN t.type='expense' THEN 1 END),COUNT(CASE WHEN t.type='transfer' THEN 1 END)
  FROM txn t WHERE `+where+" GROUP BY ledger_date(t.time)", args...)
	if err != nil {
		return result, err
	}
	buckets := map[string]DailyTotal{}
	for rows.Next() {
		var d DailyTotal
		if err = rows.Scan(&d.Date, &d.Income, &d.Expense, &d.IncomeCount, &d.ExpenseCount, &d.TransferCount); err != nil {
			rows.Close()
			return result, err
		}
		if err = safeCents(d.Income); err != nil {
			rows.Close()
			return result, err
		}
		if err = safeCents(d.Expense); err != nil {
			rows.Close()
			return result, err
		}
		buckets[d.Date] = d
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return result, err
	}
	maxAmount := int64(0)
	result.StartWeekday = int(start.Weekday())
	for day := start; !day.After(end); day = day.AddDate(0, 0, 1) {
		date := day.Format(time.DateOnly)
		d := buckets[date]
		d.Date = date
		d.Time = day.UnixMilli()
		result.Days = append(result.Days, d)
		if d.Expense > maxAmount {
			maxAmount = d.Expense
		}
		if d.ExpenseCount > 0 {
			result.ActiveDays++
		}
		if result.Total, err = addCents(result.Total, d.Expense); err != nil {
			return result, err
		}
	}
	// 以一元为对数尺度，保持旧热力图的八档着色；金额本身不做缩放。
	logMax := math.Log1p(float64(maxAmount) / 100)
	for i := range result.Days {
		d := &result.Days[i]
		if d.Expense > 0 {
			d.Level = min(8, int(math.Ceil(math.Log1p(float64(d.Expense)/100)/logMax*8)))
		}
	}
	result.WeekCount = (result.StartWeekday + len(result.Days) + 6) / 7
	return result, nil
}

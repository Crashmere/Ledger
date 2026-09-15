package ledger

import (
	"context"
	"database/sql"
	"errors"
	"regexp"
	"strconv"
	"strings"
)

type BatchRow struct {
	Line        int     `json:"line"`
	AmountInput string  `json:"amountInput"`
	Title       string  `json:"title"`
	Note        string  `json:"note"`
	AccountID   string  `json:"accountId"`
	CategoryID  *string `json:"categoryId"`
	Date        string  `json:"date"`
}
type BatchRequest struct {
	Rows []BatchRow `json:"rows"`
}
type BatchPreviewRow struct {
	Line        int               `json:"line"`
	Transaction *TransactionInput `json:"transaction"`
	Errors      []string          `json:"errors"`
}
type BatchPreview struct {
	Rows    []BatchPreviewRow `json:"rows"`
	Income  int64             `json:"income"`
	Expense int64             `json:"expense"`
	Valid   bool              `json:"valid"`
	Count   int               `json:"count"`
}

var amountPattern = regexp.MustCompile(`^[+-]?(?:[0-9]+(?:\.[0-9]{1,2})?|\.[0-9]{1,2})$`)

func parseAmount(value string) (string, int64, error) {
	value = strings.TrimSpace(value)
	value = strings.NewReplacer("−", "-", "－", "-", "＋", "+").Replace(value)
	if !amountPattern.MatchString(value) {
		return "", 0, invalid("amountInput", "金额须为数字，最多两位小数（+收入，无符号或负号为支出）")
	}
	kind := "expense"
	if strings.HasPrefix(value, "+") {
		kind = "income"
	}
	value = strings.TrimLeft(value, "+-")
	parts := strings.SplitN(value, ".", 2)
	whole := parts[0]
	if whole == "" {
		whole = "0"
	}
	fraction := "00"
	if len(parts) == 2 {
		fraction = (parts[1] + "00")[:2]
	}
	amount, err := strconv.ParseInt(whole+fraction, 10, 64)
	if err != nil || amount <= 0 || amount > MaxCents {
		return "", 0, invalid("amountInput", "金额须大于 0 且在安全范围内")
	}
	return kind, amount, nil
}
func previewBatch(ctx context.Context, tx *sql.Tx, input BatchRequest) (BatchPreview, error) {
	result := BatchPreview{Rows: []BatchPreviewRow{}, Valid: true, Count: len(input.Rows)}
	if len(input.Rows) == 0 || len(input.Rows) > 500 {
		return result, invalid("rows", "一次须录入 1 至 500 笔")
	}
	for _, row := range input.Rows {
		preview := BatchPreviewRow{Line: row.Line, Errors: []string{}}
		kind, amount, err := parseAmount(row.AmountInput)
		title := strings.TrimSpace(row.Title)
		note := strings.TrimSpace(row.Note)
		draft := TransactionInput{Type: kind, Amount: amount, AccountID: row.AccountID, CategoryID: row.CategoryID, Date: row.Date, Title: &title, Note: &note, TagIDs: []string{}}
		if err == nil && title == "" {
			err = invalid("title", "请填写标题")
		}
		if err == nil {
			_, _, err = validateTransaction(ctx, tx, draft)
		}
		if err != nil {
			var domain *Error
			if !errors.As(err, &domain) {
				return result, err
			}
			preview.Errors = append(preview.Errors, domain.Message)
			result.Valid = false
		} else {
			preview.Transaction = &draft
			if kind == "income" {
				result.Income, err = addCents(result.Income, amount)
			} else {
				result.Expense, err = addCents(result.Expense, amount)
			}
			if err != nil {
				return result, err
			}
		}
		result.Rows = append(result.Rows, preview)
	}
	return result, nil
}
func (s *Store) PreviewBatch(ctx context.Context, input BatchRequest) (BatchPreview, error) {
	var result BatchPreview
	err := s.transaction(ctx, func(tx *sql.Tx) error { var e error; result, e = previewBatch(ctx, tx, input); return e })
	return result, err
}
func (s *Store) SaveBatch(ctx context.Context, input BatchRequest) (BatchPreview, error) {
	var result BatchPreview
	err := s.transaction(ctx, func(tx *sql.Tx) error {
		var e error
		result, e = previewBatch(ctx, tx, input)
		if e != nil {
			return e
		}
		if !result.Valid {
			for _, row := range result.Rows {
				if len(row.Errors) > 0 {
					return &Error{Code: "VALIDATION", Line: row.Line, Message: row.Errors[0]}
				}
			}
		}
		for _, row := range result.Rows {
			if _, e = saveTransaction(ctx, tx, "", *row.Transaction); e != nil {
				return e
			}
		}
		return nil
	})
	return result, err
}

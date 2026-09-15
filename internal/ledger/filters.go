package ledger

import (
	"fmt"
	"slices"
	"strings"
	"time"
	"unicode/utf8"

	"golang.org/x/text/cases"
	"golang.org/x/text/language"
)

// buildFilter 中 t 固定代表 txn。列表和所有统计共用这里的条件，避免口径漂移。
func buildFilter(f TransactionFilter) (string, []any, error) {
	where := []string{"t.is_delete=0"}
	args := []any{}
	appendIDs := func(column string, ids []string) error {
		clean, err := uniqueIDs(ids)
		if err != nil {
			return err
		}
		if len(clean) == 0 {
			return nil
		}
		where = append(where, column+" IN ("+placeholders(len(clean))+")")
		for _, id := range clean {
			args = append(args, id)
		}
		return nil
	}
	if len(f.Types) > 3 {
		return "", nil, invalid("types", "交易类型无效")
	}
	for _, v := range f.Types {
		if !slices.Contains([]string{"income", "expense", "transfer"}, v) {
			return "", nil, invalid("types", "交易类型无效")
		}
	}
	if err := appendIDs("t.type", f.Types); err != nil {
		return "", nil, err
	}
	accounts, err := uniqueIDs(f.AccountIDs)
	if err != nil {
		return "", nil, err
	}
	if len(accounts) > 0 {
		ph := placeholders(len(accounts))
		where = append(where, "(t.account_id IN ("+ph+") OR t.to_account_id IN ("+ph+"))")
		for range 2 {
			for _, id := range accounts {
				args = append(args, id)
			}
		}
	}
	if err = appendIDs("t.category_id", f.CategoryIDs); err != nil {
		return "", nil, err
	}
	tags, err := uniqueIDs(f.TagIDs)
	if err != nil {
		return "", nil, err
	}
	if len(tags) > 0 {
		where = append(where, "EXISTS (SELECT 1 FROM txn_tag tt JOIN tag g ON g.id=tt.tag_id WHERE tt.txn_id=t.id AND g.is_delete=0 AND g.id IN ("+placeholders(len(tags))+"))")
		for _, id := range tags {
			args = append(args, id)
		}
	}
	excluded, err := uniqueIDs(f.ExcludedIDs)
	if err != nil {
		return "", nil, err
	}
	if len(excluded) > 0 {
		where = append(where, "t.id NOT IN ("+placeholders(len(excluded))+")")
		for _, id := range excluded {
			args = append(args, id)
		}
	}
	var start, end time.Time
	if f.DateFrom != "" {
		start, err = ParseDate(f.DateFrom)
		if err != nil {
			return "", nil, err
		}
		where = append(where, "t.time>=?")
		args = append(args, start.UnixMilli())
	}
	if f.DateTo != "" {
		end, err = ParseDate(f.DateTo)
		if err != nil {
			return "", nil, err
		}
		where = append(where, "t.time<?")
		args = append(args, end.AddDate(0, 0, 1).UnixMilli())
	}
	if !start.IsZero() && !end.IsZero() && start.After(end) {
		return "", nil, invalid("dateTo", "结束日期不能早于开始日期")
	}
	if f.AmountMin != nil {
		if *f.AmountMin < 0 || *f.AmountMin > MaxCents {
			return "", nil, invalid("amountMin", "金额下限无效")
		}
		where = append(where, "t.amount>=?")
		args = append(args, *f.AmountMin)
	}
	if f.AmountMax != nil {
		if *f.AmountMax < 0 || *f.AmountMax > MaxCents {
			return "", nil, invalid("amountMax", "金额上限无效")
		}
		where = append(where, "t.amount<=?")
		args = append(args, *f.AmountMax)
	}
	if f.AmountMin != nil && f.AmountMax != nil && *f.AmountMin > *f.AmountMax {
		return "", nil, invalid("amountMax", "金额上限不能小于下限")
	}
	projects := "SELECT id FROM account WHERE kind='project'"
	switch f.ProjectScope {
	case "", "all":
	case "exclude", "selected":
		allowed := []string{"(t.account_id NOT IN (" + projects + ") AND (t.to_account_id IS NULL OR t.to_account_id NOT IN (" + projects + ")))"}
		if f.ProjectScope == "selected" && len(accounts) > 0 {
			selected := projects + " AND id IN (" + placeholders(len(accounts)) + ")"
			allowed = append(allowed, "t.account_id IN ("+selected+")", "t.to_account_id IN ("+selected+")")
			for range 2 {
				for _, id := range accounts {
					args = append(args, id)
				}
			}
		}
		where = append(where, "("+strings.Join(allowed, " OR ")+")")
	default:
		return "", nil, invalid("projectScope", "专项范围无效")
	}
	if utf8.RuneCountInString(f.Keyword) > 200 {
		return "", nil, invalid("keyword", "关键词最多 200 个字符")
	}
	fields := f.SearchFields
	for _, field := range fields {
		if !slices.Contains([]string{"title", "note", "category", "tag"}, field) {
			return "", nil, invalid("searchFields", "搜索字段无效")
		}
	}
	keyword := cases.Lower(language.Und).String(strings.Trim(f.Keyword, "\t\n\v\f\r \u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff"))
	if keyword != "" {
		if len(fields) == 0 || len(fields) > 4 {
			return "", nil, invalid("searchFields", "请选择 1 至 4 个搜索字段")
		}
		matches := []string{}
		for _, field := range fields {
			switch field {
			case "title", "note":
				matches = append(matches, fmt.Sprintf("instr(ledger_lower(t.%s),?)>0", field))
			case "category":
				matches = append(matches, "EXISTS (SELECT 1 FROM category c WHERE c.id=t.category_id AND c.is_delete=0 AND instr(ledger_lower(c.name),?)>0)")
			case "tag":
				matches = append(matches, "EXISTS (SELECT 1 FROM txn_tag tt JOIN tag g ON g.id=tt.tag_id WHERE tt.txn_id=t.id AND g.is_delete=0 AND instr(ledger_lower(g.name),?)>0)")
			}
			args = append(args, keyword)
		}
		where = append(where, "("+strings.Join(matches, " OR ")+")")
	}
	return strings.Join(where, " AND "), args, nil
}

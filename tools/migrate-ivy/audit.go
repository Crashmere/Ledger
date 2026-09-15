package main

import (
	"context"
	"fmt"
	"math"
	"sort"
	"time"

	"ledger/internal/ledger"
)

type totals struct {
	Income  int64 `json:"income"`
	Expense int64 `json:"expense"`
	Count   int64 `json:"count"`
}

func auditStatistics(path string, source map[string][]map[string]any) (map[string]any, error) {
	store, err := ledger.Open(path, false)
	if err != nil {
		return nil, err
	}
	defer store.Close()
	ctx := context.Background()
	balances := map[string]int64{}
	project := map[string]bool{}
	include := map[string]bool{}
	categories := map[string]string{}
	for _, row := range source["account"] {
		id := row["id"].(string)
		project[id] = row["kind"] == "project"
		if row["is_delete"] == int64(0) {
			balances[id] = row["initial_balance"].(int64)
			include[id] = row["include_in_balance"] == int64(1)
		}
	}
	for _, row := range source["category"] {
		if row["is_delete"] == int64(0) {
			categories[row["id"].(string)] = row["name"].(string)
		}
	}
	months := map[string]bool{}
	active := []map[string]any{}
	for _, row := range source["txn"] {
		if row["is_delete"] != int64(0) {
			continue
		}
		active = append(active, row)
		id := row["account_id"].(string)
		amount := row["amount"].(int64)
		switch row["type"] {
		case "income":
			balances[id] += amount
		case "expense":
			balances[id] -= amount
		case "transfer":
			balances[id] -= amount
			balances[row["to_account_id"].(string)] += amount
		}
		months[ledger.DateOf(row["time"].(int64))[:7]] = true
	}
	actualAccounts, err := store.Accounts(ctx)
	if err != nil {
		return nil, err
	}
	var totalBalance int64
	for _, a := range actualAccounts.Items {
		if balances[a.ID] != a.Balance {
			return nil, fmt.Errorf("账户余额对账失败：%s", a.ID)
		}
		if include[a.ID] {
			totalBalance += balances[a.ID]
		}
	}
	if totalBalance != actualAccounts.TotalBalance {
		return nil, fmt.Errorf("总余额对账失败")
	}
	periods := []string{"all"}
	for month := range months {
		periods = append(periods, month)
	}
	sort.Strings(periods)
	audit := map[string]any{"accountBalances": balances, "totalBalance": totalBalance}
	summaries := map[string]totals{}
	for _, period := range periods {
		for _, scope := range []string{"all", "exclude"} {
			filter := ledger.TransactionFilter{ProjectScope: scope}
			if period != "all" {
				start, err := ledger.ParseDate(period + "-01")
				if err != nil {
					return nil, err
				}
				filter.DateFrom = start.Format(time.DateOnly)
				filter.DateTo = start.AddDate(0, 1, -1).Format(time.DateOnly)
			}
			expected := totals{}
			grouped := map[string]totals{}
			var earliest, latest int64
			var expenses int64
			for _, row := range active {
				ms := row["time"].(int64)
				if period != "all" && ledger.DateOf(ms)[:7] != period {
					continue
				}
				if scope == "exclude" && (project[row["account_id"].(string)] || row["to_account_id"] != nil && project[row["to_account_id"].(string)]) {
					continue
				}
				expected.Count++
				category := "未分类"
				if id, ok := row["category_id"].(string); ok && categories[id] != "" {
					category = categories[id]
				}
				group := grouped[category]
				amount := row["amount"].(int64)
				switch row["type"] {
				case "income":
					expected.Income += amount
					group.Income += amount
					group.Count++
				case "expense":
					expected.Expense += amount
					group.Expense += amount
					group.Count++
					if expenses == 0 || ms < earliest {
						earliest = ms
					}
					if expenses == 0 || ms > latest {
						latest = ms
					}
					expenses++
				}
				if row["type"] != "transfer" {
					grouped[category] = group
				}
			}
			actual, err := store.Summary(ctx, ledger.SummaryQuery{Filter: filter})
			if err != nil {
				return nil, err
			}
			if actual.Income != expected.Income || actual.Expense != expected.Expense || actual.TotalCount != expected.Count || actual.Net != expected.Income-expected.Expense {
				return nil, fmt.Errorf("收支对账失败：%s/%s", period, scope)
			}
			span := int64(math.Round(float64(latest-earliest) / 86400000))
			if actual.Annual.Count != expenses || actual.Annual.SpanDays != span {
				return nil, fmt.Errorf("历史跨度对账失败：%s/%s", period, scope)
			}
			if expenses >= 2 && span > 0 {
				amount := int64(math.Round(float64(expected.Expense) / float64(span) * 365))
				if actual.Annual.Amount == nil || *actual.Annual.Amount != amount {
					return nil, fmt.Errorf("年化对账失败：%s/%s", period, scope)
				}
			} else if actual.Annual.Amount != nil {
				return nil, fmt.Errorf("年化应为空")
			}
			for _, direction := range []string{"income", "expense"} {
				rows, err := store.CategoryStatistics(ctx, ledger.CategoryQuery{Filter: filter, GroupBy: "name", Direction: direction})
				if err != nil {
					return nil, err
				}
				if len(rows) != len(grouped) {
					return nil, fmt.Errorf("分类数量对账失败：%s/%s", period, scope)
				}
				for _, row := range rows {
					e := grouped[row.Name]
					if row.Income != e.Income || row.Expense != e.Expense {
						return nil, fmt.Errorf("分类金额对账失败：%s/%s", period, scope)
					}
				}
			}
			summaries[period+"/"+scope] = expected
		}
	}
	audit["summaries"] = summaries
	return audit, nil
}

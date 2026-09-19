package ledger

import (
	"context"
	"errors"
	"path/filepath"
	"testing"
)

var testContext = context.Background()

func pointer[T any](v T) *T { return &v }
func testStore(t *testing.T) *Store {
	t.Helper()
	s, e := Open(filepath.Join(t.TempDir(), "ledger.sqlite"), true)
	if e != nil {
		t.Fatal(e)
	}
	t.Cleanup(func() { s.Close() })
	return s
}
func account(t *testing.T, s *Store, name, kind string, initial int64) Account {
	t.Helper()
	a, e := s.SaveAccount(testContext, "", AccountInput{Name: name, Color: -1, Kind: kind, InitialBalance: initial, IncludeInBalance: kind == "normal"})
	if e != nil {
		t.Fatal(e)
	}
	return a
}
func transaction(t *testing.T, s *Store, input TransactionInput) Transaction {
	t.Helper()
	v, e := s.SaveTransaction(testContext, "", input)
	if e != nil {
		t.Fatal(e)
	}
	return v
}
func requireCode(t *testing.T, err error, code string) {
	t.Helper()
	var domain *Error
	if !errors.As(err, &domain) || domain.Code != code {
		t.Fatalf("wanted %s, got %v", code, err)
	}
}

func TestBalancesTransfersAndDeletion(t *testing.T) {
	s := testStore(t)
	a := account(t, s, "现金", "normal", 10000)
	b := account(t, s, "银行卡", "normal", 2000)
	c, e := s.SaveCategory(testContext, "", CategoryInput{Name: "餐饮", Color: -1, AccountID: a.ID})
	if e != nil {
		t.Fatal(e)
	}
	expense := transaction(t, s, TransactionInput{Type: "expense", Amount: 1200, AccountID: a.ID, CategoryID: &c.ID, Date: "2026-09-01"})
	transaction(t, s, TransactionInput{Type: "income", Amount: 5000, AccountID: b.ID, Date: "2026-09-02"})
	transaction(t, s, TransactionInput{Type: "transfer", Amount: 3000, AccountID: b.ID, ToAccountID: &a.ID, Date: "2026-09-03"})
	accounts, e := s.Accounts(testContext)
	if e != nil {
		t.Fatal(e)
	}
	if accounts.Items[0].Balance != 11800 || accounts.Items[1].Balance != 4000 || accounts.TotalBalance != 15800 {
		t.Fatalf("balances: %+v", accounts)
	}
	summary, e := s.Summary(testContext, SummaryQuery{})
	if e != nil {
		t.Fatal(e)
	}
	if summary.Income != 5000 || summary.Expense != 1200 || summary.TransferCount != 1 || summary.TotalCount != 3 {
		t.Fatalf("summary: %+v", summary)
	}
	flow, e := s.Summary(testContext, SummaryQuery{FlowAccountID: a.ID})
	if e != nil || flow.Inflow != 3000 || flow.Outflow != 1200 {
		t.Fatalf("flow: %+v %v", flow, e)
	}
	requireCode(t, s.DeleteAccount(testContext, a.ID), "RESTRICT")
	if e = s.DeleteCategory(testContext, c.ID); e != nil {
		t.Fatal(e)
	}
	value, e := s.Transaction(testContext, expense.ID)
	if e != nil || value.CategoryID != nil {
		t.Fatalf("category detach: %+v %v", value, e)
	}
	if e = s.DeleteTransaction(testContext, expense.ID); e != nil {
		t.Fatal(e)
	}
	_, e = s.Transaction(testContext, expense.ID)
	requireCode(t, e, "NOT_FOUND")
}
func TestPaginationUsesCompleteFilterForTotals(t *testing.T) {
	s := testStore(t)
	a := account(t, s, "日常", "normal", 0)
	c, e := s.SaveCategory(testContext, "", CategoryInput{Name: "餐饮", Color: -1, AccountID: a.ID})
	if e != nil {
		t.Fatal(e)
	}
	for i := range 65 {
		transaction(t, s, TransactionInput{Type: "expense", Amount: 100, AccountID: a.ID, Date: "2026-09-01", CategoryID: &c.ID, Title: pointer("午餐")})
		_ = i
	}
	page, e := s.QueryTransactions(testContext, TransactionQuery{Page: 2, PageSize: 50, IncludeDayTotals: true})
	if e != nil {
		t.Fatal(e)
	}
	if len(page.Items) != 15 || page.TotalCount != 65 || page.DayTotals["2026-09-01"].Expense != 6500 {
		t.Fatalf("page: %+v", page)
	}
	summary, e := s.Summary(testContext, SummaryQuery{})
	if e != nil || summary.Expense != 6500 || summary.ExpenseCount != 65 {
		t.Fatalf("summary: %+v %v", summary, e)
	}
	excluded := page.Items[0].ID
	filter := TransactionFilter{ExcludedIDs: []string{excluded}, CategoryIDs: []string{c.ID}}
	page, e = s.QueryTransactions(testContext, TransactionQuery{Filter: filter, PageSize: 200})
	if e != nil || page.TotalCount != 64 {
		t.Fatalf("exclude: %v %v", page.TotalCount, e)
	}
	summary, e = s.Summary(testContext, SummaryQuery{Filter: filter})
	if e != nil || summary.Expense != 6400 {
		t.Fatal("exclude mismatch", e, summary)
	}
	categories, e := s.CategoryStatistics(testContext, CategoryQuery{Filter: filter, GroupBy: "name"})
	if e != nil || len(categories) != 1 || categories[0].Expense != 6400 {
		t.Fatal("category mismatch", categories, e)
	}
}
func TestProjectSelectionAndLiteralUnicodeSearch(t *testing.T) {
	s := testStore(t)
	normal := account(t, s, "日常", "normal", 0)
	project := account(t, s, "旅行", "project", 0)
	transaction(t, s, TransactionInput{Type: "expense", Amount: 100, AccountID: normal.ID, Date: "2026-09-01", Title: pointer("ÉCOLE 100%_ ΟΣ İ")})
	transaction(t, s, TransactionInput{Type: "transfer", Amount: 200, AccountID: normal.ID, ToAccountID: &project.ID, Date: "2026-09-01"})
	transaction(t, s, TransactionInput{Type: "expense", Amount: 300, AccountID: project.ID, Date: "2026-09-01"})
	for _, tc := range []struct {
		scope string
		ids   []string
		count int64
	}{{"all", nil, 3}, {"exclude", nil, 1}, {"selected", []string{normal.ID}, 1}, {"selected", []string{project.ID}, 2}} {
		page, e := s.QueryTransactions(testContext, TransactionQuery{Filter: TransactionFilter{ProjectScope: tc.scope, AccountIDs: tc.ids}})
		if e != nil || page.TotalCount != tc.count {
			t.Fatalf("scope %+v: %d %v", tc, page.TotalCount, e)
		}
	}
	for _, keyword := range []string{"école", "%_", "ος", "i\u0307", "\ufeffécole\ufeff"} {
		page, e := s.QueryTransactions(testContext, TransactionQuery{Filter: TransactionFilter{Keyword: keyword, SearchFields: []string{"title"}}})
		if e != nil || page.TotalCount != 1 {
			t.Fatalf("keyword %q: %d %v", keyword, page.TotalCount, e)
		}
	}
}
func TestDatePreservationAndCalendar(t *testing.T) {
	s := testStore(t)
	a := account(t, s, "日常", "normal", 0)
	input := TransactionInput{Type: "expense", Amount: 100, AccountID: a.ID, Date: "2024-02-28"}
	v := transaction(t, s, input)
	midnight, _ := ParseDate(input.Date)
	original := midnight.UnixMilli() + 18*3600000
	if _, e := s.db.Exec("UPDATE txn SET time=? WHERE id=?", original, v.ID); e != nil {
		t.Fatal(e)
	}
	input.Note = pointer("只改备注")
	edited, e := s.SaveTransaction(testContext, v.ID, input)
	if e != nil || edited.Time != original {
		t.Fatal("lost historical time", e, edited.Time)
	}
	transaction(t, s, TransactionInput{Type: "expense", Amount: 300, AccountID: a.ID, Date: "2024-03-01"})
	daily, e := s.DailyStatistics(testContext, DailyQuery{Filter: TransactionFilter{DateFrom: "2024-02-28", DateTo: "2024-03-01"}})
	if e != nil || len(daily.Days) != 3 || daily.Days[1].Date != "2024-02-29" || daily.Days[1].Expense != 0 || daily.Total != 400 || daily.Days[2].Level != 8 {
		t.Fatalf("calendar: %+v %v", daily, e)
	}
	summary, e := s.Summary(testContext, SummaryQuery{})
	if e != nil || summary.Annual.SpanDays != 1 || summary.Annual.Amount == nil || *summary.Annual.Amount != 146000 {
		t.Fatalf("annual: %+v %v", summary, e)
	}
}
func TestBatchAtomicityAndReferences(t *testing.T) {
	s := testStore(t)
	a := account(t, s, "现金", "normal", 0)
	request := BatchRequest{Rows: []BatchRow{{Line: 1, AmountInput: "10.25", Title: "早餐", AccountID: a.ID, Date: "2026-09-01"}, {Line: 2, AmountInput: "+20", Title: "退款", AccountID: "missing", Date: "2026-09-01"}}}
	preview, e := s.PreviewBatch(testContext, request)
	if e != nil || preview.Valid || len(preview.Rows[1].Errors) == 0 {
		t.Fatal("preview", preview, e)
	}
	_, e = s.SaveBatch(testContext, request)
	requireCode(t, e, "VALIDATION")
	summary, _ := s.Summary(testContext, SummaryQuery{})
	if summary.TotalCount != 0 {
		t.Fatal("partial batch")
	}
	request.Rows[1].AccountID = a.ID
	result, e := s.SaveBatch(testContext, request)
	if e != nil || !result.Valid || result.Expense != 1025 || result.Income != 2000 {
		t.Fatal("batch", result, e)
	}
	if e = s.ReorderAccounts(testContext, []string{a.ID, a.ID}); e == nil {
		t.Fatal("duplicate order accepted")
	}
}
func TestMissingDatabaseIsNotInitialized(t *testing.T) {
	path := filepath.Join(t.TempDir(), "missing.sqlite")
	if s, e := Open(path, false); e == nil {
		s.Close()
		t.Fatal("missing DB accepted")
	}
	s, e := Open(path, true)
	if e != nil {
		t.Fatal(e)
	}
	s.Close()
	if s, e = Open(path, true); e == nil {
		s.Close()
		t.Fatal("existing DB replaced")
	}
}

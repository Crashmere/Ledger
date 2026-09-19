// Package ledger 实现账本规则和 SQLite 读写，不依赖 HTTP 或页面名称。
package ledger

const MaxCents int64 = 9007199254740991

type Account struct {
	ID               string  `json:"id"`
	Name             string  `json:"name"`
	Color            int64   `json:"color"`
	Icon             *string `json:"icon"`
	InitialBalance   int64   `json:"initialBalance"`
	IncludeInBalance bool    `json:"includeInBalance"`
	OrderNum         float64 `json:"orderNum"`
	Kind             string  `json:"kind"`
	PeriodStart      *int64  `json:"periodStart"`
	PeriodEnd        *int64  `json:"periodEnd"`
	ArchivedAt       *int64  `json:"archivedAt"`
	CreatedAt        int64   `json:"createdAt"`
	UpdatedAt        int64   `json:"updatedAt"`
	Balance          int64   `json:"balance"`
}
type AccountInput struct {
	Name             string  `json:"name"`
	Color            int64   `json:"color"`
	InitialBalance   int64   `json:"initialBalance"`
	IncludeInBalance bool    `json:"includeInBalance"`
	Kind             string  `json:"kind"`
	PeriodStart      *string `json:"periodStart"`
	PeriodEnd        *string `json:"periodEnd"`
	Archived         bool    `json:"archived"`
}
type AccountsResult struct {
	Items        []Account `json:"items"`
	TotalBalance int64     `json:"totalBalance"`
}
type Category struct {
	ID        string  `json:"id"`
	AccountID string  `json:"accountId"`
	Name      string  `json:"name"`
	Color     int64   `json:"color"`
	Icon      *string `json:"icon"`
	OrderNum  float64 `json:"orderNum"`
	CreatedAt int64   `json:"createdAt"`
}
type CategoryInput struct {
	AccountID string `json:"accountId"`
	Name      string `json:"name"`
	Color     int64  `json:"color"`
}
type Transaction struct {
	ID          string  `json:"id"`
	Type        string  `json:"type"`
	Amount      int64   `json:"amount"`
	AccountID   string  `json:"accountId"`
	ToAccountID *string `json:"toAccountId"`
	CategoryID  *string `json:"categoryId"`
	Time        int64   `json:"time"`
	Date        string  `json:"date"`
	Title       *string `json:"title"`
	Note        *string `json:"note"`
	CreatedAt   int64   `json:"createdAt"`
	UpdatedAt   int64   `json:"updatedAt"`
}
type TransactionInput struct {
	Type        string  `json:"type"`
	Amount      int64   `json:"amount"`
	AccountID   string  `json:"accountId"`
	ToAccountID *string `json:"toAccountId"`
	CategoryID  *string `json:"categoryId"`
	Date        string  `json:"date"`
	Title       *string `json:"title"`
	Note        *string `json:"note"`
}

// TransactionFilter 不包含分页：列表、汇总和图表必须共享同一完整匹配集。
type TransactionFilter struct {
	DateFrom     string   `json:"dateFrom,omitempty"`
	DateTo       string   `json:"dateTo,omitempty"`
	Types        []string `json:"types,omitempty"`
	AccountIDs   []string `json:"accountIds,omitempty"`
	CategoryIDs  []string `json:"categoryIds,omitempty"`
	AmountMin    *int64   `json:"amountMin,omitempty"`
	AmountMax    *int64   `json:"amountMax,omitempty"`
	Keyword      string   `json:"keyword,omitempty"`
	SearchFields []string `json:"searchFields,omitempty"`
	ExcludedIDs  []string `json:"excludedIds,omitempty"`
	ProjectScope string   `json:"projectScope,omitempty"`
}
type TransactionQuery struct {
	Filter           TransactionFilter `json:"filter"`
	Page             int               `json:"page"`
	PageSize         int               `json:"pageSize"`
	SortBy           string            `json:"sortBy"`
	SortDir          string            `json:"sortDir"`
	IncludeDayTotals bool              `json:"includeDayTotals"`
}
type DayTotal struct {
	Income  int64 `json:"income"`
	Expense int64 `json:"expense"`
	Count   int64 `json:"count"`
}
type TransactionPage struct {
	Items      []Transaction       `json:"items"`
	Page       int                 `json:"page"`
	PageSize   int                 `json:"pageSize"`
	TotalCount int64               `json:"totalCount"`
	DayTotals  map[string]DayTotal `json:"dayTotals,omitempty"`
}
type SummaryQuery struct {
	Filter        TransactionFilter `json:"filter"`
	FlowAccountID string            `json:"flowAccountId,omitempty"`
}
type Annual struct {
	Amount   *int64 `json:"amount"`
	SpanDays int64  `json:"spanDays"`
	Count    int64  `json:"count"`
}
type Summary struct {
	Income        int64  `json:"income"`
	Expense       int64  `json:"expense"`
	Net           int64  `json:"net"`
	TotalCount    int64  `json:"totalCount"`
	IncomeCount   int64  `json:"incomeCount"`
	ExpenseCount  int64  `json:"expenseCount"`
	TransferCount int64  `json:"transferCount"`
	Inflow        int64  `json:"inflow"`
	Outflow       int64  `json:"outflow"`
	Annual        Annual `json:"annual"`
}
type CategoryQuery struct {
	Filter    TransactionFilter `json:"filter"`
	GroupBy   string            `json:"groupBy"`
	Direction string            `json:"direction"`
}
type CategoryTotal struct {
	ID           *string `json:"id"`
	Name         string  `json:"name"`
	Income       int64   `json:"income"`
	Expense      int64   `json:"expense"`
	IncomeCount  int64   `json:"incomeCount"`
	ExpenseCount int64   `json:"expenseCount"`
	Latest       int64   `json:"latest"`
}
type DailyQuery struct {
	Filter TransactionFilter `json:"filter"`
}
type DailyTotal struct {
	Date          string `json:"date"`
	Time          int64  `json:"time"`
	Income        int64  `json:"income"`
	Expense       int64  `json:"expense"`
	IncomeCount   int64  `json:"incomeCount"`
	ExpenseCount  int64  `json:"expenseCount"`
	TransferCount int64  `json:"transferCount"`
	Level         int    `json:"level"`
}
type DailyResult struct {
	Days         []DailyTotal `json:"days"`
	StartWeekday int          `json:"startWeekday"`
	WeekCount    int          `json:"weekCount"`
	Total        int64        `json:"total"`
	ActiveDays   int          `json:"activeDays"`
}

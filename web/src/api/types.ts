// 与 Go model.go 对应。金额单位为整数分，账目日期统一使用北京时间。
export type Id = string;
export type Cents = number;
export type TxnType = 'income' | 'expense' | 'transfer';
export type AccountKind = 'normal' | 'project';
export interface Account {
  id: Id; name: string; color: number; icon: string | null;
  initialBalance: Cents; includeInBalance: boolean; orderNum: number;
  kind: AccountKind; periodStart: number | null; periodEnd: number | null;
  archivedAt: number | null; createdAt: number; updatedAt: number; balance: Cents;
}
export interface AccountInput {
  name: string; color: number; initialBalance: Cents; includeInBalance: boolean;
  kind: AccountKind; periodStart: string | null; periodEnd: string | null; archived: boolean;
}
export interface Category {
  id: Id; accountId: Id; name: string; color: number; icon: string | null; orderNum: number; createdAt: number;
}
export interface Transaction {
  fabricWorldEligible?: boolean;
  id: Id; type: TxnType; amount: Cents; accountId: Id; toAccountId: Id | null;
  categoryId: Id | null; time: number; date: string; title: string | null; note: string | null;
  createdAt: number; updatedAt: number;
}
export interface TransactionInput {
  type: TxnType; amount: Cents; accountId: Id; toAccountId: Id | null;
  categoryId: Id | null; date: string; title: string | null; note: string | null;
}
export interface TransactionFilter {
  dateFrom?: string; dateTo?: string; types?: TxnType[]; accountIds?: Id[];
  categoryIds?: Id[]; amountMin?: Cents; amountMax?: Cents;
  keyword?: string; searchFields?: ('title' | 'note' | 'category')[];
  excludedIds?: Id[]; projectScope?: 'all' | 'exclude' | 'selected';
}
export interface TransactionQuery {
  filter: TransactionFilter; page?: number; pageSize?: number;
  sortBy?: 'time' | 'amount'; sortDir?: 'asc' | 'desc'; includeDayTotals?: boolean;
}
export interface DayTotal { income: Cents; expense: Cents; count: number }
export interface TransactionPage {
  items: Transaction[]; page: number; pageSize: number; totalCount: number;
  dayTotals?: Record<string, DayTotal>;
}
export interface Summary {
  income: Cents; expense: Cents; net: Cents; totalCount: number;
  incomeCount: number; expenseCount: number; transferCount: number;
  inflow: Cents; outflow: Cents; annual: { amount: Cents | null; spanDays: number; count: number };
}
export interface CategoryTotal {
  id: Id | null; name: string; income: Cents; expense: Cents;
  incomeCount: number; expenseCount: number; latest: number;
}
export interface DailyTotal {
  date: string; time: number; income: Cents; expense: Cents;
  incomeCount: number; expenseCount: number; transferCount: number; level: number;
}
export interface DailyResult {
  days: DailyTotal[]; startWeekday: number; weekCount: number; total: Cents; activeDays: number;
}
export interface BatchRow {
  line: number; amountInput: string; title: string; note: string;
  accountId: Id; categoryId: Id | null; date: string;
}
export interface BatchPreview {
  fabricWorldTransactions?: Transaction[];
  rows: { line: number; transaction: TransactionInput | null; errors: string[] }[];
  income: Cents; expense: Cents; valid: boolean; count: number;
}

import { request } from './client';
import type { Account, AccountInput, Category, Tag, TransactionInput, TransactionQuery, TransactionPage,
  TxnWithTags, TransactionFilter, Summary, CategoryTotal, DailyResult, BatchRow, BatchPreview } from './types';
export * from './types';
export { AppError } from './client';
export { format, yuanToCents, centsToYuan } from '../services/money';

const idPath = (id: string) => encodeURIComponent(id);
export const ledgerInfo = () => request<{ timezone: string; today: string; earliestMonth: string | null }>('/ledger/info');
export const accountService = {
  list: () => request<{ items: Account[]; totalBalance: number }>('/accounts'),
  create: (input: AccountInput) => request<Account>('/accounts', 'POST', input),
  update: (id: string, input: AccountInput) => request<Account>('/accounts/' + idPath(id), 'PUT', input),
  remove: (id: string) => request('/accounts/' + idPath(id), 'DELETE'),
  reorder: (ids: string[]) => request('/accounts/reorder', 'POST', { ids }),
};
export const categoryService = {
  list: () => request<Category[]>('/categories'),
  listByAccount: (id: string) => request<Category[]>('/categories?accountId=' + idPath(id)),
  create: (input: { accountId: string; name: string; color: number }) => request<Category>('/categories', 'POST', input),
  update: (id: string, input: { name: string; color: number }) => request<Category>('/categories/' + idPath(id), 'PUT', input),
  remove: (id: string) => request('/categories/' + idPath(id), 'DELETE'),
  reorder: (id: string, ids: string[]) => request('/accounts/' + idPath(id) + '/categories/reorder', 'POST', { ids }),
};
export const tagService = {
  list: () => request<Tag[]>('/tags'),
  create: (input: { name: string; color: number }) => request<Tag>('/tags', 'POST', input),
  update: (id: string, input: { name: string; color: number }) => request<Tag>('/tags/' + idPath(id), 'PUT', input),
  remove: (id: string) => request('/tags/' + idPath(id), 'DELETE'),
};
export const txnService = {
  get: (id: string) => request<TxnWithTags>('/transactions/' + idPath(id)),
  query: (input: TransactionQuery) => request<TransactionPage>('/transactions/query', 'POST', input),
  create: (input: TransactionInput) => request<TxnWithTags>('/transactions', 'POST', input),
  update: (id: string, input: TransactionInput) => request<TxnWithTags>('/transactions/' + idPath(id), 'PUT', input),
  remove: (id: string) => request('/transactions/' + idPath(id), 'DELETE'),
  preview: (rows: BatchRow[]) => request<BatchPreview>('/transactions/batch/preview', 'POST', { rows }),
  batch: (rows: BatchRow[]) => request<BatchPreview>('/transactions/batch', 'POST', { rows }),
};
export const statsService = {
  summary: (filter: TransactionFilter, flowAccountId?: string) => request<Summary>('/statistics/summary', 'POST', { filter, flowAccountId }),
  categories: (filter: TransactionFilter, groupBy: 'id' | 'name', direction: 'income' | 'expense') =>
    request<CategoryTotal[]>('/statistics/categories', 'POST', { filter, groupBy, direction }),
  daily: (filter: TransactionFilter) => request<DailyResult>('/statistics/daily', 'POST', { filter }),
};
export function emptySummary(): Summary {
  return { income: 0, expense: 0, net: 0, totalCount: 0, incomeCount: 0, expenseCount: 0,
    transferCount: 0, inflow: 0, outflow: 0, annual: { amount: null, spanDays: 0, count: 0 } };
}

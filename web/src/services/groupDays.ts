import type { TxnWithTags, DayTotal } from '../api/types';
import { dayLabel } from './dates';
export interface DayGroup { key: string; label: string; expense: number; income: number; items: TxnWithTags[] }
// 只对当前页分组排版；日小计来自后端完整筛选集，跨页时不会少算。
export function groupDays(items: TxnWithTags[], totals: Record<string, DayTotal>): DayGroup[] {
  const groups = new Map<string, DayGroup>();
  for (const txn of items) {
    let group = groups.get(txn.date);
    if (!group) {
      group = { key: txn.date, label: dayLabel(txn.date), income: totals[txn.date]?.income ?? 0,
        expense: totals[txn.date]?.expense ?? 0, items: [] };
      groups.set(txn.date, group);
    }
    group.items.push(txn);
  }
  return [...groups.values()];
}

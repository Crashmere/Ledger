// ============================================================
// stats.test.ts —— S9 StatsService.breakdownByCategory / trend 单测
// ============================================================
// 覆盖 S9 任务书 §六.12 必测点：
//   ① 转账被排除（breakdown / trend 均不含 transfer）
//   ② 跨账户同名分类合并为一行（按 category.name）
//   ③ 无分类交易归入固定占位名 '未分类'
//   ④ 时区分桶正确（本地时区、跨月/跨日边界；日/月粒度）
//   附：amount 降序、accountIds/time 过滤、types 交集（transfer 恒排除）。
// 复用 S1 的 better-sqlite3 内存库夹具（每用例独立库、开外键）。
// ============================================================

import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { BetterSqliteAdapter, makeTestAdapter } from './better-sqlite-adapter';
import {
  AccountServiceImpl,
  CategoryServiceImpl,
  StatsServiceImpl,
  TxnServiceImpl,
} from '../src/services';
import { bucketOf, buildExpenseHeatmap, EXPENSE_HEATMAP_LEVEL_COUNT } from '../src/services/stats';
import type { Id } from '../src/services/contract';

let adapter: BetterSqliteAdapter;
let accounts: AccountServiceImpl;
let categories: CategoryServiceImpl;
let txns: TxnServiceImpl;
let stats: StatsServiceImpl;

beforeEach(async () => {
  adapter = await makeTestAdapter();
  accounts = new AccountServiceImpl(adapter);
  categories = new CategoryServiceImpl(adapter);
  txns = new TxnServiceImpl(adapter);
  stats = new StatsServiceImpl(adapter);
});

afterEach(() => {
  adapter.close();
});

// ------------------------------------------------------------
// breakdownByCategory
// ------------------------------------------------------------
describe('StatsService.breakdownByCategory', () => {
  it('跨账户同名分类按 name 合并为一行，金额为二者之和', async () => {
    const a = await accounts.create({ name: 'A', color: 1 });
    const b = await accounts.create({ name: 'B', color: 2 });
    // 两个不同账户下都有一个叫「食物」的分类。
    const foodA = await categories.create({ accountId: a.id, name: '食物', color: 1 });
    const foodB = await categories.create({ accountId: b.id, name: '食物', color: 2 });

    await txns.create({ type: 'expense', amount: 1000, accountId: a.id, categoryId: foodA.id });
    await txns.create({ type: 'expense', amount: 400, accountId: b.id, categoryId: foodB.id });

    const rows = await stats.breakdownByCategory({ types: ['expense'] });
    const food = rows.filter((r) => r.categoryName === '食物');
    expect(food).toHaveLength(1);
    expect(food[0].amount).toBe(1400);
    expect(food[0].count).toBe(2);
  });

  it('转账被排除：加/减一笔转账不影响 breakdown 数字', async () => {
    const a = await accounts.create({ name: 'A', color: 1 });
    const b = await accounts.create({ name: 'B', color: 2 });
    const cat = await categories.create({ accountId: a.id, name: '房租', color: 1 });
    await txns.create({ type: 'expense', amount: 2200, accountId: a.id, categoryId: cat.id });

    const before = await stats.breakdownByCategory({ types: ['expense'] });
    await txns.create({ type: 'transfer', amount: 9999, accountId: a.id, toAccountId: b.id });
    const after = await stats.breakdownByCategory({ types: ['expense'] });

    expect(after).toEqual(before);
    expect(after.reduce((s, r) => s + r.amount, 0)).toBe(2200);
  });

  it('无分类交易归入「未分类」一行', async () => {
    const a = await accounts.create({ name: 'A', color: 1 });
    await txns.create({ type: 'expense', amount: 500, accountId: a.id }); // 无 categoryId
    await txns.create({ type: 'expense', amount: 300, accountId: a.id });

    const rows = await stats.breakdownByCategory({ types: ['expense'] });
    const uncat = rows.filter((r) => r.categoryName === '未分类');
    expect(uncat).toHaveLength(1);
    expect(uncat[0].amount).toBe(800);
    expect(uncat[0].count).toBe(2);
  });

  it('按 amount 降序返回', async () => {
    const a = await accounts.create({ name: 'A', color: 1 });
    const c1 = await categories.create({ accountId: a.id, name: '小', color: 1 });
    const c2 = await categories.create({ accountId: a.id, name: '大', color: 2 });
    await txns.create({ type: 'expense', amount: 100, accountId: a.id, categoryId: c1.id });
    await txns.create({ type: 'expense', amount: 900, accountId: a.id, categoryId: c2.id });

    const rows = await stats.breakdownByCategory({ types: ['expense'] });
    expect(rows.map((r) => r.categoryName)).toEqual(['大', '小']);
    expect(rows.map((r) => r.amount)).toEqual([900, 100]);
  });

  it('types 交集：只传 transfer 时结果为空（transfer 恒排除）', async () => {
    const a = await accounts.create({ name: 'A', color: 1 });
    const b = await accounts.create({ name: 'B', color: 2 });
    await txns.create({ type: 'transfer', amount: 500, accountId: a.id, toAccountId: b.id });
    const rows = await stats.breakdownByCategory({ types: ['transfer'] });
    expect(rows).toEqual([]);
  });

  it('不传 types 时收支都统计（income+expense 各成组）', async () => {
    const a = await accounts.create({ name: 'A', color: 1 });
    const salary = await categories.create({ accountId: a.id, name: '工资', color: 1 });
    const food = await categories.create({ accountId: a.id, name: '食物', color: 2 });
    await txns.create({ type: 'income', amount: 7000, accountId: a.id, categoryId: salary.id });
    await txns.create({ type: 'expense', amount: 1200, accountId: a.id, categoryId: food.id });

    const rows = await stats.breakdownByCategory({});
    const names = rows.map((r) => r.categoryName).sort();
    expect(names).toEqual(['工资', '食物']);
  });

  it('支持 accountIds / timeFrom / timeTo 过滤', async () => {
    const a = await accounts.create({ name: 'A', color: 1 });
    const b = await accounts.create({ name: 'B', color: 2 });
    const ca = await categories.create({ accountId: a.id, name: 'A食', color: 1 });
    const cb = await categories.create({ accountId: b.id, name: 'B食', color: 2 });
    await txns.create({ type: 'expense', amount: 100, accountId: a.id, categoryId: ca.id, time: 100 });
    await txns.create({ type: 'expense', amount: 200, accountId: b.id, categoryId: cb.id, time: 300 });

    const onlyA = await stats.breakdownByCategory({ types: ['expense'], accountIds: [a.id] });
    expect(onlyA.map((r) => r.categoryName)).toEqual(['A食']);

    const afterT = await stats.breakdownByCategory({ types: ['expense'], timeFrom: 150 });
    expect(afterT.map((r) => r.categoryName)).toEqual(['B食']);
  });
});

// ------------------------------------------------------------
// trend
// ------------------------------------------------------------
/** 本地时间构造 epoch（避免依赖运行环境 TZ 猜测）。 */
function localMs(y: number, m1: number, d: number, h = 0, min = 0): number {
  return new Date(y, m1 - 1, d, h, min, 0, 0).getTime();
}

describe('StatsService.trend', () => {
  it('bucketOf 按本地时区分桶（月/日粒度）', () => {
    const t = localMs(2026, 8, 1, 0, 0); // 本地 8月1日 00:00
    expect(bucketOf(t, 'month')).toBe('2026-08');
    expect(bucketOf(t, 'day')).toBe('2026-08-01');
    const t2 = localMs(2026, 12, 31, 23, 30);
    expect(bucketOf(t2, 'month')).toBe('2026-12');
    expect(bucketOf(t2, 'day')).toBe('2026-12-31');
  });

  it('按月分桶：income/expense 分别聚合，bucket 升序，transfer 排除', async () => {
    const a = await accounts.create({ name: 'A', color: 1 });
    const b = await accounts.create({ name: 'B', color: 2 });
    // 7 月
    await txns.create({ type: 'income', amount: 5000, accountId: a.id, time: localMs(2026, 7, 15) });
    await txns.create({ type: 'expense', amount: 2000, accountId: a.id, time: localMs(2026, 7, 20) });
    // 8 月
    await txns.create({ type: 'income', amount: 7000, accountId: a.id, time: localMs(2026, 8, 3) });
    await txns.create({ type: 'expense', amount: 1200, accountId: a.id, time: localMs(2026, 8, 8) });
    // 转账应被排除
    await txns.create({ type: 'transfer', amount: 9999, accountId: a.id, toAccountId: b.id, time: localMs(2026, 8, 9) });

    const points = await stats.trend({ granularity: 'month' });
    expect(points.map((p) => p.bucket)).toEqual(['2026-07', '2026-08']);
    expect(points[0]).toEqual({ bucket: '2026-07', income: 5000, expense: 2000 });
    expect(points[1]).toEqual({ bucket: '2026-08', income: 7000, expense: 1200 });
  });

  it('按日分桶：跨日边界不串桶', async () => {
    const a = await accounts.create({ name: 'A', color: 1 });
    await txns.create({ type: 'expense', amount: 100, accountId: a.id, time: localMs(2026, 8, 1, 23, 59) });
    await txns.create({ type: 'expense', amount: 200, accountId: a.id, time: localMs(2026, 8, 2, 0, 1) });

    const points = await stats.trend({ granularity: 'day' });
    expect(points.map((p) => p.bucket)).toEqual(['2026-08-01', '2026-08-02']);
    expect(points[0].expense).toBe(100);
    expect(points[1].expense).toBe(200);
  });

  it('月初凌晨的交易归入本月（本地时区，不因 UTC 串到上月）', async () => {
    const a = await accounts.create({ name: 'A', color: 1 });
    // 本地 8 月 1 日 00:00 —— 若误用 UTC strftime，在东八区会串到 7 月。
    await txns.create({ type: 'income', amount: 3000, accountId: a.id, time: localMs(2026, 8, 1, 0, 0) });
    const points = await stats.trend({ granularity: 'month' });
    expect(points).toHaveLength(1);
    expect(points[0].bucket).toBe('2026-08');
    expect(points[0].income).toBe(3000);
  });

  it('支持 accountIds / 时间过滤', async () => {
    const a = await accounts.create({ name: 'A', color: 1 });
    const b = await accounts.create({ name: 'B', color: 2 });
    await txns.create({ type: 'income', amount: 1000, accountId: a.id, time: localMs(2026, 8, 5) });
    await txns.create({ type: 'income', amount: 500, accountId: b.id, time: localMs(2026, 8, 6) });

    const onlyA = await stats.trend({ granularity: 'month', accountIds: [a.id as Id] });
    expect(onlyA).toHaveLength(1);
    expect(onlyA[0].income).toBe(1000);
  });
});

describe('buildExpenseHeatmap', () => {
  it('补齐范围内每一天，按本地周日开始分列，不丢失空白日期', () => {
    const result = buildExpenseHeatmap([], localMs(2026, 8, 1), localMs(2026, 9, 1) - 1);
    expect(result.days).toHaveLength(31);
    expect(result.startWeekday).toBe(6);
    expect(result.weekCount).toBe(6);
    expect(result.days[0].date).toBe('2026-08-01');
    expect(result.days[30].date).toBe('2026-08-31');
    expect(result.days.every((day) => day.amount === 0 && day.count === 0 && day.level === 0)).toBe(true);
    expect(result.activeDays).toBe(0);
    expect(result.total).toBe(0);
  });

  it('只累加闭区间内的支出整数分，收入和转账不影响金额与支出天数', () => {
    const from = localMs(2026, 8, 1);
    const to = localMs(2026, 8, 3) - 1;
    const result = buildExpenseHeatmap([
      { type: 'expense', amount: 928, time: from },
      { type: 'expense', amount: 780, time: from + 1000 },
      { type: 'expense', amount: 1, time: to },
      { type: 'expense', amount: 9999, time: from - 1 },
      { type: 'expense', amount: 9999, time: to + 1 },
      { type: 'income', amount: 9999, time: from },
      { type: 'transfer', amount: 9999, time: to },
    ], from, to);
    expect(result.total).toBe(1709);
    expect(result.activeDays).toBe(2);
    expect(result.days.map((day) => [day.amount, day.count])).toEqual([[1708, 2], [1, 1]]);
  });

  it('对数八档细分日常小额，大额支出不再把它们都压进最低档', () => {
    const amounts = [1, 100, 500, 1000, 2000, 5000, 10000, 50000, 100000, 1000000];
    const result = buildExpenseHeatmap(amounts.map((amount, i) => ({
      type: 'expense', amount, time: localMs(2026, 8, i + 1),
    })), localMs(2026, 8, 1), localMs(2026, 8, 12) - 1);
    expect(result.days.map((day) => day.level)).toEqual([1, 1, 2, 3, 3, 4, 5, 6, 7, 8, 0]);
    expect(result.days.slice(0, amounts.length).map((day) => day.amount)).toEqual(amounts);
    expect(result.total).toBe(amounts.reduce((sum, amount) => sum + amount, 0));
    expect(result.activeDays).toBe(amounts.length);
  });

  it('分级随金额单调递增、同额同色，空白日期不影响色阶', () => {
    const amounts = [1, 2, 10, 100, 100, 200, 1000, 10000, 1000000];
    const txns = amounts.map((amount, i) => ({
      type: 'expense' as const, amount, time: localMs(2026, 8, i + 1),
    }));
    const result = buildExpenseHeatmap(txns, localMs(2026, 8, 1), localMs(2026, 8, 10) - 1);
    const levels = result.days.map((day) => day.level);
    expect(levels).toEqual([...levels].sort((a, b) => a - b));
    expect(levels[3]).toBe(levels[4]);
    expect(levels.at(-1)).toBe(EXPENSE_HEATMAP_LEVEL_COUNT);
    expect(levels.every((level) => Number.isInteger(level) && level >= 1 && level <= EXPENSE_HEATMAP_LEVEL_COUNT)).toBe(true);
    const extended = buildExpenseHeatmap(txns, localMs(2026, 8, 1), localMs(2026, 9, 1) - 1);
    expect(extended.days.slice(0, amounts.length)).toEqual(result.days);
  });

  it('单笔一分钱和全部同额时仍有有效最高档，不产生 NaN', () => {
    for (const amounts of [[1], [100, 100, 100]]) {
      const result = buildExpenseHeatmap(amounts.map((amount, i) => ({
        type: 'expense', amount, time: localMs(2026, 8, i + 1),
      })), localMs(2026, 8, 1), localMs(2026, 8, amounts.length + 1) - 1);
      expect(result.days.map((day) => day.level)).toEqual(amounts.map(() => EXPENSE_HEATMAP_LEVEL_COUNT));
    }
  });

  it('覆盖闰年、跨年和跨多个年份的范围，不截断为一年', () => {
    const leap = buildExpenseHeatmap([], localMs(2024, 2, 1), localMs(2024, 3, 1) - 1);
    expect(leap.days).toHaveLength(29);
    expect(leap.days[28].date).toBe('2024-02-29');
    const crossYear = buildExpenseHeatmap([], localMs(2025, 12, 31), localMs(2026, 1, 2) - 1);
    expect(crossYear.days.map((day) => day.date)).toEqual(['2025-12-31', '2026-01-01']);
    const twoYears = buildExpenseHeatmap([], localMs(2024, 1, 1), localMs(2026, 1, 1) - 1);
    expect(twoYears.days).toHaveLength(731);
  });

  it('夏令时切换周按日历递增，每个日期只出现一次', () => {
    for (const month of [3, 11]) {
      const result = buildExpenseHeatmap([], localMs(2026, month, 1), localMs(2026, month, 16) - 1);
      expect(result.days).toHaveLength(15);
      expect(new Set(result.days.map((day) => day.date)).size).toBe(15);
      expect(result.days.every((day) => new Date(day.time).getHours() === 0)).toBe(true);
    }
  });

  it('日期倒置或无效时返回空图，单日范围保留一个方块', () => {
    for (const [from, to] of [[2, 1], [NaN, 1], [0, Infinity]]) {
      expect(buildExpenseHeatmap([], from, to)).toEqual({
        days: [], startWeekday: 0, weekCount: 0, total: 0, activeDays: 0,
      });
    }
    const day = localMs(2026, 8, 2);
    const result = buildExpenseHeatmap([], day, day);
    expect(result.days).toHaveLength(1);
    expect(result.startWeekday).toBe(0);
    expect(result.weekCount).toBe(1);
  });

  it('直接使用报告查询结果，账户、分类、金额与专项条件共同生效', async () => {
    const normal = await accounts.create({ name: '日常', color: 1 });
    const project = await accounts.create({ name: '专项', color: 2, kind: 'project' });
    const food = await categories.create({ accountId: normal.id, name: '餐饮', color: 1 });
    const time = localMs(2026, 8, 1);
    await txns.createMany([
      { type: 'expense', amount: 100, accountId: normal.id, categoryId: food.id, time },
      { type: 'expense', amount: 500, accountId: normal.id, categoryId: food.id, time },
      { type: 'expense', amount: 900, accountId: normal.id, time },
      { type: 'expense', amount: 9999, accountId: project.id, time },
      { type: 'income', amount: 700, accountId: normal.id, categoryId: food.id, time },
    ]);
    const query = { timeFrom: time, timeTo: localMs(2026, 9, 1) - 1 };
    const filtered = await txns.query({ ...query, categoryIds: [food.id], amountMin: 200, excludeProjects: true });
    expect(buildExpenseHeatmap(filtered, query.timeFrom, query.timeTo).total).toBe(500);
    const normalTxns = await txns.query({ ...query, excludeProjects: true });
    expect(buildExpenseHeatmap(normalTxns, query.timeFrom, query.timeTo).total).toBe(1500);
    const projectTxns = await txns.query({ ...query, accountIds: [project.id] });
    expect(buildExpenseHeatmap(projectTxns, query.timeFrom, query.timeTo).total).toBe(9999);
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { effectScope, nextTick, type EffectScope } from 'vue';

const query = vi.hoisted(() => vi.fn());
vi.mock('../src/services', () => ({ txnService: { query } }));

type MonthState = ReturnType<typeof import('../src/composables/useSelectedMonth').useSelectedMonth>;
let month: MonthState;
const scopes: EffectScope[] = [];

beforeEach(async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 8, 13, 12));
  vi.resetModules();
  query.mockReset();
  query.mockResolvedValue([{ time: new Date(2024, 0, 1).getTime() }]);
  const { useSelectedMonth } = await import('../src/composables/useSelectedMonth');
  month = useSelectedMonth();
  await month.refreshBounds();
});

afterEach(() => {
  scopes.splice(0).forEach(scope => scope.stop());
  vi.useRealTimers();
});

async function reportRange() {
  const { useReportRange } = await import('../src/composables/useReportRange');
  const scope = effectScope();
  scopes.push(scope);
  return scope.run(useReportRange)!;
}

function moveTo(year: number, zeroBasedMonth: number): void {
  const target = year * 12 + zeroBasedMonth;
  while (month.selectedMonthIndex.value > target && !month.atEarliestMonth.value) month.prevMonth();
}

describe('共享月份', () => {
  it('默认当前月且多个消费者共享同一选择', async () => {
    expect(month.monthLabel.value).toBe('2026年9月');
    expect(month.periodLabel.value).toBe('本月');
    const { useSelectedMonth } = await import('../src/composables/useSelectedMonth');
    const other = useSelectedMonth();
    month.prevMonth();
    expect(other.monthLabel.value).toBe('2026年8月');
    expect(other.periodLabel.value).toBe('2026年8月');
    other.nextMonth();
    expect(month.monthLabel.value).toBe('2026年9月');
  });

  it('月末使用闭区间，并正确处理跨年和闰年二月', () => {
    moveTo(2026, 0);
    month.prevMonth();
    expect(month.dateFrom.value).toBe('2025-12-01');
    expect(month.dateTo.value).toBe('2025-12-31');
    expect(month.timeTo.value).toBe(new Date(2026, 0, 1).getTime() - 1);
    month.nextMonth();
    expect(month.dateFrom.value).toBe('2026-01-01');
    moveTo(2024, 1);
    expect(month.dateTo.value).toBe('2024-02-29');
    expect(month.timeFrom.value).toBe(new Date(2024, 1, 1).getTime());
    expect(month.timeTo.value).toBe(new Date(2024, 2, 1).getTime() - 1);
  });

  it('不能越过最早记录与当前月，范围内的空月允许停留', async () => {
    query.mockResolvedValue([{ time: new Date(2026, 6, 15).getTime() }]);
    await month.refreshBounds();
    month.nextMonth();
    expect(month.monthLabel.value).toBe('2026年9月');
    month.prevMonth();
    expect(month.monthLabel.value).toBe('2026年8月');
    month.prevMonth();
    month.prevMonth();
    expect(month.monthLabel.value).toBe('2026年7月');
    expect(month.atEarliestMonth.value).toBe(true);
    expect(query).toHaveBeenLastCalledWith({ sortBy: 'time', sortDir: 'asc', limit: 1 });
  });

  it('空账本或只有未来记录时锁定当前月', async () => {
    month.prevMonth();
    query.mockResolvedValue([]);
    await month.refreshBounds();
    expect(month.periodLabel.value).toBe('本月');
    expect(month.atEarliestMonth.value).toBe(true);
    month.prevMonth();
    expect(month.atCurrentMonth.value).toBe(true);
    query.mockResolvedValue([{ time: new Date(2027, 0, 1).getTime() }]);
    await month.refreshBounds();
    expect(month.atEarliestMonth.value).toBe(true);
    expect(month.dateFrom.value).toBe('2026-09-01');
  });

  it('删除早期记录后收紧下界，新增更早记录后重新开放', async () => {
    moveTo(2024, 0);
    query.mockResolvedValue([{ time: new Date(2026, 6, 1).getTime() }]);
    await month.refreshBounds();
    expect(month.dateFrom.value).toBe('2026-07-01');
    query.mockResolvedValue([{ time: new Date(2025, 11, 1).getTime() }]);
    await month.refreshBounds();
    month.prevMonth();
    expect(month.dateFrom.value).toBe('2026-06-01');
  });

  it('过期的范围查询结果不会覆盖新结果', async () => {
    let resolveOld!: (rows: { time: number }[]) => void;
    query.mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve; }));
    const old = month.refreshBounds();
    query.mockResolvedValueOnce([{ time: new Date(2026, 7, 1).getTime() }]);
    await month.refreshBounds();
    resolveOld([{ time: new Date(2020, 0, 1).getTime() }]);
    await old;
    month.prevMonth();
    month.prevMonth();
    expect(month.dateFrom.value).toBe('2026-08-01');
  });

  it('进入新自然月后可向右切换，但不擅自改变已有选择', async () => {
    vi.setSystemTime(new Date(2026, 9, 1));
    await month.refreshBounds();
    expect(month.monthLabel.value).toBe('2026年9月');
    expect(month.atCurrentMonth.value).toBe(false);
    month.nextMonth();
    expect(month.monthLabel.value).toBe('2026年10月');
  });
});

describe('报告时间与共享月份联动', () => {
  it('进入报告时当前月选择本月，历史月填充自定义首末日期', async () => {
    const current = await reportRange();
    expect(current.rangeMode.value).toBe('month');
    month.prevMonth();
    await nextTick();
    expect(current.rangeMode.value).toBe('custom');
    expect(current.customFrom.value).toBe('2026-08-01');
    expect(current.customTo.value).toBe('2026-08-31');
    expect(current.timeFrom.value).toBe(month.timeFrom.value);
    expect(current.timeTo.value).toBe(month.timeTo.value);
    const remounted = await reportRange();
    expect(remounted.rangeMode.value).toBe('custom');
    expect(remounted.customFrom.value).toBe('2026-08-01');
  });

  it('旧选择器最后操作生效，不取交集或反向修改共享月份', async () => {
    month.prevMonth();
    const report = await reportRange();
    report.rangeMode.value = 'year';
    await nextTick();
    expect(report.timeFrom.value).toBe(new Date(2026, 0, 1).getTime());
    expect(report.timeTo.value).toBe(new Date(2027, 0, 1).getTime() - 1);
    expect(month.monthLabel.value).toBe('2026年8月');
    report.rangeMode.value = '30d';
    expect(report.timeFrom.value).toBe(new Date(2026, 7, 15).getTime());
    expect(report.timeTo.value).toBe(new Date(2026, 8, 14).getTime() - 1);
    report.rangeMode.value = 'month';
    expect(report.timeFrom.value).toBe(new Date(2026, 8, 1).getTime());
    expect(month.monthLabel.value).toBe('2026年8月');
    month.prevMonth();
    await nextTick();
    expect(report.rangeMode.value).toBe('custom');
    expect(report.customFrom.value).toBe('2026-07-01');
    expect(report.timeTo.value).toBe(new Date(2026, 7, 1).getTime() - 1);
  });

  it('手动自定义范围跨月生效，再切月份重置；返回当前月使用本月', async () => {
    month.prevMonth();
    const report = await reportRange();
    report.customFrom.value = '2026-06-15';
    report.customTo.value = '2026-09-03';
    await nextTick();
    expect(report.timeFrom.value).toBe(new Date(2026, 5, 15).getTime());
    expect(report.timeTo.value).toBe(new Date(2026, 8, 4).getTime() - 1);
    expect(month.monthLabel.value).toBe('2026年8月');
    month.nextMonth();
    await nextTick();
    expect(report.rangeMode.value).toBe('month');
    expect(report.timeFrom.value).toBe(new Date(2026, 8, 1).getTime());
  });
});

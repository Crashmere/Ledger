import { describe, expect, it } from 'vitest';
import { importDateToEpoch, parseImportAmount, parseTextTransactions } from '../src/services/import/textTransactions';

const sample = `-26.32 滤芯  一个
-9.46 风机支架 一个
-2.21 接口 一个
-3.86 电烙铁 一个
-7 密封圈 两个
-5.86 外丝接口 1个
-6.4 排烟管 1.5米
-19.58 水桶 16L
-139 风机 一个
-16 来塞尔亚麻 2米
-42.75 汉麻 1.7米
-22 亚麻 1.7米
-69 麻本色高支亚麻 3.4 米
-7.2 粒刻蛋白饮 2瓶`;

describe('文本交易导入', () => {
  it('完整解析 14 行示例，合计 37664 分并保留备注空格', () => {
    const rows = parseTextTransactions(sample);
    expect(rows).toHaveLength(14);
    expect(rows.reduce((sum, row) => sum + (parseImportAmount(row.amountInput).amount ?? 0), 0)).toBe(37664);
    expect(rows[0]).toMatchObject({ title: '滤芯', note: '一个', lineNumber: 1 });
    expect(rows[12]).toMatchObject({ title: '麻本色高支亚麻', note: '3.4 米' });
  });

  it('忽略空行但保留原始行号，兼容 CRLF、Tab 和全角空格', () => {
    const rows = parseTextTransactions('\n -9.28\t标题\t备注  内部\t空格 \r\n\r\n7.8　标题二\r+35.35 标题三');
    expect(rows.map((r) => r.lineNumber)).toEqual([2, 4, 5]);
    expect(rows[0]?.note).toBe('备注  内部\t空格');
    expect(rows[1]?.note).toBe('');
  });

  it('格式错误的行不静默丢弃，保留原文供修正', () => {
    const rows = parseTextTransactions('错误行\n-12\nabc 标题 备注');
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({ source: '错误行', title: '' });
    expect(rows[1]).toMatchObject({ amountInput: '-12', title: '' });
    expect(parseImportAmount(rows[2]!.amountInput).error).not.toBeNull();
  });

  it.each([
    ['-9.28', 'expense', 928], ['9.28', 'expense', 928], ['+9.28', 'income', 928],
    ['−6.4', 'expense', 640], ['－6.4', 'expense', 640], ['＋6.4', 'income', 640],
    ['.5', 'expense', 50], ['+35.35', 'income', 3535], [' 7 ', 'expense', 700],
  ])('金额 %s -> %s %i 分', (input, type, amount) => {
    expect(parseImportAmount(input)).toEqual({ type, amount, error: null });
  });

  it.each(['', '0', '-0', '+0.00', '1.001', 'NaN', 'Infinity', '1e3', '0x10', '1,000', '1元', '--2', '- 2', '9'.repeat(400)])(
    '拒绝无效金额 %s', (input) => expect(parseImportAmount(input).error).not.toBeNull(),
  );

  it('日期使用本地零点，支持闰年，拒绝自动溢出的日期', () => {
    expect(importDateToEpoch('2024-02-29')).toBe(new Date(2024, 1, 29).getTime());
    expect(importDateToEpoch('2026-09-11')).toBe(new Date(2026, 8, 11).getTime());
    for (const date of ['2026-02-29', '2026-04-31', '2026-13-01', '2026-00-00', '', '2026-9-1']) {
      expect(importDateToEpoch(date)).toBeNull();
    }
  });
});

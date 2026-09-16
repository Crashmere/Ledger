import { describe, expect, it } from 'vitest';
import { normalizeAmountInput, parseAmountInput } from '../src/services/amountInput';
import { yuanToCents } from '../src/services/money';

describe('手机金额输入', () => {
  it('接受整数、小数以及输入中暂留的小数点', () => {
    for (const [input, expected] of [['12', 12], ['12.', 12], ['0.50', 0.5], ['.5', 0.5], ['0', 0]] as const) {
      expect(parseAmountInput(input)).toBe(expected);
    }
  });

  it('地区键盘的逗号转为小数点，9.28 元保存为 928 分', () => {
    const input = normalizeAmountInput(' 9,28 ');
    expect(input).toBe('9.28');
    expect(yuanToCents(parseAmountInput(input)!)).toBe(928);
  });

  it('拒绝非法或超精度金额，不静默删除字符、截断或计算粘贴的算式', () => {
    for (const input of ['', '.', '1.2.3', '1.234', '12abc', '-12', '1e3', '12+8', '1 000', 'Infinity', '9007199254740992']) {
      expect(parseAmountInput(normalizeAmountInput(input)), input).toBeNull();
    }
  });

  it('多个分隔符不会被悄悄转换成另一笔金额', () => {
    for (const input of ['1,234.56', '1.234,56', '1,2,3']) {
      expect(parseAmountInput(normalizeAmountInput(input))).toBeNull();
    }
  });
});

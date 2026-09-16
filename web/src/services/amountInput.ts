/** 小数键盘可能按系统地区输入逗号。只转换小数分隔符，不丢弃非法字符或截断金额。 */
export function normalizeAmountInput(value: string): string {
  return value.trim().replace(',', '.');
}

/** 手机直接输入元，最多两位小数；禁止把粘贴的算式、负号或科学计数法当作金额。 */
export function parseAmountInput(value: string): number | null {
  if (!/^(?:\d+(?:\.\d{0,2})?|\.\d{1,2})$/.test(value)) return null;
  const amount = Number(value);
  return Number.isFinite(amount) && Number.isSafeInteger(Math.round(amount * 100)) ? amount : null;
}

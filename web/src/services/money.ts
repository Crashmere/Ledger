
import type { Cents } from '../api/types';

/**
 * 元(字符串/数字) -> 分。
 * 用先转字符串定点、再 Math.round 的方式规避二进制浮点误差：
 *   yuanToCents(9.28) === 928，yuanToCents(7.8) === 780。
 */
export function yuanToCents(yuan: string | number): Cents {
  const n = typeof yuan === 'string' ? Number(yuan) : yuan;
  if (!Number.isFinite(n)) {
    throw new Error(`yuanToCents: 非法金额 ${String(yuan)}`);
  }
  return Math.round(Number(n.toFixed(2)) * 100);
}

/**
 * 分 -> 元字符串（用于展示）：780 -> "7.80"。
 * 负数保留符号：-780 -> "-7.80"。
 */
export function centsToYuan(cents: Cents): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(Math.trunc(cents));
  const yuan = Math.floor(abs / 100);
  const fen = abs % 100;
  return `${sign}${yuan}.${fen.toString().padStart(2, '0')}`;
}

/**
 * 格式化带符号金额，供 UI 用。
 *   format(780)                       -> "7.80"
 *   format(780, { sign: true })       -> "+7.80"
 *   format(-780, { sign: true })      -> "-7.80"
 *   format(780, { symbol: '¥' })      -> "¥7.80"
 */
export function format(cents: Cents, opts?: { sign?: boolean; symbol?: string }): string {
  const symbol = opts?.symbol ?? '';
  const body = centsToYuan(Math.abs(cents));
  let signStr = '';
  if (opts?.sign) {
    signStr = cents < 0 ? '-' : '+';
  } else if (cents < 0) {
    signStr = '-';
  }
  return `${signStr}${symbol}${body}`;
}

export const MoneyUtil = {
  yuanToCents,
  centsToYuan,
  format,
} as const;

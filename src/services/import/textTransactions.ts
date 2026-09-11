import { yuanToCents } from '../money';

export interface TextTransaction {
  lineNumber: number;
  source: string;
  amountInput: string;
  title: string;
  note: string;
}

export interface ParsedAmount {
  type: 'expense' | 'income';
  amount: number | null;
  error: string | null;
}

export function parseImportAmount(input: string): ParsedAmount {
  const text = input.trim().replace(/^[−－]/, '-').replace(/^＋/, '+');
  const type = text.startsWith('+') ? 'income' : 'expense';
  if (!/^[+-]?(?:\d+(?:\.\d{1,2})?|\.\d{1,2})$/.test(text)) {
    return { type, amount: null, error: '金额须为数字，最多两位小数（+收入，负号或无符号为支出）' };
  }
  const unsigned = text.replace(/^[+-]/, '');
  if (!Number.isFinite(Number(unsigned)) || Number(unsigned) > Number.MAX_SAFE_INTEGER / 100) {
    return { type, amount: null, error: '金额超出安全范围' };
  }
  const amount = yuanToCents(unsigned);
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    return { type, amount: null, error: '金额须大于 0 且在安全范围内' };
  }
  return { type, amount, error: null };
}

export function parseTextTransactions(text: string): TextTransaction[] {
  const rows: TextTransaction[] = [];
  for (const [index, source] of text.split(/\r\n?|\n/).entries()) {
    const trimmed = source.trim();
    if (!trimmed) continue;
    const parts = /^(\S+)(?:\s+(\S+))?(?:\s+([\s\S]*))?$/.exec(trimmed);
    rows.push({
      lineNumber: index + 1,
      source,
      amountInput: parts?.[1] ?? '',
      title: parts?.[2] ?? '',
      note: parts?.[3] ?? '',
    });
  }
  return rows;
}

export function importDateToEpoch(value: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(0);
  date.setFullYear(year, month - 1, day);
  date.setHours(0, 0, 0, 0);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    return null;
  }
  return date.getTime();
}

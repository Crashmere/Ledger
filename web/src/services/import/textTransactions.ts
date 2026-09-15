
export interface TextTransaction {
  lineNumber: number;
  source: string;
  amountInput: string;
  title: string;
  note: string;
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

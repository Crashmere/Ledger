import type { TransactionFilter } from "../api";

export interface InsightSelection {
  from: string;
  to: string;
  x: number;
  y: number;
}

// Use the same scope as the chart, including partial months/years and exclusions.
export function insightTransactionFilter(
  filter: TransactionFilter,
  from: string,
  to: string,
): TransactionFilter | null {
  const dateFrom = filter.dateFrom && filter.dateFrom > from ? filter.dateFrom : from;
  const dateTo = filter.dateTo && filter.dateTo < to ? filter.dateTo : to;
  const types = (filter.types?.length ? filter.types : ["income", "expense"] as const)
    .filter((type) => type !== "transfer");
  // An empty types array means unrestricted in the API, so do not send it here.
  if (dateFrom > dateTo || !types.length) return null;
  return { ...filter, dateFrom, dateTo, types };
}

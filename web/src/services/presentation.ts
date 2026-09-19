import { format, type Transaction } from "../api";
export const money = (cents: number, sign = false) =>
  format(cents, { sign }).replace(/\d+(?=\.)/, (s) =>
    s.replace(/\B(?=(\d{3})+(?!\d))/g, ","),
  );
export const color = (value: number) =>
  "#" + (value >>> 0).toString(16).padStart(8, "0").slice(2);
export const typeName = (type: string) =>
  ({ expense: "支出", income: "收入", transfer: "转账" })[type] || type;
export const txnAmount = (txn: Transaction) =>
  (txn.type === "expense" ? "−" : txn.type === "income" ? "+" : "") +
  money(txn.amount);

import { describe, expect, it } from "vitest";
import { insightTransactionFilter } from "../src/services/insightTransactions";
import type { TransactionFilter } from "../src/api";

describe("chart transaction scope", () => {
  it("keeps all filters and intersects a partial month without mutating the scope", () => {
    const filter: TransactionFilter = {
      dateFrom: "2026-09-12", dateTo: "2026-09-23", accountIds: ["a"], categoryIds: ["c"],
      keyword: "午餐", searchFields: ["title"], amountMin: 100, amountMax: 20000,
      excludedIds: ["excluded"], projectScope: "selected", types: ["expense", "transfer"],
    };
    expect(insightTransactionFilter(filter, "2026-09-01", "2026-09-30"))
      .toEqual({ ...filter, types: ["expense"] });
    expect(filter.types).toEqual(["expense", "transfer"]);
  });
  it("shows both incomes and expenses by default but never transfers", () => {
    expect(insightTransactionFilter({}, "2026-09-20", "2026-09-20"))
      .toEqual({ dateFrom: "2026-09-20", dateTo: "2026-09-20", types: ["income", "expense"] });
    expect(insightTransactionFilter({ types: ["income"] }, "2026-01-01", "2026-12-31")?.types)
      .toEqual(["income"]);
  });
  it("does not turn a transfer-only or disjoint scope into unrestricted results", () => {
    expect(insightTransactionFilter({ types: ["transfer"] }, "2026-09-01", "2026-09-30")).toBeNull();
    expect(insightTransactionFilter({ dateFrom: "2026-10-01" }, "2026-09-01", "2026-09-30")).toBeNull();
  });
});

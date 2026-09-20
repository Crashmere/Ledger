import { describe, expect, it } from "vitest";
import type { DailyTotal } from "../src/api";
import { calendarMonths, trendSeries } from "../src/services/insightData";

function days(from: string, count: number): DailyTotal[] {
  return Array.from({ length: count }, (_, i) => ({
    date: new Date(Date.parse(from + "T00:00:00Z") + i * 86400000)
      .toISOString()
      .slice(0, 10),
    time: 0,
    income: i % 3 ? 0 : 12345,
    expense: 101 + i,
    incomeCount: 1,
    expenseCount: 1,
    transferCount: 0,
    level: 1,
  }));
}

describe("insight display grouping", () => {
  it("keeps daily detail for short ranges and empty results", () => {
    const input = days("2026-09-01", 30);
    const result = trendSeries(input);
    expect(result.unit).toBe("day");
    expect(result.points).toHaveLength(30);
    expect(result.points[0]).toMatchObject({
      key: "2026-09-01",
      from: "2026-09-01",
      to: "2026-09-01",
      expense: 101,
    });
    expect(trendSeries([]).points).toEqual([]);
  });
  it("sums leap-year days into months without changing integer-cent totals", () => {
    const input = days("2024-01-01", 366);
    const result = trendSeries(input);
    expect(result.unit).toBe("month");
    expect(result.points).toHaveLength(12);
    expect(result.points[1]).toMatchObject({
      from: "2024-02-01",
      to: "2024-02-29",
    });
    for (const field of ["income", "expense"] as const)
      expect(result.points.reduce((sum, point) => sum + point[field], 0)).toBe(
        input.reduce((sum, day) => sum + day[field], 0),
      );
  });
  it("distinguishes years and retains partial range boundaries", () => {
    const monthly = trendSeries(days("2025-12-20", 70));
    expect(monthly.points[0]).toMatchObject({
      key: "2025-12",
      label: "2025-12",
      from: "2025-12-20",
      to: "2025-12-31",
    });
    const yearly = trendSeries(days("2023-12-20", 800));
    expect(yearly.unit).toBe("year");
    expect(yearly.points.map((point) => point.key)).toEqual([
      "2023",
      "2024",
      "2025",
      "2026",
    ]);
    expect(yearly.points[0].from).toBe("2023-12-20");
  });
  it("makes bounded month calendars with real weekdays and only selected days", () => {
    const input = days("2023-12-29", 64);
    const months = calendarMonths(input, "2024");
    expect(months.map((month) => month.key)).toEqual([
      "2024-01",
      "2024-02",
      "2024-03",
    ]);
    expect(months[0].offset).toBe(1);
    expect(months[1].days).toHaveLength(29);
    expect(months[1].days.at(-1)?.date).toBe("2024-02-29");
    const partial = calendarMonths(input, "2023")[0];
    expect(partial.offset).toBe(5);
    expect(partial.days.map((day) => day.date)).toEqual([
      "2023-12-29",
      "2023-12-30",
      "2023-12-31",
    ]);
    expect(calendarMonths(input, "2022")).toEqual([]);
  });
});

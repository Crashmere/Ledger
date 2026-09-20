import type { DailyTotal } from "../api";

// Group the server's daily totals only for display; filters and statistics stay on the server.
export function trendSeries(days: DailyTotal[]) {
  const unit =
    days.length <= 62 ? "day" : days.length <= 730 ? "month" : "year";
  const points: {
    key: string;
    label: string;
    from: string;
    to: string;
    income: number;
    expense: number;
  }[] = [];
  const sameYear = days[0]?.date.slice(0, 4) === days.at(-1)?.date.slice(0, 4);
  for (const day of days) {
    const key = day.date.slice(
      0,
      unit === "day" ? 10 : unit === "month" ? 7 : 4,
    );
    let point = points.at(-1);
    if (!point || point.key !== key) {
      const label =
        unit === "day"
          ? day.date.slice(5)
          : unit === "year"
            ? key + "年"
            : sameYear
              ? Number(day.date.slice(5, 7)) + "月"
              : key;
      point = {
        key,
        label,
        from: day.date,
        to: day.date,
        income: 0,
        expense: 0,
      };
      points.push(point);
    }
    point.to = day.date;
    point.income += day.income;
    point.expense += day.expense;
  }
  return { unit, points };
}

export function calendarMonths(days: DailyTotal[], year: string) {
  const months: {
    key: string;
    label: string;
    offset: number;
    days: DailyTotal[];
    expense: number;
  }[] = [];
  for (const day of days) {
    if (!day.date.startsWith(year + "-")) continue;
    const key = day.date.slice(0, 7);
    let month = months.at(-1);
    if (!month || month.key !== key) {
      // Partial months retain their real weekday positions and contain only filtered days.
      month = {
        key,
        label: Number(day.date.slice(5, 7)) + "月",
        offset: new Date(day.date + "T00:00:00Z").getUTCDay(),
        days: [],
        expense: 0,
      };
      months.push(month);
    }
    month.days.push(day);
    month.expense += day.expense;
  }
  return months;
}

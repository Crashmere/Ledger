import { money } from "./presentation";

export function chartMaximum(amounts: number[]) {
  let largest = 100;
  for (const amount of amounts) largest = Math.max(largest, amount);
  const magnitude = 10 ** Math.floor(Math.log10(largest / 4));
  const tick =
    ([1, 2, 2.5, 5, 10].find((value) => value * magnitude >= largest / 4) ?? 10) *
    magnitude;
  return tick * 4;
}

export function chartMoney(cents: number, maximum: number, fractionDigits = 1) {
  return maximum >= 1000000 && cents > 0
    ? (cents / 1000000).toLocaleString("zh-CN", { maximumFractionDigits: fractionDigits }) + "万"
    : money(Math.round(cents)).replace(".00", "");
}

export function annualChartScale(amounts: number[]) {
  let minimum = amounts[0] ?? 0;
  let maximum = minimum;
  for (const amount of amounts) {
    minimum = Math.min(minimum, amount);
    maximum = Math.max(maximum, amount);
  }
  // A one-cent offset keeps rounded zero amounts on the same continuous scale.
  const low = Math.log1p(minimum);
  const high = Math.log1p(maximum);
  const padding = high > low ? (high - low) * 0.08 : Math.log(1.1);
  const start = Math.max(0, low - padding);
  const end = maximum === 0 ? Math.log(2) : high + padding;
  const position = (amount: number) => (Math.log1p(amount) - start) / (end - start);
  const ticks = [...new Set(Array.from({ length: 5 }, (_, i) =>
    Math.round(Math.expm1(start + (end - start) * i / 4)),
  ))];
  const smallestGap = Math.min(...ticks.slice(1).map((tick, i) => tick - ticks[i]));
  const fractionDigits = Math.min(6, Math.max(1, Math.ceil(Math.log10(1000000 / smallestGap))));
  return {
    position,
    ticks,
    label: (amount: number) => chartMoney(amount, maximum, fractionDigits),
  };
}

export function smoothLine(points: { x: number; y: number }[]) {
  if (!points.length) return "";
  const coordinate = (value: number) => Number(value.toFixed(3));
  let path = `M${coordinate(points[0].x)} ${coordinate(points[0].y)}`;
  if (points.length === 1) return path;
  const slopes = points.slice(1).map((point, i) =>
    (point.y - points[i].y) / (point.x - points[i].x),
  );
  // Monotone cubic tangents smooth the line without inventing peaks between days.
  const tangents = points.map((_, i) => {
    if (i === 0) return slopes[0];
    if (i === points.length - 1) return slopes[i - 1];
    const before = slopes[i - 1], after = slopes[i];
    return before * after <= 0 ? 0 : 2 * before * after / (before + after);
  });
  for (let i = 1; i < points.length; i++) {
    const previous = points[i - 1], point = points[i];
    const third = (point.x - previous.x) / 3;
    path += `C${coordinate(previous.x + third)} ${coordinate(previous.y + tangents[i - 1] * third)} ${coordinate(point.x - third)} ${coordinate(point.y - tangents[i] * third)} ${coordinate(point.x)} ${coordinate(point.y)}`;
  }
  return path;
}

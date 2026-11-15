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

export function chartMoney(cents: number, maximum: number) {
  return maximum >= 1000000 && cents > 0
    ? (cents / 1000000).toLocaleString("zh-CN", { maximumFractionDigits: 1 }) + "万"
    : money(Math.round(cents)).replace(".00", "");
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

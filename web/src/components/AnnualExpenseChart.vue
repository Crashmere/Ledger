<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type { Annual } from "../api";
import { money } from "../services/presentation";
import { chartMaximum, chartMoney, smoothLine } from "../services/chart";

const props = defineProps<{ annual: Annual }>();
const days = computed(() => props.annual.days ?? []);
const maximum = computed(() => chartMaximum(days.value.map((day) => day.amount)));
const active = ref<number | null>(null);
watch(days, () => { active.value = null; });
const current = computed(() => days.value[active.value ?? days.value.length - 1]);
const x = (index: number) => days.value.length === 1 ? 325 : 45 + index * 560 / (days.value.length - 1);
const y = (amount: number) => 169 - amount / maximum.value * 144;
const line = computed(() => smoothLine(days.value.map((day, i) => ({ x: x(i), y: y(day.amount) }))));
const area = computed(() => days.value.length > 1
  ? `${line.value}L605 169H45Z` : "");
const axisPoints = computed(() => {
  const count = days.value.length;
  if (!count) return [];
  const ticks = Math.min(5, count);
  const indices = [...new Set(Array.from({ length: ticks }, (_, i) =>
    Math.round(i * (count - 1) / Math.max(1, ticks - 1)),
  ))];
  const sameYear = days.value[0].date.slice(0, 4) === days.value[count - 1].date.slice(0, 4);
  return indices.map((index) => ({
    index,
    label: sameYear ? days.value[index].date.slice(5) : days.value[index].date,
  }));
});
function inspect(event: MouseEvent) {
  const svg = event.currentTarget as SVGSVGElement;
  const matrix = svg.getScreenCTM();
  if (!matrix || !days.value.length) return;
  const point = svg.createSVGPoint();
  point.x = event.clientX;
  point.y = event.clientY;
  const position = point.matrixTransform(matrix.inverse());
  if (position.x < 45 || position.x > 605 || position.y < 15 || position.y > 185) return;
  active.value = Math.max(0, Math.min(days.value.length - 1,
    Math.round((position.x - 45) / 560 * (days.value.length - 1)),
  ));
}
</script>

<template>
  <section class="annual-chart-section">
    <div class="annual-heading">
      <h2>折合全年支出走势</h2>
      <p v-if="days.length">
        {{ days[0].date }} 至 {{ days[days.length - 1].date }} ·
        {{ annual.spanDays }} 天 · 每天一个点
      </p>
    </div>
    <template v-if="current">
      <div class="annual-readout" aria-live="polite">
        <span>{{ current.date }}</span>
        <strong class="num neg">折合全年 {{ money(current.amount) }}</strong>
        <span class="annual-help">悬停或点击查看每日折算值</span>
      </div>
      <svg
        class="annual-chart"
        viewBox="0 0 620 215"
        role="img"
        aria-label="每日累计支出折合全年金额的平滑曲线图"
        :data-point-count="days.length"
        @pointermove="inspect"
        @click="inspect"
        @pointerleave="active = null"
      >
        <g v-for="level in [0, 1, 2, 3, 4]" :key="level">
          <path :d="'M45 ' + (25 + level * 36) + 'H605'" stroke="var(--border)" stroke-dasharray="3 4" />
          <text x="0" :y="29 + level * 36">{{ chartMoney(maximum * (4 - level) / 4, maximum) }}</text>
        </g>
        <path :d="area" fill="var(--expense)" opacity="0.07" />
        <path :d="line" fill="none" stroke="var(--expense)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke" />
        <path v-if="active !== null" :d="'M' + x(active) + ' 25V169'" stroke="var(--expense)" stroke-dasharray="3 4" opacity="0.4" />
        <circle :cx="x(active ?? days.length - 1)" :cy="y(current.amount)" r="3.5" fill="var(--expense)" stroke="var(--surface)" stroke-width="1.5" />
        <text
          v-for="point in axisPoints" :key="point.index"
          :x="x(point.index)" y="202"
          :text-anchor="days.length === 1 ? 'middle' : point.index === 0 ? 'start' : point.index === days.length - 1 ? 'end' : 'middle'"
        >{{ point.label }}</text>
      </svg>
      <p class="annual-formula">截至当天的筛选累计支出 ÷ 已过天数 × 365，含首个支出日与当天</p>
    </template>
    <p v-else class="annual-empty">当前筛选暂无已发生支出</p>
  </section>
</template>

<style scoped>
.annual-chart-section {
  margin-top: 18px;
  border: 1px solid var(--border);
  border-radius: 14px;
  padding: 18px 18px 20px;
  background: #fcfdfa;
  min-width: 0;
}
.annual-heading h2 { font-size: 16px; }
.annual-heading p {
  font-size: 11px;
  color: var(--fg-3);
  margin-top: 5px;
}
.annual-readout {
  min-height: 42px;
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 18px;
  font-size: 10px;
  color: var(--fg-2);
}
.annual-readout strong { font-weight: 500; }
.annual-help, .annual-formula { color: var(--fg-3); }
.annual-chart {
  width: 100%;
  height: 230px;
  display: block;
  max-width: 100%;
}
.annual-chart text { fill: var(--fg-3); font-size: 9px; }
.annual-formula { font-size: 10px; margin-top: 4px; }
.annual-empty { color: var(--fg-3); font-size: 12px; padding: 30px 0; }
@media (max-width: 600px) {
  .annual-chart-section { padding: 14px 10px 12px; }
  .annual-heading h2 { font-size: 14px; }
  .annual-chart { height: 190px; }
  .annual-chart text { font-size: 10px; }
  .annual-readout { font-size: 9px; gap: 8px; min-height: 46px; }
}
</style>

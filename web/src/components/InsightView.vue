<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import type { Summary, DailyResult, CategoryTotal, TransactionFilter } from "../api";
import { money } from "../services/presentation";
import ExpenseHeatmap from "./ExpenseHeatmap.vue";
import InsightTransactions from "./InsightTransactions.vue";
import type { InsightSelection } from "../services/insightTransactions";
import { trendSeries } from "../services/insightData";
import { useMediaQuery } from "../composables/useMediaQuery";
const props = defineProps<{
  summary: Summary;
  daily: DailyResult;
  dailyError?: string;
  categories: CategoryTotal[];
  filter: TransactionFilter;
}>();
const direction = defineModel<"expense" | "income">("direction", {
  required: true,
});
defineEmits<{ drilldown: [name: string] }>();
const selection = ref<InsightSelection | null>(null);
function inspect(from: string, to: string, event: MouseEvent) {
  const target = event.currentTarget as Element;
  const rect = target.getBoundingClientRect();
  selection.value = {
    from, to,
    x: event.detail ? event.clientX : rect.left + rect.width / 2,
    y: event.detail ? event.clientY : rect.top + rect.height / 2,
  };
}
function inspectTrend(index: number, event: MouseEvent) {
  active.value = index;
  const point = trend.value.points[index];
  if (point) inspect(point.from, point.to, event);
}
watch(() => props.daily, () => { selection.value = null; });
// Each response includes both directions; switching only changes this panel.
const breakdowns = computed(() =>
  (["expense", "income"] as const).map((side) => ({
    side,
    total: props.summary[side],
    rows: props.categories
      .filter((c) => c[side] > 0)
      .sort((a, b) => b[side] - a[side] || b.latest - a.latest),
  })),
);
const reducedMotion = useMediaQuery("(prefers-reduced-motion: reduce)");
const switching = ref(false);
let switchTimer: ReturnType<typeof setTimeout> | undefined;
watch(direction, () => {
  clearTimeout(switchTimer);
  switching.value = !reducedMotion.value;
  if (switching.value)
    switchTimer = setTimeout(() => (switching.value = false), 220);
});
onUnmounted(() => clearTimeout(switchTimer));
const trend = computed(() => trendSeries(props.daily.days));
const unitLabel = computed(
  () => ({ day: "日", month: "月", year: "年" })[trend.value.unit],
);
const max = computed(() => {
  const largest = Math.max(
    100,
    ...trend.value.points.flatMap((d) => [d.expense, d.income]),
  );
  const magnitude = 10 ** Math.floor(Math.log10(largest / 4));
  const tick =
    ([1, 2, 2.5, 5, 10].find((value) => value * magnitude >= largest / 4) ??
      10) * magnitude;
  return tick * 4;
});
const active = ref<number | null>(null);
const current = computed(() =>
  active.value === null ? null : trend.value.points[active.value],
);
watch(trend, () => {
  active.value = null;
});
const step = computed(() => 560 / Math.max(1, trend.value.points.length));
const barWidth = computed(() => Math.max(1, Math.min(28, step.value * 0.65)));
const chart = ref<SVGSVGElement | null>(null);
const chartScale = ref(1);
let chartObserver: ResizeObserver | undefined;
onMounted(() => {
  chartObserver = new ResizeObserver(([entry]) => {
    if (!entry) return;
    const scale = Math.min(
      entry.contentRect.width / 620,
      entry.contentRect.height / 215,
    );
    if (scale > 0) chartScale.value = scale;
  });
  if (chart.value) chartObserver.observe(chart.value);
});
// Data loading failures can remove the chart without unmounting this view.
watch(chart, (element, previous) => {
  if (previous) chartObserver?.unobserve(previous);
  if (element) chartObserver?.observe(element);
});
onUnmounted(() => chartObserver?.disconnect());
function barHeight(amount: number) {
  // Keep zero invisible and positive values at least 4 CSS pixels tall after SVG scaling.
  return amount > 0
    ? Math.min(144, Math.max((amount / max.value) * 144, 4 / chartScale.value))
    : 0;
}
const axisPoints = computed(() => {
  const points = trend.value.points;
  const stride = Math.max(1, Math.ceil(points.length / 6));
  return points
    .map((point, index) => ({ ...point, index }))
    .filter((point) => point.index % stride === 0);
});
function axisMoney(cents: number) {
  return max.value >= 1000000 && cents > 0
    ? (cents / 1000000).toLocaleString("zh-CN", { maximumFractionDigits: 1 }) +
        "万"
    : money(Math.round(cents)).replace(".00", "");
}
const tone = (i: number) => "var(--chart-" + ((i % 7) + 1) + ")";
</script>
<template>
  <div class="insight-view">
    <p v-if="dailyError" class="chart-error" role="status">{{ dailyError }}</p>
    <section v-else class="trend-section">
      <div class="insight-heading">
        <div>
          <h2>收支走势</h2>
          <p>
            {{ daily.days.length }} 天 · 按{{ unitLabel }}汇总 ·
            {{ daily.activeDays }} 天有支出
          </p>
        </div>
        <div class="chart-legend">
          <span><i class="income-dot" />收入</span
          ><span><i class="expense-dot" />支出</span>
        </div>
      </div>
      <div class="chart-readout" aria-live="polite">
        <template v-if="current"
          >{{
            current.from === current.to
              ? current.from
              : current.from + " 至 " + current.to
          }}
          <span class="pos">收入 {{ money(current.income) }}</span
          ><span class="neg">支出 {{ money(current.expense) }}</span></template
        ><template v-else
          >按{{ unitLabel }}查看收支
          <span class="chart-help">悬停查看金额 · 点击查看收支明细</span></template
        >
      </div>
      <svg
        ref="chart"
        class="flow-chart"
        viewBox="0 0 620 215"
        role="img"
        :aria-label="'按' + unitLabel + '汇总的收入与支出柱状图'"
      >
        <g v-for="level in [0, 1, 2, 3, 4]" :key="level">
          <path
            :d="'M45 ' + (25 + level * 36) + 'H605'"
            stroke="var(--border)"
            stroke-dasharray="3 4"
          />
          <text x="0" :y="29 + level * 36">
            {{ axisMoney((max * (4 - level)) / 4) }}
          </text>
        </g>
        <g
          v-for="(day, i) in trend.points"
          :key="day.key"
          class="trend-point"
          :data-period="day.key"
          @mouseenter="active = i"
          @click="inspectTrend(i, $event)"
        >
          <rect
            :x="45 + i * step"
            y="15"
            :width="step"
            height="170"
            :fill="active === i ? 'var(--surface-3)' : 'transparent'"
          />
          <rect
            class="income-bar"
            :x="45 + i * step + (step - barWidth) / 2"
            :y="169 - barHeight(day.income)"
            :width="barWidth / 2"
            :height="barHeight(day.income)"
            fill="var(--income)"
            rx="1"
          />
          <rect
            class="expense-bar"
            :x="45 + i * step + step / 2"
            :y="169 - barHeight(day.expense)"
            :width="barWidth / 2"
            :height="barHeight(day.expense)"
            fill="var(--expense)"
            rx="1"
          />
        </g>
        <text
          v-for="point in axisPoints"
          :key="point.key"
          :x="45 + (point.index + 0.5) * step"
          y="202"
          text-anchor="middle"
        >
          {{ point.label }}
        </text>
      </svg>
      <p class="chart-minimum-hint">
        小额收支保留最低可见高度，具体金额以提示为准
      </p>
    </section>
    <div class="insight-bottom">
      <section class="distribution">
        <div class="insight-heading">
          <h2>{{ direction === "expense" ? "钱花在哪里" : "收入来自哪里" }}</h2>
          <div class="direction-tabs">
            <button
              :class="{ on: direction === 'expense' }"
              :aria-pressed="direction === 'expense'"
              @click="direction = 'expense'"
            >
              支出</button
            ><button
              :class="{ on: direction === 'income' }"
              :aria-pressed="direction === 'income'"
              @click="direction = 'income'"
            >
              收入
            </button>
          </div>
        </div>
        <div
          class="distribution-content"
          :aria-busy="switching"
          aria-label="分类统计"
        >
          <div
            v-if="switching"
            class="distribution-switch-status"
            role="status"
            aria-label="正在切换分类统计"
          />
          <div
            v-for="{ side, rows, total } in breakdowns"
            :key="side"
            class="distribution-panel"
            :class="{ 'is-active': direction === side }"
            :aria-hidden="direction !== side"
            :inert="direction !== side || switching"
          >
            <div class="distribution-total">
              <span class="num">{{ money(total) }}</span
              ><small>{{ rows.length }} 个分类</small>
            </div>
            <div class="share-strip" aria-hidden="true">
              <span
                v-for="(row, i) in rows"
                :key="row.name"
                :style="{ flex: row[side], background: tone(i) }"
              />
            </div>
            <div v-if="!rows.length" class="empty">
              当前范围暂无{{ side === "expense" ? "支出" : "收入" }}
            </div>
            <button
              v-for="(row, i) in rows"
              :key="row.name"
              class="category-rank"
              :disabled="row.name === '未分类'"
              @click="$emit('drilldown', row.name)"
            >
              <span class="rank-name"
                ><i :style="{ background: tone(i) }" />{{ row.name }}</span
              ><span class="rank-share"
                >{{ total ? ((row[side] / total) * 100).toFixed(1) : 0 }}%</span
              ><strong class="num">{{ money(row[side]) }}</strong
              ><span class="rank-arrow">↗</span>
            </button>
          </div>
        </div>
      </section>
      <div class="activity-section">
        <div class="annual-inline">
          <span>折合全年支出</span
          ><strong class="num">{{
            summary.annual.amount === null ? "—" : money(summary.annual.amount)
          }}</strong
          ><small>{{
            summary.annual.amount === null
              ? "至少需要两笔不同日期的支出"
              : "基于 " +
                summary.annual.count +
                " 笔支出 · " +
                summary.annual.spanDays +
                " 天"
          }}</small>
        </div>
        <ExpenseHeatmap
          v-if="!dailyError"
          :data="daily"
          @inspect="(date, event) => inspect(date, date, event)"
          @period-change="selection = null"
        />
      </div>
    </div>
    <InsightTransactions v-if="selection" :selection="selection" :filter="filter" @close="selection = null" />
  </div>
</template>
<style scoped>
.chart-error {
  padding: 20px 0;
  font-size: 12px;
  color: var(--fg-2);
}
.insight-view {
  padding-top: 12px;
  min-width: 0;
  container-type: inline-size;
}
.insight-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
}
.insight-heading h2 {
  font-size: 16px;
}
.insight-heading p {
  font-size: 11px;
  color: var(--fg-3);
  margin-top: 5px;
}
.chart-legend {
  display: flex;
  gap: 15px;
  font-size: 10px;
  color: var(--fg-2);
}
.chart-legend span {
  display: flex;
  align-items: center;
  gap: 5px;
}
.chart-legend i {
  width: 6px;
  height: 6px;
  border-radius: 2px;
}
.income-dot {
  background: var(--income);
}
.expense-dot {
  background: var(--expense);
}
.chart-readout {
  min-height: 42px;
  flex-wrap: wrap;
  display: flex;
  align-items: center;
  gap: 18px;
  font-size: 10px;
  color: var(--fg-2);
}
.chart-readout .chart-help {
  color: var(--fg-3);
}
.flow-chart {
  width: 100%;
  height: 230px;
  display: block;
  max-width: 100%;
}
.flow-chart text {
  fill: var(--fg-3);
  font-size: 9px;
}
.trend-point {
  cursor: pointer;
}
.chart-minimum-hint {
  color: var(--fg-3);
  font-size: 10px;
  margin-top: 4px;
}
.trend-section {
  border: 1px solid var(--border);
  border-radius: 14px;
  padding: 18px;
  background: #fcfdfa;
  padding-bottom: 20px;
}
.insight-bottom {
  display: grid;
  grid-template-columns: minmax(0, 0.85fr) minmax(0, 1.15fr);
  gap: 24px;
  padding-top: 24px;
}
.insight-bottom > * {
  min-width: 0;
}
.distribution-content {
  position: relative;
  display: grid;
}
.distribution-panel {
  /* Share a grid cell so switching cannot move the calendar or scroll position. */
  grid-area: 1 / 1;
  min-width: 0;
  align-self: start;
  visibility: hidden;
  opacity: 0;
  transform: translateY(4px);
  pointer-events: none;
  transition:
    opacity 220ms ease,
    transform 220ms var(--ease-out),
    visibility 0s linear 220ms;
}
.distribution-panel.is-active {
  visibility: visible;
  opacity: 1;
  transform: translateY(0);
  pointer-events: auto;
  transition-delay: 0s;
}
.distribution-switch-status {
  position: absolute;
  top: 7px;
  left: 0;
  right: 0;
  height: 2px;
  border-radius: 2px;
  overflow: hidden;
  background: var(--surface-3);
}
.distribution-switch-status::after {
  content: "";
  display: block;
  height: 100%;
  background: var(--primary);
  transform-origin: left;
  animation: distribution-switch 220ms ease-out both;
}
@keyframes distribution-switch {
  from {
    transform: scaleX(0);
  }
  to {
    transform: scaleX(1);
  }
}
.distribution-total {
  display: flex;
  align-items: baseline;
  gap: 12px;
  margin: 18px 0;
  flex-wrap: wrap;
  overflow-wrap: anywhere;
}
.distribution-total > span {
  font-size: 25px;
  font-weight: 600;
}
.distribution-total small {
  font-size: 10px;
  color: var(--fg-3);
}
.share-strip {
  display: flex;
  gap: 3px;
  height: 16px;
  border-radius: 6px;
  overflow: hidden;
  margin-bottom: 18px;
}
.category-rank {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 42px minmax(64px, auto) 12px;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 12px 6px;
  border-radius: 7px;
  border-bottom: 1px solid var(--border);
  font-size: 12px;
  text-align: left;
}
.category-rank:hover {
  color: var(--primary);
  background: var(--surface-2);
}
.rank-name {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  overflow-wrap: anywhere;
}
.rank-name i {
  width: 7px;
  height: 7px;
  border-radius: 2px;
  flex-shrink: 0;
}
.rank-share {
  color: var(--fg-3);
  font-size: 10px;
  width: 38px;
  text-align: right;
}
.category-rank strong {
  font-size: 12px;
  font-weight: 500;
  overflow-wrap: anywhere;
  min-width: 0;
  text-align: right;
}
.rank-arrow {
  color: var(--fg-3);
  font-size: 12px;
}
.direction-tabs {
  display: flex;
  gap: 3px;
  background: var(--surface-3);
  padding: 3px;
  border-radius: 9px;
  flex-shrink: 0;
}
.direction-tabs button {
  font-size: 11px;
  padding: 6px 10px;
  border-radius: 6px;
}
.direction-tabs .on {
  background: white;
  color: var(--primary);
}
.annual-inline {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, auto);
  padding: 17px;
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: 13px;
  margin-bottom: 20px;
  gap: 5px;
  font-size: 11px;
  overflow-wrap: anywhere;
}
.annual-inline strong {
  font-size: 19px;
  grid-column: 2;
  grid-row: 1/3;
  align-self: center;
}
.annual-inline small {
  font-size: 10px;
  color: var(--fg-3);
}
.activity-section :deep(.card) {
  border: 0;
  border-radius: 0;
}
.activity-section :deep(.card-head) {
  padding: 0 0 16px;
  border: 0;
}
.activity-section :deep(.card-pad) {
  padding: 0;
}
.activity-section :deep(.heatmap-footer) {
  font-size: 10px;
}
@container (max-width: 650px) {
  .insight-bottom {
    grid-template-columns: minmax(0, 1fr);
    gap: 26px;
  }
  .flow-chart {
    height: 210px;
  }
}
@media (max-width: 600px) {
  .chart-readout {
    font-size: 9px;
    gap: 8px;
    flex-wrap: wrap;
    min-height: 46px;
  }
  .flow-chart {
    height: 190px;
  }
  .insight-bottom {
    padding-top: 20px;
  }
  .trend-section {
    padding: 14px 10px 6px;
  }
  .insight-heading h2 {
    font-size: 14px;
  }
  .category-rank {
    min-height: 44px;
  }
  .flow-chart text {
    font-size: 10px;
  }
}
</style>

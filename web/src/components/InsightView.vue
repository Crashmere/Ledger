<script setup lang="ts">
import { computed, ref } from "vue";
import type { Summary, DailyResult, CategoryTotal } from "../api";
import { money } from "../services/presentation";
import ExpenseHeatmap from "./ExpenseHeatmap.vue";
const props = defineProps<{
  summary: Summary;
  daily: DailyResult;
  dailyError?: string;
  categories: CategoryTotal[];
}>();
const direction = defineModel<"expense" | "income">("direction", {
  required: true,
});
defineEmits<{ drilldown: [name: string] }>();
const rows = computed(() =>
  props.categories
    .filter((c) => c[direction.value] > 0)
    .sort((a, b) => b[direction.value] - a[direction.value]),
);
const total = computed(() => props.summary[direction.value]);
const max = computed(() =>
  Math.max(1, ...props.daily.days.flatMap((d) => [d.expense, d.income])),
);
const active = ref<number | null>(null);
const current = computed(() =>
  active.value === null ? null : props.daily.days[active.value],
);
const step = computed(() => 560 / Math.max(1, props.daily.days.length));
const barWidth = computed(() => Math.max(1, Math.min(14, step.value * 0.65)));
const tone = (i: number) => "var(--chart-" + ((i % 7) + 1) + ")";
</script>
<template>
  <div class="insight-view">
    <p v-if="dailyError" class="chart-error" role="status">{{ dailyError }}</p>
    <section v-else class="trend-section">
      <div class="insight-heading">
        <div>
          <h2>收支走势</h2>
          <p>{{ daily.days.length }} 天 · {{ daily.activeDays }} 天有支出</p>
        </div>
        <div class="chart-legend">
          <span><i class="income-dot" />收入</span
          ><span><i class="expense-dot" />支出</span>
        </div>
      </div>
      <div class="chart-readout" aria-live="polite">
        <template v-if="current"
          >{{ current.date }}
          <span class="pos">收入 {{ money(current.income) }}</span
          ><span class="neg">支出 {{ money(current.expense) }}</span></template
        ><template v-else
          >最高单日收支 {{ money(max) }}
          <span>悬停或点击查看每日明细</span></template
        >
      </div>
      <svg
        class="flow-chart"
        viewBox="0 0 620 215"
        role="img"
        aria-label="每日收入与支出柱状图"
      >
        <g v-for="level in [0, 1, 2, 3]" :key="level">
          <path
            :d="'M45 ' + (25 + level * 48) + 'H605'"
            stroke="var(--border)"
            stroke-dasharray="3 4"
          />
          <text x="0" :y="29 + level * 48">
            {{ money(Math.round((max * (3 - level)) / 3)).replace(".00", "") }}
          </text>
        </g>
        <g
          v-for="(day, i) in daily.days"
          :key="day.date"
          @mouseenter="active = i"
          @click="active = i"
        >
          <rect
            :x="45 + i * step"
            y="15"
            :width="step"
            height="170"
            fill="transparent"
          />
          <rect
            :x="45 + i * step"
            :y="169 - (day.income / max) * 144"
            :width="barWidth / 2"
            :height="(day.income / max) * 144"
            fill="var(--income)"
            rx="1"
          />
          <rect
            :x="45 + i * step + barWidth / 2"
            :y="169 - (day.expense / max) * 144"
            :width="barWidth / 2"
            :height="(day.expense / max) * 144"
            fill="var(--primary)"
            rx="1"
          />
          <title>
            {{ day.date }} 收入 {{ money(day.income) }} 支出
            {{ money(day.expense) }}
          </title>
        </g>
        <text x="45" y="202">{{ daily.days[0]?.date.slice(5) }}</text>
        <text x="325" y="202" text-anchor="middle">
          {{ daily.days[Math.floor(daily.days.length / 2)]?.date.slice(5) }}
        </text>
        <text x="605" y="202" text-anchor="end">
          {{ daily.days.at(-1)?.date.slice(5) }}
        </text>
      </svg>
    </section>
    <div class="insight-bottom">
      <section class="distribution">
        <div class="insight-heading">
          <h2>{{ direction === "expense" ? "钱花在哪里" : "收入来自哪里" }}</h2>
          <div class="direction-tabs">
            <button
              :class="{ on: direction === 'expense' }"
              @click="direction = 'expense'"
            >
              支出</button
            ><button
              :class="{ on: direction === 'income' }"
              @click="direction = 'income'"
            >
              收入
            </button>
          </div>
        </div>
        <div class="distribution-total">
          <span class="num">{{ money(total) }}</span
          ><small>{{ rows.length }} 个分类</small>
        </div>
        <div class="share-strip" aria-hidden="true">
          <span
            v-for="(row, i) in rows"
            :key="row.name"
            :style="{ flex: row[direction], background: tone(i) }"
          />
        </div>
        <div v-if="!rows.length" class="empty">
          当前范围暂无{{ direction === "expense" ? "支出" : "收入" }}
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
            >{{
              total ? ((row[direction] / total) * 100).toFixed(1) : 0
            }}%</span
          ><strong class="num">{{ money(row[direction]) }}</strong
          ><span class="rank-arrow">↗</span>
        </button>
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
        <ExpenseHeatmap v-if="!dailyError" :data="daily" />
      </div>
    </div>
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
}
.insight-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
}
.insight-heading h2 {
  font-size: 14px;
}
.insight-heading p {
  font-size: 10px;
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
  background: var(--primary);
}
.chart-readout {
  height: 42px;
  display: flex;
  align-items: center;
  gap: 18px;
  font-size: 10px;
  color: var(--fg-2);
}
.chart-readout > span:last-child {
  color: var(--fg-3);
}
.flow-chart {
  width: 100%;
  height: 230px;
  display: block;
  overflow: visible;
}
.flow-chart text {
  fill: var(--fg-3);
  font-size: 9px;
}
.trend-section {
  border-bottom: 1px solid var(--border);
  padding-bottom: 20px;
}
.insight-bottom {
  display: grid;
  grid-template-columns: 1.05fr 1fr;
  gap: 32px;
  padding-top: 24px;
}
.distribution-total {
  display: flex;
  align-items: baseline;
  gap: 12px;
  margin: 18px 0;
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
  height: 12px;
  border-radius: 4px;
  overflow: hidden;
  margin-bottom: 18px;
}
.category-rank {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  padding: 12px 0;
  border-bottom: 1px solid var(--border);
  font-size: 12px;
  text-align: left;
}
.category-rank:hover {
  color: var(--primary);
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
  width: 75px;
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
  border-radius: 6px;
}
.direction-tabs button {
  font-size: 10px;
  padding: 4px 9px;
  border-radius: 4px;
}
.direction-tabs .on {
  background: white;
  color: var(--primary);
}
.annual-inline {
  display: grid;
  grid-template-columns: 1fr auto;
  padding: 17px;
  background: var(--surface-2);
  border-radius: 9px;
  margin-bottom: 20px;
  gap: 5px;
  font-size: 11px;
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
.activity-section :deep(.heatmap-hint) {
  display: none;
}
.activity-section :deep(.heatmap-footer) {
  font-size: 10px;
}
@media (max-width: 1050px) {
  .insight-bottom {
    grid-template-columns: 1fr;
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
    height: 46px;
  }
  .flow-chart {
    height: 190px;
  }
  .insight-bottom {
    padding-top: 20px;
  }
  .trend-section {
    padding-bottom: 10px;
  }
  .category-rank {
    min-height: 44px;
  }
  .flow-chart text {
    font-size: 10px;
  }
}
</style>

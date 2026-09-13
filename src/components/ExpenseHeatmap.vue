<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import type { Txn } from '../services/contract';
import { format } from '../services/money';
import { buildExpenseHeatmap, type ExpenseHeatmapDay } from '../services/stats';

const props = defineProps<{
  txns: readonly Pick<Txn, 'type' | 'amount' | 'time'>[];
  timeFrom: number;
  timeTo: number;
}>();

const heatmap = computed(() => buildExpenseHeatmap(props.txns, props.timeFrom, props.timeTo));
const grid = ref<HTMLElement | null>(null);
const focusedIndex = ref(0);
const activeDate = ref<string | null>(null);
const activeDay = computed(() => heatmap.value.days.find((day) => day.date === activeDate.value));
const levels = [0, 1, 2, 3, 4];
const weekdays = ['日', '一', '二', '三', '四', '五', '六'];
const monthLabels = computed(() => {
  const labels: { text: string; column: number }[] = [];
  heatmap.value.days.forEach((day, index) => {
    const date = new Date(day.time);
    if (index !== 0 && date.getDate() !== 1) return;
    const column = Math.floor((heatmap.value.startWeekday + index) / 7) + 1;
    const previous = labels.at(-1);
    // 月初紧贴范围起点时合并标签，避免相邻周的月份文字重叠。
    if (previous && column - previous.column < 3) labels.pop();
    labels.push({ text: `${date.getMonth() + 1}月`, column });
  });
  return labels;
});

watch(() => [props.timeFrom, props.timeTo], () => {
  focusedIndex.value = 0;
  activeDate.value = null;
  if (grid.value) grid.value.scrollLeft = 0;
});

function describeDay(day: ExpenseHeatmapDay): string {
  return `${day.date} · 支出 ${format(day.amount, { symbol: '¥' })} · ${day.count} 笔`;
}

function activateDay(day: ExpenseHeatmapDay, index: number): void {
  activeDate.value = day.date;
  focusedIndex.value = index;
}

async function onDayKeydown(event: KeyboardEvent, index: number): Promise<void> {
  if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || event.isComposing) return;
  let target = index;
  switch (event.key) {
    case 'ArrowLeft': target -= 7; break;
    case 'ArrowRight': target += 7; break;
    case 'ArrowUp': target--; break;
    case 'ArrowDown': target++; break;
    case 'Home': target = 0; break;
    case 'End': target = heatmap.value.days.length - 1; break;
    default: return;
  }
  event.preventDefault();
  event.stopPropagation();
  focusedIndex.value = Math.max(0, Math.min(heatmap.value.days.length - 1, target));
  await nextTick();
  grid.value?.querySelectorAll<HTMLButtonElement>('.heatmap-day')[focusedIndex.value]?.focus();
}
</script>

<template>
  <section class="card expense-heatmap" aria-label="每日支出热力图">
    <div class="card-head heatmap-head">
      <h3>每日支出</h3>
      <span class="faint heatmap-hint">每格一天，颜色越深支出越多</span>
    </div>
    <div class="card-pad">
      <div v-if="heatmap.days.length === 0" class="empty">请选择有效的日期范围</div>
      <template v-else>
        <div class="heatmap-layout">
          <div class="heatmap-weekdays faint" aria-hidden="true">
            <span v-for="day in weekdays" :key="day">{{ day }}</span>
          </div>
          <div ref="grid" class="heatmap-scroll">
            <div class="heatmap-calendar" :style="{ '--heatmap-weeks': heatmap.weekCount }" role="group" aria-label="每日支出，使用方向键选择日期">
              <div class="heatmap-months faint" aria-hidden="true">
                <span v-for="label in monthLabels" :key="label.column" :style="{ gridColumn: label.column }">{{ label.text }}</span>
              </div>
              <div class="heatmap-days">
                <span v-for="n in heatmap.startWeekday" :key="'pad-' + n" aria-hidden="true"></span>
                <button
                  v-for="(day, index) in heatmap.days"
                  :key="day.date"
                  type="button"
                  class="heatmap-day"
                  :class="{ selected: activeDate === day.date }"
                  :data-level="day.level"
                  :data-date="day.date"
                  :aria-label="describeDay(day)"
                  :title="describeDay(day)"
                  :tabindex="focusedIndex === index ? 0 : -1"
                  @mouseenter="activeDate = day.date"
                  @focus="activateDay(day, index)"
                  @click="activateDay(day, index)"
                  @keydown="onDayKeydown($event, index)"
                ></button>
              </div>
            </div>
          </div>
        </div>
        <div class="heatmap-detail num" role="status">
          {{ activeDay ? describeDay(activeDay) : heatmap.activeDays ? '悬停或点击方块查看当天支出' : '当前范围暂无支出' }}
        </div>
        <div class="heatmap-footer">
          <span class="muted">{{ heatmap.activeDays }} 天有支出 · 合计 <b class="num">{{ format(heatmap.total, { symbol: '¥' }) }}</b></span>
          <div class="heatmap-scale faint" aria-label="颜色按当前范围每日最高支出分为四档，灰色表示无支出">
            <span>少</span>
            <span v-for="level in levels" :key="level" class="heatmap-swatch" :data-level="level" aria-hidden="true"></span>
            <span>多</span>
          </div>
        </div>
      </template>
    </div>
  </section>
</template>

<style scoped>
.expense-heatmap {
  --heatmap-cell: 14px;
  --heatmap-gap: 4px;
  min-width: 0;
}
.heatmap-head { flex-wrap: wrap; gap: 8px; }
.heatmap-hint { font-size: var(--fs-xs); }
.heatmap-layout { display: flex; gap: 10px; min-width: 0; }
.heatmap-weekdays {
  display: grid;
  grid-template-rows: repeat(7, var(--heatmap-cell));
  gap: var(--heatmap-gap);
  flex: 0 0 16px;
  margin-top: 24px;
  font-size: 10px;
  line-height: var(--heatmap-cell);
}
.heatmap-scroll { min-width: 0; max-width: 100%; overflow-x: auto; padding: 2px; }
.heatmap-calendar { width: max-content; }
.heatmap-months {
  display: grid;
  grid-template-columns: repeat(var(--heatmap-weeks), var(--heatmap-cell));
  column-gap: var(--heatmap-gap);
  height: 22px;
  font-size: var(--fs-xs);
}
.heatmap-months span { white-space: nowrap; }
.heatmap-days {
  display: grid;
  grid-auto-flow: column;
  grid-template-rows: repeat(7, var(--heatmap-cell));
  grid-template-columns: repeat(var(--heatmap-weeks), var(--heatmap-cell));
  gap: var(--heatmap-gap);
}
.heatmap-day, .heatmap-swatch {
  width: var(--heatmap-cell);
  height: var(--heatmap-cell);
  border-radius: 3px;
  background: var(--surface-3);
}
[data-level="1"] { background: color-mix(in srgb, var(--expense) 25%, var(--surface)); }
[data-level="2"] { background: color-mix(in srgb, var(--expense) 50%, var(--surface)); }
[data-level="3"] { background: color-mix(in srgb, var(--expense) 75%, var(--surface)); }
[data-level="4"] { background: var(--expense); }
.heatmap-day.selected { box-shadow: inset 0 0 0 1px var(--fg-2); }
.heatmap-detail { margin-top: 14px; font-size: var(--fs-xs); color: var(--fg-2); overflow-wrap: anywhere; }
.heatmap-footer { display: flex; justify-content: space-between; align-items: center; gap: 12px; flex-wrap: wrap; margin-top: 12px; font-size: var(--fs-sm); }
.heatmap-scale { display: flex; align-items: center; gap: 4px; font-size: var(--fs-xs); }
.heatmap-scale > span:first-child { margin-right: 3px; }
.heatmap-scale > span:last-child { margin-left: 3px; }
@media (max-width: 720px) {
  .expense-heatmap { --heatmap-cell: 18px; }
  .card-pad { padding: 16px; }
}
</style>

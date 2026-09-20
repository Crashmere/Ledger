<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import type { DailyResult, DailyTotal } from "../api";
import { format } from "../services/money";
import { calendarMonths } from "../services/insightData";

const props = defineProps<{ data: DailyResult }>();
const calendar = ref<HTMLElement | null>(null);
const year = ref("");
const activeDate = ref<string | null>(null);
const focusedDate = ref("");
const years = computed(() => [
  ...new Set(props.data.days.map((day) => day.date.slice(0, 4))),
]);
const months = computed(() => calendarMonths(props.data.days, year.value));
const visibleDays = computed(() => months.value.flatMap((month) => month.days));
const activeDay = computed(() =>
  visibleDays.value.find((day) => day.date === activeDate.value),
);
const weekdays = ["日", "一", "二", "三", "四", "五", "六"];
const levels = Array.from({ length: 9 }, (_, level) => level);
const levelStyles = levels.map((level) => ({
  background:
    level === 0
      ? "var(--surface-3)"
      : `color-mix(in srgb, var(--expense) ${16 + (84 * (level - 1)) / 7}%, var(--surface))`,
  color: level >= 5 ? "#fff" : "var(--fg)",
}));
const scaleDescription =
  "支出按对数分为 8 档；灰色表示无支出，最深色为整个筛选范围最高支出";

watch(
  () => props.data.days,
  () => {
    if (!years.value.includes(year.value))
      year.value = years.value.at(-1) || "";
    activeDate.value = null;
    focusedDate.value = visibleDays.value[0]?.date || "";
  },
  { immediate: true },
);
watch(year, () => {
  activeDate.value = null;
  focusedDate.value = visibleDays.value[0]?.date || "";
});

function describeDay(day: DailyTotal) {
  return `${day.date} · 支出 ${format(day.expense, { symbol: "¥" })} · ${day.expenseCount} 笔`;
}
function activateDay(day: DailyTotal) {
  activeDate.value = day.date;
  focusedDate.value = day.date;
}
async function onDayKeydown(event: KeyboardEvent, day: DailyTotal) {
  if (
    event.altKey ||
    event.ctrlKey ||
    event.metaKey ||
    event.shiftKey ||
    event.isComposing
  )
    return;
  const index = visibleDays.value.findIndex((item) => item.date === day.date);
  let target = index;
  switch (event.key) {
    case "ArrowLeft":
      target--;
      break;
    case "ArrowRight":
      target++;
      break;
    case "ArrowUp":
      target -= 7;
      break;
    case "ArrowDown":
      target += 7;
      break;
    case "Home":
      target = 0;
      break;
    case "End":
      target = visibleDays.value.length - 1;
      break;
    default:
      return;
  }
  event.preventDefault();
  event.stopPropagation();
  focusedDate.value =
    visibleDays.value[
      Math.max(0, Math.min(visibleDays.value.length - 1, target))
    ]?.date || "";
  await nextTick();
  calendar.value
    ?.querySelector<HTMLButtonElement>(`[data-date="${focusedDate.value}"]`)
    ?.focus();
}
</script>

<template>
  <section class="card expense-heatmap" aria-label="每日支出热力图">
    <div class="card-head heatmap-head">
      <div>
        <h3>每日支出</h3>
        <p class="heatmap-caption">每格一天 · 按月查看</p>
      </div>
      <select
        v-if="years.length > 1"
        v-model="year"
        class="heatmap-year"
        aria-label="热力图年份"
      >
        <option v-for="item in years" :key="item" :value="item">
          {{ item }} 年
        </option>
      </select>
      <span v-else class="faint">{{ year }} 年</span>
    </div>
    <div class="card-pad">
      <div v-if="!visibleDays.length" class="empty">请选择有效的日期范围</div>
      <template v-else>
        <div ref="calendar" class="heatmap-month-grid">
          <section
            v-for="month in months"
            :key="month.key"
            class="heatmap-month"
            :aria-label="month.key + ' 每日支出'"
          >
            <header class="heatmap-month-heading">
              <strong>{{ month.label }}</strong
              ><span class="num" :title="'本月支出 ' + format(month.expense)">{{
                format(month.expense)
              }}</span>
            </header>
            <div class="heatmap-weekdays" aria-hidden="true">
              <span v-for="day in weekdays" :key="day">{{ day }}</span>
            </div>
            <div
              class="heatmap-days"
              role="group"
              aria-label="使用左右键切换日期，上下键切换周"
            >
              <span
                v-for="n in month.offset"
                :key="'pad-' + n"
                aria-hidden="true"
              />
              <button
                v-for="day in month.days"
                :key="day.date"
                type="button"
                class="heatmap-day"
                :class="{ selected: activeDate === day.date }"
                :style="levelStyles[day.level]"
                :data-level="day.level"
                :data-date="day.date"
                :aria-label="describeDay(day)"
                :title="describeDay(day)"
                :tabindex="focusedDate === day.date ? 0 : -1"
                @mouseenter="activeDate = day.date"
                @focus="activateDay(day)"
                @click="activateDay(day)"
                @keydown="onDayKeydown($event, day)"
              >
                {{ Number(day.date.slice(8)) }}
              </button>
            </div>
          </section>
        </div>
        <div class="heatmap-detail num" role="status">
          {{
            activeDay
              ? describeDay(activeDay)
              : "点击日期或使用方向键查看当天支出"
          }}
        </div>
        <div class="heatmap-footer">
          <span class="muted"
            >当前筛选 {{ data.activeDays }} 天有支出 · 合计
            <b class="num">{{ format(data.total, { symbol: "¥" }) }}</b></span
          >
          <div
            class="heatmap-scale faint"
            :aria-label="scaleDescription"
            :title="scaleDescription"
          >
            <span>少</span
            ><span
              v-for="level in levels"
              :key="level"
              class="heatmap-swatch"
              :style="levelStyles[level]"
              aria-hidden="true"
            /><span>多</span>
          </div>
        </div>
      </template>
    </div>
  </section>
</template>

<style scoped>
.expense-heatmap {
  min-width: 0;
  max-width: 100%;
}
.heatmap-head {
  flex-wrap: wrap;
  gap: 8px;
}
.heatmap-caption {
  font-size: 11px;
  color: var(--fg-3);
  margin-top: 5px;
}
.heatmap-year {
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 6px 8px;
  background: var(--surface);
  font-size: 12px;
  max-width: 100%;
}
.heatmap-month-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 125px), 1fr));
  gap: 18px 14px;
}
.heatmap-month {
  min-width: 0;
  max-width: 220px;
}
.heatmap-month-heading {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 6px;
  margin-bottom: 8px;
  font-size: 12px;
}
.heatmap-month-heading > span {
  font-size: 10px;
  color: var(--fg-3);
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.heatmap-weekdays,
.heatmap-days {
  display: grid;
  grid-template-columns: repeat(7, minmax(0, 1fr));
  gap: 3px;
}
.heatmap-weekdays {
  text-align: center;
  color: var(--fg-3);
  font-size: 9px;
  margin-bottom: 5px;
}
.heatmap-day {
  aspect-ratio: 1;
  width: 100%;
  min-width: 0;
  display: grid;
  place-items: center;
  border-radius: 4px;
  font-size: 9px;
  font-variant-numeric: tabular-nums;
}
.heatmap-day.selected {
  box-shadow: inset 0 0 0 1px var(--fg);
}
.heatmap-day:focus-visible {
  outline-offset: 1px;
  position: relative;
  z-index: 1;
}
.heatmap-detail {
  margin-top: 16px;
  min-height: 2.5em;
  font-size: 11px;
  color: var(--fg-2);
  overflow-wrap: anywhere;
}
.heatmap-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  margin-top: 12px;
  font-size: 12px;
  overflow-wrap: anywhere;
}
.heatmap-scale {
  display: flex;
  align-items: center;
  gap: 3px;
  font-size: 10px;
}
.heatmap-swatch {
  width: 10px;
  height: 10px;
  border-radius: 2px;
}
@media (max-width: 600px) {
  .heatmap-month-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 18px 12px;
  }
  .heatmap-year {
    font-size: 16px;
  }
}
</style>

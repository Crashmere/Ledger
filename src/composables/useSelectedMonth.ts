import { computed, readonly, ref } from 'vue';
import { txnService } from '../services';

function monthIndex(date: Date): number {
  return date.getFullYear() * 12 + date.getMonth();
}

const currentMonthIndex = ref(monthIndex(new Date()));
const selectedMonthIndex = ref(currentMonthIndex.value);
const earliestMonthIndex = ref<number | null>(null);
let boundsRequest = 0;

const year = computed(() => Math.floor(selectedMonthIndex.value / 12));
const month = computed(() => selectedMonthIndex.value % 12);
const monthLabel = computed(() => `${year.value}年${month.value + 1}月`);
const atCurrentMonth = computed(() => selectedMonthIndex.value >= currentMonthIndex.value);
const atEarliestMonth = computed(
  () => earliestMonthIndex.value === null || selectedMonthIndex.value <= earliestMonthIndex.value,
);
const periodLabel = computed(() => atCurrentMonth.value ? '本月' : monthLabel.value);
const timeFrom = computed(() => new Date(year.value, month.value, 1).getTime());
// 查询终点为闭区间，不能包含次月第一天。
const timeTo = computed(() => new Date(year.value, month.value + 1, 1).getTime() - 1);
const dateFrom = computed(() => `${year.value}-${String(month.value + 1).padStart(2, '0')}-01`);
const dateTo = computed(() => {
  const lastDay = new Date(year.value, month.value + 1, 0).getDate();
  return `${year.value}-${String(month.value + 1).padStart(2, '0')}-${lastDay}`;
});

async function refreshBounds(): Promise<void> {
  const request = ++boundsRequest;
  currentMonthIndex.value = monthIndex(new Date());
  const [earliest] = await txnService.query({ sortBy: 'time', sortDir: 'asc', limit: 1 });
  if (request !== boundsRequest) return;
  earliestMonthIndex.value = earliest
    ? Math.min(monthIndex(new Date(earliest.time)), currentMonthIndex.value)
    : null;
  selectedMonthIndex.value = Math.min(
    currentMonthIndex.value,
    Math.max(earliestMonthIndex.value ?? currentMonthIndex.value, selectedMonthIndex.value),
  );
}

function prevMonth(): void {
  currentMonthIndex.value = monthIndex(new Date());
  if (!atEarliestMonth.value) selectedMonthIndex.value -= 1;
}

function nextMonth(): void {
  currentMonthIndex.value = monthIndex(new Date());
  if (!atCurrentMonth.value) selectedMonthIndex.value += 1;
}

export function useSelectedMonth() {
  return {
    selectedMonthIndex: readonly(selectedMonthIndex),
    monthLabel,
    periodLabel,
    timeFrom,
    timeTo,
    dateFrom,
    dateTo,
    atCurrentMonth,
    atEarliestMonth,
    prevMonth,
    nextMonth,
    refreshBounds,
  };
}

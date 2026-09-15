import { computed, readonly, ref } from 'vue';
import { ledgerInfo } from '../api';
import { beijingDate } from '../services/dates';

function monthIndex(date: string): number {
  const [year, month] = date.split('-').map(Number);
  return year * 12 + month - 1;
}
const currentMonthIndex = ref(monthIndex(beijingDate()));
const selectedMonthIndex = ref(currentMonthIndex.value);
const earliestMonthIndex = ref<number | null>(null);
let boundsRequest = 0;
const year = computed(() => Math.floor(selectedMonthIndex.value / 12));
const month = computed(() => selectedMonthIndex.value % 12);
const monthLabel = computed(() => year.value + '年' + (month.value + 1) + '月');
const atCurrentMonth = computed(() => selectedMonthIndex.value >= currentMonthIndex.value);
const atEarliestMonth = computed(() => earliestMonthIndex.value === null || selectedMonthIndex.value <= earliestMonthIndex.value);
const periodLabel = computed(() => atCurrentMonth.value ? '本月' : monthLabel.value);
const dateFrom = computed(() => year.value + '-' + String(month.value + 1).padStart(2, '0') + '-01');
const dateTo = computed(() => dateFrom.value.slice(0, 8) + new Date(Date.UTC(year.value, month.value + 1, 0)).getUTCDate());
async function refreshBounds(): Promise<void> {
  const request = ++boundsRequest;
  const info = await ledgerInfo();
  if (request !== boundsRequest) return;
  currentMonthIndex.value = monthIndex(info.today);
  earliestMonthIndex.value = info.earliestMonth ? Math.min(monthIndex(info.earliestMonth), currentMonthIndex.value) : null;
  selectedMonthIndex.value = Math.min(currentMonthIndex.value,
    Math.max(earliestMonthIndex.value ?? currentMonthIndex.value, selectedMonthIndex.value));
}
function prevMonth(): void { if (!atEarliestMonth.value) selectedMonthIndex.value--; }
function nextMonth(): void { if (!atCurrentMonth.value) selectedMonthIndex.value++; }
export function useSelectedMonth() {
  return { selectedMonthIndex: readonly(selectedMonthIndex), monthLabel, periodLabel,
    dateFrom, dateTo, atCurrentMonth, atEarliestMonth, prevMonth, nextMonth, refreshBounds };
}

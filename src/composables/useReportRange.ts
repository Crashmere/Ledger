import { computed, ref, watch } from 'vue';
import { useSelectedMonth } from './useSelectedMonth';

export type RangeMode = 'month' | '30d' | 'year' | 'custom';

function parseDay(value: string): Date {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, month - 1, day);
}

export function useReportRange() {
  const selectedMonth = useSelectedMonth();
  const rangeMode = ref<RangeMode>('month');
  const customFrom = ref('');
  const customTo = ref('');

  // 月份只在实际变化时覆盖报告范围，手动选定的跨月范围不反向修改共享月份。
  watch(selectedMonth.selectedMonthIndex, () => {
    rangeMode.value = selectedMonth.atCurrentMonth.value ? 'month' : 'custom';
    customFrom.value = selectedMonth.dateFrom.value;
    customTo.value = selectedMonth.dateTo.value;
  }, { immediate: true });

  const timeFrom = computed(() => {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth();
    switch (rangeMode.value) {
      case 'month': return new Date(year, month, 1).getTime();
      case '30d': return new Date(year, month, now.getDate() - 29).getTime();
      case 'year': return new Date(year, 0, 1).getTime();
      case 'custom': return customFrom.value ? parseDay(customFrom.value).getTime() : selectedMonth.timeFrom.value;
    }
  });

  const timeTo = computed(() => {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth();
    switch (rangeMode.value) {
      case 'month': return new Date(year, month + 1, 1).getTime() - 1;
      case '30d': return new Date(year, month, now.getDate() + 1).getTime() - 1;
      case 'year': return new Date(year + 1, 0, 1).getTime() - 1;
      case 'custom': {
        if (!customTo.value) return selectedMonth.timeTo.value;
        const end = parseDay(customTo.value);
        end.setDate(end.getDate() + 1);
        return end.getTime() - 1;
      }
    }
  });

  return { rangeMode, customFrom, customTo, timeFrom, timeTo };
}

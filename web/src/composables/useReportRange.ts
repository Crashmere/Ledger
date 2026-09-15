import { computed, ref, watch } from 'vue';
import { useSelectedMonth } from './useSelectedMonth';
import { beijingDate, shiftDay } from '../services/dates';
export type RangeMode = 'month' | '30d' | 'year' | 'custom';
export function useReportRange() {
  const selectedMonth = useSelectedMonth();
  const rangeMode = ref<RangeMode>('month');
  const customFrom = ref('');
  const customTo = ref('');
  // 共享月份和范围按钮采用最后一次操作；自定义范围不改其他页面的月份。
  watch(selectedMonth.selectedMonthIndex, () => {
    rangeMode.value = selectedMonth.atCurrentMonth.value ? 'month' : 'custom';
    customFrom.value = selectedMonth.dateFrom.value;
    customTo.value = selectedMonth.dateTo.value;
  }, { immediate: true });
  const dateFrom = computed(() => {
    const today = beijingDate();
    switch (rangeMode.value) {
      case 'month': return today.slice(0, 8) + '01';
      case '30d': return shiftDay(today, -29);
      case 'year': return today.slice(0, 4) + '-01-01';
      case 'custom': return customFrom.value || selectedMonth.dateFrom.value;
    }
  });
  const dateTo = computed(() => {
    const today = beijingDate();
    switch (rangeMode.value) {
      case 'month': {
        const [year, month] = today.split('-').map(Number);
        return today.slice(0, 8) + new Date(Date.UTC(year, month, 0)).getUTCDate();
      }
      case '30d': return today;
      case 'year': return today.slice(0, 4) + '-12-31';
      case 'custom': return customTo.value || selectedMonth.dateTo.value;
    }
  });
  return { rangeMode, customFrom, customTo, dateFrom, dateTo };
}

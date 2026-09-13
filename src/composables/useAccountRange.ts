import { computed, readonly, ref, type Ref } from 'vue';
import type { AccountKind } from '../services';
import { useSelectedMonth } from './useSelectedMonth';

const STORAGE_KEY = 'accounts:project-month-filter';

function loadEnabled(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

const enabled = ref(loadEnabled());

function setEnabled(value: boolean): void {
  enabled.value = value;
  try {
    localStorage.setItem(STORAGE_KEY, value ? '1' : '0');
  } catch {
    // 本地存储不可用时，仍在当前会话内应用选择。
  }
}

export function useProjectMonthFilter() {
  return { enabled: readonly(enabled), setEnabled };
}

export function useAccountRange(kind: Readonly<Ref<AccountKind | undefined>>) {
  const month = useSelectedMonth();
  const filterByMonth = computed(() => kind.value !== 'project' || enabled.value);
  const timeFrom = computed(() => filterByMonth.value ? month.timeFrom.value : undefined);
  const timeTo = computed(() => filterByMonth.value ? month.timeTo.value : undefined);
  const periodLabel = computed(() => filterByMonth.value ? month.periodLabel.value : '全部');

  return { filterByMonth, timeFrom, timeTo, periodLabel };
}

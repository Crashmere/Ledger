<script setup lang="ts">
import { computed } from "vue";
import AppIcon from "./AppIcon.vue";
import { useMediaQuery } from "../composables/useMediaQuery";

const props = defineProps<{
  page: number;
  total: number;
  pageSize: number;
  loading: boolean;
}>();
const emit = defineEmits<{
  change: [page: number];
  sizeChange: [pageSize: number];
}>();
const compact = useMediaQuery("(max-width: 600px)");
const pages = computed(() =>
  Math.max(1, Math.ceil(props.total / props.pageSize)),
);
const pageItems = computed(() => {
  const count = compact.value ? 5 : 7;
  const last = pages.value;
  const sequence = (from: number, to: number) =>
    Array.from({ length: to - from + 1 }, (_, index) => from + index);
  if (last <= count) return sequence(1, last);
  if (props.page <= count - 3)
    return [...sequence(1, count - 2), "end-gap", last];
  if (props.page >= last - (count - 4))
    return [1, "start-gap", ...sequence(last - (count - 3), last)];
  const radius = (count - 5) / 2;
  return [
    1,
    "start-gap",
    ...sequence(props.page - radius, props.page + radius),
    "end-gap",
    last,
  ];
});

function selectPage(value: number) {
  if (
    !props.loading &&
    value >= 1 &&
    value <= pages.value &&
    value !== props.page
  )
    emit("change", value);
}
</script>

<template>
  <nav
    v-if="total > 0"
    class="pagination"
    aria-label="交易分页"
    :aria-busy="loading"
  >
    <span class="pagination-total" aria-live="polite">共 {{ total }} 条</span>
    <div class="pagination-pages">
      <button
        class="page-button"
        aria-label="上一页"
        :disabled="loading || page <= 1"
        @click="selectPage(page - 1)"
      >
        <AppIcon name="back" :size="17" />
      </button>
      <template v-for="item in pageItems" :key="item">
        <button
          v-if="typeof item === 'number'"
          class="page-button page-number num"
          :class="{ current: item === page }"
          :aria-label="'第 ' + item + ' 页'"
          :aria-current="item === page ? 'page' : undefined"
          :disabled="loading"
          @click="selectPage(item)"
        >
          {{ item }}
        </button>
        <span v-else class="page-gap" aria-hidden="true">…</span>
      </template>
      <button
        class="page-button page-next"
        aria-label="下一页"
        :disabled="loading || page >= pages"
        @click="selectPage(page + 1)"
      >
        <AppIcon name="back" :size="17" />
      </button>
    </div>
    <select
      class="page-size"
      aria-label="每页条数"
      :value="pageSize"
      :disabled="loading"
      @change="
        emit('sizeChange', Number(($event.target as HTMLSelectElement).value))
      "
    >
      <option v-for="size in [10, 20, 50, 100]" :key="size" :value="size">
        {{ size }} 条/页
      </option>
    </select>
  </nav>
</template>

<style scoped>
.pagination {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  flex-wrap: wrap;
  gap: 12px;
  min-width: 0;
  font-size: 13px;
  color: var(--fg-2);
}
.pagination-total {
  white-space: nowrap;
}
.pagination-pages {
  display: flex;
  align-items: center;
  gap: 6px;
}
.page-button,
.page-size {
  border: 1px solid var(--border-strong);
  border-radius: 7px;
  background: var(--surface);
  color: var(--fg);
  height: 34px;
}
.page-button {
  display: inline-grid;
  place-items: center;
  min-width: 34px;
  padding: 0 7px;
  font-size: 14px;
}
.page-button:hover:not(:disabled) {
  border-color: var(--primary);
  color: var(--primary);
  background: var(--primary-soft);
}
.page-button.current {
  border-color: var(--primary);
  background: var(--primary-soft);
  color: var(--primary);
  font-weight: 600;
}
.page-button:disabled {
  color: var(--fg-3);
  background: var(--surface-2);
}
.page-next svg {
  transform: rotate(180deg);
}
.page-gap {
  min-width: 20px;
  text-align: center;
}
.page-size {
  padding: 0 9px;
  font-size: 13px;
  cursor: pointer;
}
.page-size:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
@media (max-width: 600px) {
  .pagination {
    width: 100%;
    display: grid;
    grid-template-columns: 1fr auto;
    gap: 12px 8px;
  }
  .pagination-pages {
    grid-column: 1 / -1;
    grid-row: 2;
    justify-content: center;
  }
  .page-size {
    grid-column: 2;
    grid-row: 1;
    font-size: 16px;
  }
  .page-button {
    min-width: 34px;
    height: 36px;
  }
}
</style>

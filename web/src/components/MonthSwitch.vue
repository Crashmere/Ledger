<script setup lang="ts">
import { useSelectedMonth } from "../composables/useSelectedMonth";

const {
  monthLabel,
  atCurrentMonth,
  atEarliestMonth,
  prevMonth,
  nextMonth,
} = useSelectedMonth();
</script>

<template>
  <div class="month-switch" role="group" aria-label="选择月份">
    <button
      type="button"
      aria-label="上一月（← 键）"
      :disabled="atEarliestMonth"
      @click="prevMonth"
    >
      ‹
    </button>
    <span class="m-label" aria-live="polite">{{ monthLabel }}</span>
    <button
      type="button"
      aria-label="下一月（→ 键）"
      :disabled="atCurrentMonth"
      @click="nextMonth"
    >
      ›
    </button>
    <span class="kbd-hint month-kbd" aria-hidden="true"
      ><span class="kbd">←</span><span class="kbd">→</span></span
    >
  </div>
</template>

<style scoped>
.month-switch:not(.topbar-month) {
  position: relative;
}
.month-kbd {
  position: absolute;
  left: 100%;
  margin-left: 8px;
  top: 50%;
  transform: translateY(-50%);
  white-space: nowrap;
}
@media (max-width: 1100px) {
  .month-kbd {
    display: none;
  }
}
</style>

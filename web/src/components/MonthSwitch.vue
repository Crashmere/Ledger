<script setup lang="ts">
import { onMounted, onUnmounted, watch } from 'vue';
import { useRoute } from 'vue-router';
import { useSelectedMonth } from '../composables/useSelectedMonth';
import { pushToast } from '../composables/useToast';


const route = useRoute();
const { monthLabel, atCurrentMonth, atEarliestMonth, prevMonth, nextMonth, refreshBounds } = useSelectedMonth();


function updateBounds(): void {
  void refreshBounds().catch(() => pushToast('error', '月份范围加载失败，请稍后重试。'));
}

function onMonthKeydown(event: KeyboardEvent): void {
  if (event.defaultPrevented || event.isComposing || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
  if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
  const target = event.target as HTMLElement | null;
  if (target?.closest('input, textarea, select, [role="tablist"]') || target?.isContentEditable) return;
  if (document.querySelector('dialog[open], .workspace-sheet')) return;
  if (event.key === 'ArrowLeft') prevMonth();
  else nextMonth();
  event.preventDefault();
}

watch(() => route.name, updateBounds);
onMounted(() => {
  updateBounds();

  window.addEventListener('focus', updateBounds);
  window.addEventListener('keydown', onMonthKeydown);
});
onUnmounted(() => {

  window.removeEventListener('focus', updateBounds);
  window.removeEventListener('keydown', onMonthKeydown);
});
</script>

<template>
  <div class="month-switch" role="group" aria-label="选择月份">
    <button type="button" aria-label="上一月（← 键）" :disabled="atEarliestMonth" @click="prevMonth">‹</button>
    <span class="m-label" aria-live="polite">{{ monthLabel }}</span>
    <button type="button" aria-label="下一月（→ 键）" :disabled="atCurrentMonth" @click="nextMonth">›</button>
    <span class="kbd-hint month-kbd" aria-hidden="true"><span class="kbd">←</span><span class="kbd">→</span></span>
  </div>
</template>

<style scoped>
.month-switch:not(.topbar-month) { position: relative; }
.month-kbd {
  position: absolute;
  left: 100%;
  margin-left: 8px;
  top: 50%;
  transform: translateY(-50%);
  white-space: nowrap;
}
@media (max-width: 1100px) {
  .month-kbd { display: none; }
}
</style>

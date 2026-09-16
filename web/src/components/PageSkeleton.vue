<script setup lang="ts">
withDefaults(defineProps<{ label?: string; form?: boolean; compact?: boolean }>(), { label: '页面', form: false, compact: false });
</script>

<template>
  <div class="page-skeleton" role="status" aria-live="polite" :aria-label="`正在加载${label}`" aria-busy="true">
    <div class="skeleton-heading">正在加载{{ label }}…</div>
    <div class="skeleton-layout" :class="{ 'skeleton-form': form }" aria-hidden="true">
      <div v-for="n in compact ? 0 : form ? 2 : 3" :key="n" class="skeleton-card">
        <div class="skeleton-line skeleton-short" />
        <div class="skeleton-line skeleton-value" />
        <div class="skeleton-line" />
      </div>
      <div class="skeleton-card skeleton-list">
        <div v-for="n in 5" :key="n" class="skeleton-row">
          <div class="skeleton-icon" />
          <div class="skeleton-copy"><div class="skeleton-line" /><div class="skeleton-line skeleton-short" /></div>
          <div class="skeleton-line skeleton-amount" />
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.page-skeleton { width: 100%; min-width: 0; }
.skeleton-heading { margin-bottom: 16px; color: var(--fg-3); font-size: var(--fs-sm); }
.skeleton-layout { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 16px; }
.skeleton-form { grid-template-columns: repeat(2, minmax(0, 1fr)); max-width: 860px; margin: auto; }
.skeleton-card { padding: 20px; border: 1px solid var(--border); border-radius: var(--r-lg); background: var(--surface); }
.skeleton-line, .skeleton-icon { background: var(--surface-3); border-radius: 6px; animation: skeleton-pulse 1.4s ease-in-out infinite alternate; }
.skeleton-line { height: 12px; width: 100%; }
.skeleton-card > .skeleton-line + .skeleton-line { margin-top: 16px; }
.skeleton-short { width: 45%; }
.skeleton-value { height: 30px; width: 65%; }
.skeleton-list { grid-column: 1 / -1; }
.skeleton-row { display: flex; align-items: center; gap: 14px; padding: 18px 0; }
.skeleton-row + .skeleton-row { border-top: 1px solid var(--border); }
.skeleton-icon { width: 38px; height: 38px; flex: none; }
.skeleton-copy { flex: 1; min-width: 0; }
.skeleton-copy .skeleton-line + .skeleton-line { margin-top: 10px; }
.skeleton-amount { width: 60px; flex: none; }
@keyframes skeleton-pulse { to { opacity: 0.4; } }
@media (max-width: 720px) { .skeleton-layout { grid-template-columns: minmax(0, 1fr); gap: 12px; } .skeleton-card { padding: 16px; } }
@media (prefers-reduced-motion: reduce) { .skeleton-line, .skeleton-icon { animation: none; } }
</style>

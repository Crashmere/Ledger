<script setup lang="ts">
defineProps<{ name: string; size?: number }>();
const paths: Record<string, string> = {
  ledger:
    'M6 3h13a1 1 0 0 1 1 1v17H6a3 3 0 0 1-3-3V6a3 3 0 0 1 3-3Zm0 0v14m-3 1a2 2 0 0 1 2-2h15M10 7h6m-6 4h4',
  accounts: 'M3 7h17v13H3V7Zm0 0V5a2 2 0 0 1 2-2h12v4m-2 5h6v4h-6z',
  reports: 'M4 3v17h17M8 15v-4m5 4V7m5 8V4',
  plus: 'M12 5v14M5 12h14',
  search: 'M21 21l-5-5m2-6a7 7 0 1 1-14 0 7 7 0 0 1 14 0Z',
  batch: 'M8 3h12v14H8zM4 7v14h12M11 7h6m-6 4h6',
  menu: 'M4 6h16M4 12h16M4 18h16',
  arrow: 'M5 12h14m-5-5 5 5-5 5',
  back: 'm14 6-6 6 6 6',
  close: 'm6 6 12 12M6 18 18 6',
  expense: 'M12 5v14m-6-6 6 6 6-6',
  income: 'M12 19V5m-6 6 6-6 6 6',
  transfer: 'M3 7h17m-4-4 4 4-4 4M21 17H4m4-4-4 4 4 4',
  edit: 'm15 4 5 5M4 20l5-1L21 7a2 2 0 0 0-5-5L4 14v6Zm9 0h8',
  copy: 'M9 9h11v11H9zM5 15H3V3h12v2',
  filter: 'M4 6h16M7 12h10m-7 6h4',
  calendar: 'M4 5h16v16H4zM8 3v4m8-4v4M4 10h16',
};
</script>
<template>
  <svg
    :width="size || 20"
    :height="size || 20"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.7"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <path :d="paths[name] || paths.ledger" />
  </svg>
</template>

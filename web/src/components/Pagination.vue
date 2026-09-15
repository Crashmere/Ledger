<script setup lang="ts">
import { computed } from 'vue';
const props = defineProps<{ page: number; total: number; pageSize?: number; loading: boolean }>();
const emit = defineEmits<{ change: [page: number] }>();
const pages = computed(() => Math.max(1, Math.ceil(props.total / (props.pageSize ?? 50))));
</script>
<template>
  <nav v-if="total > 0" class="pagination" aria-label="交易分页">
    <button class="btn" :disabled="loading || page <= 1" @click="emit('change', page - 1)">上一页</button>
    <span aria-live="polite">{{ page }} / {{ pages }} 页 · 共 {{ total }} 笔</span>
    <button class="btn" :disabled="loading || page >= pages" @click="emit('change', page + 1)">下一页</button>
  </nav>
</template>
<style scoped>
.pagination { display:flex; align-items:center; justify-content:center; gap:12px; padding:16px 4px; font-size:12px; }
.pagination .btn { padding:8px 12px; }
</style>

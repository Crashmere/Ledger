<script setup lang="ts">
import { useRoute } from "vue-router";
const route = useRoute();
</script>
<template>
  <nav class="entry-tabs" aria-label="记账方式">
    <RouterLink :to="{ path: '/transactions/add', query: route.query }"
      >单笔记账</RouterLink
    ><RouterLink :to="{ path: '/transactions/batch', query: route.query }"
      >批量记账</RouterLink
    >
  </nav>
</template>
<style scoped>
.entry-tabs {
  display: flex;
  gap: 4px;
  width: fit-content;
  padding: 4px;
  border: 1px solid var(--border);
  border-radius: 11px;
  background: var(--surface-2);
  margin-bottom: 22px;
  font-size: 12px;
  color: var(--fg-3);
}
.entry-tabs a {
  padding: 8px 17px;
  border-radius: 7px;
}
.entry-tabs .router-link-active {
  color: var(--primary);
  font-weight: 600;
  background: white;
  box-shadow: 0 1px 4px #253b3310;
}
.entry-tabs a:hover {
  color: var(--primary);
}
</style>

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
  gap: 18px;
  margin-bottom: 22px;
  font-size: 11px;
  color: var(--fg-3);
}
.entry-tabs a {
  padding: 5px 0;
}
.entry-tabs .router-link-active {
  color: var(--primary);
  font-weight: 600;
}
.entry-tabs a:hover {
  color: var(--primary);
}
</style>

<script setup lang="ts">
defineProps<{ message: string }>();
defineEmits<{ retry: [] }>();
</script>
<template><div v-if="message" class="load-error" role="alert">{{ message }} <button class="btn" @click="$emit('retry')">重试</button></div></template>
<style scoped>.load-error { margin-bottom:16px; padding:16px; border:1px solid var(--negative); border-radius:12px; background:var(--surface); display:flex; align-items:center; justify-content:space-between; gap:12px; }</style>

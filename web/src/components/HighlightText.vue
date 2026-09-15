<script setup lang="ts">
import { computed } from 'vue';
const props = defineProps<{ text: string; keyword: string }>();
const segments = computed(() => {
  const source = props.text;
  const keyword = props.keyword.trim().toLowerCase();
  if (!keyword) return [{ text: source, hit: false }];
  const lower = source.toLowerCase();
  // Unicode 转小写可能增加长度（如 İ），保留与原文的偏移映射。
  const starts: number[] = [], ends: number[] = [];
  let position = 0;
  for (const character of source) {
    for (let i = 0; i < character.toLowerCase().length; i++) {
      starts.push(position); ends.push(position + character.length);
    }
    position += character.length;
  }
  const result: { text: string; hit: boolean }[] = [];
  let offset = 0, originalOffset = 0;
  for (;;) {
    const index = lower.indexOf(keyword, offset);
    if (index < 0) break;
    const start = starts[index], end = ends[index + keyword.length - 1];
    result.push({ text: source.slice(originalOffset, start), hit: false }, { text: source.slice(start, end), hit: true });
    originalOffset = end;
    offset = index + keyword.length;
  }
  result.push({ text: source.slice(originalOffset), hit: false });
  return result;
});
</script>
<template><template v-for="(segment, index) in segments" :key="index"><mark v-if="segment.hit">{{ segment.text }}</mark><template v-else>{{ segment.text }}</template></template></template>

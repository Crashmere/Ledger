<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue';
defineProps<{ saving: boolean; error: string; uncertain: boolean }>();
defineEmits<{ dismiss: []; review: [] }>();
const dialog = ref<HTMLDialogElement | null>(null);
onMounted(() => dialog.value?.showModal());
onUnmounted(() => dialog.value?.close());
</script>

<template>
  <Teleport to="body">
    <dialog ref="dialog" class="save-status" aria-labelledby="save-status-title" aria-describedby="save-status-message"
      @cancel.prevent="!saving && $emit('dismiss')" @keydown.stop>
      <div v-if="saving" class="save-spinner" aria-hidden="true" />
      <div aria-live="polite" aria-atomic="true">
        <h3 id="save-status-title">{{ saving ? '正在保存交易' : uncertain ? '保存结果未确认' : '保存未成功' }}</h3>
        <p id="save-status-message">{{ saving ? '正在等待服务器确认，请保持页面打开。' : error }}</p>
      </div>
      <div v-if="!saving" class="save-status-actions">
        <button class="btn btn-secondary" @click="$emit('dismiss')">返回表单</button>
        <button v-if="uncertain" class="btn btn-primary" @click="$emit('review')">查看账目核对</button>
      </div>
    </dialog>
  </Teleport>
</template>

<style scoped>
.save-status { margin: auto; width: min(380px, calc(100% - 32px)); max-height: calc(100dvh - 32px); padding: 28px; border: 1px solid var(--border); border-radius: var(--r-lg); background: var(--surface); color: var(--fg); box-shadow: var(--sh-3); text-align: center; }
.save-status::backdrop { background: rgba(0, 0, 0, 0.32); }
.save-status p { margin-top: 12px; color: var(--fg-2); line-height: 1.6; }
.save-status-actions { display: flex; flex-wrap: wrap; justify-content: center; gap: 10px; margin-top: 24px; }
.save-spinner { width: 36px; height: 36px; margin: 0 auto 20px; border: 3px solid var(--border); border-top-color: var(--primary); border-radius: 50%; animation: save-spin 0.8s linear infinite; }
@keyframes save-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .save-spinner { animation: none; } }
</style>

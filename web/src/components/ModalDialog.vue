<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue';
const props = defineProps<{ label: string; busy?: boolean }>();
const emit = defineEmits<{ close: [] }>();
const dialog = ref<HTMLDialogElement | null>(null);
onMounted(() => dialog.value?.showModal());
onUnmounted(() => dialog.value?.close());
function close() {
  if (!props.busy) emit('close');
}
</script>
<template>
  <dialog
    ref="dialog"
    class="modal-dialog"
    :aria-label="label"
    @cancel.prevent="close"
    @keydown.stop
    @click="$event.target === dialog && close()"
  >
    <slot />
  </dialog>
</template>
<style scoped>
.modal-dialog {
  margin: auto;
  padding: 0;
  width: min(440px, calc(100vw - 28px));
  max-height: calc(100dvh - 28px);
  border: 0;
  border-radius: 14px;
  color: var(--fg);
  background: var(--surface);
  box-shadow: var(--sh-3);
}
.modal-dialog::backdrop {
  background: #142b2359;
  backdrop-filter: blur(3px);
}
</style>

<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch } from "vue";
import { useRoute } from "vue-router";
import { useMediaQuery } from "../composables/useMediaQuery";
import AppIcon from "./AppIcon.vue";

const emit = defineEmits<{ manage: [] }>();
const route = useRoute();
const mobile = useMediaQuery("(max-width: 600px)");
const open = ref(false);
const menu = ref<HTMLElement | null>(null);
const trigger = ref<HTMLButtonElement | null>(null);

function close(restoreFocus = false) {
  open.value = false;
  if (restoreFocus) trigger.value?.focus({ preventScroll: true });
}
function manage() {
  // Restore to the persistent trigger so the sheet can return focus here.
  close(true);
  emit("manage");
}
function outside(event: PointerEvent) {
  if (!menu.value?.contains(event.target as Node)) close();
}
function keydown(event: KeyboardEvent) {
  if (!open.value || event.isComposing) return;
  if (event.key === "Escape") {
    event.preventDefault();
    event.stopPropagation();
    close(true);
  } else if (["Tab", "ArrowLeft", "ArrowRight"].includes(event.key)) {
    // Let the workspace keep its view and month shortcuts.
    close();
  }
}
watch(() => route.fullPath, () => close());
watch(mobile, () => close());
onMounted(() => {
  document.addEventListener("pointerdown", outside, true);
  window.addEventListener("keydown", keydown, true);
});
onUnmounted(() => {
  document.removeEventListener("pointerdown", outside, true);
  window.removeEventListener("keydown", keydown, true);
});
</script>

<template>
  <div v-if="mobile" ref="menu" class="workspace-menu">
    <button
      ref="trigger"
      type="button"
      class="icon-btn workspace-menu-trigger"
      aria-label="更多功能"
      :aria-expanded="open"
      aria-controls="workspace-menu-links"
      @click="open = !open"
    >
      <AppIcon name="menu" :size="21" />
    </button>
    <Transition name="workspace-menu">
      <nav
        v-if="open"
        id="workspace-menu-links"
        class="workspace-menu-dropdown"
        aria-label="账本菜单"
      >
        <button type="button" @click="manage">
          <AppIcon name="accounts" :size="18" />账户管理
        </button>
      </nav>
    </Transition>
  </div>
</template>

<style scoped>
.workspace-menu {
  position: relative;
  flex-shrink: 0;
}
.workspace-menu-trigger {
  width: 40px;
  height: 40px;
  border-radius: 10px;
  background: var(--surface-2);
}
.workspace-menu-trigger[aria-expanded="true"] {
  background: var(--primary-soft);
  color: var(--primary);
}
.workspace-menu-dropdown {
  position: absolute;
  top: calc(100% + 9px);
  right: 0;
  width: 168px;
  padding: 6px;
  border: 1px solid var(--border);
  border-radius: 13px;
  background: var(--surface);
  box-shadow: 0 10px 30px #253b3314, 0 2px 6px #253b3308;
}
.workspace-menu-dropdown button {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  min-height: 44px;
  padding: 10px 12px;
  border-radius: 8px;
  text-align: left;
  font-size: 13px;
}
.workspace-menu-dropdown button svg {
  color: var(--fg-2);
}
.workspace-menu-dropdown button:hover,
.workspace-menu-dropdown button:active {
  background: var(--primary-soft);
}
.workspace-menu-enter-active,
.workspace-menu-leave-active {
  transition: opacity 160ms ease, transform 160ms var(--ease-out);
}
.workspace-menu-enter-from,
.workspace-menu-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}
.workspace-menu-leave-active {
  pointer-events: none;
}
</style>

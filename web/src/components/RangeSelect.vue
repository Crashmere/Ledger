<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, useId, watch } from "vue";
import { useRoute } from "vue-router";
import AppIcon from "./AppIcon.vue";

const value = defineModel<string>({ required: true });
const open = defineModel<boolean>("open", { default: false });
const options = [
  { value: "month", label: "按月" },
  { value: "30d", label: "近 30 天" },
  { value: "year", label: "本年" },
  { value: "all", label: "全部时间" },
  { value: "custom", label: "自定义" },
];
const selectedIndex = computed(() =>
  Math.max(0, options.findIndex(option => option.value === value.value)),
);
const activeIndex = ref(0);
const trigger = ref<HTMLButtonElement | null>(null);
const menu = ref<HTMLElement | null>(null);
const menuId = useId();
const optionId = (index: number) => `${menuId}-${index}`;
const position = ref({ left: "0px", top: "0px", maxHeight: "none" });
const placed = ref(false);
const above = ref(false);
let anchor: DOMRect | undefined;
const route = useRoute();

function place() {
  if (!open.value || !trigger.value || !menu.value) return;
  anchor = trigger.value.getBoundingClientRect();
  const viewport = window.visualViewport;
  const left = (viewport?.offsetLeft ?? 0) + 8;
  const top = (viewport?.offsetTop ?? 0) + 8;
  const right = left + (viewport?.width ?? window.innerWidth) - 16;
  const bottom = top + (viewport?.height ?? window.innerHeight) - 16;
  const belowSpace = bottom - anchor.bottom - 7;
  const aboveSpace = anchor.top - top - 7;
  const height = menu.value.scrollHeight + 2;
  above.value = belowSpace < height && aboveSpace > belowSpace;
  const available = Math.max(0, above.value ? aboveSpace : belowSpace);
  const y = above.value
    ? anchor.top - Math.min(height, available) - 7
    : anchor.bottom + 7;
  position.value = {
    left: Math.max(left, Math.min(anchor.left, right - menu.value.offsetWidth)) + "px",
    top: y + "px",
    maxHeight: available + "px",
  };
  placed.value = true;
  void nextTick(revealActive);
}
async function show() {
  activeIndex.value = selectedIndex.value;
  placed.value = false;
  open.value = true;
  trigger.value?.focus({ preventScroll: true });
  await nextTick();
  place();
}
function close(restoreFocus = false) {
  open.value = false;
  if (restoreFocus) trigger.value?.focus({ preventScroll: true });
}
function choose(index: number) {
  value.value = options[index].value;
  close(true);
}
function revealActive() {
  // Scroll only the menu; scrollIntoView could also move the workspace.
  const option = document.getElementById(optionId(activeIndex.value));
  if (!menu.value || !option) return;
  const top = option.offsetTop;
  const bottom = top + option.offsetHeight;
  if (top < menu.value.scrollTop) menu.value.scrollTop = top;
  else if (bottom > menu.value.scrollTop + menu.value.clientHeight)
    menu.value.scrollTop = bottom - menu.value.clientHeight;
}
function keydown(event: KeyboardEvent) {
  if (
    event.isComposing || event.keyCode === 229 ||
    event.ctrlKey || event.metaKey || event.altKey
  ) return;
  if (["Enter", " ", "ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
    event.preventDefault();
    event.stopPropagation();
    if (!open.value) {
      void show();
      return;
    }
    if (event.key === "Enter" || event.key === " ") choose(activeIndex.value);
    else {
      if (event.key === "Home") activeIndex.value = 0;
      else if (event.key === "End") activeIndex.value = options.length - 1;
      else {
        const step = event.key === "ArrowDown" ? 1 : -1;
        activeIndex.value = (activeIndex.value + step + options.length) % options.length;
      }
      void nextTick(revealActive);
    }
  } else if (open.value && ["Escape", "Tab"].includes(event.key)) {
    event.preventDefault();
    event.stopPropagation();
    close(true);
  }
}
function outside(event: PointerEvent) {
  const target = event.target as Node;
  if (!trigger.value?.contains(target) && !menu.value?.contains(target)) close();
}
function scroll(event: Event) {
  if (!open.value || !anchor || menu.value?.contains(event.target as Node)) return;
  const current = trigger.value?.getBoundingClientRect();
  // Ignore a queued scroll event from bringing the trigger into view before clicking.
  if (current?.top !== anchor.top || current?.left !== anchor.left) close();
}
const dismiss = () => close();
watch(() => route.fullPath, dismiss);
onMounted(() => {
  document.addEventListener("pointerdown", outside, true);
  document.addEventListener("scroll", scroll, true);
  window.addEventListener("resize", dismiss);
  window.visualViewport?.addEventListener("resize", place);
  window.visualViewport?.addEventListener("scroll", dismiss);
});
onUnmounted(() => {
  document.removeEventListener("pointerdown", outside, true);
  document.removeEventListener("scroll", scroll, true);
  window.removeEventListener("resize", dismiss);
  window.visualViewport?.removeEventListener("resize", place);
  window.visualViewport?.removeEventListener("scroll", dismiss);
});
</script>

<template>
  <button
    ref="trigger"
    type="button"
    role="combobox"
    class="range-trigger"
    aria-label="时间范围"
    aria-haspopup="listbox"
    :aria-expanded="open"
    :aria-controls="open ? menuId : undefined"
    :aria-activedescendant="open ? optionId(activeIndex) : undefined"
    @click="open ? close() : show()"
    @keydown="keydown"
  >
    <span :key="value" class="range-label">{{ options[selectedIndex].label }}</span>
    <AppIcon name="chevron-down" :size="14" class="range-chevron" />
  </button>
  <Teleport to="body">
    <Transition name="range-menu">
      <div
        v-if="open"
        :id="menuId"
        ref="menu"
        class="range-menu"
        role="listbox"
        aria-label="时间范围选项"
        :aria-hidden="!open || !placed || undefined"
        :inert="!open || undefined"
        :data-side="above ? 'above' : 'below'"
        :style="{ ...position, visibility: placed ? 'visible' : 'hidden' }"
        @keydown="keydown"
      >
        <button
          v-for="(option, index) in options"
          :id="optionId(index)"
          :key="option.value"
          type="button"
          role="option"
          tabindex="-1"
          class="range-option"
          :class="{ active: activeIndex === index }"
          :aria-selected="value === option.value"
          @pointermove="activeIndex = index"
          @mousedown.prevent
          @click="choose(index)"
        >
          <span>{{ option.label }}</span>
          <AppIcon v-if="value === option.value" name="check" :size="15" />
        </button>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.range-trigger {
  display: inline-flex;
  align-items: center;
  justify-content: space-between;
  flex-shrink: 0;
  gap: 10px;
  width: 104px;
  min-height: 38px;
  padding: 8px 12px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--surface);
  font-size: 12px;
}
.range-trigger:hover,
.range-trigger[aria-expanded="true"] {
  background: var(--primary-soft);
  color: var(--primary);
  border-color: #c6d9ca;
}
.range-label {
  white-space: nowrap;
  animation: range-label-in 160ms var(--ease-out);
}
.range-chevron {
  color: var(--fg-2);
  transition: transform 200ms var(--ease-out);
}
.range-trigger[aria-expanded="true"] .range-chevron {
  transform: rotate(180deg);
}
.range-menu {
  position: fixed;
  z-index: 40;
  width: 184px;
  max-width: calc(100vw - 16px);
  padding: 6px;
  overflow-y: auto;
  overscroll-behavior: contain;
  border: 1px solid var(--border);
  border-radius: 14px;
  background: var(--surface);
  box-shadow: 0 12px 32px #253b331a, 0 3px 8px #253b330a;
  transform-origin: top left;
}
.range-menu[data-side="above"] {
  transform-origin: bottom left;
  --menu-offset: 4px;
}
.range-option {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  width: 100%;
  min-height: 40px;
  padding: 9px 12px;
  border-radius: 8px;
  font-size: 13px;
  text-align: left;
}
.range-option[aria-selected="true"] {
  color: var(--primary);
  font-weight: 600;
}
.range-option.active {
  background: var(--primary-soft);
  color: var(--primary);
}
.range-option:active {
  transform: scale(0.98);
}
.range-menu-enter-active {
  transition: opacity 160ms ease, transform 200ms var(--ease-out);
}
.range-menu-leave-active {
  transition: opacity 110ms ease, transform 130ms var(--ease-out);
  pointer-events: none;
}
.range-menu-enter-from,
.range-menu-leave-to {
  opacity: 0;
  transform: translateY(var(--menu-offset, -4px)) scale(0.96);
}
@keyframes range-label-in {
  from { opacity: 0; transform: translateY(2px); }
  to { opacity: 1; transform: translateY(0); }
}
</style>

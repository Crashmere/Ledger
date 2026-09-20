<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import { useRoute } from "vue-router";
import { txnService, type Transaction, type TransactionFilter } from "../api";
import { insightTransactionFilter, type InsightSelection } from "../services/insightTransactions";
import { txnAmount } from "../services/presentation";
import AppIcon from "./AppIcon.vue";

const props = defineProps<{ selection: InsightSelection; filter: TransactionFilter }>();
const emit = defineEmits<{ close: [] }>();
const route = useRoute();
const popup = ref<HTMLElement | null>(null);
const list = ref<HTMLElement | null>(null);
const items = ref<Transaction[]>([]);
const total = ref(0);
const page = ref(0);
const loading = ref(false);
const error = ref("");
const position = ref({ left: "0px", top: "0px" });
const placed = ref(false);
let request = 0;
let observer: ResizeObserver | undefined;
// A click may follow a focus/scrollIntoView whose scroll event is still queued.
// Compare positions so that event cannot dismiss the popup that just opened.
let scrollPositions = new Map<Element, { left: number; top: number }>();
const periodLabel = computed(() => props.selection.from === props.selection.to
  ? props.selection.from : props.selection.from + " 至 " + props.selection.to);

function place() {
  const element = popup.value;
  if (!element) return;
  const viewport = window.visualViewport;
  const left = (viewport?.offsetLeft ?? 0) + 10;
  const top = (viewport?.offsetTop ?? 0) + 10;
  const right = left + (viewport?.width ?? window.innerWidth) - 20;
  const bottom = top + (viewport?.height ?? window.innerHeight) - 20;
  const { width, height } = element.getBoundingClientRect();
  // Flip beside the pointer near the edges, then clamp within the visible screen.
  const x = props.selection.x + 12 + width <= right
    ? props.selection.x + 12 : props.selection.x - width - 12;
  const y = props.selection.y + 12 + height <= bottom
    ? props.selection.y + 12 : props.selection.y - height - 12;
  position.value = {
    left: Math.max(left, Math.min(x, right - width)) + "px",
    top: Math.max(top, Math.min(y, bottom - height)) + "px",
  };
  placed.value = true;
}
async function load(reset = false) {
  if (!reset && loading.value) return;
  const token = ++request;
  const nextPage = reset ? 1 : page.value + 1;
  if (reset) {
    items.value = [];
    page.value = 0;
    total.value = 0;
    if (list.value) list.value.scrollTop = 0;
  }
  error.value = "";
  const filter = insightTransactionFilter(props.filter, props.selection.from, props.selection.to);
  if (!filter) {
    loading.value = false;
    return;
  }
  loading.value = true;
  try {
    const result = await txnService.query({ filter, page: nextPage, pageSize: 30, sortBy: "amount", sortDir: "desc" });
    if (token !== request) return;
    items.value = reset ? result.items : [...items.value, ...result.items];
    total.value = result.totalCount;
    page.value = nextPage;
  } catch (cause) {
    if (token === request) error.value = cause instanceof Error ? cause.message : "暂时无法读取收支";
  } finally {
    if (token === request) loading.value = false;
  }
}
watch(() => props.selection, () => {
  void load(true);
  void nextTick(place);
}, { immediate: true });
watch(() => JSON.stringify(props.filter), () => emit("close"));
watch(() => route.fullPath, () => emit("close"));
function outside(event: PointerEvent) {
  if (!popup.value?.contains(event.target as Node)) emit("close");
}
function scroll(event: Event) {
  // Scrolling the list keeps the popup; moving its underlying chart dismisses it.
  if (popup.value?.contains(event.target as Node)) return;
  const target = event.target === document ? document.scrollingElement : event.target;
  if (!(target instanceof Element)) return;
  const previous = scrollPositions.get(target);
  if (previous?.left === target.scrollLeft && previous.top === target.scrollTop) return;
  emit("close");
}
function keydown(event: KeyboardEvent) {
  if (event.key !== "Escape" || event.isComposing) return;
  event.preventDefault();
  event.stopPropagation();
  emit("close");
}
const dismiss = () => emit("close");
onMounted(() => {
  scrollPositions = new Map(
    [document.scrollingElement, ...document.querySelectorAll(".work-area,.account-rail")]
      .filter((element): element is Element => element !== null)
      .map(element => [element, { left: element.scrollLeft, top: element.scrollTop }]),
  );
  observer = new ResizeObserver(place);
  if (popup.value) observer.observe(popup.value);
  place();
  document.addEventListener("pointerdown", outside, true);
  document.addEventListener("scroll", scroll, true);
  window.addEventListener("keydown", keydown, true);
  window.addEventListener("resize", dismiss);
  window.visualViewport?.addEventListener("resize", dismiss);
  window.visualViewport?.addEventListener("scroll", dismiss);
});
onUnmounted(() => {
  request++;
  observer?.disconnect();
  document.removeEventListener("pointerdown", outside, true);
  document.removeEventListener("scroll", scroll, true);
  window.removeEventListener("keydown", keydown, true);
  window.removeEventListener("resize", dismiss);
  window.visualViewport?.removeEventListener("resize", dismiss);
  window.visualViewport?.removeEventListener("scroll", dismiss);
});
</script>

<template>
  <Teleport to="body">
    <section
      ref="popup"
      class="insight-transactions"
      :style="{ ...position, visibility: placed ? 'visible' : 'hidden' }"
      role="region"
      aria-label="区间收支明细"
      :aria-busy="loading"
    >
      <header class="insight-transactions-head">
        <div>
          <strong>{{ periodLabel }}</strong>
          <small>收支明细 · 金额从高到低</small>
        </div>
        <button type="button" class="icon-btn" aria-label="关闭收支明细" @click="$emit('close')">
          <AppIcon name="close" :size="16" />
        </button>
      </header>
      <div ref="list" class="insight-transactions-list">
        <ul v-if="items.length">
          <li v-for="item in items" :key="item.id" class="insight-transaction" :data-id="item.id">
            <span :title="item.title || '未命名交易'">{{ item.title || "未命名交易" }}</span>
            <b class="num" :class="item.type === 'income' ? 'pos' : 'neg'">{{ txnAmount(item) }}</b>
          </li>
        </ul>
        <div v-if="loading" class="insight-transactions-state" role="status">
          <i class="insight-transactions-spinner" aria-hidden="true" />正在读取收支…
        </div>
        <div v-else-if="error" class="insight-transactions-state" role="status">
          <span>{{ error }}</span>
          <button type="button" class="insight-transactions-more" @click="load()">重试</button>
        </div>
        <p v-else-if="!items.length" class="insight-transactions-state">这段时间暂无符合筛选的收支</p>
        <button
          v-else-if="items.length < total"
          type="button"
          class="insight-transactions-more"
          @click="load()"
        >加载更多 · 已显示 {{ items.length }} / {{ total }} 笔</button>
      </div>
    </section>
  </Teleport>
</template>

<style scoped>
.insight-transactions {
  position: fixed;
  z-index: 35;
  width: min(320px, calc(100vw - 20px));
  max-height: min(360px, calc(100dvh - 20px));
  display: flex;
  flex-direction: column;
  border: 1px solid var(--border);
  border-radius: 14px;
  background: var(--surface);
  box-shadow: 0 12px 36px #253b3326, 0 2px 8px #253b330a;
  animation: insight-popup-in 160ms ease-out;
}
.insight-transactions-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  flex-shrink: 0;
  padding: 12px 10px 11px 15px;
  border-bottom: 1px solid var(--border);
}
.insight-transactions-head strong {
  display: block;
  font-size: 12px;
  font-weight: 600;
}
.insight-transactions-head small {
  display: block;
  font-size: 10px;
  color: var(--fg-3);
  margin-top: 3px;
}
.insight-transactions-head button {
  flex-shrink: 0;
}
.insight-transactions-list {
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: 4px 14px;
}
.insight-transactions-list ul {
  list-style: none;
}
.insight-transaction {
  display: flex;
  align-items: baseline;
  gap: 14px;
  padding: 10px 0;
  border-bottom: 1px solid var(--border);
  font-size: 12px;
}
.insight-transaction:last-child {
  border-bottom: 0;
}
.insight-transaction span {
  min-width: 0;
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.insight-transaction b {
  flex-shrink: 0;
  font-weight: 600;
}
.insight-transactions-state {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-wrap: wrap;
  gap: 8px;
  min-height: 88px;
  padding: 18px 4px;
  color: var(--fg-3);
  font-size: 12px;
  text-align: center;
}
.insight-transactions-more {
  width: 100%;
  min-height: 40px;
  color: var(--primary);
  font-size: 11px;
  border-radius: 8px;
  margin: 4px 0;
}
.insight-transactions-more:hover {
  background: var(--primary-soft);
}
.insight-transactions-spinner {
  width: 13px;
  height: 13px;
  border: 2px solid var(--border);
  border-top-color: var(--primary);
  border-radius: 50%;
  animation: insight-popup-spin 800ms linear infinite;
}
@keyframes insight-popup-spin {
  to { transform: rotate(360deg); }
}
@keyframes insight-popup-in {
  from { opacity: 0; }
  to { opacity: 1; }
}
</style>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type { Account, TxnType } from "../api";
import { yuanToCents } from "../services/money";
import AppIcon from "./AppIcon.vue";
const props = defineProps<{
  accounts: Account[];
  categories: string[];
  allowTransfer?: boolean;
  alwaysOpen?: boolean;
}>();
const types = defineModel<TxnType[]>("types", { required: true });
const accountIds = defineModel<string[]>("accountIds", { required: true });
const categoryNames = defineModel<string[]>("categoryNames", {
  required: true,
});
const min = defineModel<number | null>("min", { required: true });
const max = defineModel<number | null>("max", { required: true });
const open = ref(props.alwaysOpen || false);
const minInput = ref("");
const maxInput = ref("");
watch(
  [min, max],
  () => {
    minInput.value = min.value === null ? "" : String(min.value / 100);
    maxInput.value = max.value === null ? "" : String(max.value / 100);
  },
  { immediate: true },
);
const amountError = ref("");
const count = computed(
  () =>
    types.value.length +
    accountIds.value.length +
    categoryNames.value.length +
    Number(min.value !== null || max.value !== null),
);
const typeOptions = computed(() =>
  props.allowTransfer
    ? (["expense", "income", "transfer"] as const)
    : (["expense", "income"] as const),
);
const typeLabel = (v: string) =>
  ({ expense: "支出", income: "收入", transfer: "转账" })[v];
function toggle<T>(list: T[], value: T): T[] {
  return list.includes(value)
    ? list.filter((v) => v !== value)
    : [...list, value];
}
function toggleOpen() {
  open.value = !open.value;
  minInput.value = min.value === null ? "" : String(min.value / 100);
  maxInput.value = max.value === null ? "" : String(max.value / 100);
}
function applyAmount() {
  try {
    for (const value of [minInput.value, maxInput.value]) {
      if (value.trim() && !/^\d+(?:\.\d{1,2})?$/.test(value.trim()))
        throw new Error();
    }
    const a = minInput.value.trim() ? yuanToCents(minInput.value.trim()) : null;
    const b = maxInput.value.trim() ? yuanToCents(maxInput.value.trim()) : null;
    if (
      (a !== null && a < 0) ||
      (b !== null && b < 0) ||
      (a !== null && b !== null && a > b)
    )
      throw new Error();
    min.value = a;
    max.value = b;
    amountError.value = "";
  } catch {
    amountError.value =
      "请输入非负金额，最多两位小数，最低金额不能大于最高金额。";
  }
}
function reset() {
  types.value = [];
  accountIds.value = [];
  categoryNames.value = [];
  min.value = null;
  max.value = null;
  minInput.value = "";
  maxInput.value = "";
  amountError.value = "";
}
</script>
<template>
  <section class="filters">
    <div class="filter-line">
      <button
        v-if="!alwaysOpen"
        class="btn btn-ghost btn-sm"
        :class="{ 'filter-active': count > 0 }"
        :aria-expanded="open"
        @click="toggleOpen"
      >
        <AppIcon name="filter" :size="16" />筛选<span
          v-if="count"
          class="filter-count"
          >{{ count }}</span
        >
      </button>
      <span v-if="!count" class="filter-hint"
        >默认统计普通账户 · 可选择专项账户</span
      >
      <button
        v-for="id in accountIds"
        :key="id"
        class="filter-tag"
        @click="accountIds = accountIds.filter((v) => v !== id)"
      >
        {{ accounts.find((a) => a.id === id)?.name
        }}<AppIcon name="close" :size="12" />
      </button>
      <button
        v-for="t in types"
        :key="t"
        class="filter-tag"
        @click="types = types.filter((v) => v !== t)"
      >
        {{ typeLabel(t) }}<AppIcon name="close" :size="12" />
      </button>
      <button
        v-for="c in categoryNames"
        :key="c"
        class="filter-tag"
        @click="categoryNames = categoryNames.filter((v) => v !== c)"
      >
        {{ c }}<AppIcon name="close" :size="12" />
      </button>
      <button
        v-if="min !== null || max !== null"
        class="filter-tag"
        @click="
          min = null;
          max = null;
        "
      >
        金额 {{ min === null ? "不限" : min / 100 }} —
        {{ max === null ? "不限" : max / 100
        }}<AppIcon name="close" :size="12" />
      </button>
      <button v-if="count" class="text-button" @click="reset">清空筛选</button>
    </div>
    <div
      v-if="open || alwaysOpen"
      class="filter-body"
      @keydown.esc.stop="open = false"
    >
      <div class="filter-group">
        <span>交易类型</span>
        <div>
          <button
            v-for="t in typeOptions"
            :key="t"
            class="choice"
            :class="{ on: types.includes(t) }"
            :aria-pressed="types.includes(t)"
            @click="types = toggle(types, t)"
          >
            {{ typeLabel(t) }}
          </button>
        </div>
      </div>
      <div class="filter-group">
        <span>账户</span>
        <div>
          <button
            v-for="a in accounts"
            :key="a.id"
            class="choice"
            :class="{ on: accountIds.includes(a.id) }"
            :aria-pressed="accountIds.includes(a.id)"
            @click="accountIds = toggle(accountIds, a.id)"
          >
            {{ a.name }}<small v-if="a.kind === 'project'">专项</small></button
          ><span v-if="!accounts.length" class="muted">暂无账户</span>
        </div>
      </div>
      <div class="filter-group">
        <span>分类</span>
        <div>
          <button
            v-for="c in categories"
            :key="c"
            class="choice"
            :class="{ on: categoryNames.includes(c) }"
            :aria-pressed="categoryNames.includes(c)"
            @click="categoryNames = toggle(categoryNames, c)"
          >
            {{ c }}</button
          ><span v-if="!categories.length" class="muted">暂无分类</span>
        </div>
      </div>
      <div class="filter-group">
        <span>金额 / 元</span>
        <div class="amount-range">
          <input
            v-model="minInput"
            class="input"
            aria-label="最低金额"
            placeholder="最低金额"
            inputmode="decimal"
          /><span>—</span
          ><input
            v-model="maxInput"
            class="input"
            aria-label="最高金额"
            placeholder="最高金额"
            inputmode="decimal"
          /><button class="btn btn-secondary btn-sm" @click="applyAmount">
            应用金额
          </button>
        </div>
      </div>
      <p v-if="amountError" class="neg" role="alert">{{ amountError }}</p>
      <div class="filter-finish">
        <slot /><button
          v-if="!alwaysOpen"
          class="text-button"
          @click="open = false"
        >
          收起筛选 ↑
        </button>
      </div>
    </div>
  </section>
</template>
<style scoped>
.filters {
  min-width: 0;
}
.filter-line {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.filter-hint {
  font-size: 12px;
  color: var(--fg-3);
}
.filter-count {
  background: var(--primary);
  color: white;
  font-size: 10px;
  padding: 1px 5px;
  border-radius: 4px;
}
.filter-active,
.filter-tag {
  color: var(--primary);
  background: var(--primary-soft);
}
.filter-tag {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 9px;
  border-radius: 6px;
  font-size: 12px;
  max-width: 100%;
  overflow-wrap: anywhere;
}
.filter-body {
  background: var(--surface-2);
  border: 1px solid var(--border);
  padding: 16px;
  border-radius: 10px;
  margin-top: 12px;
}
.filter-group {
  display: grid;
  grid-template-columns: 72px minmax(0, 1fr);
  gap: 10px;
  align-items: start;
  margin-bottom: 12px;
}
.filter-group > span {
  font-size: 12px;
  color: var(--fg-2);
  padding-top: 7px;
}
.filter-group > div {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.choice {
  padding: 6px 10px;
  border: 1px solid var(--border);
  background: var(--surface);
  border-radius: 6px;
  font-size: 12px;
}
.choice.on {
  border-color: var(--primary);
  color: var(--primary);
  background: var(--primary-soft);
}
.choice small {
  margin-left: 5px;
  opacity: 0.65;
}
.amount-range .input {
  width: 130px;
  padding: 7px 10px;
}
.filter-finish {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
  justify-content: space-between;
  align-items: center;
}
@media (max-width: 720px) {
  .filter-hint {
    font-size: 11px;
  }
  .filter-body {
    padding: 12px;
  }
  .filter-group {
    grid-template-columns: 1fr;
    gap: 5px;
  }
  .filter-group > span {
    padding: 0;
  }
  .amount-range .input {
    width: calc(50% - 14px);
  }
  .choice {
    min-height: 34px;
  }
  .filter-tag {
    font-size: 11px;
  }
}
</style>

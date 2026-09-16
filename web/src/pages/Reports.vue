<script setup lang="ts">
import { usePageRefresh } from '../composables/usePageRefresh';
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import {
  accountService,
  categoryService,
  tagService,
  statsService, emptySummary,
  format,
  type Account,
  type Category,
  type Id,
  type Tag,
  type TxnType,
  type TransactionFilter, type CategoryTotal, type DailyResult,

} from '../api';
import ExpenseHeatmap from '../components/ExpenseHeatmap.vue';
import { useReportRange, type RangeMode } from '../composables/useReportRange';

import LoadError from '../components/LoadError.vue';
import PageSkeleton from '../components/PageSkeleton.vue';

const { rangeMode, customFrom, customTo, dateFrom, dateTo } = useReportRange();

const rangeLabel = computed(() => dateFrom.value + ' – ' + dateTo.value);

const RANGE_TABS: ReadonlyArray<{ v: RangeMode; label: string }> = [
  { v: 'month', label: '本月' },
  { v: '30d', label: '近 30 天' },
  { v: 'year', label: '本年' },
  { v: 'custom', label: '自定义' },
];

const selectedTypes = ref<TxnType[]>([]); // 仅 income/expense 可选
const selectedAccountIds = ref<Id[]>([]);
const selectedCategoryNames = ref<string[]>([]); // 展示层按名去重
const selectedTagIds = ref<Id[]>([]);
const amountMinCents = ref<number | null>(null);
const amountMaxCents = ref<number | null>(null);

const pieDir = ref<Extract<TxnType, 'income' | 'expense'>>('expense');

const accounts = ref<Account[]>([]);
const allCategories = ref<Category[]>([]);
const tags = ref<Tag[]>([]);

const uniqueCategoryNames = computed<string[]>(() => {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const c of allCategories.value) {
    if (!seen.has(c.name)) {
      seen.add(c.name);
      out.push(c.name);
    }
  }
  return out;
});

async function loadStatic(): Promise<void> {
  const [result, cats, tagList] = await Promise.all([accountService.list(), categoryService.list(), tagService.list()]);
  accounts.value = result.items;
  allCategories.value = cats;
  tags.value = tagList;
}
const loading = ref(false);
const initializing = ref(true);
const initializingRequest = ref(false);
const error = ref('');
const summary = ref(emptySummary());
const categoryTotals = ref<CategoryTotal[]>([]);
const daily = ref<DailyResult>({ days: [], startWeekday: 0, weekCount: 0, total: 0, activeDays: 0 });

function categoryIdsForNames(names: string[]): Id[] {
  if (names.length === 0) return [];
  const set = new Set(names);
  return allCategories.value.filter((c) => set.has(c.name)).map((c) => c.id);
}

const activeQuery = computed<TransactionFilter>(() => {
  const q: TransactionFilter = {
    dateFrom: dateFrom.value,
    dateTo: dateTo.value,
    projectScope: 'selected',
  };
  if (selectedTypes.value.length > 0) q.types = [...selectedTypes.value];
  if (selectedAccountIds.value.length > 0) q.accountIds = [...selectedAccountIds.value];
  const catIds = categoryIdsForNames(selectedCategoryNames.value);
  if (catIds.length > 0) q.categoryIds = catIds;
  if (selectedTagIds.value.length > 0) q.tagIds = [...selectedTagIds.value];
  if (amountMinCents.value !== null) q.amountMin = amountMinCents.value;
  if (amountMaxCents.value !== null) q.amountMax = amountMaxCents.value;
  return q;
});

let loadRequest = 0;
async function load(): Promise<void> {
  const request = ++loadRequest;
  loading.value = true;
  error.value = '';
  try {
    const filter = activeQuery.value;
    const [nextSummary, nextCategories, nextDaily] = await Promise.all([
      statsService.summary(filter), statsService.categories(filter, 'name', pieDir.value), statsService.daily(filter),
    ]);
    if (request !== loadRequest) return;
    summary.value = nextSummary;
    categoryTotals.value = nextCategories;
    daily.value = nextDaily;
  } catch (e) {
    if (request === loadRequest) {
      error.value = (e as Error).message;
      summary.value = emptySummary(); categoryTotals.value = [];
      daily.value = { days: [], startWeekday: 0, weekCount: 0, total: 0, activeDays: 0 };
    }
  } finally {
    if (request === loadRequest) loading.value = false;
  }
}

async function initialize(): Promise<void> {
  if (initializingRequest.value) return;
  initializingRequest.value = true;
  error.value = '';
  try { await loadStatic(); await load(); }
  catch (e) { error.value = (e as Error).message; }
  finally { initializing.value = false; initializingRequest.value = false; }
}
onMounted(async () => {
  window.addEventListener('keydown', onReportsKeydown);
  await initialize();
});

onUnmounted(() => {
  loadRequest++;
  window.removeEventListener('keydown', onReportsKeydown);
});

function onReportsKeydown(e: KeyboardEvent): void {
  if (e.altKey || e.isComposing) return;
  if (e.key === 'Escape' && addOpen.value) {
    if (addDim.value !== null) addDim.value = null;
    else closeAdd();
    e.preventDefault();
  }
}

function onRangeKeydown(e: KeyboardEvent): void {
  if (e.altKey || e.metaKey || e.ctrlKey || e.shiftKey || e.isComposing) return;
  if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
  const idx = RANGE_TABS.findIndex((t) => t.v === rangeMode.value);
  const next = (idx + (e.key === 'ArrowRight' ? 1 : -1) + RANGE_TABS.length) % RANGE_TABS.length;
  rangeMode.value = RANGE_TABS[next].v;
  (e.currentTarget as HTMLElement).querySelectorAll<HTMLButtonElement>('button')[next]?.focus();
  e.preventDefault();
  e.stopPropagation();
}

watch([activeQuery, pieDir], () => void load(), { deep: true });

const summaryIncome = computed(() => summary.value.income);
const summaryExpense = computed(() => summary.value.expense);
const summaryNet = computed(() => summary.value.net);
const summaryCount = computed(() => summary.value.incomeCount + summary.value.expenseCount);
interface BreakdownRow { name: string; amount: number; count: number; latest: number }
const pieGroups = computed<BreakdownRow[]>(() => categoryTotals.value.filter(row => row[pieDir.value] > 0).map(row => ({
  name: row.name, amount: row[pieDir.value], count: pieDir.value === 'expense' ? row.expenseCount : row.incomeCount, latest: row.latest,
})));
const pieTotal = computed(() => pieDir.value === 'expense' ? summary.value.expense : summary.value.income);

const colorByName = computed<Map<string, string>>(() => {
  const m = new Map<string, string>();
  pieGroups.value.forEach((g, i) => m.set(g.name, `var(--chart-${(i % 7) + 1})`));
  return m;
});

const donutStyle = computed<Record<string, string>>(() => {
  const rows = pieGroups.value;
  const total = pieTotal.value;
  if (total <= 0 || rows.length === 0) return { background: 'var(--surface-3)' };
  const stops: string[] = [];
  let acc = 0;
  rows.forEach((r, i) => {
    const start = (acc / total) * 100;
    acc += r.amount;
    const end = (acc / total) * 100;
    stops.push(`var(--chart-${(i % 7) + 1}) ${start}% ${end}%`);
  });
  return { background: `conic-gradient(${stops.join(', ')})` };
});

const rankRows = computed<BreakdownRow[]>(() => pieGroups.value);
const rankMax = computed<number>(() => rankRows.value.reduce((m, r) => Math.max(m, r.amount), 0));

function withThousands(s: string): string {
  return s.replace(/\d+(?=\.)/, (m) => m.replace(/\B(?=(\d{3})+(?!\d))/g, ','));
}
function fmtMoney(cents: number, opts?: { sign?: boolean; symbol?: string }): string {
  return withThousands(format(cents, opts));
}

function fmtYuanInt(cents: number): string {
  const yuan = Math.round(Math.abs(cents) / 100);
  return String(yuan).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function pct(amount: number): string {
  const t = pieTotal.value;
  return t > 0 ? ((amount / t) * 100).toFixed(1) : '0.0';
}
function barWidth(amount: number): string {
  const m = rankMax.value;
  return m > 0 ? `${(amount / m) * 100}%` : '0%';
}

function typeLabel(t: TxnType): string {
  return t === 'income' ? '收入' : t === 'expense' ? '支出' : '转账';
}
function accountName(id: Id): string {
  return accounts.value.find((a) => a.id === id)?.name ?? '';
}
function tagName(id: Id): string {
  return tags.value.find((t) => t.id === id)?.name ?? '';
}

type AddDim = 'type' | 'account' | 'category' | 'tag' | 'amount';
const addOpen = ref(false);
const addDim = ref<AddDim | null>(null);
const amountMinInput = ref<string>('');
const amountMaxInput = ref<string>('');

function openAdd(): void {
  addOpen.value = true;
  addDim.value = null;
}
function closeAdd(): void {
  addOpen.value = false;
  addDim.value = null;
}

function toggleType(t: TxnType): void {
  const i = selectedTypes.value.indexOf(t);
  if (i >= 0) selectedTypes.value.splice(i, 1);
  else selectedTypes.value.push(t);
}
function toggleAccount(id: Id): void {
  const i = selectedAccountIds.value.indexOf(id);
  if (i >= 0) selectedAccountIds.value.splice(i, 1);
  else selectedAccountIds.value.push(id);
}
function toggleCategoryName(name: string): void {
  const i = selectedCategoryNames.value.indexOf(name);
  if (i >= 0) selectedCategoryNames.value.splice(i, 1);
  else selectedCategoryNames.value.push(name);
}
function toggleTag(id: Id): void {
  const i = selectedTagIds.value.indexOf(id);
  if (i >= 0) selectedTagIds.value.splice(i, 1);
  else selectedTagIds.value.push(id);
}
function applyAmount(): void {
  const min = amountMinInput.value.trim();
  const max = amountMaxInput.value.trim();
  amountMinCents.value = min ? Math.round(Number(min) * 100) : null;
  amountMaxCents.value = max ? Math.round(Number(max) * 100) : null;
  closeAdd();
}
function clearAmount(): void {
  amountMinCents.value = null;
  amountMaxCents.value = null;
  amountMinInput.value = '';
  amountMaxInput.value = '';
}
const amountChipLabel = computed<string>(() => {
  const parts: string[] = [];
  if (amountMinCents.value !== null) parts.push(`≥${fmtMoney(amountMinCents.value)}`);
  if (amountMaxCents.value !== null) parts.push(`≤${fmtMoney(amountMaxCents.value)}`);
  return parts.join(' ');
});
const hasAmountChip = computed(() => amountMinCents.value !== null || amountMaxCents.value !== null);

const hasAnyFilter = computed(
  () =>
    selectedTypes.value.length > 0 ||
    selectedAccountIds.value.length > 0 ||
    selectedCategoryNames.value.length > 0 ||
    selectedTagIds.value.length > 0 ||
    hasAmountChip.value,
);
function clearAll(): void {
  selectedTypes.value = [];
  selectedAccountIds.value = [];
  selectedCategoryNames.value = [];
  selectedTagIds.value = [];
  clearAmount();
}
usePageRefresh(() => { void initialize(); });
</script>

<template>
  <div class="content reports">
    <PageSkeleton v-if="initializing" label="报告" />
    <template v-else>
    <LoadError :message="error" @retry="initialize" />

    <div class="rep-head">
      <div class="range-tabs" role="tablist" aria-label="报告时间范围" @keydown="onRangeKeydown">
        <button
          v-for="tab in RANGE_TABS"
          :key="tab.v"
          class="range-tab"
          role="tab"
          :aria-selected="rangeMode === tab.v"
          :tabindex="rangeMode === tab.v ? 0 : -1"
          :class="{ on: rangeMode === tab.v }"
          @click="rangeMode = tab.v"
        >
          {{ tab.label }}
        </button>
      </div>
      <span class="kbd-hint range-kbd" aria-hidden="true">聚焦后 <span class="kbd">←</span><span class="kbd">→</span>切换范围</span>
      <div v-if="rangeMode === 'custom'" class="row gap-2 custom-range">
        <input type="date" class="input date-input" v-model="customFrom" aria-label="起始日期" />
        <span class="faint">至</span>
        <input type="date" class="input date-input" v-model="customTo" aria-label="结束日期" />
      </div>
      <span class="faint range-label num">{{ rangeLabel }}</span>
    </div>


    <div class="card card-pad" style="padding: 14px 16px">
      <div class="row wrap gap-2">
        <div class="row wrap gap-2">
          <span class="faint" style="font-size: 12px; font-weight: 600; margin-right: 2px">逐步筛选</span>

          <span v-for="t in selectedTypes" :key="'ty-' + t" class="chip chip-on">
            类型：{{ typeLabel(t) }}
            <span class="x" role="button" tabindex="0" aria-label="删除条件" @click="toggleType(t)" @keydown.enter.prevent="toggleType(t)" @keydown.space.prevent="toggleType(t)">×</span>
          </span>
          <span v-for="id in selectedAccountIds" :key="'ac-' + id" class="chip chip-on">
            账户：{{ accountName(id) }}
            <span class="x" role="button" tabindex="0" aria-label="删除条件" @click="toggleAccount(id)" @keydown.enter.prevent="toggleAccount(id)" @keydown.space.prevent="toggleAccount(id)">×</span>
          </span>
          <span v-for="name in selectedCategoryNames" :key="'ca-' + name" class="chip chip-on">
            分类：{{ name }}
            <span class="x" role="button" tabindex="0" aria-label="删除条件" @click="toggleCategoryName(name)" @keydown.enter.prevent="toggleCategoryName(name)" @keydown.space.prevent="toggleCategoryName(name)">×</span>
          </span>
          <span v-for="id in selectedTagIds" :key="'tg-' + id" class="chip chip-on">
            标签：{{ tagName(id) }}
            <span class="x" role="button" tabindex="0" aria-label="删除条件" @click="toggleTag(id)" @keydown.enter.prevent="toggleTag(id)" @keydown.space.prevent="toggleTag(id)">×</span>
          </span>
          <span v-if="hasAmountChip" class="chip chip-on">
            金额：{{ amountChipLabel }}
            <span class="x" role="button" tabindex="0" aria-label="删除条件" @click="clearAmount()" @keydown.enter.prevent="clearAmount()" @keydown.space.prevent="clearAmount()">×</span>
          </span>


          <span class="add-wrap">
            <span class="chip chip-add" role="button" @click="addOpen ? closeAdd() : openAdd()">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.4">
                <path d="M12 5v14M5 12h14" />
              </svg>
              添加条件
            </span>


            <div v-if="addOpen" class="add-backdrop" @click="closeAdd()"></div>
            <div v-if="addOpen" class="add-menu">
              <template v-if="addDim === null">
                <button class="add-item" @click="addDim = 'type'">类型</button>
                <button class="add-item" @click="addDim = 'account'">账户</button>
                <button class="add-item" @click="addDim = 'category'">分类</button>
                <button class="add-item" @click="addDim = 'tag'">标签</button>
                <button class="add-item" @click="addDim = 'amount'">金额范围</button>
              </template>

              <template v-else>
                <button class="add-back" @click="addDim = null">‹ 返回</button>

                <template v-if="addDim === 'type'">
                  <button
                    class="add-opt"
                    :class="{ sel: selectedTypes.includes('expense') }"
                    @click="toggleType('expense')"
                  >
                    支出
                  </button>
                  <button
                    class="add-opt"
                    :class="{ sel: selectedTypes.includes('income') }"
                    @click="toggleType('income')"
                  >
                    收入
                  </button>
                </template>

                <template v-else-if="addDim === 'account'">
                  <button
                    v-for="a in accounts"
                    :key="a.id"
                    class="add-opt"
                    :class="{ sel: selectedAccountIds.includes(a.id) }"
                    @click="toggleAccount(a.id)"
                  >
                    {{ a.name }}<span v-if="a.kind === 'project'" class="opt-tag">专项</span>
                  </button>
                </template>

                <template v-else-if="addDim === 'category'">
                  <div v-if="uniqueCategoryNames.length === 0" class="add-empty">暂无分类</div>
                  <button
                    v-for="name in uniqueCategoryNames"
                    :key="name"
                    class="add-opt"
                    :class="{ sel: selectedCategoryNames.includes(name) }"
                    @click="toggleCategoryName(name)"
                  >
                    {{ name }}
                  </button>
                </template>

                <template v-else-if="addDim === 'tag'">
                  <div v-if="tags.length === 0" class="add-empty">暂无标签</div>
                  <button
                    v-for="tg in tags"
                    :key="tg.id"
                    class="add-opt"
                    :class="{ sel: selectedTagIds.includes(tg.id) }"
                    @click="toggleTag(tg.id)"
                  >
                    {{ tg.name }}
                  </button>
                </template>

                <template v-else-if="addDim === 'amount'">
                  <div class="add-amount">
                    <input class="input" v-model="amountMinInput" placeholder="最小(元)" inputmode="decimal" />
                    <input class="input" v-model="amountMaxInput" placeholder="最大(元)" inputmode="decimal" />
                    <button class="btn btn-primary btn-sm btn-block" @click="applyAmount()">应用</button>
                  </div>
                </template>
              </template>
            </div>
          </span>

          <span
            v-if="hasAnyFilter"
            class="chip chip-add"
            role="button"
            style="border-style: solid"
            @click="clearAll()"
          >
            清空
          </span>
        </div>
      </div>
    </div>


    <PageSkeleton v-if="loading || initializingRequest" label="报告统计" />
    <template v-else>
    <div class="grid g-3 mt-4">
      <div class="stat">
        <div class="s-label">
          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M12 5v14M5 12l7 7 7-7" />
          </svg>
          支出合计
        </div>
        <div class="s-value neg num">−{{ fmtMoney(summaryExpense) }}</div>
        <div class="s-trend">{{ summary.expenseCount }} 笔支出</div>
      </div>
      <div class="stat">
        <div class="s-label">
          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M12 19V5M5 12l7-7 7 7" />
          </svg>
          收入合计
        </div>
        <div class="s-value pos num">{{ fmtMoney(summaryIncome, { sign: true }) }}</div>
        <div class="s-trend">净额 <b class="num" :class="summaryNet >= 0 ? 'pos' : 'neg'">{{ fmtMoney(summaryNet, { sign: true }) }}</b></div>
      </div>
      <div class="stat">
        <div class="s-label">
          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2" />
            <rect x="9" y="3" width="6" height="4" rx="1" />
            <path d="M9 12h6M9 16h4" />
          </svg>
          笔数
        </div>
        <div class="s-value num">{{ summaryCount }}</div>
        <div class="s-trend">已按当前筛选统计（不含转账）</div>
      </div>
    </div>

    <div class="card category-breakdown mt-4">
      <div class="card-head">
        <h3>{{ pieDir === 'expense' ? '支出' : '收入' }}分类</h3>
        <div class="row gap-2">
          <button type="button" class="mini-toggle" :class="{ on: pieDir === 'expense' }" :aria-pressed="pieDir === 'expense'" @click="pieDir = 'expense'">支出</button>
          <button type="button" class="mini-toggle" :class="{ on: pieDir === 'income' }" :aria-pressed="pieDir === 'income'" @click="pieDir = 'income'">收入</button>
        </div>
      </div>
      <div class="card-pad">
        <div v-if="pieGroups.length === 0" class="empty">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6">
            <circle cx="12" cy="12" r="9" />
            <path d="M12 3v9l6 3" />
          </svg>
          <div style="font-weight: 700; color: var(--fg-2)">当前范围暂无{{ pieDir === 'expense' ? '支出' : '收入' }}</div>
        </div>
        <div v-else class="category-content">
          <div class="category-chart">
            <div class="donut" :style="donutStyle">
              <div class="donut-center">
                <div>
                  <div class="faint" style="font-size: 11px; font-weight: 600">{{ pieDir === 'expense' ? '支出' : '收入' }}</div>
                  <div class="mono-lg" style="font-size: 18px">¥{{ fmtYuanInt(pieTotal) }}</div>
                </div>
              </div>
            </div>
          </div>
          <div class="category-detail">
            <div class="category-detail-head">
              <span class="muted" title="跨账户按分类名合并">分类明细</span>
              <span class="faint">金额（高→低）</span>
            </div>
            <div class="stack gap-4">
              <div v-for="row in rankRows" :key="row.name">
                <div class="rank-label">
                  <span class="rank-name">
                    <span class="lg-dot" :style="{ background: colorByName.get(row.name) }"></span>
                    <span class="category-name" :title="row.name">{{ row.name }}</span>
                  </span>
                  <span class="rank-amount num muted">{{ fmtMoney(row.amount) }} · <b class="tag-inline">{{ pct(row.amount) }}%</b></span>
                </div>
                <div class="bar-track">
                  <div class="bar-fill" :style="{ width: barWidth(row.amount), background: colorByName.get(row.name) }"></div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <ExpenseHeatmap class="mt-4" :data="daily" />
    </template>
    </template>
  </div>
</template>

<style scoped>
/* 报告页顶部范围选择行 */
.rep-head {
  display: flex;
  align-items: center;
  gap: 14px;
  margin-bottom: 16px;
  flex-wrap: wrap;
}
.range-tabs {
  display: flex;
  gap: 4px;
  background: var(--surface-2);
  border-radius: var(--r-pill);
  padding: 4px;
}
.range-tab {
  padding: 7px 14px;
  border-radius: var(--r-pill);
  font-weight: 600;
  font-size: var(--fs-sm);
  color: var(--fg-2);
}
.range-tab:hover {
  background: var(--surface-3);
}
.range-tab.on {
  background: var(--primary-soft);
  color: var(--primary);
}
.date-input {
  width: auto;
  padding: 7px 10px;
}
.range-label {
  font-size: var(--fs-sm);
}

/* 饼图方向小切换 */
.mini-toggle {
  font-size: var(--fs-xs);
  font-weight: 700;
  padding: 4px 10px;
  border-radius: var(--r-pill);
  color: var(--fg-3);
}
.mini-toggle.on {
  background: var(--primary-soft);
  color: var(--primary);
}

/* 添加条件弹层 */
.add-wrap {
  position: relative;
  display: inline-flex;
}
.chip .x {
  cursor: pointer;
}
/* 让筛选 chip、添加/清空按钮位于 add-backdrop 之上，
   否则弹层打开时全屏遮罩会盖住这些 chip，导致 × 移除/清空点不到。
   整套下拉层级抬到手机底栏(.m-tabbar z:30 / .m-fab z:31)之上，
   否则窄屏/矮屏下菜单底部会被固定底栏盖住、点击落到底栏误切页。band=40/41/42。 */
.chip-on,
.chip-add {
  position: relative;
  z-index: 42;
}
.add-backdrop {
  position: fixed;
  inset: 0;
  z-index: 40;
}
.add-menu {
  position: absolute;
  top: calc(100% + 6px);
  left: 0;
  z-index: 41;
  min-width: 170px;
  max-height: 280px;
  overflow: auto;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--r-md);
  box-shadow: var(--sh-3);
  padding: 6px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.add-item,
.add-opt,
.add-back {
  text-align: left;
  padding: 8px 10px;
  border-radius: var(--r-sm);
  font-size: var(--fs-sm);
  font-weight: 600;
  color: var(--fg);
}
.add-item:hover,
.add-opt:hover {
  background: var(--surface-2);
}
.add-back {
  color: var(--fg-3);
  font-weight: 600;
}
.add-opt.sel {
  background: var(--primary-soft);
  color: var(--primary);
}
.add-opt.sel::after {
  content: '✓';
  margin-left: 8px;
}
.opt-tag {
  margin-left: 6px;
  padding: 1px 6px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 700;
  background: var(--surface-3, rgba(147, 52, 230, 0.14));
  color: #9334e6;
}
.add-empty {
  padding: 8px 10px;
  font-size: var(--fs-sm);
  color: var(--fg-3);
}
.add-amount {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 4px;
}

/* ---- 图表类（设计稿 app.css 移植；tokens.css 未含，故在此就地定义） ---- */
.donut {
  width: 160px;
  height: 160px;
  border-radius: 50%;
  position: relative;
  flex-shrink: 0;
}
.donut::after {
  content: '';
  position: absolute;
  inset: 26px;
  background: var(--surface);
  border-radius: 50%;
}
.donut-center {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  z-index: 2;
  text-align: center;
}
.category-breakdown { min-width: 0; }
.category-breakdown .card-head { flex-wrap: wrap; gap: 8px; }
.category-content {
  display: grid;
  grid-template-columns: 200px minmax(0, 1fr);
  align-items: center;
  gap: 32px;
}
.category-chart { display: flex; justify-content: center; }
.category-detail { min-width: 0; }
.category-detail-head {
  display: flex;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 16px;
  font-size: var(--fs-xs);
}
.lg-dot {
  width: 10px;
  height: 10px;
  border-radius: 3px;
  flex-shrink: 0;
}
.category-name {
  min-width: 0;
  flex: 1;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.rank-label {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 6px 12px;
  margin-bottom: 6px;
}
.rank-name {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  flex: 1 1 80px;
  font-weight: 600;
}
.rank-amount { margin-left: auto; font-size: var(--fs-sm); overflow-wrap: anywhere; }

.bar-track {
  height: 8px;
  background: var(--surface-3);
  border-radius: var(--r-pill);
  overflow: hidden;
}
.bar-fill {
  height: 100%;
  border-radius: var(--r-pill);
}

.grid.g-3 { grid-template-columns: repeat(3, minmax(0, 1fr)); }
.stat { min-width: 0; overflow-wrap: anywhere; }

@media (max-width: 960px) {
  .category-content { grid-template-columns: minmax(0, 1fr); gap: 24px; }
}

@media (min-width: 721px) and (max-width: 960px) {
  .grid.g-3 { grid-template-columns: minmax(0, 1fr); }
}

@media (max-width: 720px) {

  /* 汇总三卡：窄屏挤不下三列 → 单列铺满 */
  .grid.g-3 {
    grid-template-columns: 1fr;
  }

  /* 顶部范围选择行：允许换行 */
  .rep-head {
    gap: 10px;
  }

  .donut {
    width: 128px;
    height: 128px;
  }

  /* 添加条件弹层：不超出视口宽度 */
  .add-menu {
    max-width: calc(100vw - 32px);
  }
}
</style>

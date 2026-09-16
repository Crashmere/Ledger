<script setup lang="ts">
import { usePageRefresh } from '../composables/usePageRefresh';
import { computed, onMounted, onBeforeUnmount, nextTick, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { useSelectedMonth } from '../composables/useSelectedMonth';
import {
  accountService,
  categoryService,
  tagService,
  txnService, statsService, emptySummary,
  format,
  type Account,
  type Category,
  type Id,
  type Tag,
  type TxnType,
  type TransactionFilter,
  type TxnWithTags,
} from '../api';

import Pagination from '../components/Pagination.vue';
import LoadError from '../components/LoadError.vue';
import PageSkeleton from '../components/PageSkeleton.vue';
import HighlightText from '../components/HighlightText.vue';
import { dayLabel } from '../services/dates';
const router = useRouter();
const { dateFrom, dateTo, monthLabel } = useSelectedMonth();
const filterByMonth = ref(false);

function openEdit(id: Id): void {
  void router.push(`/txn/${id}/edit`);
}

function copyTxn(id: Id): void {
  void router.push({ path: '/add', query: { copy: id } });
}

const keyword = ref<string>('');

type SearchField = 'title' | 'note' | 'category' | 'tag';
const SEARCH_FIELDS: ReadonlyArray<{ v: SearchField; label: string }> = [
  { v: 'title', label: '标题' },
  { v: 'note', label: '备注' },
  { v: 'category', label: '分类' },
  { v: 'tag', label: '标签' },
];
const DEFAULT_SEARCH_FIELDS: SearchField[] = ['title', 'note', 'category', 'tag'];
const searchFields = ref<SearchField[]>([...DEFAULT_SEARCH_FIELDS]);
function fieldOn(f: SearchField): boolean {
  return searchFields.value.includes(f);
}
function toggleField(f: SearchField): void {
  const i = searchFields.value.indexOf(f);
  if (i >= 0) {
    if (searchFields.value.length === 1) return; // 至少保留 1 项
    searchFields.value.splice(i, 1);
  } else {
    searchFields.value.push(f);
  }
}

const selectedTypes = ref<TxnType[]>([]); // 搜索页允许筛 transfer（与报告页不同）
const selectedAccountIds = ref<Id[]>([]);
const selectedCategoryNames = ref<string[]>([]); // 展示层按名去重，同名跨账户都算
const selectedTagIds = ref<Id[]>([]);
const amountMinCents = ref<number | null>(null);
const amountMaxCents = ref<number | null>(null);

type SortSel = 'time-desc' | 'time-asc' | 'amount-desc' | 'amount-asc';
const sortSel = ref<SortSel>('time-desc');
const SORT_OPTS: ReadonlyArray<{ v: SortSel; label: string }> = [
  { v: 'time-desc', label: '时间（新→旧）' },
  { v: 'time-asc', label: '时间（旧→新）' },
  { v: 'amount-desc', label: '金额（高→低）' },
  { v: 'amount-asc', label: '金额（低→高）' },
];

const accounts = ref<Account[]>([]);
const allCategories = ref<Category[]>([]);
const tags = ref<Tag[]>([]);
const categoryById = ref<Map<Id, Category>>(new Map());

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
  categoryById.value = new Map(cats.map(c => [c.id, c]));
  tags.value = tagList;
}
const hitTxns = ref<TxnWithTags[]>([]);
const summary = ref(emptySummary());
const loading = ref(false);
const initializing = ref(true);
const initializingRequest = ref(false);
const error = ref('');
const page = ref(1);
const excludedIds = ref<Set<Id>>(new Set());

function categoryIdsForNames(names: string[]): Id[] {
  if (names.length === 0) return [];
  const set = new Set(names);
  return allCategories.value.filter((c) => set.has(c.name)).map((c) => c.id);
}

const activeQuery = computed<TransactionFilter>(() => {
  const q: TransactionFilter = {
    projectScope: 'selected', keyword: keyword.value, searchFields: searchFields.value, excludedIds: [...excludedIds.value],
  };
  if (filterByMonth.value) {
    q.dateFrom = dateFrom.value;
    q.dateTo = dateTo.value;
  }
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
async function load(withStats = true): Promise<void> {
  const request = ++loadRequest;
  loading.value = true;
  error.value = '';
  hitTxns.value = [];
  try {
    const filter = activeQuery.value;
    const [result, nextSummary] = await Promise.all([
      txnService.query({ filter, page: page.value,
        sortBy: sortSel.value.startsWith('amount') ? 'amount' : 'time',
        sortDir: sortSel.value.endsWith('asc') ? 'asc' : 'desc' }),
      withStats ? statsService.summary(filter) : Promise.resolve(summary.value),
    ]);
    if (request !== loadRequest) return;
    hitTxns.value = result.items;
    summary.value = nextSummary;
  } catch (e) {
    if (request === loadRequest) { error.value = (e as Error).message; summary.value = emptySummary(); }
  } finally {
    if (request === loadRequest) loading.value = false;
  }
}

onMounted(async () => {
  window.addEventListener('keydown', onSearchGlobalKeydown);
  loadRecent();
  await initialize();
});

// 输入关键词短暂防抖；响应序号只防止旧请求覆盖新筛选，不参与服务器写入。
let searchTimer: ReturnType<typeof setTimeout> | undefined;
watch([activeQuery, sortSel], () => {
  clearTimeout(searchTimer); loadRequest++; page.value = 1; loading.value = true; hitTxns.value = [];
  searchTimer = setTimeout(() => void load(), 200);
}, { deep: true });
function changePage(value: number): void { page.value = value; void load(false); }
async function initialize(): Promise<void> {
  if (initializingRequest.value) return;
  initializingRequest.value = true;
  error.value = '';
  try { await loadStatic(); await load(); }
  catch (e) { error.value = (e as Error).message; }
  finally { initializing.value = false; initializingRequest.value = false; }
}

const excludedCount = computed<number>(() => excludedIds.value.size);
function excludeTxn(id: Id): void {
  const next = new Set(excludedIds.value);
  next.add(id);
  excludedIds.value = next;
  if (selectedId.value === id) selectedId.value = null;
}
function restoreExcluded(): void {
  if (excludedIds.value.size) excludedIds.value = new Set();
}

const hitCount = computed(() => summary.value.totalCount);
const hitExpense = computed(() => summary.value.expense);
const hitIncome = computed(() => summary.value.income);

const summaryHint = computed<string>(() => {
  const kw = keyword.value.trim();
  const scope = selectedAccountIds.value.length ? '所选账户' : '普通账户';
  const period = filterByMonth.value ? monthLabel.value : '全部时间';
  return `${kw ? `关键词「${kw}」` : scope} · ${period}`;
});

const annual = computed(() => {
  const value = summary.value.annual;
  return { amount: value.amount, hint: value.count < 2 ? '支出样本不足（需 ≥2 笔）'
    : value.spanDays <= 0 ? '支出集中在同一天，无法折算'
    : '基于 ' + value.spanDays + ' 天 · ' + value.count + ' 笔支出' };
});

const selectedId = ref<Id | null>(null);
function selectTxn(id: Id): void {
  selectedId.value = id;
}

const selectedTxn = computed<TxnWithTags | null>(
  () => hitTxns.value.find((t) => t.id === selectedId.value) ?? null,
);

function moveSelection(delta: number): void {
  const list = hitTxns.value;
  if (list.length === 0) return;
  const idx = list.findIndex((t) => t.id === selectedId.value);
  let next: number;
  if (idx < 0) next = delta > 0 ? 0 : list.length - 1;
  else next = Math.min(list.length - 1, Math.max(0, idx + delta));
  const target = list[next];
  if (target) {
    selectedId.value = target.id;
    void nextTick(() => {
      document
        .querySelector('.txn-selected')
        ?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    });
  }
}

function onSearchGlobalKeydown(e: KeyboardEvent): void {
  if (e.altKey || e.defaultPrevented || e.isComposing) return;
  const el = e.target as HTMLElement | null;
  if (e.key !== 'Escape' && el?.closest('button, select, input[type="checkbox"]')) return;
  const inField =
    !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
  if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && !e.metaKey && !e.ctrlKey) {
    moveSelection(e.key === 'ArrowDown' ? 1 : -1);
    e.preventDefault();
    return;
  }
  if (e.key === 'Enter' && !inField && selectedTxn.value) {
    openEdit(selectedTxn.value.id);
    e.preventDefault();
    return;
  }
  if (e.key === 'Escape') {
    if (addOpen.value) {
      closeAdd();
    } else if (keyword.value.trim()) {
      clearKeyword();
    } else if (hasAnyFilter.value) {
      clearAll();
    } else {
      return;
    }
    e.preventDefault();
  }
}

function rowDateText(t: TxnWithTags): string { return dayLabel(t.date); }

function argbToCss(argb: number): string {
  const u = argb >>> 0;
  const a = ((u >>> 24) & 0xff) / 255;
  const r = (u >>> 16) & 0xff;
  const g = (u >>> 8) & 0xff;
  const b = u & 0xff;
  return `rgba(${r}, ${g}, ${b}, ${a === 0 ? 1 : a})`;
}

function accountName(id: Id | null): string {
  if (!id) return '';
  return accounts.value.find((a) => a.id === id)?.name ?? '';
}
function accountColor(id: Id | null): string {
  if (!id) return 'var(--fg-3)';
  const acc = accounts.value.find((a) => a.id === id);
  return acc ? argbToCss(acc.color) : 'var(--fg-3)';
}
function categoryName(id: Id | null): string {
  if (!id) return '';
  return categoryById.value.get(id)?.name ?? '';
}

function txnColor(t: TxnWithTags): string {
  if (t.type === 'transfer') return 'var(--transfer)';
  if (t.categoryId) {
    const cat = categoryById.value.get(t.categoryId);
    if (cat) return argbToCss(cat.color);
  }
  return accountColor(t.accountId);
}

function txnTitle(t: TxnWithTags): string {
  if (t.title && t.title.trim()) return t.title;
  const cat = categoryName(t.categoryId);
  if (cat) return cat;
  if (t.type === 'transfer') return '转账';
  return '(无标题)';
}

function txnAmountText(t: TxnWithTags): string {
  if (t.type === 'expense') return `−${fmtMoney(t.amount)}`;
  if (t.type === 'income') return `+${fmtMoney(t.amount)}`;
  return fmtMoney(t.amount); // transfer：不带正负
}
function txnAmountClass(t: TxnWithTags): string {
  if (t.type === 'expense') return 'neg';
  if (t.type === 'income') return 'pos';
  return 'tr';
}
function typeLabel(t: TxnType): string {
  return t === 'income' ? '收入' : t === 'expense' ? '支出' : '转账';
}
function typeBadgeClass(t: TxnType): string {
  return t === 'income' ? 'badge-income' : t === 'expense' ? 'badge-expense' : 'badge-transfer';
}

function fullDateTimeText(t: TxnWithTags): string { return t.date.slice(0,4) + '年' + dayLabel(t.date); }
function isoDate(t: TxnWithTags): string { return t.date; }

function withThousands(s: string): string {
  return s.replace(/\d+(?=\.)/, (m) => m.replace(/\B(?=(\d{3})+(?!\d))/g, ','));
}
function fmtMoney(cents: number, opts?: { sign?: boolean; symbol?: string }): string {
  return withThousands(format(cents, opts));
}

const RECENT_KEY = 'search:recent';
const RECENT_MAX = 8;
const recentSearches = ref<string[]>([]);

function loadRecent(): void {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    if (!raw) return;
    const arr = JSON.parse(raw);
    if (Array.isArray(arr)) {
      recentSearches.value = arr.filter((x): x is string => typeof x === 'string').slice(0, RECENT_MAX);
    }
  } catch {
    recentSearches.value = [];
  }
}
function persistRecent(): void {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(recentSearches.value));
  } catch {
  }
}
function addRecent(kw: string): void {
  const k = kw.trim();
  if (!k) return;
  const next = [k, ...recentSearches.value.filter((x) => x !== k)].slice(0, RECENT_MAX);
  recentSearches.value = next;
  persistRecent();
}
function applyRecent(kw: string): void {
  keyword.value = kw;
  addRecent(kw); // 点击即置顶
}
function clearRecent(): void {
  recentSearches.value = [];
  persistRecent();
}

let recentTimer: ReturnType<typeof setTimeout> | undefined;
watch(keyword, (val) => {
  if (recentTimer) clearTimeout(recentTimer);
  const k = val.trim();
  if (!k) return;
  recentTimer = setTimeout(() => addRecent(k), 500);
});
function onSearchEnter(): void {
  if (recentTimer) clearTimeout(recentTimer);
  addRecent(keyword.value);
}
function clearKeyword(): void {
  keyword.value = '';
}
onBeforeUnmount(() => {
  clearTimeout(searchTimer);
  loadRequest++;
  if (recentTimer) clearTimeout(recentTimer);
  window.removeEventListener('keydown', onSearchGlobalKeydown);
});

type AddDim = 'type' | 'account' | 'category' | 'tag' | 'amount';
const addOpen = ref(false);
const addDim = ref<AddDim | null>(null);
const amountMinInput = ref<string>('');
const amountMaxInput = ref<string>('');

const ALL_TYPES: ReadonlyArray<TxnType> = ['expense', 'income', 'transfer'];

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

function tagName(id: Id): string {
  return tags.value.find((t) => t.id === id)?.name ?? '';
}

const hasAnyFilter = computed(
  () =>
    selectedTypes.value.length > 0 ||
    selectedAccountIds.value.length > 0 ||
    selectedCategoryNames.value.length > 0 ||
    selectedTagIds.value.length > 0 ||
    hasAmountChip.value ||
    filterByMonth.value ||
    keyword.value.trim().length > 0 ||
    excludedIds.value.size > 0,
);
function clearAll(): void {
  filterByMonth.value = false;
  selectedTypes.value = [];
  selectedAccountIds.value = [];
  selectedCategoryNames.value = [];
  selectedTagIds.value = [];
  clearAmount();
  keyword.value = '';
  searchFields.value = [...DEFAULT_SEARCH_FIELDS];
  excludedIds.value = new Set();
}
usePageRefresh(() => { page.value = 1; void initialize(); });
</script>

<template>
  <div class="content">
    <PageSkeleton v-if="initializing" label="搜索" />
    <template v-else>
    <LoadError :message="error" @retry="initialize" />

    <div class="search-head">
      <span class="page-sub">共</span>
      <span class="badge badge-expense">命中 {{ hitCount }} 笔</span>
      <span
        v-if="excludedCount"
        class="excluded-note"
        role="button"
        tabindex="0"
        title="恢复被临时排除的交易"
        @click="restoreExcluded()"
        @keydown.enter="restoreExcluded()"
      >
        已排除 {{ excludedCount }} 条 · 恢复
      </span>
      <span class="kbd-hint search-kbd" aria-hidden="true">
        <span class="kbd">↑</span><span class="kbd">↓</span>选择
        <span class="kbd">↵</span>编辑
        <span class="kbd">Esc</span>清空
      </span>
    </div>


    <div class="search-box">
      <span class="s-lead">
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="11" cy="11" r="7" />
          <path d="m21 21-4-4" />
        </svg>
      </span>
      <input
        class="input"
        v-model="keyword"
        aria-label="搜索交易"
        placeholder="搜索标题 / 备注 / 分类 / 标签…"
        @keydown.enter="onSearchEnter"
      />
      <button v-if="keyword" class="s-clear" aria-label="清除" @click="clearKeyword">
        <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.4">
          <path d="M18 6 6 18M6 6l12 12" />
        </svg>
      </button>
    </div>


    <div class="scope-row mt-3">
      <span class="scope-key">搜索范围</span>
      <button
        v-for="f in SEARCH_FIELDS"
        :key="'sf-' + f.v"
        class="pill scope-pill"
        :class="{ 'pill-active': fieldOn(f.v) }"
        :aria-pressed="fieldOn(f.v)"
        @click="toggleField(f.v)"
      >
        {{ f.label }}
      </button>

      <span class="filter-sep" aria-hidden="true"></span>
      <label class="month-filter">
        <input type="checkbox" v-model="filterByMonth" />
        是否按选中月份过滤
      </label>


      <span v-for="t in selectedTypes" :key="'ty-' + t" class="chip chip-on">
        类型：{{ typeLabel(t) }}
        <span class="x" role="button" tabindex="0" aria-label="删除筛选" @click="toggleType(t)" @keydown.enter.prevent="toggleType(t)" @keydown.space.prevent="toggleType(t)">×</span>
      </span>
      <span v-for="id in selectedAccountIds" :key="'ac-' + id" class="chip chip-on">
        账户：{{ accountName(id) }}
        <span class="x" role="button" tabindex="0" aria-label="删除筛选" @click="toggleAccount(id)" @keydown.enter.prevent="toggleAccount(id)" @keydown.space.prevent="toggleAccount(id)">×</span>
      </span>
      <span v-for="name in selectedCategoryNames" :key="'ca-' + name" class="chip chip-on">
        分类：{{ name }}
        <span class="x" role="button" tabindex="0" aria-label="删除筛选" @click="toggleCategoryName(name)" @keydown.enter.prevent="toggleCategoryName(name)" @keydown.space.prevent="toggleCategoryName(name)">×</span>
      </span>
      <span v-for="id in selectedTagIds" :key="'tg-' + id" class="chip chip-on">
        标签：{{ tagName(id) }}
        <span class="x" role="button" tabindex="0" aria-label="删除筛选" @click="toggleTag(id)" @keydown.enter.prevent="toggleTag(id)" @keydown.space.prevent="toggleTag(id)">×</span>
      </span>
      <span v-if="hasAmountChip" class="chip chip-on">
        金额：{{ amountChipLabel }}
        <span class="x" role="button" tabindex="0" aria-label="删除筛选" @click="clearAmount()" @keydown.enter.prevent="clearAmount()" @keydown.space.prevent="clearAmount()">×</span>
      </span>


      <span class="add-wrap">
        <span class="chip chip-add" role="button" @click="addOpen ? closeAdd() : openAdd()">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.4">
            <path d="M12 5v14M5 12h14" />
          </svg>
          添加筛选
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
                v-for="t in ALL_TYPES"
                :key="'opt-ty-' + t"
                class="add-opt"
                :class="{ sel: selectedTypes.includes(t) }"
                @click="toggleType(t)"
              >
                {{ typeLabel(t) }}
              </button>
            </template>

            <template v-else-if="addDim === 'account'">
              <div v-if="accounts.length === 0" class="add-empty">暂无账户</div>
              <button
                v-for="a in accounts"
                :key="a.id"
                class="add-opt"
                :class="{ sel: selectedAccountIds.includes(a.id) }"
                @click="toggleAccount(a.id)"
              >
                {{ a.name }}
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

        <span
          v-if="hasAnyFilter"
          class="chip chip-add"
          role="button"
          style="border-style: solid"
          @click="clearAll()"
        >
          清空
        </span>
      </span>
    </div>


    <div v-if="recentSearches.length" class="recent-row mt-3">
      <span class="r-key">最近搜索</span>
      <span
        v-for="kw in recentSearches"
        :key="'rc-' + kw"
        class="pill"
        role="button"
        @click="applyRecent(kw)"
      >
        {{ kw }}
      </span>
      <span class="pill recent-clear" role="button" @click="clearRecent()">清除历史</span>
    </div>

    <div class="divider"></div>


    <PageSkeleton v-if="loading || initializingRequest" label="搜索结果" />
    <template v-else>
    <div class="grid sum-strip">
      <div class="stat">
        <div class="s-label">
          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="11" cy="11" r="7" />
            <path d="m21 21-4-4" />
          </svg>
          命中笔数
        </div>
        <div class="s-value num">{{ hitCount }}</div>
        <div class="s-trend">{{ summaryHint }}</div>
      </div>
      <div class="stat">
        <div class="s-label">
          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M12 5v14M5 12l7 7 7-7" />
          </svg>
          支出合计
        </div>
        <div class="s-value neg num">−{{ fmtMoney(hitExpense) }}</div>
        <div class="s-trend">仅统计支出（不含转账）</div>
      </div>
      <div class="stat">
        <div class="s-label">
          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M12 19V5M5 12l7-7 7 7" />
          </svg>
          收入合计
        </div>
        <div class="s-value pos num" :class="{ faint: hitIncome === 0 }">
          {{ fmtMoney(hitIncome, { sign: true }) }}
        </div>
        <div class="s-trend">仅统计收入（不含转账）</div>
      </div>
      <div class="stat">
        <div class="s-label">
          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M3 3v18h18" />
            <path d="m7 14 4-4 3 3 5-6" />
          </svg>
          折合全年
        </div>
        <div class="s-value num" :class="{ faint: annual.amount === null }">
          <template v-if="annual.amount === null">—</template>
          <template v-else>≈ −{{ fmtMoney(annual.amount) }}</template>
        </div>
        <div class="s-trend">{{ annual.hint }}</div>
      </div>
    </div>


    <div class="two-col search-two-col mt-4">

      <div class="card">
        <div class="card-head">
          <h3>命中交易</h3>
          <div class="row gap-3" style="align-items: center">
            <span class="faint" style="font-size: 13px">{{ hitCount }} 笔</span>
            <label class="pill pill-active">
              <span class="p-key">排序</span>
              <select v-model="sortSel" class="sort-select" aria-label="展示排序">
                <option v-for="o in SORT_OPTS" :key="o.v" :value="o.v">{{ o.label }}</option>
              </select>
            </label>
          </div>
        </div>
        <div class="card-pad" style="padding-top: 4px">

          <div v-if="!loading && !error && hitTxns.length === 0" class="empty">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6">
              <circle cx="11" cy="11" r="7" />
              <path d="m21 21-4-4" />
            </svg>
            <div style="font-weight: 700; color: var(--fg-2)">没有命中的交易</div>
            <div class="mt-2">换个关键词，或调整/清空筛选条件。</div>
          </div>


          <div
            v-for="t in hitTxns"
            :key="t.id"
            class="txn txn-clickable"
            :class="{ 'txn-selected': t.id === selectedId }"
            role="button"
            tabindex="0"
            @click="selectTxn(t.id)"
            @keydown.enter="selectTxn(t.id)"
          >
            <div class="ic-tile" :style="{ background: txnColor(t) }">
              <svg v-if="t.type === 'expense'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M12 5v14M5 12l7 7 7-7" />
              </svg>
              <svg v-else-if="t.type === 'income'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M12 19V5M5 12l7-7 7 7" />
              </svg>
              <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M17 3l4 4-4 4M7 21l-4-4 4-4M21 7H8M3 17h13" />
              </svg>
            </div>
            <div class="txn-main">
              <div class="txn-title">
                <span ><HighlightText :text="txnTitle(t)" :keyword="fieldOn('title') ? keyword : ''" /></span>
                <span v-if="t.type === 'transfer'" class="badge badge-transfer" style="margin-left: 6px">转账</span>
                <span v-else-if="t.type === 'income'" class="badge badge-income" style="margin-left: 6px">收入</span>
              </div>
              <div class="txn-sub">
                <template v-if="t.type === 'transfer'">
                  <span>{{ accountName(t.accountId) }} → {{ accountName(t.toAccountId) }}</span>
                </template>
                <template v-else>
                  <span>{{ accountName(t.accountId) }}</span>
                  <template v-if="categoryName(t.categoryId)">
                    <span class="sub-dot">·</span>
                    <span ><HighlightText :text="categoryName(t.categoryId)" :keyword="fieldOn('category') ? keyword : ''" /></span>
                  </template>
                </template>
                <template v-if="t.tags.length">
                  <span class="sep" />
                  <span
                    v-for="tag in t.tags"
                    :key="tag.id"
                    class="tag-inline"

                  ><HighlightText :text="tag.name" :keyword="fieldOn('tag') ? keyword : ''" /></span>
                </template>
              </div>
              <div v-if="t.note && t.note.trim()" class="txn-note" :title="t.note">
                <span ><HighlightText :text="t.note" :keyword="fieldOn('note') ? keyword : ''" /></span>
              </div>
            </div>
            <div class="txn-right">
              <div class="txn-amt num" :class="txnAmountClass(t)">{{ txnAmountText(t) }}</div>
              <div class="txn-date">{{ rowDateText(t) }}</div>
            </div>
            <button
              class="txn-exclude"
              type="button"
              aria-label="排除此条"
              title="从结果与统计中排除此条"
              @click.stop="excludeTxn(t.id)"
              @keydown.enter.stop="excludeTxn(t.id)"
            >
              <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.4">
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
            </button>
          </div>
          <Pagination :page="page" :total="hitCount" :loading="loading" @change="changePage" />
        </div>
      </div>


      <div class="stack gap-4">
        <div class="card">
          <div class="card-head">
            <h3>交易详情</h3>
            <span v-if="selectedTxn" class="badge" :class="typeBadgeClass(selectedTxn.type)">
              {{ typeLabel(selectedTxn.type) }}
            </span>
          </div>
          <div class="card-pad" style="padding-top: 14px">

            <div v-if="!selectedTxn" class="empty" style="padding: 32px 16px">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6">
                <path d="M9 11l3 3 8-8" />
                <path d="M20 12v6a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h9" />
              </svg>
              <div style="font-weight: 700; color: var(--fg-2)">点击左侧交易查看详情</div>
            </div>

            <template v-else>
              <div class="row gap-3" style="align-items: flex-start">
                <div class="ic-tile lg" :style="{ background: txnColor(selectedTxn) }">
                  <svg v-if="selectedTxn.type === 'expense'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M12 5v14M5 12l7 7 7-7" />
                  </svg>
                  <svg v-else-if="selectedTxn.type === 'income'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M12 19V5M5 12l7-7 7 7" />
                  </svg>
                  <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M17 3l4 4-4 4M7 21l-4-4 4-4M21 7H8M3 17h13" />
                  </svg>
                </div>
                <div style="flex: 1; min-width: 0">
                  <div style="font-weight: 700; font-size: 16px" ><HighlightText :text="txnTitle(selectedTxn)" :keyword="fieldOn('title') ? keyword : ''" /></div>
                  <div class="muted" style="font-size: 12px; margin-top: 2px">{{ fullDateTimeText(selectedTxn) }}</div>
                </div>
              </div>

              <div class="s-value num" :class="txnAmountClass(selectedTxn)" style="font-size: 32px; font-weight: 800; margin: 14px 0 6px">
                {{ txnAmountText(selectedTxn) }}
              </div>

              <div class="divider" style="margin: 8px 0 4px"></div>

              <div class="detail-kv">
                <span class="k">账户</span>
                <span class="v">
                  <span class="acc-dot" :style="{ background: accountColor(selectedTxn.accountId) }"></span>
                  {{ accountName(selectedTxn.accountId) }}
                </span>
              </div>
              <div v-if="selectedTxn.type === 'transfer'" class="detail-kv">
                <span class="k">转入账户</span>
                <span class="v">
                  <span class="acc-dot" :style="{ background: accountColor(selectedTxn.toAccountId) }"></span>
                  {{ accountName(selectedTxn.toAccountId) }}
                </span>
              </div>
              <div v-else class="detail-kv">
                <span class="k">分类</span>
                <span class="v" ><HighlightText :text="categoryName(selectedTxn.categoryId) || '未分类'" :keyword="fieldOn('category') ? keyword : ''" /></span>
              </div>
              <div class="detail-kv">
                <span class="k">日期</span>
                <span class="v num">{{ isoDate(selectedTxn) }}</span>
              </div>
              <div class="detail-kv">
                <span class="k">标签</span>
                <span class="v">
                  <template v-if="selectedTxn.tags.length">
                    <span
                      v-for="tag in selectedTxn.tags"
                      :key="tag.id"
                      class="tag-inline"

                    ><HighlightText :text="tag.name" :keyword="fieldOn('tag') ? keyword : ''" /></span>
                  </template>
                  <span v-else class="faint">无</span>
                </span>
              </div>

              <div v-if="selectedTxn.note && selectedTxn.note.trim()" style="margin-top: 12px">
                <span class="field-label">备注</span>
                <div class="detail-note" ><HighlightText :text="selectedTxn.note" :keyword="fieldOn('note') ? keyword : ''" /></div>
              </div>

              <div class="row gap-2 mt-4">
                <button class="btn btn-ghost btn-sm btn-block" @click="openEdit(selectedTxn.id)">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M11 4H4v16h16v-7M18.5 2.5a2.1 2.1 0 0 1 3 3L12 15l-4 1 1-4z" />
                  </svg>
                  编辑
                </button>
                <button class="btn btn-ghost btn-sm btn-block" @click="copyTxn(selectedTxn.id)">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <rect x="9" y="9" width="11" height="11" rx="2" />
                    <path d="M5 15V5a2 2 0 0 1 2-2h10" />
                  </svg>
                  复制
                </button>
                <button
                  class="btn btn-ghost btn-sm btn-block"
                  title="从结果与统计中排除此条（临时，可恢复）"
                  @click="excludeTxn(selectedTxn.id)"
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <circle cx="12" cy="12" r="9" />
                    <path d="M6 6l12 12" />
                  </svg>
                  排除
                </button>
              </div>
            </template>
          </div>
        </div>
      </div>
    </div>
    </template>
    </template>
  </div>
</template>

<style scoped>
/* 命中计数行 */
.search-head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 14px;
}
.search-head .page-sub {
  font-size: var(--fs-sm);
  color: var(--fg-3);
  font-weight: 600;
}
/* 搜索页快捷键提示：推到该行最右，轻量、不抢眼（手机端由 tokens.css 统一隐藏）。 */
.search-head .search-kbd { margin-left: auto; gap: 4px; }
.search-head .search-kbd .kbd { margin-left: 2px; }

/* 已临时排除的提示：轻量可点，点击恢复全部被排除项（会话态）。 */
.search-head .excluded-note {
  font-size: var(--fs-xs);
  font-weight: 600;
  color: var(--fg-3);
  cursor: pointer;
  border: 1px dashed var(--border);
  border-radius: var(--r-pill);
  padding: 2px 8px;
}
.search-head .excluded-note:hover {
  color: var(--primary);
  border-color: var(--primary);
}

/* 展示排序下拉（嵌在 pill 里的原生 select，去边框透明化；从报告页迁入） */
.sort-select {
  background: none;
  border: none;
  outline: none;
  font-weight: 600;
  color: var(--primary);
  cursor: pointer;
}

/* 大号搜索框（照抄 search.html 局部样式） */
.search-box {
  position: relative;
  display: flex;
  align-items: center;
}
.search-box .s-lead {
  position: absolute;
  left: 14px;
  color: var(--fg-3);
  display: grid;
  place-items: center;
}
.search-box .s-clear {
  position: absolute;
  right: 10px;
  width: 26px;
  height: 26px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  color: var(--fg-2);
  background: var(--surface-2);
}
.search-box .s-clear:hover {
  background: var(--surface-3);
}
.search-box input.input {
  padding-left: 42px;
  padding-right: 44px;
  height: 46px;
  font-size: 16px;
  font-weight: 600;
}

/* HighlightText 子组件中的命中片段。 */
:deep(mark) {
  background: #fff3c4;
  color: inherit;
  border-radius: 3px;
  padding: 0 2px;
  font-weight: 700;
}
:global(.dark mark) {
  background: #6b5a12;
  color: #fdf3c9;
}

/* 筛选 chip 的删除叉（× / 清空按钮同 z-index 见下） */
.chip .x {
  cursor: pointer;
}

/* z-index 坑（踩过）：让筛选 chip、添加/清空按钮位于 add-backdrop 之上，
   否则弹层打开时全屏遮罩会盖住这些 chip，导致 × / 清空点不到。
   整套下拉层级抬到手机底栏(.m-tabbar z:30 / .m-fab z:31)之上，
   否则窄屏/矮屏下菜单底部会被固定底栏盖住、点击落到底栏误切页。band=40/41/42。 */
.add-wrap {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 8px;
}
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
}
.add-opt.sel {
  background: var(--primary-soft);
  color: var(--primary);
}
.add-opt.sel::after {
  content: '✓';
  margin-left: 8px;
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

/* 搜索范围：字段多选 pill 行（复用 .pill / .pill-active）。 */
.month-filter {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--fg-2);
  font-size: var(--fs-sm);
  cursor: pointer;
}
.month-filter input { accent-color: var(--primary); }
.scope-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.scope-row .scope-key {
  font-size: var(--fs-xs);
  color: var(--fg-3);
  font-weight: 700;
  letter-spacing: 0.04em;
}
.scope-pill {
  cursor: pointer;
}

/* 搜索范围与筛选合并同一行时的细竖分隔符：区隔「作用字段」与「叠加筛选」两类。
   无筛选时它就是范围 pills 末尾的一个小竖线，语义上标示后面可继续添加筛选。 */
.filter-sep {
  width: 1px;
  align-self: stretch;
  min-height: 20px;
  background: var(--border);
  margin: 0 2px;
}

/* 最近搜索 */
.recent-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.recent-row .r-key {
  font-size: var(--fs-xs);
  color: var(--fg-3);
  font-weight: 700;
  letter-spacing: 0.04em;
}
.recent-row .pill {
  cursor: pointer;
}
.recent-row .recent-clear {
  color: var(--fg-3);
  border-style: dashed;
}

/* 命中汇总条：桌面四卡等宽（.grid 已给 display:grid+gap，此处只定列数，
   不复用全局 .g-3 以免其 repeat(3) 特异性盖过下方响应式覆盖）。 */
.sum-strip {
  grid-template-columns: repeat(4, 1fr);
}
.sum-strip .stat {
  padding: 14px 16px;
}
.sum-strip .s-value {
  font-size: 24px;
}

/* 双栏：左结果自适应、右详情固定 320px（对照设计稿桌面稿）。
   左轨道用 minmax(0, 1fr) 而非 1fr：1fr 最小尺寸默认为 min-content，
   命中行里 nowrap 的超长备注/标题会把左列撑爆、整页横向溢出、省略号失效。
   压成最小 0 后左列可收缩到容器内，超长文本由各自的 ellipsis 隐藏。 */
.search-two-col {
  height: auto;
  grid-template-columns: minmax(0, 1fr) 320px;
  align-items: start;
}

/* 右详情列随页面滚动吸顶跟随：桌面双栏下左命中列表常远长于右详情卡，
   让详情列 sticky 停靠、滚动时始终可见（滚动容器是 .content，58px 顶栏是其上方
   不滚动的兄弟节点，故吸顶点不被顶栏遮挡）。top 对齐 .content 的 22px 内边距，
   静止态与吸顶态位置一致、无跳动。sticky 生效前提是该列不被拉伸到整行高——
   已由上面的 align-items:start 保证。窄屏单列时在 900px 段还原为 static。 */
.search-two-col > .stack {
  position: sticky;
  top: 22px;
}

/* 结果行可点击 + 选中高亮（负 margin 让底色铺满行内边距，照抄 Overview）。 */
.txn-clickable {
  cursor: pointer;
  margin: 0 -8px;
  padding-left: 8px;
  padding-right: 8px;
  border-radius: var(--r-md);
  transition: background 0.12s;
}
.txn-clickable:hover {
  background: var(--surface-2);
}
.txn-clickable:focus-visible {
  outline: 2px solid var(--primary);
  outline-offset: -2px;
}
.txn-selected,
.txn-selected:hover {
  background: var(--primary-soft);
}
.txn-sub .sub-dot {
  color: var(--fg-3);
}
/* 平铺列表右列：金额在上、日期在下（不分组后每行自带日期，右对齐不抢主信息）。 */
.txn-right {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 2px;
  flex-shrink: 0;
}
.txn-date {
  font-size: var(--fs-xs);
  color: var(--fg-3);
  white-space: nowrap;
}
.txn-note {
  font-size: var(--fs-xs);
  color: var(--fg-3);
  opacity: 0.75;
  margin-top: 2px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* 行内「排除」叉：默认隐形不占视觉，hover / 聚焦该行或按钮本身时淡出，
   触屏（无 hover）恒显以便点按。轻量圆钮，点击将该行移出结果与统计。 */
.txn-exclude {
  flex-shrink: 0;
  width: 26px;
  height: 26px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  color: var(--fg-3);
  background: transparent;
  opacity: 0;
  transition: opacity 0.12s, background 0.12s, color 0.12s;
}
.txn-clickable:hover .txn-exclude,
.txn-clickable:focus-within .txn-exclude,
.txn-exclude:focus-visible {
  opacity: 1;
}
.txn-exclude:hover {
  background: var(--expense-soft);
  color: var(--expense);
}
@media (hover: none) {
  .txn-exclude { opacity: 1; }
}

/* 详情键值行（照抄设计稿） */
.detail-kv {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 9px 0;
  border-bottom: 1px solid var(--border);
  font-size: var(--fs-sm);
}
.detail-kv:last-child {
  border-bottom: none;
}
.detail-kv .k {
  color: var(--fg-3);
  font-weight: 600;
  flex-shrink: 0;
}
.detail-kv .v {
  font-weight: 600;
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  justify-content: flex-end;
  text-align: right;
}
.acc-dot {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  flex-shrink: 0;
}
.detail-note {
  color: var(--fg-2);
  font-size: 13px;
  background: var(--surface-2);
  border-radius: var(--r-md);
  padding: 10px 12px;
  margin-top: 6px;
  word-break: break-word;
}

/* 窄视口退化为单列（手机端细做留待后续，仅伏笔）。 */
@media (max-width: 900px) {
  .search-two-col {
    grid-template-columns: 1fr;
  }
  /* 单列后 grid 列默认 minmax(auto,1fr)，auto 最小值=子项 max-content 宽，
     会被命中列表里的长标题/备注撑破视口 → 窄屏横向滚动（真实数据 375px 复现）。
     给两列子项补 min-width:0，让列可收缩到容器宽度。（桌面双栏用固定 320px 列，不受影响。） */
  .search-two-col > * {
    min-width: 0;
  }
  /* 单列下详情卡落到列表下方，吸顶跟随无意义且会遮挡列表，还原为普通流。 */
  .search-two-col > .stack {
    position: static;
  }
  /* 汇总条：900px 内先收成两列（≤720 再塌单列，见下段）。 */
  .sum-strip {
    grid-template-columns: repeat(2, 1fr);
  }
}

/* ============================================================
   手机端（≤720px）：双栏已塌单列（列表在上、详情卡在下，单列可用）；
   此处补齐搜索框、汇总三卡、弹层不溢出。不改搜索/过滤/高亮逻辑。
   ============================================================ */
@media (max-width: 720px) {
  /* 汇总四卡塌成单列，避免 SE 375 等窄屏横向溢出。 */
  .sum-strip {
    grid-template-columns: 1fr;
  }

  /* 搜索框铺满、字段可点区域足够 */
  .search-box input.input {
    height: 44px;
  }

  /* 添加筛选弹层不超出视口 */
  .add-menu {
    max-width: calc(100vw - 32px);
  }

  /* 详情卡内容不被长文本撑破 */
  .detail-kv .v {
    min-width: 0;
    word-break: break-word;
  }
}
</style>

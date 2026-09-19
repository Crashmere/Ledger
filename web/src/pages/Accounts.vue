<script setup lang="ts">
import { usePageRefresh } from '../composables/usePageRefresh';
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { useAccountRange, useProjectMonthFilter } from '../composables/useAccountRange';
import { useRoute, useRouter } from 'vue-router';
import {
  accountService,
  categoryService,
  txnService, statsService, emptySummary, type DayTotal, type CategoryTotal,
  yuanToCents,
  centsToYuan,
  format,
  AppError,
  type Account,
  type Category,
  type Transaction,
  type Id,
} from '../api';

import Pagination from '../components/Pagination.vue';
import LoadError from '../components/LoadError.vue';
import PageSkeleton from '../components/PageSkeleton.vue';
import { groupDays, type DayGroup } from '../services/groupDays';
import { beijingDate } from '../services/dates';
const { enabled: projectMonthEnabled, setEnabled: setProjectMonthEnabled } = useProjectMonthFilter();
const router = useRouter();
const route = useRoute();
let disposed = false;

function syncQuery(): void {
  if (disposed || route.name !== 'accounts') return;
  const q: Record<string, string> = {};
  if (selectedAccountId.value) q.account = selectedAccountId.value;
  if (categoryFilterId.value) q.cat = categoryFilterId.value;
  void router.replace({ query: q });
}

function openEdit(id: Id): void {
  void router.push(`/txn/${id}/edit`);
}

const accounts = ref<Account[]>([]);
const balanceById = ref<Map<Id, number>>(new Map());
const categoriesByAccount = ref<Map<Id, Category[]>>(new Map());
const categoryById = ref<Map<Id, Category>>(new Map());

const selectedAccountId = ref<Id | null>(null);
const selectedCategories = ref<Category[]>([]); // 右栏分类网格（可拖拽重排）
const accountTxns = ref<Transaction[]>([]); // 当前页明细；流量与分类小计由后端单独计算
const categoryFilterId = ref<Id | null>(null); // 明细按分类筛选（null = 全部）；点分类网格切换

type Modal = { kind: 'account' | 'category'; mode: 'create' | 'edit'; id?: Id } | null;
const modal = ref<Modal>(null);
const saving = ref(false);

const DEFAULT_COLOR = hexToArgb('#1a73e8');
const fName = ref('');
const fColor = ref<number>(DEFAULT_COLOR);
const randomColor = ref<number>(DEFAULT_COLOR);
const fInitialBalance = ref('0'); // 元字符串，仅账户用
const fIncludeInBalance = ref(true); // 仅账户用
const fKind = ref<'normal' | 'project'>('normal');
const fPeriodStart = ref(''); // yyyy-mm-dd（可空）
const fPeriodEnd = ref(''); // yyyy-mm-dd（可空）
const fArchived = ref(false); // 是否已归档（结束）

const COLOR_PRESETS = [
  '#1a73e8', '#1e8e3e', '#d93025', '#f29900',
  '#9334e6', '#00acc1', '#ff7043', '#6c5ce7',
  '#34a853', '#ea4335', '#4285f4', '#fbbc05',
];

interface ConfirmState {
  title: string;
  message: string;
  confirmText: string;
  onConfirm: () => void | Promise<void>;
}
const confirmState = ref<ConfirmState | null>(null);

const feedback = ref<{ kind: 'success' | 'error'; msg: string } | null>(null);
let feedbackTimer: ReturnType<typeof setTimeout> | null = null;

const drag = ref<{ kind: 'account' | 'category'; index: number } | null>(null);

const selectedAccount = computed(
  () => accounts.value.find((a) => a.id === selectedAccountId.value) ?? null,
);

const normalAccounts = computed(() => accounts.value.filter((a) => a.kind !== 'project'));

const projectAccounts = computed(() => accounts.value.filter((a) => a.kind === 'project'));

const isProjectSelected = computed(() => selectedAccount.value?.kind === 'project');
const { filterByMonth, dateFrom, dateTo, periodLabel } = useAccountRange(
  computed(() => selectedAccount.value?.kind),
);

function fmtDateInput(ms: number | null): string { return ms === null ? '' : beijingDate(ms); }

function periodText(a: Account): string {
  const s = a.periodStart !== null ? fmtDateInput(a.periodStart) : '';
  const e = a.periodEnd !== null ? fmtDateInput(a.periodEnd) : '';
  if (s && e) return `${s} ~ ${e}`;
  if (s) return `${s} 起`;
  if (e) return `截至 ${e}`;
  return '未设时间段';
}

const totalBalance = ref(0);
const accountFlow = ref(emptySummary());
const categoryTotals = ref<CategoryTotal[]>([]);
const dayTotals = ref<Record<string, DayTotal>>({});
const page = ref(1);
const total = ref(0);
const error = ref('');
const initializing = ref(true);
let refreshing = false;

const modalTitle = computed(() => {
  const m = modal.value;
  if (!m) return '';
  const noun =
    m.kind === 'account'
      ? fKind.value === 'project'
        ? '专项账户'
        : '账户'
      : '分类';
  return `${m.mode === 'create' ? '新建' : '编辑'}${noun}`;
});

async function reloadAccounts(): Promise<void> {
  const [result, categories] = await Promise.all([accountService.list(), categoryService.list()]);
  accounts.value = result.items;
  totalBalance.value = result.totalBalance;
  balanceById.value = new Map(result.items.map(a => [a.id, a.balance]));
  const catMap = new Map<Id, Category[]>();
  for (const category of categories) {
    const list = catMap.get(category.accountId) ?? [];
    list.push(category); catMap.set(category.accountId, list);
  }
  categoriesByAccount.value = catMap;
  categoryById.value = new Map(categories.map(c => [c.id, c]));

  if (!accounts.value.some((a) => a.id === selectedAccountId.value)) {
    selectedAccountId.value = accounts.value[0]?.id ?? null;
    categoryFilterId.value = null;
    page.value = 1;
  }
}

let detailRequest = 0;
const detailLoading = ref(false);
async function reloadDetail(withStats = true): Promise<void> {
  const request = ++detailRequest;
  const id = selectedAccountId.value;
  selectedCategories.value = id ? categoriesByAccount.value.get(id) ?? [] : [];
  accountTxns.value = [];
  if (!id) {
    detailLoading.value = false;
    return;
  }
  detailLoading.value = true;
  error.value = '';
  try {
    // 分类 chip 只缩小明细，顶部流量和分类网格仍描述整个账户范围。
    const filter = { accountIds: [id], dateFrom: dateFrom.value, dateTo: dateTo.value };
    const detailFilter = { ...filter, categoryIds: categoryFilterId.value ? [categoryFilterId.value] : undefined };
    const [result, summary, categories] = await Promise.all([
      txnService.query({ filter: detailFilter, page: page.value, includeDayTotals: true, sortBy: 'time', sortDir: 'desc' }),
      withStats ? statsService.summary(filter, id) : Promise.resolve(accountFlow.value),
      withStats ? statsService.categories(filter, 'id', 'expense') : Promise.resolve(categoryTotals.value),
    ]);
    if (request !== detailRequest) return;
    accountTxns.value = result.items;
    total.value = result.totalCount;
    dayTotals.value = result.dayTotals ?? {};
    accountFlow.value = summary;
    categoryTotals.value = categories;
  } catch (e) {
    if (request === detailRequest) {
      error.value = (e as Error).message; accountTxns.value = []; total.value = 0;
      accountFlow.value = emptySummary(); categoryTotals.value = [];
    }
  } finally {
    if (request === detailRequest) detailLoading.value = false;
  }
}
watch([dateFrom, dateTo, categoryFilterId], () => { page.value = 1; syncQuery(); void reloadDetail(); });
function changePage(value: number): void { page.value = value; void reloadDetail(false); }
async function initialize(readRoute = false): Promise<void> {
  if (refreshing) return;
  refreshing = true;
  error.value = '';
  const qCat = readRoute ? route.query.cat : undefined;
  try {
    await reloadAccounts();
    if (disposed) return;
    if (typeof qCat === 'string' && selectedAccountId.value) {
      const cats = categoriesByAccount.value.get(selectedAccountId.value) ?? [];
      if (cats.some((c) => c.id === qCat)) categoryFilterId.value = qCat;
    }
    await reloadDetail();
    syncQuery();
  }
  catch (e) { error.value = (e as Error).message; }
  finally { initializing.value = false; refreshing = false; }
}


async function selectAccount(id: Id): Promise<void> {
  selectedAccountId.value = id;
  page.value = 1;
  categoryFilterId.value = null; // 切换账户清空明细的分类筛选
  syncQuery();
  await reloadDetail();
}

function toggleCategoryFilter(catId: Id): void {
  categoryFilterId.value = categoryFilterId.value === catId ? null : catId;
  syncQuery();
}

onMounted(async () => {
  window.addEventListener('keydown', onGlobalKeydown);
  const qAccount = route.query.account;
  if (typeof qAccount === 'string' && qAccount) selectedAccountId.value = qAccount;

  await initialize(true);
});

onUnmounted(() => {
  disposed = true;
  detailRequest++;
  window.removeEventListener('keydown', onGlobalKeydown);
});

function onGlobalKeydown(e: KeyboardEvent): void {
  if (e.key !== 'Escape') return;
  if (confirmState.value) {
    confirmState.value = null;
    e.preventDefault();
  } else if (modal.value) {
    closeModal();
    e.preventDefault();
  }
}

function onDragStart(kind: 'account' | 'category', index: number): void {
  drag.value = { kind, index };
}

async function onDrop(kind: 'account' | 'category', index: number): Promise<void> {
  const d = drag.value;
  drag.value = null;
  if (saving.value || !d || d.kind !== kind || d.index === index) return;
  saving.value = true;
  try {
    if (kind === 'account') {
      const normals = normalAccounts.value.slice();
      const [moved] = normals.splice(d.index, 1);
      normals.splice(index, 0, moved);
      const ordered = [...normals, ...projectAccounts.value];
      await accountService.reorder(ordered.map(account => account.id));
      accounts.value = ordered;
    } else if (selectedAccountId.value) {
      const ordered = selectedCategories.value.slice();
      const [moved] = ordered.splice(d.index, 1);
      ordered.splice(index, 0, moved);
      await categoryService.reorder(selectedAccountId.value, ordered.map(category => category.id));
      selectedCategories.value = ordered;
      categoriesByAccount.value.set(selectedAccountId.value, ordered);
    }
  } catch (e) { showFeedback('error', (e as Error).message); }
  finally { saving.value = false; }
}

function openAccountCreate(): void {
  fName.value = '';
  randomColor.value = makeRandomColor();
  fColor.value = randomColor.value; // 默认选中随机色
  fInitialBalance.value = '0';
  fIncludeInBalance.value = true;
  fKind.value = 'normal';
  fPeriodStart.value = '';
  fPeriodEnd.value = '';
  fArchived.value = false;
  modal.value = { kind: 'account', mode: 'create' };
}

function openProjectCreate(): void {
  fName.value = '';
  randomColor.value = makeRandomColor();
  fColor.value = randomColor.value; // 默认选中随机色
  fInitialBalance.value = '0';
  fIncludeInBalance.value = false; // 专项默认不计入左栏总额
  fKind.value = 'project';
  fPeriodStart.value = '';
  fPeriodEnd.value = '';
  fArchived.value = false;
  modal.value = { kind: 'account', mode: 'create' };
}
function openAccountEdit(acc: Account): void {
  fName.value = acc.name;
  randomColor.value = makeRandomColor(); // 备一枚随机色供重选，但保持原色选中
  fColor.value = acc.color;
  fInitialBalance.value = centsToYuan(acc.initialBalance);
  fIncludeInBalance.value = acc.includeInBalance;
  fKind.value = acc.kind === 'project' ? 'project' : 'normal';
  fPeriodStart.value = fmtDateInput(acc.periodStart);
  fPeriodEnd.value = fmtDateInput(acc.periodEnd);
  fArchived.value = acc.archivedAt !== null;
  modal.value = { kind: 'account', mode: 'edit', id: acc.id };
}
function openCategoryCreate(): void {
  fName.value = '';
  randomColor.value = makeRandomColor();
  fColor.value = randomColor.value; // 默认选中随机色
  modal.value = { kind: 'category', mode: 'create' };
}
function openCategoryEdit(cat: Category): void {
  fName.value = cat.name;
  randomColor.value = makeRandomColor();
  fColor.value = cat.color;
  modal.value = { kind: 'category', mode: 'edit', id: cat.id };
}
function closeModal(): void {
  modal.value = null;
}

async function saveModal(): Promise<void> {
  const m = modal.value;
  if (!m || saving.value) return;
  const name = fName.value.trim();
  if (!name) {
    showFeedback('error', '名称不能为空');
    return;
  }

  saving.value = true;
  let saved = false;
  try {
    if (m.kind === 'account') {
      const draft = {
        name,
        color: fColor.value,
        initialBalance: yuanToCents(fInitialBalance.value || '0'),
        includeInBalance: fIncludeInBalance.value,
        kind: fKind.value,
        periodStart: fPeriodStart.value || null,
        periodEnd: fPeriodEnd.value || null,
      };
      if (m.mode === 'create') {
        const created = await accountService.create({
          ...draft,
          archived: fArchived.value,
        });
        saved = true;
        await reloadAccounts();
        selectedAccountId.value = created.id;
        categoryFilterId.value = null;
      } else {
        await accountService.update(m.id!, { ...draft, archived: fArchived.value });
        saved = true;
        await reloadAccounts();
      }
      page.value = 1;
      await reloadDetail();
    } else if (m.kind === 'category') {
      const accId = selectedAccountId.value;
      if (!accId) {
        showFeedback('error', '请先选择账户');
        return;
      }
      if (m.mode === 'create') {
        await categoryService.create({ accountId: accId, name, color: fColor.value });
      } else {
        await categoryService.update(m.id!, { name, color: fColor.value });
      }
      saved = true;
      await reloadAccounts(); // 刷新分类计数/映射
      page.value = 1;
      await reloadDetail();
    }
    closeModal();
    syncQuery();
    showFeedback('success', '已保存 ✓');
  } catch (e) {
    if (saved) { closeModal(); showFeedback('error', '已保存，但刷新失败，请重新加载页面。'); }
    else showFeedback('error', e instanceof AppError ? e.message : '保存失败，请先核对结果。');
  } finally {
    saving.value = false;
  }
}

function deleteAccount(acc: Account): void {
  confirmState.value = {
    title: '删除账户',
    message: '确定删除该账户？只有没有任何交易和分类的空账户才能删除；若账户下仍有交易或分类，将被拦截。',
    confirmText: '删除账户',
    onConfirm: async () => {
      let deleted = false;
      try {
        await accountService.remove(acc.id);
        deleted = true;
        closeModal();
        await reloadAccounts();
        syncQuery();
        await reloadDetail();
        showFeedback('success', '账户已删除');
      } catch (e) {
        if (deleted) { showFeedback('error', '已删除，但刷新失败，请重新加载页面。'); return; }
        if (e instanceof AppError && e.code === 'RESTRICT') {
          showFeedback('error', '该账户下还有交易或分类，请先删除或转移后再删除账户');
        } else {
          showFeedback('error', e instanceof AppError ? e.message : '删除失败，请重试');
        }
      }
    },
  };
}

function deleteCategory(cat: Category): void {
  confirmState.value = {
    title: '删除分类',
    message: '删除后，该分类下的交易会保留，但将不再有分类（分类显示为空）。确定删除吗？',
    confirmText: '删除分类',
    onConfirm: async () => {
      let deleted = false;
      try {
        await categoryService.remove(cat.id);
        deleted = true;
        if (categoryFilterId.value === cat.id) categoryFilterId.value = null;
        await reloadAccounts();
        page.value = 1;
        await reloadDetail();
        showFeedback('success', '分类已删除，相关交易保留');
      } catch (e) {
        if (deleted) { showFeedback('error', '已删除，但刷新失败，请重新加载页面。'); return; }
        showFeedback('error', e instanceof AppError ? e.message : '删除失败，请重试');
      }
    },
  };
}

async function runConfirm(): Promise<void> {
  const c = confirmState.value;
  if (!c || saving.value) return;
  confirmState.value = null;
  saving.value = true;
  try { await c.onConfirm(); } finally { saving.value = false; }
}

function showFeedback(kind: 'success' | 'error', msg: string): void {
  feedback.value = { kind, msg };
  if (feedbackTimer) clearTimeout(feedbackTimer);
  feedbackTimer = setTimeout(() => {
    feedback.value = null;
  }, 2400);
}

function hexToArgb(hex: string): number {
  const rgb = parseInt(hex.replace('#', ''), 16);
  return 0xff000000 + rgb;
}

function argbToCss(argb: number): string {
  const u = argb >>> 0;
  const a = ((u >>> 24) & 0xff) / 255;
  const r = (u >>> 16) & 0xff;
  const g = (u >>> 8) & 0xff;
  const b = u & 0xff;
  return `rgba(${r}, ${g}, ${b}, ${a === 0 ? 1 : a})`;
}

function isColorSelected(hex: string): boolean {
  return hexToArgb(hex) === fColor.value;
}

function argbToRgb(argb: number): [number, number, number] {
  const u = argb >>> 0;
  return [(u >>> 16) & 0xff, (u >>> 8) & 0xff, u & 0xff];
}

function rgbToHueSat(r: number, g: number, b: number): { h: number; s: number } {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === rn) h = (((gn - bn) / d) % 6 + 6) % 6;
    else if (max === gn) h = (bn - rn) / d + 2;
    else h = (rn - gn) / d + 4;
    h *= 60;
  }
  const l = (max + min) / 2;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  return { h, s };
}

function hslToArgb(h: number, s: number, l: number): number {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = h / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let r = 0;
  let g = 0;
  let b = 0;
  if (hp < 1) [r, g, b] = [c, x, 0];
  else if (hp < 2) [r, g, b] = [x, c, 0];
  else if (hp < 3) [r, g, b] = [0, c, x];
  else if (hp < 4) [r, g, b] = [0, x, c];
  else if (hp < 5) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const m = l - c / 2;
  const R = Math.round((r + m) * 255);
  const G = Math.round((g + m) * 255);
  const B = Math.round((b + m) * 255);
  return 0xff000000 + (R << 16) + (G << 8) + B;
}

function hueGap(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

function collectUsedHues(): number[] {
  const argbList: number[] = COLOR_PRESETS.map(hexToArgb);
  for (const a of accounts.value) argbList.push(a.color);
  for (const c of categoryById.value.values()) argbList.push(c.color);
  const hues: number[] = [];
  for (const argb of argbList) {
    const [r, g, b] = argbToRgb(argb);
    const { h, s } = rgbToHueSat(r, g, b);
    if (s > 0.15) hues.push(h); // 近灰色的色相无意义，跳过
  }
  return hues;
}

function makeRandomColor(): number {
  const used = collectUsedHues();
  const MIN_GAP = 24; // 与任一已用色相至少相隔 24°
  let hue = Math.random() * 360;
  let bestGap = -1;
  for (let i = 0; i < 32; i++) {
    const h = Math.random() * 360;
    let nearest = 360;
    for (const u of used) nearest = Math.min(nearest, hueGap(h, u));
    if (nearest >= MIN_GAP) {
      hue = h; // 第一个够远的随机候选即采用，保持随机性
      bestGap = nearest;
      break;
    }
    if (nearest > bestGap) {
      bestGap = nearest; // 兜底：都不够远时取离最近已用色相最远者
      hue = h;
    }
  }
  const s = 0.68 + Math.random() * 0.14; // 68%-82%
  const l = 0.46 + Math.random() * 0.14; // 46%-60%
  return hslToArgb(hue, s, l);
}

function rerollRandomColor(): void {
  randomColor.value = makeRandomColor();
  fColor.value = randomColor.value;
}

function accountName(id: Id | null): string {
  if (!id) return '';
  return accounts.value.find((a) => a.id === id)?.name ?? '';
}
function categoryName(id: Id | null): string {
  if (!id) return '';
  return categoryById.value.get(id)?.name ?? '';
}

function categoryExpense(catId: Id): number {
  return categoryTotals.value.find(c => c.id === catId)?.expense ?? 0;
}

const filteredCategory = computed<Category | null>(() =>
  categoryFilterId.value ? (categoryById.value.get(categoryFilterId.value) ?? null) : null,
);

const groups = computed(() => groupDays(accountTxns.value, dayTotals.value));

function daySummaryText(g: DayGroup): string {
  return `支出 ${format(g.expense)} · 收入 ${format(g.income)}`;
}

function txnColor(t: Transaction): string {
  if (t.type === 'transfer') return 'var(--transfer)';
  if (t.categoryId) {
    const cat = categoryById.value.get(t.categoryId);
    if (cat) return argbToCss(cat.color);
  }
  const acc = accounts.value.find((a) => a.id === t.accountId);
  return acc ? argbToCss(acc.color) : 'var(--fg-3)';
}
function txnTitle(t: Transaction): string {
  if (t.title && t.title.trim()) return t.title;
  const cat = categoryName(t.categoryId);
  if (cat) return cat;
  if (t.type === 'transfer') return '转账';
  return '(无标题)';
}

function txnSub(t: Transaction): string {
  if (t.type === 'transfer') {
    return `${accountName(t.accountId)} → ${accountName(t.toAccountId)}`;
  }
  const cat = categoryName(t.categoryId);
  return cat ? `${accountName(t.accountId)} · ${cat}` : `${accountName(t.accountId)} · 未分类`;
}
function txnAmountText(t: Transaction): string {
  if (t.type === 'expense') return `−${format(t.amount)}`;
  if (t.type === 'income') return `+${format(t.amount)}`;
  return format(t.amount); // transfer：中性、无正负号
}
function txnAmountClass(t: Transaction): string {
  if (t.type === 'expense') return 'neg';
  if (t.type === 'income') return 'pos';
  return 'tr';
}
usePageRefresh(() => { page.value = 1; void initialize(); });
</script>

<template>
  <div class="content acc-content">
    <PageSkeleton v-if="initializing" label="账户" />
    <template v-else>
    <LoadError :message="error" @retry="initialize" />


    <div class="two-col acc-two-col">

      <div class="card acc-list-card">
        <div class="card-head">
          <h3>账户</h3>
          <span class="faint" style="font-size: 13px">
            {{ accounts.length }} 个 · 总额 {{ format(totalBalance) }}
          </span>
        </div>
        <div class="card-pad" style="padding-top: 6px">
          <div
            v-for="(acc, idx) in normalAccounts"
            :key="acc.id"
            class="acc-row"
            :class="{ on: acc.id === selectedAccountId }"
            draggable="true"
            @click="selectAccount(acc.id)"
            @dragstart="onDragStart('account', idx)"
            @dragover.prevent
            @drop="onDrop('account', idx)"
          >
            <span v-if="acc.id === selectedAccountId" class="acc-row-bar" :style="{ background: argbToCss(acc.color) }" />
            <div class="ic-tile sm" :style="{ background: argbToCss(acc.color) }">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
                <path d="M3 6h18l-2 13H5z" />
                <path d="M9 6V4h6v2" />
              </svg>
            </div>
            <div class="txn-main">
              <div class="txn-title" style="font-size: 14px">
                {{ acc.name }}
                <span v-if="!acc.includeInBalance" class="badge" style="background: var(--surface-2); color: var(--fg-3); margin-left: 6px">不计入总额</span>
              </div>
              <div class="txn-sub">{{ (categoriesByAccount.get(acc.id) ?? []).length }} 个分类</div>
            </div>
            <div class="num" style="font-weight: 700">{{ format(balanceById.get(acc.id) ?? 0) }}</div>
            <svg class="drag-handle" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="var(--fg-3)" stroke-width="2" aria-label="拖拽排序">
              <circle cx="9" cy="6" r="1" /><circle cx="15" cy="6" r="1" />
              <circle cx="9" cy="12" r="1" /><circle cx="15" cy="12" r="1" />
              <circle cx="9" cy="18" r="1" /><circle cx="15" cy="18" r="1" />
            </svg>
          </div>

          <div v-if="accounts.length === 0" class="empty" style="padding: 24px 12px">
            <div style="font-weight: 700; color: var(--fg-2)">还没有账户</div>
          </div>

          <div class="divider" style="margin: 12px 0" />
          <button class="btn btn-ghost btn-block" style="border-style: dashed; color: var(--fg-2)" @click="openAccountCreate">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M12 5v14M5 12h14" /></svg>
            新建账户
          </button>


          <div class="proj-section">
            <div class="proj-section-head">
              <span>专项账户</span>
              <span class="faint" style="font-size: 12px; font-weight: 600">不计入统计 · {{ projectAccounts.length }} 个</span>
            </div>
            <div
              v-for="acc in projectAccounts"
              :key="acc.id"
              class="acc-row"
              :class="{ on: acc.id === selectedAccountId }"
              @click="selectAccount(acc.id)"
            >
              <span v-if="acc.id === selectedAccountId" class="acc-row-bar" :style="{ background: argbToCss(acc.color) }" />
              <div class="ic-tile sm" :style="{ background: argbToCss(acc.color) }">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
                  <path d="M3 7h18M3 7l2-3h14l2 3M5 7v13h14V7" /><path d="M9 11h6" />
                </svg>
              </div>
              <div class="txn-main">
                <div class="txn-title" style="font-size: 14px">
                  {{ acc.name }}
                  <span v-if="acc.archivedAt !== null" class="badge" style="background: var(--surface-2); color: var(--fg-3); margin-left: 6px">已归档</span>
                </div>
                <div class="txn-sub">{{ periodText(acc) }}</div>
              </div>
              <div class="num" style="font-weight: 700">{{ format(balanceById.get(acc.id) ?? 0) }}</div>
            </div>
            <button class="btn btn-ghost btn-block mt-2" style="border-style: dashed; color: var(--fg-2)" @click="openProjectCreate">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M12 5v14M5 12h14" /></svg>
              新建专项账户
            </button>
          </div>
        </div>
      </div>


      <div v-if="selectedAccount" class="stack gap-4">

        <div
          class="card card-pad acc-hero"
          :style="{ background: `linear-gradient(135deg, ${argbToCss(selectedAccount.color)}, #34a853)` }"
        >
          <div class="row gap-3" style="align-items: flex-start">
            <div class="ic-tile lg" style="background: rgba(255, 255, 255, 0.22)">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
                <path d="M3 6h18l-2 13H5z" /><path d="M9 6V4h6v2" />
              </svg>
            </div>
            <div style="flex: 1; min-width: 0">
              <div style="font-size: 13px; opacity: 0.9; font-weight: 600">{{ selectedAccount.name }} · 当前余额</div>
              <div class="num acc-hero-amt">¥{{ format(balanceById.get(selectedAccount.id) ?? 0) }}</div>
              <div v-if="isProjectSelected" style="font-size: 12px; opacity: 0.9; font-weight: 600">
                专项 · {{ periodText(selectedAccount) }}<template v-if="selectedAccount.archivedAt !== null"> · 已归档</template>
              </div>
            </div>
            <button class="btn btn-sm acc-hero-edit" @click="openAccountEdit(selectedAccount)">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" />
              </svg>
              编辑
            </button>
          </div>
          <div class="row gap-4 mt-4" style="font-size: 13px; flex-wrap: wrap">
            <span style="opacity: 0.95">{{ periodLabel }}流入 <b class="num">+{{ format(accountFlow.inflow) }}</b></span>
            <span style="opacity: 0.9">{{ periodLabel }}流出 <b class="num">−{{ format(accountFlow.outflow) }}</b></span>
          </div>
        </div>

        <label v-if="isProjectSelected" class="row gap-2">
          <input type="checkbox" :checked="projectMonthEnabled" @change="setProjectMonthEnabled(($event.target as HTMLInputElement).checked)" />
          专项账户按月份筛选
        </label>

        <div class="card">
          <div class="card-head">
            <h3>账户内分类</h3>
            <span class="faint" style="font-size: 13px">{{ selectedAccount.name }} · {{ selectedCategories.length }} 个</span>
          </div>
          <div class="card-pad" style="padding-top: 14px">
            <div v-if="selectedCategories.length" class="grid g-3">
              <div
                v-for="(cat, idx) in selectedCategories"
                :key="cat.id"
                class="cat-item"
                :class="{ 'cat-item-on': categoryFilterId === cat.id }"
                role="button"
                tabindex="0"
                :aria-pressed="categoryFilterId === cat.id"
                :title="categoryFilterId === cat.id ? '点击取消筛选' : '点击只看该分类的交易'"
                draggable="true"
                @click="toggleCategoryFilter(cat.id)"
                @keydown.enter="toggleCategoryFilter(cat.id)"
                @dragstart="onDragStart('category', idx)"
                @dragover.prevent
                @drop="onDrop('category', idx)"
              >
                <div class="ic-tile sm" :style="{ background: argbToCss(cat.color) }">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M20.6 13.4 12 22l-8.6-8.6a2 2 0 0 1 0-2.8L11 3.4a2 2 0 0 1 1.4-.6H20a2 2 0 0 1 2 2v7.6a2 2 0 0 1-.6 1.4z" />
                    <circle cx="16.5" cy="7.5" r="1.2" />
                  </svg>
                </div>
                <div style="min-width: 0; flex: 1">
                  <div style="font-weight: 600; font-size: 13px" class="ellipsis">{{ cat.name }}</div>
                  <div v-if="categoryExpense(cat.id) > 0" class="num neg" style="font-size: 11px">
                    −{{ format(categoryExpense(cat.id)) }}
                  </div>
                </div>
                <div class="cat-actions">
                  <button class="icon-btn icon-btn-sm" aria-label="编辑分类" @click.stop="openCategoryEdit(cat)">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" /></svg>
                  </button>
                  <button class="icon-btn icon-btn-sm danger" aria-label="删除分类" @click.stop="deleteCategory(cat)">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14" /></svg>
                  </button>
                </div>
              </div>
            </div>
            <div v-else class="faint" style="padding: 6px 0 12px">该账户暂无分类</div>
            <button class="btn btn-ghost btn-block mt-3" style="border-style: dashed; color: var(--fg-2)" @click="openCategoryCreate">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M12 5v14M5 12h14" /></svg>
              新建分类
            </button>
          </div>
        </div>


        <div class="card">
          <div class="card-head">
            <h3>{{ periodLabel }}交易明细</h3>
            <button
              v-if="filteredCategory"
              class="filter-chip"
              title="点击清除分类筛选"
              @click="categoryFilterId = null"
            >
              <span class="fc-dot" :style="{ background: argbToCss(filteredCategory.color) }" />
              <span class="ellipsis">{{ filteredCategory.name }}</span>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M18 6 6 18M6 6l12 12" /></svg>
            </button>
            <span v-else class="faint" style="font-size: 13px">仅显示「{{ selectedAccount.name }}」</span>
          </div>
          <div class="card-pad" style="padding-top: 4px">
            <PageSkeleton v-if="detailLoading" label="账户交易" compact />
            <div v-else-if="!error && groups.length === 0" class="empty" style="padding: 28px 12px">
              <div style="font-weight: 700; color: var(--fg-2)">{{ filterByMonth ? periodLabel : '' }}{{ filteredCategory ? '该分类下' : '该账户' }}暂无交易</div>
            </div>
            <template v-for="g in groups" :key="g.key">
              <div class="day-head">
                <span class="d-date">{{ g.label }}</span>
                <span class="d-sum">{{ daySummaryText(g) }}</span>
              </div>
              <div
                v-for="t in g.items"
                :key="t.id"
                class="txn txn-clickable"
                role="button"
                tabindex="0"
                @click="openEdit(t.id)"
                @keydown.enter="openEdit(t.id)"
              >
                <div class="ic-tile sm" :style="{ background: txnColor(t) }">
                  <svg v-if="t.type === 'expense'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12l7 7 7-7" /></svg>
                  <svg v-else-if="t.type === 'income'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 19V5M5 12l7-7 7 7" /></svg>
                  <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 3l4 4-4 4M7 21l-4-4 4-4M21 7H8M3 17h13" /></svg>
                </div>
                <div class="txn-main">
                  <div class="txn-title">
                    {{ txnTitle(t) }}
                    <span v-if="t.type === 'transfer'" class="badge badge-transfer" style="margin-left: 6px">转账</span>
                  </div>
                  <div class="txn-sub">
                    {{ txnSub(t) }}
                  </div>

                  <div v-if="t.note && t.note.trim()" class="txn-note" :title="t.note">{{ t.note }}</div>
                </div>
                <div class="txn-amt num" :class="txnAmountClass(t)">{{ txnAmountText(t) }}</div>
              </div>
            </template>
            <Pagination :page="page" :total="total" :loading="detailLoading" @change="changePage" />
          </div>
        </div>
      </div>


      <div v-else class="card card-pad empty">
        <div style="font-weight: 700; color: var(--fg-2)">先在左侧新建一个账户</div>
      </div>
    </div>


    <div v-if="modal" class="modal-backdrop" @click.self="closeModal">
      <div class="modal">
        <div class="modal-head">
          <h3>{{ modalTitle }}</h3>
          <button class="icon-btn" aria-label="关闭" @click="closeModal">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </div>
        <div class="modal-body">

          <div class="field">
            <label class="field-label">名称</label>
            <input v-model="fName" class="input" placeholder="必填，如：生活费" @keyup.enter="saveModal" />
          </div>


          <div class="field">
            <label class="field-label">颜色</label>
            <div class="swatches">

              <button
                type="button"
                class="swatch swatch-random"
                :class="{ on: fColor === randomColor }"
                :style="{ background: argbToCss(randomColor) }"
                :aria-label="'随机颜色（点击换一个）'"
                title="随机颜色（点击换一个）"
                @click="rerollRandomColor"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
                  <path d="M21 12a9 9 0 1 1-3-6.7M21 4v4h-4" />
                </svg>
              </button>
              <button
                v-for="hex in COLOR_PRESETS"
                :key="hex"
                type="button"
                class="swatch"
                :class="{ on: isColorSelected(hex) }"
                :style="{ background: hex }"
                :aria-label="`颜色 ${hex}`"
                @click="fColor = hexToArgb(hex)"
              />
            </div>
          </div>


          <template v-if="modal.kind === 'account'">
            <div class="field">
              <label class="field-label">初始余额（元）</label>
              <input v-model="fInitialBalance" class="input" inputmode="decimal" placeholder="0" />
            </div>
            <div class="field">
              <label class="field-label">计入总额</label>
              <div class="row gap-3">
                <button class="switch" :class="{ on: fIncludeInBalance }" role="switch" :aria-checked="fIncludeInBalance" @click="fIncludeInBalance = !fIncludeInBalance">
                  <span class="knob" />
                </button>
                <span class="faint" style="font-size: 13px">{{ fIncludeInBalance ? '计入左栏总额' : '不计入左栏总额' }}</span>
              </div>
            </div>


            <div class="field">
              <label class="field-label">账户类型</label>
              <div class="row gap-3">
                <button
                  class="switch"
                  :class="{ on: fKind === 'project' }"
                  role="switch"
                  :aria-checked="fKind === 'project'"
                  @click="fKind = fKind === 'project' ? 'normal' : 'project'"
                >
                  <span class="knob" />
                </button>
                <span class="faint" style="font-size: 13px">{{ fKind === 'project' ? '专项账户（不计入日常统计）' : '普通账户' }}</span>
              </div>
            </div>


            <template v-if="fKind === 'project'">
              <div class="divider" style="margin: 2px 0" />
              <div class="faint" style="font-size: 12px; line-height: 1.5">
                专项账户用于记录某段时间的特殊开支（如一次旅行），其交易不计入概览/报告等日常统计。
              </div>
              <div class="row gap-3">
                <div class="field" style="flex: 1">
                  <label class="field-label">开始日期</label>
                  <input v-model="fPeriodStart" class="input" type="date" />
                </div>
                <div class="field" style="flex: 1">
                  <label class="field-label">结束日期</label>
                  <input v-model="fPeriodEnd" class="input" type="date" />
                </div>
              </div>
              <div class="field">
                <label class="field-label">已结束（归档）</label>
                <div class="row gap-3">
                  <button class="switch" :class="{ on: fArchived }" role="switch" :aria-checked="fArchived" @click="fArchived = !fArchived">
                    <span class="knob" />
                  </button>
                  <span class="faint" style="font-size: 13px">{{ fArchived ? '已归档：标记该专项已结束' : '进行中' }}</span>
                </div>
              </div>
            </template>
          </template>
        </div>

        <div class="modal-foot">
          <button
            v-if="modal.mode === 'edit' && modal.kind === 'account' && selectedAccount"
            class="btn btn-ghost danger-text"
            @click="deleteAccount(selectedAccount)"
          >
            删除账户
          </button>
          <span style="flex: 1" />
          <span class="kbd-hint" aria-hidden="true"><span class="kbd">Esc</span>取消</span>
          <button class="btn btn-ghost" @click="closeModal">取消</button>
          <button class="btn btn-primary" :disabled="saving || !fName.trim()" @click="saveModal">
            {{ saving ? '保存中…' : '保存' }}
          </button>
        </div>
      </div>
    </div>


    <div v-if="confirmState" class="modal-backdrop" @click.self="confirmState = null">
      <div class="modal modal-sm">
        <div class="modal-head"><h3>{{ confirmState.title }}</h3></div>
        <div class="modal-body">
          <p style="color: var(--fg-2); font-size: 14px; line-height: 1.6">{{ confirmState.message }}</p>
        </div>
        <div class="modal-foot">
          <span style="flex: 1" />
          <span class="kbd-hint" aria-hidden="true"><span class="kbd">Esc</span>取消</span>
          <button class="btn btn-ghost" @click="confirmState = null">取消</button>
          <button class="btn btn-danger" @click="runConfirm">{{ confirmState.confirmText }}</button>
        </div>
      </div>
    </div>


    <div v-if="feedback" class="toast" :class="feedback.kind">{{ feedback.msg }}</div>
    </template>
  </div>
</template>

<style scoped>
/* 流水行备注（层级低于 .txn-sub 的最次要一行；单行省略，悬停看全文）。
   与 Overview.vue 的 .txn-note 保持一致：--fg-3 叠加 opacity 再淡一级，不硬编码色值。 */
.txn-note {
  font-size: var(--fs-xs);
  color: var(--fg-3);
  opacity: 0.75;
  margin-top: 2px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* 账户视图双栏：左固定 340px、右自适应，顶对齐。
   右轨道用 minmax(0, 1fr) 而非 1fr：1fr 的最小尺寸默认为 min-content，
   对 nowrap 的 .txn-note（超长备注）来说 min-content = 整段文字宽，会把轨道/整页撑爆、
   省略号失效。压成最小 0 后，列宽即备注最大宽度，超出由 .txn-note 的 ellipsis 隐藏。 */
.acc-two-col {
  grid-template-columns: 340px minmax(0, 1fr);
  align-items: start;
}
.acc-list-card {
  position: sticky;
  top: 0;
}

/* 账户行（选中态 + 拖拽） */
.acc-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 8px;
  border-radius: var(--r-md);
  position: relative;
  overflow: hidden;
  cursor: pointer;
}
.acc-row:hover {
  background: var(--surface-2);
}
.acc-row.on {
  background: var(--primary-soft);
}
.acc-row-bar {
  position: absolute;
  left: 0;
  top: 8px;
  bottom: 8px;
  width: 4px;
  border-radius: 0 4px 4px 0;
}
.drag-handle {
  cursor: grab;
  flex-shrink: 0;
}
.drag-handle:active {
  cursor: grabbing;
}

/* 专项账户分区：与日常账户视觉分隔（顶部分隔线 + 区标题） */
.proj-section {
  margin-top: 14px;
  padding-top: 12px;
  border-top: 1px dashed var(--border);
}
.proj-section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-weight: 700;
  font-size: var(--fs-sm);
  color: var(--fg-2);
  padding: 0 8px 6px;
}

/* 账户头部色块卡 */
.acc-hero {
  border: none;
  color: #fff;
}
.acc-hero-amt {
  font-size: 34px;
  font-weight: 800;
  margin: 2px 0;
}
.acc-hero-edit {
  background: rgba(255, 255, 255, 0.2);
  color: #fff;
}
.acc-hero-edit:hover {
  background: rgba(255, 255, 255, 0.32);
}

/* 分类网格项 */
.cat-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px;
  border-radius: var(--r-md);
  border: 1px solid var(--border);
  cursor: pointer;
}
.cat-item:hover {
  border-color: var(--border-strong);
  background: var(--surface-2);
}
.cat-item-on {
  border-color: transparent;
  background: var(--primary-soft);
  box-shadow: inset 0 0 0 1px var(--primary);
}
.cat-item-on:hover {
  background: var(--primary-soft);
  border-color: transparent;
}
/* 明细卡头：可点击清除的分类筛选 chip */
.filter-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  max-width: 60%;
  background: var(--primary-soft);
  color: var(--primary);
  border: none;
  border-radius: var(--r-pill);
  padding: 4px 10px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
}
.filter-chip:hover {
  background: var(--primary);
  color: var(--primary-fg);
}
.filter-chip .fc-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}
.filter-chip svg {
  width: 14px;
  height: 14px;
  flex-shrink: 0;
}
.cat-actions {
  display: flex;
  gap: 2px;
  opacity: 0;
  transition: 0.12s;
  flex-shrink: 0;
}
.cat-item:hover .cat-actions {
  opacity: 1;
}
.icon-btn-sm {
  width: 28px;
  height: 28px;
}
.icon-btn-sm svg {
  width: 15px;
  height: 15px;
}
.icon-btn.danger:hover {
  background: var(--expense-soft);
  color: var(--expense);
}
.ellipsis {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 弹层 */
.modal-backdrop {
  position: fixed;
  inset: 0;
  z-index: 40;
  background: rgba(16, 24, 40, 0.32);
  display: grid;
  place-items: center;
  padding: 20px;
}
.modal {
  width: 100%;
  max-width: 440px;
  background: var(--surface);
  border-radius: var(--r-xl);
  box-shadow: var(--sh-3);
  overflow: hidden;
}
.modal-sm {
  max-width: 380px;
}
.modal-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  border-bottom: 1px solid var(--border);
}
.modal-head h3 {
  font-size: var(--fs-h3);
  font-weight: 700;
}
.modal-body {
  padding: 18px 20px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.modal-foot {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 14px 20px;
  border-top: 1px solid var(--border);
}
.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.field .field-label {
  margin-bottom: 0;
}
.danger-text {
  color: var(--expense);
  border-color: transparent;
}
.danger-text:hover {
  background: var(--expense-soft);
}

/* 色板 */
.swatches {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}
.swatch {
  width: 30px;
  height: 30px;
  border-radius: 50%;
  border: 2px solid transparent;
  box-shadow: 0 0 0 1px var(--border) inset;
}
.swatch.on {
  border-color: var(--fg);
  box-shadow: 0 0 0 3px var(--ring);
}
/* 随机色芯片：色块基础上叠一个刷新图标，提示可点击重掷 */
.swatch-random {
  display: grid;
  place-items: center;
  color: #fff;
  cursor: pointer;
}
.swatch-random svg {
  width: 16px;
  height: 16px;
  filter: drop-shadow(0 1px 1px rgba(0, 0, 0, 0.35));
}

/* 开关 */
.switch {
  width: 44px;
  height: 26px;
  border-radius: 999px;
  background: var(--surface-3);
  position: relative;
  transition: 0.15s;
  flex-shrink: 0;
}
.switch.on {
  background: var(--primary);
}
.switch .knob {
  position: absolute;
  top: 3px;
  left: 3px;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: #fff;
  box-shadow: var(--sh-1);
  transition: 0.15s;
}
.switch.on .knob {
  left: 21px;
}

/* toast */
.toast {
  position: fixed;
  top: 76px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 60;
  padding: 10px 18px;
  border-radius: var(--r-pill);
  font-size: var(--fs-sm);
  font-weight: 700;
  box-shadow: var(--sh-3);
}
.toast.success {
  background: var(--income-soft);
  color: var(--income);
}
.toast.error {
  background: var(--expense-soft);
  color: var(--expense);
}

/* 窄视口退化为单列（手机端单列） */
@media (max-width: 960px) {
  .acc-two-col {
    grid-template-columns: 1fr;
  }
  /* 单列后 grid 列默认 minmax(auto,1fr)，auto 最小值=子项 max-content 宽，
     会被卡头「N 个 · 总额」等不换行长行撑破视口 → 窄屏横向滚动（iPhone SE 320px 复现）。
     给两列子项补 min-width:0，让列可收缩到容器宽度。（桌面双栏用固定 340px 列，不受影响。） */
  .acc-two-col > * {
    min-width: 0;
  }
  .acc-list-card {
    position: static;
  }
}

/* 明细流水行可点击进入编辑，hover 有底色/指针反馈。 */
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

/* ============================================================
   手机端（≤720px）：双栏已在 960px 断点塌单列；此处补齐分类网格、弹层、
   悬停才显的操作按钮改常显。仅样式，不动逻辑。
   ============================================================ */
@media (max-width: 720px) {
  /* 分类网格：三列 → 单列铺满，避免挤压 */
  .grid.g-3 {
    grid-template-columns: 1fr;
  }

  /* 弹层：近满宽居中，不溢出（max-width 560/440/380 在窄屏统一收敛） */
  .modal {
    width: calc(100vw - 32px);
    max-width: 440px;
  }

  /* cat-actions 桌面靠 hover 显现；触屏无 hover → 常显，保证可点（§4.4） */
  .cat-actions {
    opacity: 1;
  }

  /* 触控命中区：icon 按钮放大到 ≥40px */
  .icon-btn {
    width: 40px;
    height: 40px;
  }
}
</style>

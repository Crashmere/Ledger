<script setup lang="ts">
import { usePageRefresh } from '../composables/usePageRefresh';
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { useSelectedMonth } from '../composables/useSelectedMonth';
import { useRouter } from 'vue-router';
import {
  accountService,
  categoryService,
  statsService,
  txnService,
  format,
  type Account,
  type Category,
  type Id,
  emptySummary, type DayTotal,
  type Transaction,
} from '../api';

import Pagination from '../components/Pagination.vue';
import LoadError from '../components/LoadError.vue';
import PageSkeleton from '../components/PageSkeleton.vue';
import { groupDays, type DayGroup } from '../services/groupDays';
const router = useRouter();

function openEdit(id: Id): void {
  void router.push(`/txn/${id}/edit`);
}

const { dateFrom, dateTo, periodLabel } = useSelectedMonth();

const summary = ref(emptySummary());
const page = ref(1);
const total = ref(0);
const dayTotals = ref<Record<string, DayTotal>>({});
const error = ref('');
const txns = ref<Transaction[]>([]);
const accounts = ref<Account[]>([]);
const balanceById = ref<Map<Id, number>>(new Map());
const categoryById = ref<Map<Id, Category>>(new Map());
const loading = ref(false);
const initializing = ref(true);
const initializingRequest = ref(false);

async function loadStatic(): Promise<void> {
  const [result, cats] = await Promise.all([accountService.list(), categoryService.list()]);
  accounts.value = result.items;
  balanceById.value = new Map(result.items.map(a => [a.id, a.balance]));
  categoryById.value = new Map(cats.map(c => [c.id, c]));
}

let monthRequest = 0;
async function loadMonth(withStats = true): Promise<void> {
  const request = ++monthRequest;
  loading.value = true;
  error.value = '';
  try {
    const q = { dateFrom: dateFrom.value, dateTo: dateTo.value, projectScope: 'exclude' as const };
    const [nextSummary, nextTxns] = await Promise.all([
      withStats ? statsService.summary(q) : Promise.resolve(summary.value),
      txnService.query({ filter: q, page: page.value, includeDayTotals: true, sortBy: 'time', sortDir: 'desc' }),
    ]);
    if (request !== monthRequest) return;
    summary.value = nextSummary;
    txns.value = nextTxns.items;
    total.value = nextTxns.totalCount;
    dayTotals.value = nextTxns.dayTotals ?? {};
  } catch (e) {
    if (request === monthRequest) { error.value = (e as Error).message; txns.value = []; summary.value = emptySummary(); total.value = 0; }
  } finally {
    if (request === monthRequest) loading.value = false;
  }
}

async function initialize(): Promise<void> {
  if (initializingRequest.value) return;
  initializingRequest.value = true;
  error.value = '';
  try { await loadStatic(); await loadMonth(); }
  catch (e) { error.value = (e as Error).message; }
  finally { initializing.value = false; initializingRequest.value = false; }
}
onMounted(initialize);
onUnmounted(() => { monthRequest++; });
watch([dateFrom, dateTo], () => { page.value = 1; void loadMonth(); });
function changePage(value: number): void { page.value = value; void loadMonth(false); }
const txnCount = computed(() => total.value);

const netPositive = computed(() => summary.value.net >= 0);

const groups = computed(() => groupDays(txns.value, dayTotals.value));

function daySummaryText(g: DayGroup): string {
  return `支出 ${format(g.expense)} · 收入 ${format(g.income)}`;
}

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

function categoryName(id: Id | null): string {
  if (!id) return '';
  return categoryById.value.get(id)?.name ?? '';
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
  return cat ? `${accountName(t.accountId)} · ${cat}` : accountName(t.accountId);
}

function txnAmountText(t: Transaction): string {
  if (t.type === 'expense') return `−${format(t.amount)}`;
  if (t.type === 'income') return `+${format(t.amount)}`;
  return format(t.amount); // transfer：不带正负
}

function txnAmountClass(t: Transaction): string {
  if (t.type === 'expense') return 'neg';
  if (t.type === 'income') return 'pos';
  return 'tr';
}
usePageRefresh(() => { page.value = 1; void initialize(); });
</script>

<template>
  <div class="content">
    <PageSkeleton v-if="initializing || loading || initializingRequest" label="概览" />
    <template v-else>
    <LoadError :message="error" @retry="initialize" />


    <div class="grid g-3">
      <div class="stat">
        <div class="s-label">
          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M12 2v20M17 7H9.5a2.5 2.5 0 0 0 0 5h5a2.5 2.5 0 0 1 0 5H6" />
          </svg>
          {{ periodLabel }}净额
        </div>
        <div class="s-value num" :class="netPositive ? 'pos' : 'neg'">
          {{ format(summary.net, { sign: true }) }}
        </div>
        <div class="s-trend">共 {{ txnCount }} 笔</div>
      </div>
      <div class="stat">
        <div class="s-label">
          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M12 19V5M5 12l7-7 7 7" />
          </svg>
          总收入
        </div>
        <div class="s-value num pos">{{ format(summary.income, { sign: true }) }}</div>
        <div class="s-trend">{{ periodLabel }}流入（不含转账）</div>
      </div>
      <div class="stat">
        <div class="s-label">
          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M12 5v14M5 12l7 7 7-7" />
          </svg>
          总支出
        </div>
        <div class="s-value num neg">−{{ format(summary.expense) }}</div>
        <div class="s-trend">{{ periodLabel }}流出（不含转账）</div>
      </div>
    </div>

    <div class="two-col ov-two-col mt-4">

      <div class="card">
        <div class="card-head">
          <h3>{{ periodLabel }}流水</h3>
          <span class="faint" style="font-size: 13px">按日期分组</span>
        </div>
        <div class="card-pad" style="padding-top: 4px">

          <div v-if="!loading && !error && groups.length === 0" class="empty">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6">
              <rect x="3" y="4" width="18" height="16" rx="2" />
              <path d="M3 9h18M8 14h8" />
            </svg>
            <div style="font-weight: 700; color: var(--fg-2)">{{ periodLabel }}还没有记账</div>
            <RouterLink to="/add" class="btn btn-secondary btn-sm mt-3">去记一笔</RouterLink>
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
                  {{ txnTitle(t) }}
                  <span v-if="t.type === 'transfer'" class="badge badge-transfer" style="margin-left: 6px">转账</span>
                  <span v-else-if="t.type === 'income'" class="badge badge-income" style="margin-left: 6px">收入</span>
                </div>
                <div class="txn-sub">
                  {{ txnSub(t) }}
                </div>

                <div v-if="t.note && t.note.trim()" class="txn-note" :title="t.note">{{ t.note }}</div>
              </div>
              <div class="txn-amt num" :class="txnAmountClass(t)">{{ txnAmountText(t) }}</div>
            </div>
          </template>
          <Pagination :page="page" :total="total" :loading="loading" @change="changePage" />
        </div>
      </div>


      <div class="stack gap-4">
        <div class="card">
          <div class="card-head"><h3>账户余额</h3></div>
          <div class="card-pad" style="padding-top: 8px">
            <div
              v-for="acc in accounts"
              :key="acc.id"
              class="txn"
              style="border: none; padding: 9px 0"
            >
              <div class="ic-tile sm" :style="{ background: argbToCss(acc.color) }">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
                  <path d="M3 6h18l-2 13H5z" />
                </svg>
              </div>
              <div class="txn-main">
                <div class="txn-title" style="font-size: 13px">{{ acc.name }}</div>
              </div>
              <div class="mono-lg num">{{ format(balanceById.get(acc.id) ?? 0) }}</div>
            </div>
          </div>
        </div>

        <RouterLink
          to="/add"
          class="card card-pad"
          style="background: var(--primary-soft); border-color: transparent"
        >
          <div class="row gap-3">
            <div class="ic-tile" style="background: var(--primary)">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4">
                <path d="M12 5v14M5 12h14" />
              </svg>
            </div>
            <div>
              <div style="font-weight: 700">快速记一笔</div>
              <div class="muted" style="font-size: 12px">默认支出 · 今天</div>
            </div>
            <button class="btn btn-primary btn-sm" style="margin-left: auto">开始</button>
          </div>
        </RouterLink>
      </div>
    </div>
    </template>
  </div>
</template>

<style scoped>
/* 流水行备注（层级低于 .txn-sub 的最次要一行；单行省略，悬停看全文）。
   .txn-sub 用 --fg-3，本行叠加 opacity 再淡一级，不硬编码色值。 */
.txn-note {
  font-size: var(--fs-xs);
  color: var(--fg-3);
  opacity: 0.75;
  margin-top: 2px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* 概览双栏：左流水自适应、右侧固定 360px（对照设计稿桌面双栏）。
   左轨道用 minmax(0, 1fr) 而非 1fr：1fr 最小尺寸默认为 min-content，
   流水行里 nowrap 的超长备注会把左列撑爆、整页横向溢出、省略号失效。
   压成最小 0 后左列可收缩到容器内，超长备注由 .txn-note 的 ellipsis 隐藏。 */
.ov-two-col {
  grid-template-columns: minmax(0, 1fr) 360px;
  align-items: start;
}

/* 窄视口退化为单列（手机端单列）。 */
@media (max-width: 900px) {
  .ov-two-col {
    grid-template-columns: 1fr;
  }
  /* 单列后 grid 列默认 minmax(auto,1fr)，auto 最小值=子项 max-content 宽，
     会被卡片内不换行的金额/长行撑破视口 → 横向滚动。给两列子项补 min-width:0，
     让列可收缩到容器宽度。（桌面双栏用固定 360px 列，不受影响。） */
  .ov-two-col > * {
    min-width: 0;
  }
  .grid.g-3 {
    grid-template-columns: 1fr;
  }
}

/* 流水行可点击进入编辑，hover 有底色/指针反馈（负 margin + padding 让底色铺满行内边距）。 */
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
</style>

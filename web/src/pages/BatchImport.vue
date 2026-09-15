<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { onBeforeRouteLeave, useRoute, useRouter } from 'vue-router';
import {
  accountService, categoryService, txnService, format, AppError,
  type Account, type Category, type BatchRow, type BatchPreview,
} from '../api';
import {
  parseTextTransactions, type TextTransaction,
} from '../services/import/textTransactions';

import { beijingDate } from '../services/dates';
import LoadError from '../components/LoadError.vue';
import { readPreference } from '../services/preferences';

interface ImportRow extends TextTransaction {
  accountId: string;
  categoryId: string;
  date: string;
}

const route = useRoute();
const router = useRouter();
const source = ref('');
const parsedSource = ref('');
const parsed = ref(false);
const rows = ref<ImportRow[]>([]);
const accounts = ref<Account[]>([]);
const categories = ref(new Map<string, Category[]>());
const loading = ref(true);
const saving = ref(false);
const error = ref('');
const notice = ref('');
const imported = ref<{ count: number; expense: number; income: number } | null>(null);
const confirmDialog = ref<HTMLDialogElement | null>(null);
const previewHeading = ref<HTMLElement | null>(null);
const sourceInput = ref<HTMLTextAreaElement | null>(null);
const selection = ref(new Set<number>());
let selectionAnchor: number | null = null;

const defaultAccount = ref('');
const defaultCategory = ref('');
const defaultDate = ref(beijingDate());
const batchAccount = ref('');
const batchCategory = ref('__unchanged');
const batchDate = ref('');
const accountGroups = computed(() => [
  { label: '普通账户', items: accounts.value.filter((a) => a.kind === 'normal') },
  { label: '专项账户', items: accounts.value.filter((a) => a.kind === 'project') },
].filter((g) => g.items.length));
const defaultCategories = computed(() => categories.value.get(defaultAccount.value) ?? []);
watch(defaultAccount, () => { defaultCategory.value = ''; });

const selectedRows = computed(() => rows.value.filter((row) => selection.value.has(row.lineNumber)));
const batchCategoryAccount = computed(() => {
  if (batchAccount.value) return batchAccount.value;
  const ids = new Set(selectedRows.value.map((row) => row.accountId));
  return ids.size === 1 ? selectedRows.value[0]?.accountId ?? '' : '';
});
const batchCategories = computed(() => categories.value.get(batchCategoryAccount.value) ?? []);
watch(batchCategoryAccount, () => { batchCategory.value = '__unchanged'; });
const allSelected = computed(() => rows.value.length > 0 && selection.value.size === rows.value.length);
const sourceChanged = computed(() => parsed.value && source.value !== parsedSource.value);
const hasDraft = computed(() => !!source.value.trim() || rows.value.length > 0);
const canApply = computed(() => selection.value.size > 0 &&
  !!(batchAccount.value || batchCategory.value !== '__unchanged' || batchDate.value));

const preview = ref<BatchPreview | null>(null);
const previewing = ref(false);
let previewRequest = 0;
let previewTimer: ReturnType<typeof setTimeout> | undefined;
const requestRows = computed<BatchRow[]>(() => rows.value.map(row => ({
  line: row.lineNumber, amountInput: row.amountInput, title: row.title, note: row.note,
  accountId: row.accountId, categoryId: row.categoryId || null, date: row.date,
})));
const checkedRows = computed(() => rows.value.map(row => {
  const result = preview.value?.rows.find(item => item.line === row.lineNumber);
  return { row, errors: result?.errors ?? [], amount: {
    type: result?.transaction?.type ?? (row.amountInput.trim().startsWith('+') ? 'income' : 'expense'),
    error: result?.errors.length ? result.errors[0] : null,
  } };
}));
const invalidCount = computed(() => preview.value?.rows.filter(row => row.errors.length).length ?? 0);
const totals = computed(() => ({ expense: preview.value?.expense ?? 0, income: preview.value?.income ?? 0, valid: preview.value?.valid ?? false }));
const canImport = computed(() => !!preview.value?.valid && !previewing.value && !sourceChanged.value && !loading.value && !saving.value);
async function refreshPreview(): Promise<void> {
  clearTimeout(previewTimer);
  const request = ++previewRequest;
  preview.value = null;
  if (!rows.value.length) { previewing.value = false; return; }
  previewing.value = true;
  try {
    const result = await txnService.preview(requestRows.value);
    if (request === previewRequest) { preview.value = result; error.value = ''; }
  } catch (e) {
    if (request === previewRequest) error.value = (e as Error).message;
  } finally {
    if (request === previewRequest) previewing.value = false;
  }
}
watch(requestRows, () => {
  previewRequest++; preview.value = null; previewing.value = true;
  clearTimeout(previewTimer);
  previewTimer = setTimeout(() => void refreshPreview(), 250);
}, { deep: true, flush: 'sync' });
async function loadChoices(): Promise<void> {
  const [result, list] = await Promise.all([accountService.list(), categoryService.list()]);
  accounts.value = result.items;
  const grouped = new Map<string, Category[]>();
  for (const category of list) {
    const group = grouped.get(category.accountId) ?? [];
    group.push(category); grouped.set(category.accountId, group);
  }
  categories.value = grouped;
}

async function generatePreview(): Promise<void> {
  if (!source.value.trim() || loading.value || saving.value) return;
  if (parsed.value && !window.confirm('重新解析会覆盖当前预览中的修改，是否继续？')) return;
  rows.value = parseTextTransactions(source.value).map((row) => ({
    ...row, accountId: defaultAccount.value, categoryId: defaultCategory.value, date: defaultDate.value,
  }));
  parsedSource.value = source.value;
  parsed.value = true;
  selection.value = new Set();
  selectionAnchor = null;
  error.value = '';
  notice.value = '';
  imported.value = null;
  await refreshPreview();
  await nextTick();
  previewHeading.value?.focus();
  previewHeading.value?.scrollIntoView({ block: 'start' });
}

function selectRow(row: ImportRow, event: MouseEvent): void {
  const checked = (event.target as HTMLInputElement).checked;
  const next = new Set(selection.value);
  const end = rows.value.indexOf(row);
  const start = rows.value.findIndex((r) => r.lineNumber === selectionAnchor);
  const range = event.shiftKey && start >= 0 ? rows.value.slice(Math.min(start, end), Math.max(start, end) + 1) : [row];
  for (const item of range) {
    if (checked) next.add(item.lineNumber);
    else next.delete(item.lineNumber);
  }
  selection.value = next;
  selectionAnchor = row.lineNumber;
}

function selectAll(): void {
  selection.value = allSelected.value ? new Set() : new Set(rows.value.map((r) => r.lineNumber));
  selectionAnchor = null;
}

function changeAccount(row: ImportRow): void {
  if (!(categories.value.get(row.accountId) ?? []).some((c) => c.id === row.categoryId)) row.categoryId = '';
}

function applyBatch(): void {
  if (!canApply.value) return;
  for (const row of selectedRows.value) {
    if (batchAccount.value) {
      row.accountId = batchAccount.value;
      changeAccount(row);
    }
    if (batchCategory.value !== '__unchanged') row.categoryId = batchCategory.value;
    if (batchDate.value) row.date = batchDate.value;
  }
  notice.value = `已更新 ${selection.value.size} 笔；其他记录保持不变`;
}

function removeRow(lineNumber: number): void {
  rows.value = rows.value.filter((row) => row.lineNumber !== lineNumber);
  selection.value.delete(lineNumber);
  notice.value = `已移出原文第 ${lineNumber} 行（尚未入账，不影响已有交易）`;
}

async function askImport(): Promise<void> {
  if (!canImport.value) return;
  loading.value = true;
  error.value = '';
  try {
    await loadChoices();
    await refreshPreview();
  } catch {
    error.value = '读取账户和分类失败，请重试';
  } finally {
    loading.value = false;
  }
  if (!error.value && canImport.value) confirmDialog.value?.showModal();
}

async function commitImport(): Promise<void> {
  if (!canImport.value || !confirmDialog.value?.open) return;
  saving.value = true;
  error.value = '';
  try {
    const result = await txnService.batch(requestRows.value);
    imported.value = { count: result.count, expense: result.expense, income: result.income };
    rows.value = [];
    source.value = '';
    parsedSource.value = '';
    parsed.value = false;
    selection.value = new Set();
    notice.value = '';
    confirmDialog.value?.close();
  } catch (e) {
    error.value = e instanceof AppError ? e.message : '保存失败，请先查看账目核对结果。';
    confirmDialog.value?.close();
  } finally {
    saving.value = false;
  }
}

function allowLeave(): boolean {
  if (saving.value) return false;
  return !hasDraft.value || window.confirm('当前批次尚未入账，离开将丢失草稿。是否离开？');
}

function beforeUnload(event: BeforeUnloadEvent): void {
  if (!hasDraft.value && !saving.value) return;
  event.preventDefault();
  event.returnValue = '';
}

function goBack(): void {
  if (window.history.state?.back) router.back();
  else void router.push('/add');
}

function onDialogCancel(event: Event): void {
  if (saving.value) event.preventDefault();
}

async function retryLoad(): Promise<void> {
  loading.value = true;
  try { await loadChoices(); if (rows.value.length) await refreshPreview(); else error.value = ''; }
  catch (e) { error.value = (e as Error).message; }
  finally { loading.value = false; }
}
onBeforeRouteLeave(allowLeave);
onMounted(async () => {
  window.addEventListener('beforeunload', beforeUnload);
  window.addEventListener('ledger-reload', retryLoad);
  try {
    await loadChoices();
    const fromRoute = typeof route.query.account === 'string' ? route.query.account : '';
    const last = readPreference('last_account_id');
    defaultAccount.value = accounts.value.find((a) => a.id === fromRoute)?.id ??
      accounts.value.find((a) => a.id === last)?.id ?? accounts.value[0]?.id ?? '';
    const date = route.query.date;
    if (typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date)) defaultDate.value = date;
  } catch {
    error.value = '加载账户失败，请刷新后重试；原文尚未写入数据库';
  } finally {
    loading.value = false;
  }
});
onBeforeUnmount(() => { previewRequest++; clearTimeout(previewTimer); window.removeEventListener('beforeunload', beforeUnload); window.removeEventListener('ledger-reload', retryLoad); });
</script>

<template>
  <div class="content batch-import">
    <Teleport to="#topbar-slot">
      <button class="btn btn-ghost btn-sm" :disabled="saving" @click="goBack">返回</button>
    </Teleport>

    <section v-if="imported" class="card import-success" role="status">
      <h3>已记账 {{ imported.count }} 笔交易</h3>
      <p>支出 {{ format(imported.expense) }} 元 · 收入 {{ format(imported.income) }} 元</p>
      <p class="muted">已保存。</p>
      <div class="action-row">
        <button class="btn btn-ghost btn-sm" @click="imported = null; sourceInput?.focus()">继续记账</button>
        <RouterLink to="/search" class="btn btn-secondary btn-sm">查看交易</RouterLink>
      </div>
    </section>
    <LoadError :message="error" @retry="retryLoad" />
    <p v-if="loading" class="muted" role="status">正在加载账户和分类…</p>
    <p v-if="!loading && !accounts.length" class="import-error">暂无账户，请先到账户页创建账户后再记账。</p>

    <fieldset :disabled="saving || loading" class="import-editor">
      <details class="card source-card" :open="!parsed">
        <summary>1. 粘贴记账文本 <span class="muted">{{ parsed ? '展开查看原文 / 重新解析' : '每行一笔' }}</span></summary>
        <div class="source-body">
          <label for="import-source" class="field-label">金额 标题 备注</label>
          <textarea id="import-source" ref="sourceInput" v-model="source" class="input source-input" rows="6"
            placeholder="-26.32 滤芯 一个&#10;-69 麻本色高支亚麻 3.4 米&#10;+10 退款" spellcheck="false"></textarea>
          <p class="help">空格或 Tab 分隔；标题后的所有内容作为备注。+ 表示收入，负号或无符号表示支出，金额最多两位小数。</p>
          <div class="default-fields">
            <label>默认账户
              <select v-model="defaultAccount" class="input" aria-label="默认账户">
                <option value="">请选择账户</option>
                <optgroup v-for="group in accountGroups" :key="group.label" :label="group.label">
                  <option v-for="a in group.items" :key="a.id" :value="a.id">{{ a.name }}{{ a.archivedAt ? '（已归档）' : '' }}</option>
                </optgroup>
              </select>
            </label>
            <label>默认分类
              <select v-model="defaultCategory" class="input" aria-label="默认分类">
                <option value="">未分类</option>
                <option v-for="c in defaultCategories" :key="c.id" :value="c.id">{{ c.name }}</option>
              </select>
            </label>
            <label>默认日期<input v-model="defaultDate" class="input" type="date" aria-label="默认日期" /></label>
          </div>
          <div class="action-row">
            <button class="btn btn-primary" :disabled="!source.trim()" @click="generatePreview">{{ parsed ? '重新解析' : '解析并预览' }}</button>
            <span class="help">仅生成草稿，确认记账后才入账。</span>
          </div>
        </div>
      </details>

      <section v-if="parsed" class="preview-section">
        <h3 ref="previewHeading" tabindex="-1" class="preview-title">2. 预览与批量设置 <span class="muted">{{ rows.length }} 笔</span></h3>
        <p class="help">勾选只用于批量修改；记账将保存所有保留的行，不需要的行请点“移出”。</p>
        <p v-if="sourceChanged" class="import-error" role="alert">
          原文已改变，请重新解析后再记账，或 <button class="text-action" @click="source = parsedSource">还原原文</button> 保留当前预览。
        </p>
        <div class="batch-toolbar card">
          <div class="selection-bar">
            <label class="selection-toggle"><input type="checkbox" :checked="allSelected" :indeterminate="selection.size > 0 && !allSelected" @change="selectAll" />全选</label>
            <span>已选 {{ selection.size }} 笔</span>
            <button v-if="selection.size" class="text-action" @click="selection = new Set(); selectionAnchor = null">取消全选</button>
            <span class="kbd-hint"><span class="kbd">Shift</span> 连选</span>
          </div>
          <div class="batch-fields">
            <label>账户
              <select v-model="batchAccount" class="input" aria-label="批量账户">
                <option value="">保持不变</option>
                <optgroup v-for="group in accountGroups" :key="group.label" :label="group.label">
                  <option v-for="a in group.items" :key="a.id" :value="a.id">{{ a.name }}{{ a.archivedAt ? '（已归档）' : '' }}</option>
                </optgroup>
              </select>
            </label>
            <label>分类
              <select v-model="batchCategory" class="input" aria-label="批量分类" :disabled="!batchCategoryAccount">
                <option value="__unchanged">保持不变</option>
                <option value="">未分类</option>
                <option v-for="c in batchCategories" :key="c.id" :value="c.id">{{ c.name }}</option>
              </select>
            </label>
            <label>日期（留空不改）<input v-model="batchDate" class="input" type="date" aria-label="批量日期" /></label>
            <button class="btn btn-secondary btn-sm" :disabled="!canApply" @click="applyBatch">应用到选中项</button>
          </div>
          <p v-if="selection.size && !batchCategoryAccount" class="help">所选行跨账户或尚未选择账户；请先统一账户，再批量指定分类。</p>
          <p v-if="notice" class="help" role="status">{{ notice }}</p>
        </div>

        <div v-if="!rows.length" class="card empty-preview">没有待记账记录，可展开原文重新解析。</div>
        <div class="preview-list">
          <article v-for="item in checkedRows" :key="item.row.lineNumber" class="import-row card"
            :class="{ 'row-selected': selection.has(item.row.lineNumber), 'row-invalid': item.errors.length }" :data-line="item.row.lineNumber">
            <label class="row-selection">
              <input type="checkbox" :checked="selection.has(item.row.lineNumber)" :aria-label="`选择第 ${item.row.lineNumber} 行`" @click="selectRow(item.row, $event)" />
              <span class="muted num">{{ item.row.lineNumber }}</span>
            </label>
            <label class="row-amount"><span :class="item.amount.type === 'expense' ? 'neg' : 'pos'">{{ item.amount.type === 'expense' ? '支出' : '收入' }} · 元</span>
              <input v-model="item.row.amountInput" class="input num" :aria-label="`第 ${item.row.lineNumber} 行金额`" :aria-invalid="!!item.amount.error" inputmode="text" />
            </label>
            <div class="row-text">
              <label>标题<input v-model="item.row.title" class="input" :aria-label="`第 ${item.row.lineNumber} 行标题`" /></label>
              <label>备注<input v-model="item.row.note" class="input" placeholder="可留空" :aria-label="`第 ${item.row.lineNumber} 行备注`" /></label>
            </div>
            <div class="row-account">
              <label>账户
                <select v-model="item.row.accountId" class="input" :aria-label="`第 ${item.row.lineNumber} 行账户`" @change="changeAccount(item.row)">
                  <option value="">请选择账户</option>
                  <optgroup v-for="group in accountGroups" :key="group.label" :label="group.label">
                    <option v-for="a in group.items" :key="a.id" :value="a.id">{{ a.name }}{{ a.archivedAt ? '（已归档）' : '' }}</option>
                  </optgroup>
                </select>
              </label>
              <label>分类
                <select v-model="item.row.categoryId" class="input" :aria-label="`第 ${item.row.lineNumber} 行分类`">
                  <option value="">未分类</option>
                  <option v-for="c in categories.get(item.row.accountId) ?? []" :key="c.id" :value="c.id">{{ c.name }}</option>
                </select>
              </label>
            </div>
            <label class="row-date">日期<input v-model="item.row.date" class="input" type="date" :aria-label="`第 ${item.row.lineNumber} 行日期`" /></label>
            <button class="text-action row-remove" :aria-label="`移出第 ${item.row.lineNumber} 行`" @click="removeRow(item.row.lineNumber)">移出</button>
            <details class="row-source" :open="item.errors.length > 0">
              <summary>原文 · 第 {{ item.row.lineNumber }} 行</summary>
              <pre>{{ item.row.source }}</pre>
            </details>
            <p v-if="item.errors.length" class="import-error row-errors">{{ item.errors.join('；') }}</p>
          </article>
        </div>

        <div class="import-footer card">
          <div class="totals" aria-live="polite">
            <strong>待记账 {{ rows.length }} 笔</strong>
            <template v-if="preview"><span class="neg">支出 {{ format(totals.expense) }}</span><span class="pos">收入 {{ format(totals.income) }}</span></template>
            <span v-else class="faint">等待校验</span>
          </div>
          <p v-if="invalidCount" class="import-error" role="alert">{{ invalidCount }} 行待修正，请修改或移出后再记账；合计仅包含有效行。</p>
          <span v-if="previewing" class="faint">正在校验…</span>
          <button class="btn btn-primary" :disabled="!canImport" @click="askImport">确认记账 {{ rows.length }} 笔</button>
        </div>
      </section>
    </fieldset>

    <dialog ref="confirmDialog" class="import-dialog" aria-labelledby="import-confirm-title" @cancel="onDialogCancel">
      <h3 id="import-confirm-title">确认记账 {{ rows.length }} 笔交易？</h3>
      <p>支出 {{ format(totals.expense) }} 元 · 收入 {{ format(totals.income) }} 元</p>
      <p class="muted">将新增预览中的全部记录，不覆盖现有交易，也不会自动去重。请确认账户、分类和日期。</p>
      <p v-if="error" class="import-error" role="alert">{{ error }}</p>
      <div class="action-row">
        <button class="btn btn-ghost" :disabled="saving" autofocus @click="confirmDialog?.close()">返回检查</button>
        <button class="btn btn-primary" :disabled="!canImport" @click="commitImport">{{ saving ? '正在记账…' : '保存' }}</button>
      </div>
    </dialog>
  </div>
</template>

<style scoped>
.import-editor { border: 0; padding: 0; margin: 0; min-width: 0; }
.batch-import :is(label, input, select, textarea) { min-width: 0; max-width: 100%; }
.batch-import label:not(.selection-toggle):not(.row-selection) { display: grid; gap: 5px; color: var(--fg-2); font-size: var(--fs-xs); }
.batch-import .input { font-size: var(--fs-sm); padding: 7px 8px; }
.batch-import input[type="checkbox"] { accent-color: var(--primary); width: 18px; height: 18px; flex-shrink: 0; }
.batch-import :disabled { opacity: 0.6; }
.source-card > summary { padding: 14px 16px; font-weight: 700; cursor: pointer; }
.source-card > summary span { font-size: var(--fs-xs); font-weight: 400; }
.source-body { padding: 0 16px 16px; }
.source-input { resize: vertical; min-height: 140px; line-height: 1.7; }
.help { font-size: var(--fs-xs); line-height: 1.6; color: var(--fg-3); margin: 8px 0; }
.default-fields { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; margin: 14px 0; }
.action-row { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; margin-top: 14px; }
.preview-title { font-size: var(--fs-h3); margin: 22px 0 8px; scroll-margin-top: 10px; }
.preview-title span { font-size: var(--fs-sm); margin-left: 8px; }
.batch-toolbar { padding: 12px; position: sticky; top: 0; z-index: 5; box-shadow: var(--sh-1); margin: 12px 0; }
.selection-bar { display: flex; align-items: center; flex-wrap: wrap; gap: 12px; font-size: var(--fs-sm); margin-bottom: 10px; }
.selection-toggle { display: inline-flex; align-items: center; gap: 6px; cursor: pointer; }
.selection-bar .kbd-hint { margin-left: auto; }
.batch-fields { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)) auto; align-items: end; gap: 10px; }
.text-action { padding: 5px 0; color: var(--primary); font-size: var(--fs-xs); text-decoration: underline; text-underline-offset: 3px; }
.preview-list { display: grid; gap: 8px; }
.import-row { display: grid; grid-template-columns: 28px minmax(82px, 0.75fr) minmax(130px, 1.5fr) minmax(120px, 1.25fr) minmax(128px, 1fr) 28px; gap: 8px 10px; padding: 12px; align-items: start; }
.row-selected { border-color: var(--primary); background: var(--primary-soft); }
.row-invalid { border-color: var(--expense); }
.row-selection { display: flex; flex-direction: column; align-items: center; gap: 5px; font-size: var(--fs-xs); padding-top: 3px; cursor: pointer; }
.row-text, .row-account { display: grid; gap: 6px; min-width: 0; }
.row-source, .row-errors { grid-column: 2 / -1; min-width: 0; }
.row-source { font-size: var(--fs-xs); color: var(--fg-3); }
.row-source summary { cursor: pointer; }
.row-source pre { white-space: pre-wrap; overflow-wrap: anywhere; font: inherit; margin: 6px 0 0; }
.import-error { color: var(--expense); font-size: var(--fs-sm); overflow-wrap: anywhere; margin: 8px 0; }
.import-footer { padding: 16px; margin-top: 16px; }
.totals { display: flex; gap: 8px 20px; flex-wrap: wrap; margin-bottom: 12px; font-size: var(--fs-sm); }
.empty-preview, .import-success { padding: 16px; margin-bottom: 16px; }
.import-success p { margin-top: 8px; }
.import-dialog { margin: auto; width: min(440px, calc(100vw - 32px)); max-height: calc(100dvh - 32px); overflow: auto; background: var(--surface); color: var(--fg); border: 1px solid var(--border); border-radius: var(--r-lg); padding: 22px; box-shadow: var(--sh-3); }
.import-dialog::backdrop { background: rgb(0 0 0 / 35%); }
.import-dialog p { margin-top: 12px; line-height: 1.6; overflow-wrap: anywhere; }
.import-dialog .action-row { justify-content: flex-end; }
@media (max-width: 1100px) {
  .import-row { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .row-selection { grid-column: 1; grid-row: 1; flex-direction: row; }
  .row-remove { grid-column: 2; grid-row: 1; justify-self: end; padding: 6px 8px; }
  .row-amount { grid-column: 1; grid-row: 2; }
  .row-date { grid-column: 2; grid-row: 2; }
  .row-text { grid-column: 1 / -1; }
  .row-account { grid-column: 1 / -1; grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .row-source, .row-errors { grid-column: 1 / -1; }
  .batch-fields { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
@media (max-width: 720px) {
  .default-fields { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
  .default-fields > label:last-child { grid-column: 1 / -1; }
  .source-card > summary { padding: 12px; }
  .source-body { padding: 0 12px 12px; }
  .batch-toolbar { padding: 10px; }
  .batch-fields { gap: 8px; }
  .batch-import .input { font-size: 16px; width: 100%; }
  .batch-toolbar .help { font-size: 11px; }
  .selection-bar { gap: 8px; }
}
</style>

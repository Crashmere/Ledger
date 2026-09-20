<script setup lang="ts">
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  watch,
} from "vue";
import {
  onBeforeRouteLeave,
  onBeforeRouteUpdate,
  useRoute,
  useRouter,
} from "vue-router";
import EntryTabs from "../components/EntryTabs.vue";
import PageSkeleton from "../components/PageSkeleton.vue";
import SaveStatus from "../components/SaveStatus.vue";
import FabricWorldSync from "../components/FabricWorldSync.vue";
import {
  accountService,
  categoryService,
  txnService,
  format,
  AppError,
  type Account,
  type Category,
  type BatchRow,
  type BatchPreview,
  type Transaction,
} from "../api";
import {
  parseTextTransactions,
  type TextTransaction,
} from "../services/import/textTransactions";

import { beijingDate } from "../services/dates";
import LoadError from "../components/LoadError.vue";
import { readPreference } from "../services/preferences";

interface ImportRow extends TextTransaction {
  accountId: string;
  categoryId: string;
  date: string;
}

const route = useRoute();
const router = useRouter();
const source = ref("");
const parsedSource = ref("");
const parsed = ref(false);
const rows = ref<ImportRow[]>([]);
const accounts = ref<Account[]>([]);
const categories = ref(new Map<string, Category[]>());
const loading = ref(true);
const saving = ref(false);
const fabricQueue = ref<Transaction[]>([]);
async function finishFabricSync(editUrl?: string): Promise<void> {
  if (editUrl) {
    fabricQueue.value = [];
    await nextTick();
    window.location.assign(editUrl);
  } else fabricQueue.value.shift();
}
const saveError = ref("");
const saveUncertain = ref(false);
const showSaveError = ref(false);
const error = ref("");
const notice = ref("");
const imported = ref<{ count: number; expense: number; income: number } | null>(
  null,
);
const confirmDialog = ref<HTMLDialogElement | null>(null);
const previewHeading = ref<HTMLElement | null>(null);
const sourceInput = ref<HTMLTextAreaElement | null>(null);
const selection = ref(new Set<number>());
let selectionAnchor: number | null = null;

const defaultAccount = ref("");
const defaultCategory = ref("");
const defaultDate = ref(beijingDate());
const batchAccount = ref("");
const batchCategory = ref("__unchanged");
const batchDate = ref("");
const accountGroups = computed(() =>
  [
    {
      label: "普通账户",
      items: accounts.value.filter((a) => a.kind === "normal"),
    },
    {
      label: "专项账户",
      items: accounts.value.filter((a) => a.kind === "project"),
    },
  ].filter((g) => g.items.length),
);
const defaultCategories = computed(
  () => categories.value.get(defaultAccount.value) ?? [],
);
watch(defaultAccount, () => {
  defaultCategory.value = "";
});

const selectedRows = computed(() =>
  rows.value.filter((row) => selection.value.has(row.lineNumber)),
);
const batchCategoryAccount = computed(() => {
  if (batchAccount.value) return batchAccount.value;
  const ids = new Set(selectedRows.value.map((row) => row.accountId));
  return ids.size === 1 ? (selectedRows.value[0]?.accountId ?? "") : "";
});
const batchCategories = computed(
  () => categories.value.get(batchCategoryAccount.value) ?? [],
);
watch(batchCategoryAccount, () => {
  batchCategory.value = "__unchanged";
});
const allSelected = computed(
  () => rows.value.length > 0 && selection.value.size === rows.value.length,
);
const sourceChanged = computed(
  () => parsed.value && source.value !== parsedSource.value,
);
const hasDraft = computed(() => !!source.value.trim() || rows.value.length > 0);
const canApply = computed(
  () =>
    selection.value.size > 0 &&
    !!(
      batchAccount.value ||
      batchCategory.value !== "__unchanged" ||
      batchDate.value
    ),
);

const preview = ref<BatchPreview | null>(null);
const previewing = ref(false);
let previewRequest = 0;
let previewTimer: ReturnType<typeof setTimeout> | undefined;
const requestRows = computed<BatchRow[]>(() =>
  rows.value.map((row) => ({
    line: row.lineNumber,
    amountInput: row.amountInput,
    title: row.title,
    note: row.note,
    accountId: row.accountId,
    categoryId: row.categoryId || null,
    date: row.date,
  })),
);
const checkedRows = computed(() =>
  rows.value.map((row) => {
    const result = preview.value?.rows.find(
      (item) => item.line === row.lineNumber,
    );
    return {
      row,
      errors: result?.errors ?? [],
      amount: {
        type:
          result?.transaction?.type ??
          (row.amountInput.trim().startsWith("+") ? "income" : "expense"),
        error: result?.errors.length ? result.errors[0] : null,
      },
    };
  }),
);
const invalidCount = computed(
  () => preview.value?.rows.filter((row) => row.errors.length).length ?? 0,
);
const totals = computed(() => ({
  expense: preview.value?.expense ?? 0,
  income: preview.value?.income ?? 0,
  valid: preview.value?.valid ?? false,
}));
const canImport = computed(
  () =>
    !!preview.value?.valid &&
    !previewing.value &&
    !sourceChanged.value &&
    !loading.value &&
    !saving.value &&
    !saveUncertain.value,
);
async function refreshPreview(): Promise<void> {
  clearTimeout(previewTimer);
  const request = ++previewRequest;
  preview.value = null;
  if (!rows.value.length) {
    previewing.value = false;
    return;
  }
  previewing.value = true;
  try {
    const result = await txnService.preview(requestRows.value);
    if (request === previewRequest) {
      preview.value = result;
      error.value = "";
    }
  } catch (e) {
    if (request === previewRequest) error.value = (e as Error).message;
  } finally {
    if (request === previewRequest) previewing.value = false;
  }
}
watch(
  requestRows,
  () => {
    previewRequest++;
    preview.value = null;
    previewing.value = true;
    clearTimeout(previewTimer);
    previewTimer = setTimeout(() => void refreshPreview(), 250);
  },
  { deep: true, flush: "sync" },
);
async function loadChoices(): Promise<void> {
  const [result, list] = await Promise.all([
    accountService.list(),
    categoryService.list(),
  ]);
  accounts.value = result.items;
  const grouped = new Map<string, Category[]>();
  for (const category of list) {
    const group = grouped.get(category.accountId) ?? [];
    group.push(category);
    grouped.set(category.accountId, group);
  }
  categories.value = grouped;
}

async function generatePreview(): Promise<void> {
  if (!source.value.trim() || loading.value || saving.value) return;
  if (
    parsed.value &&
    !window.confirm("重新解析会覆盖当前预览中的修改，是否继续？")
  )
    return;
  rows.value = parseTextTransactions(source.value).map((row) => ({
    ...row,
    accountId: defaultAccount.value,
    categoryId: defaultCategory.value,
    date: defaultDate.value,
  }));
  parsedSource.value = source.value;
  parsed.value = true;
  selection.value = new Set();
  selectionAnchor = null;
  error.value = "";
  notice.value = "";
  imported.value = null;
  await refreshPreview();
  await nextTick();
  previewHeading.value?.focus();
  previewHeading.value?.scrollIntoView({ block: "start" });
}

function selectRow(row: ImportRow, event: MouseEvent): void {
  const checked = (event.target as HTMLInputElement).checked;
  const next = new Set(selection.value);
  const end = rows.value.indexOf(row);
  const start = rows.value.findIndex((r) => r.lineNumber === selectionAnchor);
  const range =
    event.shiftKey && start >= 0
      ? rows.value.slice(Math.min(start, end), Math.max(start, end) + 1)
      : [row];
  for (const item of range) {
    if (checked) next.add(item.lineNumber);
    else next.delete(item.lineNumber);
  }
  selection.value = next;
  selectionAnchor = row.lineNumber;
}

function selectAll(): void {
  selection.value = allSelected.value
    ? new Set()
    : new Set(rows.value.map((r) => r.lineNumber));
  selectionAnchor = null;
}

function changeAccount(row: ImportRow): void {
  if (
    !(categories.value.get(row.accountId) ?? []).some(
      (c) => c.id === row.categoryId,
    )
  )
    row.categoryId = "";
}

function applyBatch(): void {
  if (!canApply.value) return;
  for (const row of selectedRows.value) {
    if (batchAccount.value) {
      row.accountId = batchAccount.value;
      changeAccount(row);
    }
    if (batchCategory.value !== "__unchanged")
      row.categoryId = batchCategory.value;
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
  error.value = "";
  try {
    await loadChoices();
    await refreshPreview();
  } catch {
    error.value = "读取账户和分类失败，请重试";
  } finally {
    loading.value = false;
  }
  if (!error.value && canImport.value) confirmDialog.value?.showModal();
}

async function commitImport(): Promise<void> {
  if (!canImport.value || !confirmDialog.value?.open) return;
  saving.value = true;
  saveError.value = "";
  showSaveError.value = false;
  confirmDialog.value.close();
  error.value = "";
  try {
    const result = await txnService.batch(requestRows.value);
    fabricQueue.value = result.fabricWorldTransactions ?? [];
    imported.value = {
      count: result.count,
      expense: result.expense,
      income: result.income,
    };
    rows.value = [];
    source.value = "";
    parsedSource.value = "";
    parsed.value = false;
    selection.value = new Set();
    notice.value = "";
    confirmDialog.value?.close();
  } catch (e) {
    saveUncertain.value =
      !(e instanceof AppError) ||
      ["NETWORK", "RESPONSE", "INTERNAL", "HTTP"].includes(e.code);
    saveError.value = saveUncertain.value
      ? "未收到完整的保存确认，请先查看账目核对，避免重复添加。当前批次已保留。"
      : (e as AppError).message;
    error.value = saveError.value;
    showSaveError.value = true;
    confirmDialog.value?.close();
  } finally {
    saving.value = false;
  }
}

function allowLeave(): boolean {
  if (saving.value || fabricQueue.value.length) return false;
  return (
    !hasDraft.value ||
    window.confirm("当前批次尚未入账，离开将丢失草稿。是否离开？")
  );
}

function beforeUnload(event: BeforeUnloadEvent): void {
  if (!hasDraft.value && !saving.value && !fabricQueue.value.length) return;
  event.preventDefault();
  event.returnValue = "";
}

function onDialogCancel(event: Event): void {
  if (saving.value) event.preventDefault();
}

async function retryLoad(): Promise<void> {
  loading.value = true;
  try {
    await loadChoices();
    if (rows.value.length) await refreshPreview();
    else error.value = "";
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    loading.value = false;
  }
}
onBeforeRouteLeave(allowLeave);
onBeforeRouteUpdate(() => !saving.value && !fabricQueue.value.length);
onMounted(async () => {
  window.addEventListener("beforeunload", beforeUnload);
  window.addEventListener("ledger-reload", retryLoad);
  try {
    await loadChoices();
    const fromRoute =
      typeof route.query.account === "string" ? route.query.account : "";
    const last = readPreference("last_account_id");
    defaultAccount.value =
      accounts.value.find((a) => a.id === fromRoute)?.id ??
      accounts.value.find((a) => a.id === last)?.id ??
      accounts.value[0]?.id ??
      "";
    const date = route.query.date;
    if (typeof date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(date))
      defaultDate.value = date;
  } catch {
    error.value = "加载账户失败，请刷新后重试；原文尚未写入数据库";
  } finally {
    loading.value = false;
  }
});
onBeforeUnmount(() => {
  previewRequest++;
  clearTimeout(previewTimer);
  window.removeEventListener("beforeunload", beforeUnload);
  window.removeEventListener("ledger-reload", retryLoad);
});
</script>

<template>
  <div class="batch-import">
    <EntryTabs />
    <FabricWorldSync
      v-if="fabricQueue[0] && !saving"
      :key="fabricQueue[0].id"
      :transaction-id="fabricQueue[0].id"
      :transaction-title="fabricQueue[0].title || '未命名布料'"
      @finish="finishFabricSync"
    />
    <SaveStatus
      v-if="saving || showSaveError"
      :saving="saving"
      :error="saveError"
      :uncertain="saveUncertain"
      @dismiss="showSaveError = false"
      @review="
        router.push({
          path: '/transactions',
          query: { range: 'all' },
        })
      "
    />

    <section v-if="imported" class="card import-success" role="status">
      <h3>已记账 {{ imported.count }} 笔交易</h3>
      <p>
        支出 {{ format(imported.expense) }} 元 · 收入
        {{ format(imported.income) }} 元
      </p>
      <p class="muted">已保存。</p>
      <div class="action-row">
        <button
          class="btn btn-ghost btn-sm"
          @click="
            imported = null;
            sourceInput?.focus();
          "
        >
          继续记账
        </button>
        <RouterLink
          :to="{
            path: '/transactions',
            query: { range: 'all' },
          }"
          class="btn btn-secondary btn-sm"
          >查看交易</RouterLink
        >
      </div>
    </section>
    <LoadError :message="error" @retry="retryLoad" />
    <PageSkeleton v-if="loading" label="账户和分类" form />
    <p v-if="saveUncertain" class="import-error" role="alert">
      保存结果尚未确认，请先查看账目核对，当前批次不会重复提交。<RouterLink
        :to="{ path: '/transactions', query: { range: 'all' } }"
        class="btn"
        >查看账目核对</RouterLink
      >
    </p>
    <p v-if="!loading && !accounts.length" class="import-error">
      暂无账户，请先创建账户。<RouterLink
        to="/transactions/manage?create=normal"
        class="btn btn-secondary"
        >创建账户</RouterLink
      >
    </p>

    <fieldset
      v-show="!loading"
      :disabled="saving || loading || saveUncertain"
      class="import-editor"
    >
      <details class="source-card" :open="!parsed">
        <summary>
          01 · 从文本开始
          <span class="muted">{{
            parsed ? "展开查看原文 / 重新解析" : "每行一笔"
          }}</span>
        </summary>
        <div class="source-body">
          <label for="import-source" class="field-label">金额 标题 备注</label>
          <textarea
            id="import-source"
            ref="sourceInput"
            v-model="source"
            class="input source-input"
            rows="6"
            placeholder="-26.32 滤芯 一个&#10;-69 麻本色高支亚麻 3.4 米&#10;+10 退款"
            spellcheck="false"
          ></textarea>
          <p class="help">
            空格或 Tab 分隔；标题后的所有内容作为备注。+
            表示收入，负号或无符号表示支出，金额最多两位小数。
          </p>
          <div class="default-fields">
            <label
              >默认账户
              <select
                v-model="defaultAccount"
                class="input"
                aria-label="默认账户"
              >
                <option value="">请选择账户</option>
                <optgroup
                  v-for="group in accountGroups"
                  :key="group.label"
                  :label="group.label"
                >
                  <option v-for="a in group.items" :key="a.id" :value="a.id">
                    {{ a.name }}{{ a.archivedAt ? "（已归档）" : "" }}
                  </option>
                </optgroup>
              </select>
            </label>
            <label
              >默认分类
              <select
                v-model="defaultCategory"
                class="input"
                aria-label="默认分类"
              >
                <option value="">未分类</option>
                <option
                  v-for="c in defaultCategories"
                  :key="c.id"
                  :value="c.id"
                >
                  {{ c.name }}
                </option>
              </select>
            </label>
            <label
              >默认日期<input
                v-model="defaultDate"
                class="input"
                type="date"
                aria-label="默认日期"
            /></label>
          </div>
          <div class="action-row">
            <button
              class="btn btn-primary"
              :disabled="!source.trim()"
              @click="generatePreview"
            >
              {{ parsed ? "重新解析" : "生成待记账清单" }}
            </button>
            <span class="help">仅生成草稿，确认记账后才入账。</span>
          </div>
        </div>
      </details>

      <section v-if="parsed" class="preview-section">
        <h3 ref="previewHeading" tabindex="-1" class="preview-title">
          02 · 核对与调整 <span class="muted">{{ rows.length }} 笔</span>
        </h3>
        <p class="help">
          勾选只用于批量修改；记账将保存所有保留的行，不需要的行请点“移出”。
        </p>
        <p v-if="sourceChanged" class="import-error" role="alert">
          原文已改变，请重新解析后再记账，或
          <button class="text-action" @click="source = parsedSource">
            还原原文
          </button>
          保留当前预览。
        </p>
        <div class="batch-toolbar">
          <div class="selection-bar">
            <label class="selection-toggle"
              ><input
                type="checkbox"
                :checked="allSelected"
                :indeterminate="selection.size > 0 && !allSelected"
                @change="selectAll"
              />全选</label
            >
            <span>已选 {{ selection.size }} 笔</span>
            <button
              v-if="selection.size"
              class="text-action"
              @click="
                selection = new Set();
                selectionAnchor = null;
              "
            >
              取消全选
            </button>
            <span class="kbd-hint"><span class="kbd">Shift</span> 连选</span>
          </div>
          <div class="batch-fields">
            <label
              >账户
              <select
                v-model="batchAccount"
                class="input"
                aria-label="批量账户"
              >
                <option value="">保持不变</option>
                <optgroup
                  v-for="group in accountGroups"
                  :key="group.label"
                  :label="group.label"
                >
                  <option v-for="a in group.items" :key="a.id" :value="a.id">
                    {{ a.name }}{{ a.archivedAt ? "（已归档）" : "" }}
                  </option>
                </optgroup>
              </select>
            </label>
            <label
              >分类
              <select
                v-model="batchCategory"
                class="input"
                aria-label="批量分类"
                :disabled="!batchCategoryAccount"
              >
                <option value="__unchanged">保持不变</option>
                <option value="">未分类</option>
                <option v-for="c in batchCategories" :key="c.id" :value="c.id">
                  {{ c.name }}
                </option>
              </select>
            </label>
            <label
              >日期（留空不改）<input
                v-model="batchDate"
                class="input"
                type="date"
                aria-label="批量日期"
            /></label>
            <button
              class="btn btn-secondary btn-sm"
              :disabled="!canApply"
              @click="applyBatch"
            >
              应用到选中项
            </button>
          </div>
          <p v-if="selection.size && !batchCategoryAccount" class="help">
            所选行跨账户或尚未选择账户；请先统一账户，再批量指定分类。
          </p>
          <p v-if="notice" class="help" role="status">{{ notice }}</p>
        </div>

        <div v-if="!rows.length" class="card empty-preview">
          没有待记账记录，可展开原文重新解析。
        </div>
        <div class="preview-list">
          <article
            v-for="item in checkedRows"
            :key="item.row.lineNumber"
            class="import-row"
            :class="{
              'row-selected': selection.has(item.row.lineNumber),
              'row-invalid': item.errors.length,
            }"
            :data-line="item.row.lineNumber"
          >
            <label class="row-selection">
              <input
                type="checkbox"
                :checked="selection.has(item.row.lineNumber)"
                :aria-label="`选择第 ${item.row.lineNumber} 行`"
                @click="selectRow(item.row, $event)"
              />
              <span class="muted num">{{ item.row.lineNumber }}</span>
            </label>
            <label class="row-amount"
              ><span :class="item.amount.type === 'expense' ? 'neg' : 'pos'"
                >{{ item.amount.type === "expense" ? "支出" : "收入" }} ·
                元</span
              >
              <input
                v-model="item.row.amountInput"
                class="input num"
                :aria-label="`第 ${item.row.lineNumber} 行金额`"
                :aria-invalid="!!item.amount.error"
                inputmode="text"
              />
            </label>
            <div class="row-text">
              <label
                >标题<input
                  v-model="item.row.title"
                  class="input"
                  :aria-label="`第 ${item.row.lineNumber} 行标题`"
              /></label>
              <label
                >备注<input
                  v-model="item.row.note"
                  class="input"
                  placeholder="可留空"
                  :aria-label="`第 ${item.row.lineNumber} 行备注`"
              /></label>
            </div>
            <div class="row-account">
              <label
                >账户
                <select
                  v-model="item.row.accountId"
                  class="input"
                  :aria-label="`第 ${item.row.lineNumber} 行账户`"
                  @change="changeAccount(item.row)"
                >
                  <option value="">请选择账户</option>
                  <optgroup
                    v-for="group in accountGroups"
                    :key="group.label"
                    :label="group.label"
                  >
                    <option v-for="a in group.items" :key="a.id" :value="a.id">
                      {{ a.name }}{{ a.archivedAt ? "（已归档）" : "" }}
                    </option>
                  </optgroup>
                </select>
              </label>
              <label
                >分类
                <select
                  v-model="item.row.categoryId"
                  class="input"
                  :aria-label="`第 ${item.row.lineNumber} 行分类`"
                >
                  <option value="">未分类</option>
                  <option
                    v-for="c in categories.get(item.row.accountId) ?? []"
                    :key="c.id"
                    :value="c.id"
                  >
                    {{ c.name }}
                  </option>
                </select>
              </label>
            </div>
            <label class="row-date"
              >日期<input
                v-model="item.row.date"
                class="input"
                type="date"
                :aria-label="`第 ${item.row.lineNumber} 行日期`"
            /></label>
            <button
              class="text-action row-remove"
              :aria-label="`移出第 ${item.row.lineNumber} 行`"
              @click="removeRow(item.row.lineNumber)"
            >
              移出
            </button>
            <details class="row-source" :open="item.errors.length > 0">
              <summary>原文 · 第 {{ item.row.lineNumber }} 行</summary>
              <pre>{{ item.row.source }}</pre>
            </details>
            <p v-if="item.errors.length" class="import-error row-errors">
              {{ item.errors.join("；") }}
            </p>
          </article>
        </div>

        <div class="import-footer">
          <div class="totals" aria-live="polite">
            <strong>待记账 {{ rows.length }} 笔</strong>
            <template v-if="preview"
              ><span class="neg">支出 {{ format(totals.expense) }}</span
              ><span class="pos"
                >收入 {{ format(totals.income) }}</span
              ></template
            >
            <span v-else class="faint">等待校验</span>
          </div>
          <p v-if="invalidCount" class="import-error" role="alert">
            {{ invalidCount }}
            行待修正，请修改或移出后再记账；合计仅包含有效行。
          </p>
          <span v-if="previewing" class="faint">正在校验…</span>
          <button
            class="btn btn-primary"
            :disabled="!canImport"
            @click="askImport"
          >
            确认记账 {{ rows.length }} 笔
          </button>
        </div>
      </section>
    </fieldset>

    <dialog
      ref="confirmDialog"
      class="import-dialog"
      aria-labelledby="import-confirm-title"
      @cancel="onDialogCancel"
      @keydown.stop
    >
      <h3 id="import-confirm-title">确认记账 {{ rows.length }} 笔交易？</h3>
      <p>
        支出 {{ format(totals.expense) }} 元 · 收入
        {{ format(totals.income) }} 元
      </p>
      <p class="muted">
        将新增预览中的全部记录，不覆盖现有交易，也不会自动去重。请确认账户、分类和日期。
      </p>
      <p v-if="error" class="import-error" role="alert">{{ error }}</p>
      <div class="action-row">
        <button
          class="btn btn-ghost"
          :disabled="saving"
          autofocus
          @click="confirmDialog?.close()"
        >
          返回检查
        </button>
        <button
          class="btn btn-primary"
          :disabled="!canImport"
          @click="commitImport"
        >
          {{ saving ? "正在记账…" : "保存" }}
        </button>
      </div>
    </dialog>
  </div>
</template>

<style scoped>
.batch-import {
  padding: 24px;
}
.import-editor {
  border: 0;
  padding: 0;
  margin: 0;
  min-width: 0;
}
.batch-import :is(label, input, select, textarea) {
  min-width: 0;
  max-width: 100%;
}
.source-card {
  padding: 20px;
  border: 1px solid var(--border);
  border-radius: 16px;
  background: #fcfdfa;
}
.source-card > summary {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  cursor: pointer;
  font-weight: 600;
  list-style: none;
}
.source-card > summary::-webkit-details-marker {
  display: none;
}
.source-card > summary .muted {
  font-size: 11px;
  font-weight: 400;
}
.source-body {
  padding-top: 18px;
}
.source-input {
  line-height: 1.9;
  background: var(--surface-2);
  resize: vertical;
}
.help {
  font-size: 11px;
  color: var(--fg-2);
  margin: 10px 0;
  line-height: 1.7;
}
.default-fields,
.batch-fields {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
  margin: 16px 0;
}
.batch-import label {
  display: flex;
  flex-direction: column;
  gap: 5px;
  font-size: 12px;
  color: var(--fg-2);
}
.batch-import .input {
  font-size: 13px;
  padding: 9px 10px;
}
.action-row {
  display: flex;
  gap: 10px;
  align-items: center;
  flex-wrap: wrap;
  margin-top: 14px;
}
.preview-section {
  padding-top: 22px;
}
.preview-title {
  font-size: 14px;
  display: flex;
  justify-content: space-between;
  outline: 0;
}
.batch-toolbar {
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: 13px;
  padding: 14px;
  margin: 16px 0;
}
.selection-bar {
  display: flex;
  align-items: center;
  gap: 14px;
  font-size: 11px;
}
.selection-toggle,
.row-selection {
  flex-direction: row !important;
  align-items: center;
  gap: 8px !important;
}
.kbd-hint {
  margin-left: auto;
  color: var(--fg-3);
}
.batch-fields {
  grid-template-columns: 1fr 1fr 1fr auto;
  align-items: end;
  margin: 12px 0 0;
}
.import-row {
  display: grid;
  grid-template-columns: 30px 105px minmax(0, 1fr) minmax(0, 1fr);
  gap: 10px;
  padding: 16px 0;
  border-top: 1px solid var(--border);
}
.row-selected {
  background: var(--primary-soft);
}
.row-invalid {
  border-left: 2px solid var(--expense);
  padding-left: 10px;
}
.row-selection {
  align-self: start;
  padding-top: 22px;
}
.row-text,
.row-account {
  display: grid;
  gap: 10px;
}
.row-date {
  grid-column: 2/4;
}
.row-remove {
  align-self: end;
  justify-self: end;
  padding: 8px;
}
.row-source,
.row-errors {
  grid-column: 2/-1;
}
.row-source {
  font-size: 10px;
  color: var(--fg-3);
}
.row-source summary {
  cursor: pointer;
}
.row-source pre {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  margin-top: 6px;
}
.text-action {
  color: var(--primary);
  font-size: 11px;
}
.import-error {
  color: var(--expense);
  font-size: 11px;
  margin: 10px 0;
}
.import-footer {
  position: sticky;
  bottom: -24px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 10px;
  background: var(--surface);
  border-top: 1px solid var(--border);
  box-shadow: 0 -5px 20px #202c4606;
  padding: 18px 0;
  z-index: 2;
}
.totals {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 12px;
  font-size: 11px;
  flex: 1;
}
.totals strong {
  font-size: 13px;
  flex-basis: 100%;
}
.import-footer > .import-error {
  flex-basis: 100%;
  order: -1;
}
.empty-preview {
  padding: 25px;
  font-size: 12px;
  text-align: center;
}
.import-success {
  padding: 18px;
  margin-top: 16px;
  background: var(--income-soft);
  color: var(--income);
}
.import-success h3 {
  font-size: 15px;
}
.import-success p {
  font-size: 12px;
}
.import-dialog {
  margin: auto;
  width: min(430px, calc(100% - 32px));
  border: 1px solid var(--border);
  border-radius: 20px;
  padding: 26px;
  box-shadow: var(--sh-3);
}
.import-dialog::backdrop {
  background: #1b302855;
  backdrop-filter: blur(3px);
}
.import-dialog p {
  font-size: 12px;
  margin-top: 12px;
  line-height: 1.8;
}
.import-dialog .action-row {
  justify-content: flex-end;
}
@media (max-width: 720px) {
  .batch-import {
    padding: 18px;
  }
  .source-card {
    padding: 14px;
  }
  .source-card > summary .muted {
    max-width: 120px;
    text-align: right;
  }
  .default-fields {
    grid-template-columns: 1fr 1fr;
  }
  .default-fields > label:last-child {
    grid-column: 1/-1;
  }
  .batch-fields {
    grid-template-columns: 1fr 1fr;
  }
  .batch-import .input {
    font-size: 16px;
  }
  .import-row {
    grid-template-columns: 24px minmax(0, 1fr) minmax(0, 1fr);
  }
  .row-selection {
    grid-row: 1;
  }
  .row-amount {
    grid-column: 2/-1;
  }
  .row-text,
  .row-account {
    grid-column: 2/-1;
    grid-template-columns: 1fr 1fr;
  }
  .row-text {
    grid-template-columns: 1fr;
  }
  .row-date {
    grid-column: 2/-1;
  }
  .row-remove {
    grid-column: 3;
  }
  .import-footer {
    bottom: -18px;
    gap: 8px;
  }
  .import-footer .btn {
    padding: 10px;
  }
  .row-selection {
    padding-top: 28px;
  }
}
@media (min-width: 1100px) {
  .import-row {
    grid-template-columns:
      24px 90px minmax(110px, 1fr) minmax(90px, 0.85fr)
      115px 105px 135px 30px;
    gap: 8px;
    padding: 14px 0;
  }
  .row-text,
  .row-account {
    display: contents;
  }
  .row-amount {
    grid-column: 2;
    grid-row: 1;
  }
  .row-text > label:first-child {
    grid-column: 3;
    grid-row: 1;
  }
  .row-text > label:last-child {
    grid-column: 4;
    grid-row: 1;
  }
  .row-account > label:first-child {
    grid-column: 5;
    grid-row: 1;
  }
  .row-account > label:last-child {
    grid-column: 6;
    grid-row: 1;
  }
  .row-date {
    grid-column: 7;
    grid-row: 1;
  }
  .row-remove {
    grid-column: 8;
    grid-row: 1;
    padding: 8px 0;
  }
  .row-source {
    grid-column: 2/-1;
  }
  .import-row .input {
    padding: 8px;
    font-size: 12px;
  }
}
@media (max-width: 720px) {
  .row-amount {
    grid-column: 2;
    grid-row: 1;
  }
  .row-text {
    display: contents;
  }
  .row-text > label:first-child {
    grid-column: 3;
    grid-row: 1;
  }
  .row-text > label:last-child {
    grid-column: 2/-1;
  }
}
</style>

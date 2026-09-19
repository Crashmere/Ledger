<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import {
  accountService,
  categoryService,
  txnService,
  yuanToCents,
  centsToYuan,
  AppError,
  type Account,
  type Category,
  type TxnType,
  type Id,
  type Transaction,
} from "../api";
import { evalExpr, isExpression } from "../services/expr";
import {
  normalizeAmountInput,
  parseAmountInput,
} from "../services/amountInput";
import { useMediaQuery } from "../composables/useMediaQuery";

import { beijingDate, shiftDay } from "../services/dates";
import LoadError from "../components/LoadError.vue";
import EntryTabs from "../components/EntryTabs.vue";
import AppIcon from "../components/AppIcon.vue";
import ModalDialog from "../components/ModalDialog.vue";
import PageSkeleton from "../components/PageSkeleton.vue";
import SaveStatus from "../components/SaveStatus.vue";
import FabricWorldSync from "../components/FabricWorldSync.vue";
import { useSaveGuard } from "../composables/useSaveGuard";
import { pushToast } from "../composables/useToast";
import { readPreference, savePreference } from "../services/preferences";
const LAST_ACCOUNT_KEY = "last_account_id";

const route = useRoute();
const router = useRouter();
const isMobile = useMediaQuery("(max-width: 720px)");

const editingId = computed<Id | null>(() => {
  const p = route.params.id;
  return typeof p === "string" && p ? p : null;
});
const isEdit = computed(() => editingId.value !== null);
const copyingId = computed<Id | null>(() => {
  const q = route.query.copy;
  return typeof q === "string" && q ? q : null;
});

const accounts = ref<Account[]>([]);
const categories = ref<Category[]>([]);

const type = ref<TxnType>("expense"); // 智能默认：支出
const accountId = ref<Id | null>(null);
const toAccountId = ref<Id | null>(null); // 仅转账
const categoryId = ref<Id | null>(null); // 仅收支
const dateStr = ref<string>(todayStr()); // 智能默认：今天
const title = ref(""); // 标题：主要信息（如"晚饭"），选填
const note = ref(""); // 备注：详细信息（如"和同事在楼下吃"），选填
const raw = ref(""); // 手机直接输入金额；桌面允许计算器算式
const justEvaluated = ref(false);

const openPicker = ref<"account" | "category" | "toAccount" | "date" | null>(
  null,
);
const saving = ref(false);
const saveError = ref("");
const saveUncertain = ref(false);
const showSaveError = ref(false);
const syncTransactionId = ref<Id | null>(null);
const savedTransaction = ref<Transaction | null>(null);
const hasUnsavedChanges = computed(() => {
  const txn = savedTransaction.value;
  if (!txn) return false;
  const amount = amountValue.value;
  return (
    amount === null ||
    yuanToCents(amount) !== txn.amount ||
    type.value !== txn.type ||
    accountId.value !== txn.accountId ||
    toAccountId.value !== txn.toAccountId ||
    categoryId.value !== txn.categoryId ||
    dateStr.value !== txn.date ||
    (title.value.trim() || null) !== (txn.title?.trim() || null) ||
    (note.value.trim() || null) !== (txn.note?.trim() || null)
  );
});
function askFabricSync(): void {
  if (
    !savedTransaction.value?.fabricWorldEligible ||
    hasUnsavedChanges.value ||
    saving.value ||
    deleting.value ||
    saveUncertain.value ||
    syncTransactionId.value
  )
    return;
  openPicker.value = null;
  blurAmount();
  syncTransactionId.value = savedTransaction.value.id;
}
useSaveGuard(
  computed(
    () => saving.value || deleting.value || syncTransactionId.value !== null,
  ),
);
async function finishFabricSync(editUrl?: string): Promise<void> {
  syncTransactionId.value = null;
  if (editUrl) {
    await nextTick();
    window.location.assign(editUrl);
  }
}
const deleting = ref(false);
const confirmingDelete = ref(false); // 删除二次确认弹层
const initializing = ref(true);
const initError = ref("");
const allCategories = ref<Category[]>([]);
const feedback = ref<{ kind: "success" | "error"; msg: string } | null>(null);
let feedbackTimer: ReturnType<typeof setTimeout> | null = null;

const amountInputEl = ref<HTMLInputElement | null>(null);

const toAccountOptions = computed(() =>
  accounts.value.filter((a) => a.id !== accountId.value),
);

const displayValue = computed(() => {
  const r = raw.value;
  if (!r) return "0";
  if (!isExpression(r)) {
    return r.startsWith(".") ? `0${r}` : r;
  }
  const v = evalExprSafe(r);
  return v === null ? "0" : formatNum(v);
});

const exprLine = computed(() => {
  const r = raw.value;
  if (!isExpression(r)) return "";
  return r
    .replace(/\*/g, "×")
    .replace(/\//g, "÷")
    .replace(/([+\-×÷])/g, " $1 ")
    .replace(/\s+/g, " ")
    .trim();
});

const amountValue = computed(() =>
  isMobile.value ? parseAmountInput(raw.value) : evalExprSafe(raw.value),
);
const amountInputError = computed(
  () => raw.value !== "" && parseAmountInput(raw.value) === null,
);

function onAmountInput(event: Event): void {
  const input = event.target as HTMLInputElement;
  raw.value = normalizeAmountInput(input.value);
  input.value = raw.value;
  justEvaluated.value = false;
}

function blurAmount(): void {
  amountInputEl.value?.blur();
}

// iOS 点击非输入区域未必主动失焦；不拦截默认点击，仍可直接打开账户等选择器。
function dismissAmountKeyboard(event: MouseEvent): void {
  if (event.target !== amountInputEl.value) blurAmount();
}

watch(isMobile, (mobile) => {
  if (openPicker.value === "date") openPicker.value = null;
  if (!mobile || !isExpression(raw.value)) return;
  const value = evalExprSafe(raw.value);
  if (value !== null) raw.value = formatNum(value);
});

const canSave = computed(() => {
  if (
    initializing.value ||
    initError.value ||
    deleting.value ||
    saveUncertain.value
  )
    return false;
  const v = amountValue.value;
  if (v === null || v <= 0) return false;
  if (!accountId.value) return false;
  if (type.value === "transfer") {
    return !!toAccountId.value && toAccountId.value !== accountId.value;
  }
  return true;
});

function todayStr(): string {
  return beijingDate();
}
function shiftDate(delta: number): void {
  dateStr.value = shiftDay(dateStr.value, delta);
}

function evalExprSafe(input: string): number | null {
  const cleaned = input.replace(/[+\-*/.]+$/, "");
  if (cleaned === "") return null;
  return evalExpr(cleaned);
}

function formatNum(v: number): string {
  const r = Math.round(v * 100) / 100;
  return Number.isInteger(r) ? String(r) : r.toFixed(2);
}

function press(ch: string): void {
  if (justEvaluated.value) {
    raw.value = "";
    justEvaluated.value = false;
  }
  if (ch === ".") {
    const lastNum = raw.value.split(/[+\-*/()]/).pop() ?? "";
    if (lastNum.includes(".")) return;
    if (raw.value === "" || /[+\-*/(]$/.test(raw.value)) {
      raw.value += "0."; // 空串或运算符/左括号后补前导 0
      return;
    }
  }
  raw.value += ch;
}

function pressOp(op: "+" | "-" | "*" | "/"): void {
  justEvaluated.value = false;
  if (raw.value === "") return; // 不允许以运算符开头
  if (/[+\-*/]$/.test(raw.value)) {
    raw.value = raw.value.slice(0, -1) + op;
    return;
  }
  raw.value += op;
}

function pressParen(p: "(" | ")"): void {
  if (justEvaluated.value) {
    if (p === "(") raw.value = ""; // 结果后按左括号 = 开新算式
    justEvaluated.value = false;
  }
  raw.value += p;
}

function backspace(): void {
  justEvaluated.value = false;
  raw.value = raw.value.slice(0, -1);
}

function equals(): void {
  const v = amountValue.value;
  if (v === null) return;
  raw.value = formatNum(v);
  justEvaluated.value = true;
}

function clearAll(): void {
  raw.value = "";
  justEvaluated.value = false;
}

async function loadCategories(): Promise<void> {
  if (!accountId.value) {
    categories.value = [];
    categoryId.value = null;
    return;
  }
  categories.value = allCategories.value.filter(
    (category) => category.accountId === accountId.value,
  );
  if (!categories.value.some((c) => c.id === categoryId.value)) {
    categoryId.value = categories.value[0]?.id ?? null;
  }
}

async function selectAccount(id: Id): Promise<void> {
  accountId.value = id;
  openPicker.value = null;
  if (toAccountId.value === id) toAccountId.value = null; // 转出=转入 则清空
  await loadCategories();
}

function setType(t: TxnType): void {
  type.value = t;
  openPicker.value = null;
  if (t === "transfer") {
    categoryId.value = null; // 转账无分类
  } else {
    toAccountId.value = null; // 收支无转入账户
    if (categoryId.value === null)
      categoryId.value = categories.value[0]?.id ?? null;
  }
}

function showFeedback(kind: "success" | "error", msg: string): void {
  feedback.value = { kind, msg };
  if (feedbackTimer) clearTimeout(feedbackTimer);
  feedbackTimer = setTimeout(() => {
    feedback.value = null;
  }, 2200);
}

async function save(): Promise<void> {
  if (
    saving.value ||
    syncTransactionId.value ||
    deleting.value ||
    initializing.value ||
    initError.value ||
    saveUncertain.value
  )
    return;
  const value = amountValue.value;
  if (value === null || value <= 0) {
    showFeedback("error", "请输入有效金额");
    return;
  }
  if (!accountId.value) {
    showFeedback("error", "请选择账户");
    return;
  }
  if (type.value === "transfer") {
    if (!toAccountId.value) {
      showFeedback("error", "请选择转入账户");
      return;
    }
    if (toAccountId.value === accountId.value) {
      showFeedback("error", "转入账户需与转出账户不同");
      return;
    }
  }

  saving.value = true;
  openPicker.value = null;
  blurAmount();
  saveError.value = "";
  showSaveError.value = false;
  let saved = false;
  try {
    if (isEdit.value && editingId.value) {
      await txnService.update(editingId.value, {
        type: type.value,
        amount: yuanToCents(value),
        accountId: accountId.value,
        toAccountId: type.value === "transfer" ? toAccountId.value : null,
        categoryId: type.value === "transfer" ? null : categoryId.value,
        date: dateStr.value,
        title: title.value.trim() || null,
        note: note.value.trim() || null,
      });
      showFeedback("success", "已保存 ✓");
      saved = true;
    } else {
      const transaction = await txnService.create({
        type: type.value,
        amount: yuanToCents(value),
        accountId: accountId.value,
        toAccountId: type.value === "transfer" ? toAccountId.value : null,
        categoryId: type.value === "transfer" ? null : categoryId.value,
        date: dateStr.value,
        title: title.value.trim() || null,
        note: note.value.trim() || null,
      });
      savePreference(LAST_ACCOUNT_KEY, accountId.value);
      if (transaction.fabricWorldEligible)
        syncTransactionId.value = transaction.id;
      raw.value = "";
      justEvaluated.value = false;
      title.value = "";
      note.value = "";
      showFeedback("success", "已保存 ✓");
      saved = true;
    }
  } catch (e) {
    saveUncertain.value =
      !(e instanceof AppError) ||
      ["NETWORK", "RESPONSE", "INTERNAL", "HTTP"].includes(e.code);
    saveError.value = saveUncertain.value
      ? "未收到完整的保存确认，请先查看账目核对，避免重复添加。当前表单已保留。"
      : (e as AppError).message;
    showSaveError.value = true;
  } finally {
    saving.value = false;
  }
  if (saved && isEdit.value) {
    pushToast("success", "交易已保存");
    goBack();
  }
}

function askDelete(): void {
  confirmingDelete.value = true;
}

async function confirmDelete(): Promise<void> {
  if (deleting.value || saving.value) return;
  if (!editingId.value) return;
  deleting.value = true;
  try {
    await txnService.remove(editingId.value);
    confirmingDelete.value = false;
    showFeedback("success", "已删除 ✓");
    goBack();
  } catch (e) {
    confirmingDelete.value = false;
    const msg =
      e instanceof AppError && e.code === "NOT_FOUND"
        ? "这笔交易已不存在"
        : e instanceof AppError
          ? e.message
          : "删除失败，请重试";
    showFeedback("error", msg);
  } finally {
    deleting.value = false;
  }
}

function goBack(): void {
  if (saving.value) return;
  if (window.history.length > 1) {
    void router.push({ path: "/transactions", query: route.query });
  } else {
    void router.push({ path: "/transactions", query: route.query });
  }
}

function copyCurrent(): void {
  if (!editingId.value) return;
  void router.replace({
    path: "/transactions/add",
    query: { ...route.query, copy: editingId.value },
  });
}

function onKeydown(e: KeyboardEvent): void {
  if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || e.isComposing)
    return;
  if (saving.value || syncTransactionId.value || showSaveError.value) return;
  // 手机使用原生输入与焦点行为，不接管 Tab、数字键或 Enter 保存。
  if (isMobile.value) return;
  const el = e.target as HTMLElement | null;

  if (e.key === "Tab") return;
  if (el?.closest("button,select,a,dialog")) return;
  if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA")) return;
  if (e.key === "Escape") {
    if (confirmingDelete.value) confirmingDelete.value = false;
    else if (openPicker.value) openPicker.value = null;
    else if (!isEdit.value && raw.value) clearAll();
    else goBack();
    e.preventDefault();
    return;
  }
  if (e.key >= "0" && e.key <= "9") press(e.key);
  else if (
    e.key === "." ||
    e.key === "Decimal" ||
    e.code === "NumpadDecimal" ||
    e.code === "Period"
  )
    press("."); // 主键区句号、小键盘小数点、部分布局的 'Decimal' 都算小数点
  else if (e.key === "+" || e.key === "-" || e.key === "*" || e.key === "/")
    pressOp(e.key);
  else if (e.key === "(" || e.key === ")") pressParen(e.key);
  else if (e.key === "=")
    equals(); // 等于号：求值并折叠结果，供继续运算
  else if (e.key === "Backspace") backspace();
  else if (e.key.toLowerCase() === "c" && !e.ctrlKey && !e.metaKey) clearAll();
  else if (e.key === "Enter")
    void save(); // Enter 仍是「保存整笔」快捷键（金额已实时求值）
  else return;
  e.preventDefault();
}

function resetFormState(): void {
  savedTransaction.value = null;
  type.value = "expense";
  accountId.value = null;
  toAccountId.value = null;
  categoryId.value = null;
  dateStr.value = todayStr();
  title.value = "";
  note.value = "";
  raw.value = "";
  justEvaluated.value = false;
  openPicker.value = null;
  confirmingDelete.value = false;
  initError.value = "";
}

async function initCreate(): Promise<void> {
  const q = route.query.account;
  const qAccount = typeof q === "string" && q ? q : null;
  if (qAccount && accounts.value.some((a) => a.id === qAccount)) {
    accountId.value = qAccount;
  } else {
    const last = readPreference(LAST_ACCOUNT_KEY);
    if (last && accounts.value.some((a) => a.id === last)) {
      accountId.value = last;
    } else {
      accountId.value = accounts.value[0]?.id ?? null;
    }
  }
  await loadCategories();
}

async function initEdit(id: Id): Promise<void> {
  const txn = await txnService.get(id);
  savedTransaction.value = txn;

  type.value = txn.type;
  accountId.value = txn.accountId;
  toAccountId.value = txn.type === "transfer" ? txn.toAccountId : null;

  raw.value = centsToYuan(txn.amount);

  dateStr.value = txn.date;

  title.value = txn.title ?? "";
  note.value = txn.note ?? "";

  await loadCategories();
  categoryId.value = txn.type === "transfer" ? null : txn.categoryId;
}

async function initCopy(id: Id): Promise<void> {
  const txn = await txnService.get(id);

  type.value = txn.type;
  accountId.value = txn.accountId;
  toAccountId.value = txn.type === "transfer" ? txn.toAccountId : null;
  raw.value = centsToYuan(txn.amount); // 金额分→元字符串（同编辑回填）
  dateStr.value = todayStr(); // 复制的唯一差异：日期取今天
  title.value = txn.title ?? "";
  note.value = txn.note ?? "";

  await loadCategories();
  categoryId.value = txn.type === "transfer" ? null : txn.categoryId;
}

async function initForm(): Promise<void> {
  initializing.value = true;
  initError.value = "";
  try {
    resetFormState();
    const [result, categoriesResult] = await Promise.all([
      accountService.list(),
      categoryService.list(),
    ]);
    accounts.value = result.items;
    allCategories.value = categoriesResult;
    if (editingId.value) await initEdit(editingId.value);
    else if (copyingId.value) await initCopy(copyingId.value);
    else await initCreate();
  } catch (e) {
    initError.value = (e as Error).message;
  } finally {
    initializing.value = false;
  }
}
function retryInitialization(): void {
  if (initError.value) void initForm();
}

onMounted(() => {
  void initForm();
  window.addEventListener("keydown", onKeydown);
  document.addEventListener("click", dismissAmountKeyboard);
  window.addEventListener("ledger-reload", retryInitialization);
});

watch([editingId, copyingId], () => {
  void initForm();
});

onUnmounted(() => {
  window.removeEventListener("keydown", onKeydown);
  document.removeEventListener("click", dismissAmountKeyboard);
  window.removeEventListener("ledger-reload", retryInitialization);
  if (feedbackTimer) clearTimeout(feedbackTimer);
});
function calculatorKey(key: string) {
  const ops: Record<string, "+" | "-" | "*" | "/"> = {
    "÷": "/",
    "×": "*",
    "−": "-",
    "+": "+",
  };
  if (key === "=") equals();
  else if (ops[key]) pressOp(ops[key]);
  else press(key);
}
</script>
<template>
  <div class="entry-panel">
    <EntryTabs v-if="!isEdit" />
    <FabricWorldSync
      v-if="syncTransactionId"
      :transaction-id="syncTransactionId"
      :transaction-title="savedTransaction?.title || '新交易'"
      :return-label="isEdit ? '否，返回详情' : '否，返回记账'"
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
          query: { account: accountId || undefined, range: 'all' },
        })
      "
    />
    <PageSkeleton v-if="initializing" label="交易" form />
    <LoadError v-else-if="initError" :message="initError" @retry="initForm" />
    <div v-else-if="!accounts.length" class="empty">
      <strong>先创建一个账户</strong>
      <p>每笔收支都需要一个所属账户。</p>
      <RouterLink
        class="btn btn-primary"
        :to="{
          path: '/transactions/manage',
          query: { ...route.query, create: 'normal' },
        }"
        >创建账户</RouterLink
      >
    </div>
    <template v-else>
      <div
        v-if="feedback"
        class="entry-feedback"
        role="status"
        :class="feedback.kind"
      >
        {{ feedback.msg }}
      </div>
      <div class="entry-type" role="group" aria-label="交易类型">
        <button
          v-for="v in ['expense', 'income', 'transfer'] as const"
          :key="v"
          :class="{ active: type === v }"
          @click="setType(v)"
        >
          <AppIcon :name="v" :size="16" />{{
            { expense: "支出", income: "收入", transfer: "转账" }[v]
          }}
        </button>
      </div>
      <div class="entry-amount" :class="type">
        <label :for="isMobile ? 'entry-amount-input' : undefined"
          >金额 / CNY</label
        >
        <div v-if="isMobile" class="entry-amount-input">
          <span>¥</span
          ><input
            id="entry-amount-input"
            ref="amountInputEl"
            :value="raw"
            aria-label="金额（元）"
            inputmode="decimal"
            placeholder="0.00"
            autocomplete="off"
            @input="onAmountInput"
            @keydown.enter.prevent="blurAmount"
          />
        </div>
        <div
          v-else
          role="group"
          aria-label="金额"
          tabindex="0"
          class="entry-amount-value"
        >
          <span>¥</span>{{ displayValue }}
        </div>
        <span v-if="exprLine" class="entry-expression">{{ exprLine }}</span
        ><small v-if="amountInputError && isMobile" class="neg"
          >请输入金额，最多两位小数</small
        >
      </div>
      <div class="entry-fields">
        <div class="field">
          <label class="field-label" for="txn-title">标题</label
          ><input
            id="txn-title"
            v-model="title"
            class="input"
            placeholder="这笔钱用在了哪里？"
          />
        </div>
        <div class="field">
          <label class="field-label" for="txn-note"
            >备注 <span>选填</span></label
          ><textarea
            id="txn-note"
            v-model="note"
            class="input"
            rows="2"
            placeholder="补充用途、数量或其他细节"
          />
        </div>
        <div class="entry-pair">
          <div class="field">
            <label class="field-label" for="txn-account">{{
              type === "transfer" ? "转出账户" : "账户"
            }}</label
            ><select
              id="txn-account"
              class="input"
              :value="accountId"
              @change="
                selectAccount(($event.target as HTMLSelectElement).value)
              "
            >
              <option v-for="a in accounts" :value="a.id" :key="a.id">
                {{ a.name }}{{ a.kind === "project" ? " · 专项" : "" }}
              </option>
            </select>
          </div>
          <div class="field">
            <template v-if="type === 'transfer'"
              ><label class="field-label" for="txn-to-account">转入账户</label
              ><select id="txn-to-account" v-model="toAccountId" class="input">
                <option :value="null" disabled>选择转入账户</option>
                <option v-for="a in toAccountOptions" :value="a.id" :key="a.id">
                  {{ a.name }}
                </option>
              </select></template
            ><template v-else
              ><label class="field-label" for="txn-category">分类</label
              ><select id="txn-category" v-model="categoryId" class="input">
                <option :value="null">未分类</option>
                <option v-for="c in categories" :value="c.id" :key="c.id">
                  {{ c.name }}
                </option>
              </select></template
            >
          </div>
        </div>
        <div class="field">
          <label class="field-label" for="txn-date">日期</label>
          <div class="entry-date">
            <button class="icon-btn" aria-label="前一天" @click="shiftDate(-1)">
              <AppIcon name="back" :size="16" /></button
            ><input
              id="txn-date"
              type="date"
              v-model="dateStr"
              class="input"
            /><button
              class="icon-btn"
              aria-label="后一天"
              @click="shiftDate(1)"
            >
              <AppIcon
                name="back"
                :size="16"
                style="transform: rotate(180deg)"
              />
            </button>
          </div>
        </div>
      </div>
      <details v-if="!isMobile" class="calculator" open>
        <summary>计算器 <span>支持键盘直接输入算式</span></summary>
        <div class="calculator-keys">
          <button
            v-for="key in [
              '7',
              '8',
              '9',
              '÷',
              '4',
              '5',
              '6',
              '×',
              '1',
              '2',
              '3',
              '−',
              '0',
              '.',
              '=',
              '+',
            ]"
            :key="key"
            :aria-label="key === '=' ? '等于' : key"
            @click="calculatorKey(key)"
          >
            {{ key }}</button
          ><button aria-label="清空" @click="clearAll">C</button
          ><button @click="pressParen('(')">(</button
          ><button @click="pressParen(')')">)</button
          ><button aria-label="删除" @click="backspace">⌫</button>
        </div>
      </details>
      <div v-if="isEdit" class="entry-secondary">
        <button class="btn btn-ghost" @click="copyCurrent">
          <AppIcon name="copy" />复制这一笔</button
        ><button class="btn btn-ghost neg" @click="askDelete">删除交易</button
        ><button
          v-if="savedTransaction?.fabricWorldEligible"
          class="btn btn-secondary"
          :disabled="hasUnsavedChanges"
          @click="askFabricSync"
        >
          同步至 FabricWorld
        </button>
        <p v-if="savedTransaction?.fabricWorldEligible && hasUnsavedChanges">
          请先保存修改，再同步至 FabricWorld。
        </p>
      </div>
      <footer class="entry-save">
        <span v-if="saveUncertain" class="neg"
          >保存结果未确认，请先核对账目。</span
        ><span v-else>{{
          isEdit ? "修改将应用于这笔交易" : "保存后可继续记录下一笔"
        }}</span
        ><button
          class="btn btn-primary"
          :disabled="!canSave || saving"
          @click="save"
        >
          {{ isEdit ? "保存修改" : "保存这一笔"
          }}<AppIcon name="arrow" :size="15" />
        </button>
      </footer>
    </template>
    <ModalDialog
      v-if="confirmingDelete"
      label="删除交易"
      :busy="deleting"
      @close="confirmingDelete = false"
      ><div class="delete-confirm">
        <h3>删除这笔交易？</h3>
        <p>删除后将重新计算账户余额，网页无法恢复。</p>
        <div class="row gap-3">
          <button class="btn btn-ghost" @click="confirmingDelete = false">
            取消</button
          ><button
            class="btn btn-danger"
            :disabled="deleting"
            @click="confirmDelete"
          >
            {{ deleting ? "正在删除…" : "删除交易" }}
          </button>
        </div>
      </div></ModalDialog
    >
  </div>
</template>
<style scoped>
.entry-panel {
  padding: 24px 28px 0;
}
.entry-type {
  display: flex;
  gap: 20px;
  border-bottom: 1px solid var(--border);
}
.entry-type button {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 12px 0;
  font-size: 13px;
  position: relative;
  color: var(--fg-2);
}
.entry-type button.active {
  color: var(--primary);
  font-weight: 600;
}
.entry-type button.active:after {
  content: "";
  position: absolute;
  bottom: -1px;
  height: 2px;
  background: var(--primary);
  left: 0;
  right: 0;
}
.entry-amount {
  padding: 24px 0;
}
.entry-amount > label {
  font-size: 10px;
  color: var(--fg-3);
  display: block;
  margin-bottom: 5px;
}
.entry-amount-value,
.entry-amount-input {
  font-size: 42px;
  font-weight: 650;
  letter-spacing: -1.6px;
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.entry-amount-value > span,
.entry-amount-input > span {
  font-size: 25px;
  font-weight: 500;
  color: var(--fg-3);
}
.entry-amount-input input {
  border: 0;
  outline: 0;
  min-width: 0;
  width: 100%;
  font-size: 42px;
  font-weight: 600;
  background: transparent;
  letter-spacing: -1.5px;
}
.entry-expression {
  font-size: 11px;
  color: var(--fg-3);
}
.entry-fields {
  display: grid;
  gap: 17px;
}
.entry-fields .input {
  background: var(--surface-2);
  border-color: var(--border);
  font-size: 13px;
}
.entry-fields textarea {
  resize: vertical;
}
.entry-fields .field-label span {
  color: var(--fg-3);
  font-size: 10px;
  margin-left: 4px;
}
.entry-pair {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 14px;
}
.entry-date {
  display: flex;
  gap: 7px;
  align-items: center;
}
.entry-date input {
  flex: 1;
}
.calculator {
  margin-top: 22px;
  border-top: 1px solid var(--border);
  padding-top: 14px;
}
.calculator summary {
  font-size: 11px;
  color: var(--fg-2);
  cursor: pointer;
}
.calculator summary span {
  font-size: 10px;
  margin-left: 10px;
  color: var(--fg-3);
}
.calculator-keys {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 4px;
  margin-top: 12px;
}
.calculator-keys button {
  background: var(--surface-2);
  height: 34px;
  border-radius: 5px;
  font-size: 15px;
}
.calculator-keys button:nth-child(4n) {
  color: var(--primary);
  background: var(--primary-soft);
}
.calculator-keys button:hover {
  background: var(--surface-3);
}
.entry-save {
  position: sticky;
  bottom: 0;
  background: white;
  padding: 20px 0;
  display: flex;
  justify-content: space-between;
  gap: 12px;
  align-items: center;
  border-top: 1px solid var(--border);
  margin-top: 24px;
}
.entry-save > span {
  font-size: 11px;
  color: var(--fg-3);
  max-width: 52%;
}
.entry-save > .btn {
  min-width: 125px;
}
.entry-secondary {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 24px;
}
.entry-secondary > p {
  font-size: 11px;
  color: var(--fg-3);
  width: 100%;
}
.entry-feedback {
  padding: 9px 12px;
  border-radius: 6px;
  background: var(--income-soft);
  color: var(--income);
  font-size: 12px;
  margin-bottom: 12px;
}
.entry-feedback.error {
  color: var(--expense);
  background: var(--expense-soft);
}
.delete-confirm {
  padding: 25px;
}
.delete-confirm h3 {
  font-size: 17px;
}
.delete-confirm p {
  margin: 12px 0 22px;
  color: var(--fg-2);
  font-size: 13px;
}
.delete-confirm > .row {
  justify-content: flex-end;
}
@media (max-width: 720px) {
  .entry-panel {
    padding: 18px 20px 0;
  }
  .entry-amount {
    padding: 23px 0;
  }
  .entry-fields .input {
    font-size: 16px;
  }
  .entry-fields {
    gap: 16px;
  }
  .entry-save {
    padding-bottom: calc(18px + env(safe-area-inset-bottom));
  }
  .entry-save > span {
    font-size: 10px;
  }
  .entry-pair {
    gap: 10px;
  }
  .entry-type {
    gap: 26px;
  }
  .entry-type button {
    padding-top: 6px;
  }
  .entry-amount-input input {
    font-size: 40px;
  }
}
</style>

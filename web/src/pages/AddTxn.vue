<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import {
  accountService,
  categoryService,
  tagService,
  txnService,
  yuanToCents,
  centsToYuan,
  AppError,
  type Account,
  type Category,
  type Tag,
  type TxnType,
  type Id,
} from '../api';
import { evalExpr, isExpression } from '../services/expr';
import { normalizeAmountInput, parseAmountInput } from '../services/amountInput';
import { useMediaQuery } from '../composables/useMediaQuery';

import { beijingDate, shiftDay } from '../services/dates';
import LoadError from '../components/LoadError.vue';
import PageSkeleton from '../components/PageSkeleton.vue';
import SaveStatus from '../components/SaveStatus.vue';
import { useSaveGuard } from '../composables/useSaveGuard';
import { pushToast } from '../composables/useToast';
import { readPreference, savePreference } from '../services/preferences';
const LAST_ACCOUNT_KEY = 'last_account_id';

const route = useRoute();
const router = useRouter();
const isMobile = useMediaQuery('(max-width: 720px)');

const editingId = computed<Id | null>(() => {
  const p = route.params.id;
  return typeof p === 'string' && p ? p : null;
});
const isEdit = computed(() => editingId.value !== null);
const copyingId = computed<Id | null>(() => {
  const q = route.query.copy;
  return typeof q === 'string' && q ? q : null;
});

const accounts = ref<Account[]>([]);
const categories = ref<Category[]>([]);
const tags = ref<Tag[]>([]);

const type = ref<TxnType>('expense'); // 智能默认：支出
const accountId = ref<Id | null>(null);
const toAccountId = ref<Id | null>(null); // 仅转账
const categoryId = ref<Id | null>(null); // 仅收支
const dateStr = ref<string>(todayStr()); // 智能默认：今天
const selectedTagIds = ref<Id[]>([]);
const title = ref(''); // 标题：主要信息（如"晚饭"），选填
const note = ref(''); // 备注：详细信息（如"和同事在楼下吃"），选填
const raw = ref(''); // 手机直接输入金额；桌面允许计算器算式
const justEvaluated = ref(false);

const openPicker = ref<'account' | 'category' | 'toAccount' | 'date' | 'tag' | null>(null);
const saving = ref(false);
const saveError = ref('');
const saveUncertain = ref(false);
const showSaveError = ref(false);
useSaveGuard(saving);
const deleting = ref(false);
const confirmingDelete = ref(false); // 删除二次确认弹层
const initializing = ref(true);
const initError = ref('');
const allCategories = ref<Category[]>([]);
const feedback = ref<{ kind: 'success' | 'error'; msg: string } | null>(null);
let feedbackTimer: ReturnType<typeof setTimeout> | null = null;

const amountBoxEl = ref<HTMLElement | null>(null);
const amountInputEl = ref<HTMLInputElement | null>(null);
const titleInputEl = ref<HTMLInputElement | null>(null);
const noteInputEl = ref<HTMLInputElement | null>(null);

const currentAccount = computed(() => accounts.value.find((a) => a.id === accountId.value) ?? null);
const currentCategory = computed(
  () => categories.value.find((c) => c.id === categoryId.value) ?? null,
);
const currentToAccount = computed(
  () => accounts.value.find((a) => a.id === toAccountId.value) ?? null,
);
const toAccountOptions = computed(() => accounts.value.filter((a) => a.id !== accountId.value));
const selectedTags = computed(() =>
  tags.value.filter((t) => selectedTagIds.value.includes(t.id)),
);

const displayValue = computed(() => {
  const r = raw.value;
  if (!r) return '0';
  if (!isExpression(r)) {
    return r.startsWith('.') ? `0${r}` : r;
  }
  const v = evalExprSafe(r);
  return v === null ? '0' : formatNum(v);
});

const exprLine = computed(() => {
  const r = raw.value;
  if (!isExpression(r)) return '';
  return r
    .replace(/\*/g, '×')
    .replace(/\//g, '÷')
    .replace(/([+\-×÷])/g, ' $1 ')
    .replace(/\s+/g, ' ')
    .trim();
});

const amountValue = computed(() => isMobile.value ? parseAmountInput(raw.value) : evalExprSafe(raw.value));
const amountInputError = computed(() => raw.value !== '' && parseAmountInput(raw.value) === null);

function onAmountInput(event: Event): void {
  const input = event.target as HTMLInputElement;
  raw.value = normalizeAmountInput(input.value);
  input.value = raw.value;
  justEvaluated.value = false;
}

function blurAmount(): void { amountInputEl.value?.blur(); }

// iOS 点击非输入区域未必主动失焦；不拦截默认点击，仍可直接打开账户等选择器。
function dismissAmountKeyboard(event: MouseEvent): void {
  if (event.target !== amountInputEl.value) blurAmount();
}

watch(isMobile, (mobile) => {
  if (openPicker.value === 'date') openPicker.value = null;
  if (!mobile || !isExpression(raw.value)) return;
  const value = evalExprSafe(raw.value);
  if (value !== null) raw.value = formatNum(value);
});

const canSave = computed(() => {
  if (initializing.value || initError.value || deleting.value || saveUncertain.value) return false;
  const v = amountValue.value;
  if (v === null || v <= 0) return false;
  if (!accountId.value) return false;
  if (type.value === 'transfer') {
    return !!toAccountId.value && toAccountId.value !== accountId.value;
  }
  return true;
});

const isToday = computed(() => dateStr.value === todayStr());
const dateMd = computed(() => {
  const [, m, d] = dateStr.value.split('-');
  return `${Number(m)}/${Number(d)}`;
});

function todayStr(): string { return beijingDate(); }
function shiftDate(delta: number): void { dateStr.value = shiftDay(dateStr.value, delta); }

function evalExprSafe(input: string): number | null {
  const cleaned = input.replace(/[+\-*/.]+$/, '');
  if (cleaned === '') return null;
  return evalExpr(cleaned);
}

function formatNum(v: number): string {
  const r = Math.round(v * 100) / 100;
  return Number.isInteger(r) ? String(r) : r.toFixed(2);
}

function argbToCss(argb: number): string {
  const u = argb >>> 0; // 转无符号
  const a = ((u >>> 24) & 0xff) / 255;
  const r = (u >>> 16) & 0xff;
  const g = (u >>> 8) & 0xff;
  const b = u & 0xff;
  return `rgba(${r}, ${g}, ${b}, ${a === 0 ? 1 : a})`;
}

function press(ch: string): void {
  if (justEvaluated.value) {
    raw.value = '';
    justEvaluated.value = false;
  }
  if (ch === '.') {
    const lastNum = raw.value.split(/[+\-*/()]/).pop() ?? '';
    if (lastNum.includes('.')) return;
    if (raw.value === '' || /[+\-*/(]$/.test(raw.value)) {
      raw.value += '0.'; // 空串或运算符/左括号后补前导 0
      return;
    }
  }
  raw.value += ch;
}

function pressOp(op: '+' | '-' | '*' | '/'): void {
  justEvaluated.value = false;
  if (raw.value === '') return; // 不允许以运算符开头
  if (/[+\-*/]$/.test(raw.value)) {
    raw.value = raw.value.slice(0, -1) + op;
    return;
  }
  raw.value += op;
}

function pressParen(p: '(' | ')'): void {
  if (justEvaluated.value) {
    if (p === '(') raw.value = ''; // 结果后按左括号 = 开新算式
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
  raw.value = '';
  justEvaluated.value = false;
}

function toggle(picker: typeof openPicker.value): void {
  openPicker.value = openPicker.value === picker ? null : picker;
}

async function loadCategories(): Promise<void> {
  if (!accountId.value) {
    categories.value = [];
    categoryId.value = null;
    return;
  }
  categories.value = allCategories.value.filter(category => category.accountId === accountId.value);
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

function selectCategory(id: Id): void {
  categoryId.value = id;
  openPicker.value = null;
}

function selectToAccount(id: Id): void {
  toAccountId.value = id;
  openPicker.value = null;
}

function onDateInput(e: Event): void {
  const input = e.target as HTMLInputElement;
  if (input.value && input.validity.valid) dateStr.value = input.value;
  else input.value = dateStr.value;
  openPicker.value = null;
}

function toggleTag(id: Id): void {
  const idx = selectedTagIds.value.indexOf(id);
  if (idx >= 0) selectedTagIds.value.splice(idx, 1);
  else selectedTagIds.value.push(id);
}

function setType(t: TxnType): void {
  type.value = t;
  openPicker.value = null;
  if (t === 'transfer') {
    categoryId.value = null; // 转账无分类
  } else {
    toAccountId.value = null; // 收支无转入账户
    if (categoryId.value === null) categoryId.value = categories.value[0]?.id ?? null;
  }
}

function showFeedback(kind: 'success' | 'error', msg: string): void {
  feedback.value = { kind, msg };
  if (feedbackTimer) clearTimeout(feedbackTimer);
  feedbackTimer = setTimeout(() => {
    feedback.value = null;
  }, 2200);
}

async function save(): Promise<void> {
  if (saving.value || deleting.value || initializing.value || initError.value || saveUncertain.value) return;
  const value = amountValue.value;
  if (value === null || value <= 0) {
    showFeedback('error', '请输入有效金额');
    return;
  }
  if (!accountId.value) {
    showFeedback('error', '请选择账户');
    return;
  }
  if (type.value === 'transfer') {
    if (!toAccountId.value) {
      showFeedback('error', '请选择转入账户');
      return;
    }
    if (toAccountId.value === accountId.value) {
      showFeedback('error', '转入账户需与转出账户不同');
      return;
    }
  }

  saving.value = true;
  openPicker.value = null;
  blurAmount();
  saveError.value = '';
  showSaveError.value = false;
  let saved = false;
  try {
    if (isEdit.value && editingId.value) {
      await txnService.update(editingId.value, {
        type: type.value,
        amount: yuanToCents(value),
        accountId: accountId.value,
        toAccountId: type.value === 'transfer' ? toAccountId.value : null,
        categoryId: type.value === 'transfer' ? null : categoryId.value,
        date: dateStr.value,
        title: title.value.trim() || null,
        note: note.value.trim() || null,
        tagIds: selectedTagIds.value.slice(),
      });
      showFeedback('success', '已保存 ✓');
      saved = true;
    } else {
      await txnService.create({
        type: type.value,
        amount: yuanToCents(value),
        accountId: accountId.value,
        toAccountId: type.value === 'transfer' ? toAccountId.value : null,
        categoryId: type.value === 'transfer' ? null : categoryId.value,
        date: dateStr.value,
        title: title.value.trim() || null,
        note: note.value.trim() || null,
        tagIds: selectedTagIds.value.slice(),
      });
      savePreference(LAST_ACCOUNT_KEY, accountId.value);
      raw.value = '';
      justEvaluated.value = false;
      title.value = '';
      note.value = '';
      selectedTagIds.value = [];
      showFeedback('success', '已保存 ✓');
      saved = true;
    }
  } catch (e) {
    saveUncertain.value = !(e instanceof AppError) || ['NETWORK', 'RESPONSE', 'INTERNAL', 'HTTP'].includes(e.code);
    saveError.value = saveUncertain.value ? '未收到完整的保存确认，请先查看账目核对，避免重复添加。当前表单已保留。' : (e as AppError).message;
    showSaveError.value = true;
  } finally {
    saving.value = false;
  }
  if (saved && isEdit.value) { pushToast('success', '交易已保存'); goBack(); }
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
    showFeedback('success', '已删除 ✓');
    goBack();
  } catch (e) {
    confirmingDelete.value = false;
    const msg =
      e instanceof AppError && e.code === 'NOT_FOUND'
        ? '这笔交易已不存在'
        : e instanceof AppError
          ? e.message
          : '删除失败，请重试';
    showFeedback('error', msg);
  } finally {
    deleting.value = false;
  }
}

function goBack(): void {
  if (saving.value) return;
  if (window.history.length > 1) {
    router.back();
  } else {
    void router.push('/overview');
  }
}

function copyCurrent(): void {
  if (!editingId.value) return;
  void router.replace({ path: '/add', query: { copy: editingId.value } });
}

function onKeydown(e: KeyboardEvent): void {
  if (saving.value || showSaveError.value) return;
  // 手机使用原生输入与焦点行为，不接管 Tab、数字键或 Enter 保存。
  if (isMobile.value) return;
  const el = e.target as HTMLElement | null;

  if (e.key === 'Tab') {
    const amount = amountBoxEl.value;
    const titleEl = titleInputEl.value;
    const noteEl = noteInputEl.value;
    if (amount && titleEl && noteEl) {
      e.preventDefault();
      const cycle: HTMLElement[] = [amount, titleEl, noteEl];
      const len = cycle.length;
      const idx = el ? cycle.indexOf(el) : -1;
      const next = e.shiftKey ? cycle[(idx <= 0 ? len : idx) - 1] : cycle[(idx + 1) % len];
      next.focus();
    }
    return;
  }

  if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) return;
  if (e.key === 'Escape') {
    if (confirmingDelete.value) confirmingDelete.value = false;
    else if (openPicker.value) openPicker.value = null;
    else if (!isEdit.value && raw.value) clearAll();
    else goBack();
    e.preventDefault();
    return;
  }
  if (e.key >= '0' && e.key <= '9') press(e.key);
  else if (e.key === '.' || e.key === 'Decimal' || e.code === 'NumpadDecimal' || e.code === 'Period')
    press('.'); // 主键区句号、小键盘小数点、部分布局的 'Decimal' 都算小数点
  else if (e.key === '+' || e.key === '-' || e.key === '*' || e.key === '/') pressOp(e.key);
  else if (e.key === '(' || e.key === ')') pressParen(e.key);
  else if (e.key === '=') equals(); // 等于号：求值并折叠结果，供继续运算
  else if (e.key === 'Backspace') backspace();
  else if (e.key.toLowerCase() === 'c' && !e.ctrlKey && !e.metaKey) clearAll();
  else if (e.key === 'Enter') void save(); // Enter 仍是「保存整笔」快捷键（金额已实时求值）
  else return;
  e.preventDefault();
}

function resetFormState(): void {
  type.value = 'expense';
  accountId.value = null;
  toAccountId.value = null;
  categoryId.value = null;
  dateStr.value = todayStr();
  selectedTagIds.value = [];
  title.value = '';
  note.value = '';
  raw.value = '';
  justEvaluated.value = false;
  openPicker.value = null;
  confirmingDelete.value = false;
  initError.value = '';
}

async function initCreate(): Promise<void> {
  const q = route.query.account;
  const qAccount = typeof q === 'string' && q ? q : null;
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

  type.value = txn.type;
  accountId.value = txn.accountId;
  toAccountId.value = txn.type === 'transfer' ? txn.toAccountId : null;

  raw.value = centsToYuan(txn.amount);

  dateStr.value = txn.date;

  title.value = txn.title ?? '';
  note.value = txn.note ?? '';
  selectedTagIds.value = txn.tags.map((t) => t.id);

  await loadCategories();
  categoryId.value = txn.type === 'transfer' ? null : txn.categoryId;
}

async function initCopy(id: Id): Promise<void> {
  const txn = await txnService.get(id);

  type.value = txn.type;
  accountId.value = txn.accountId;
  toAccountId.value = txn.type === 'transfer' ? txn.toAccountId : null;
  raw.value = centsToYuan(txn.amount); // 金额分→元字符串（同编辑回填）
  dateStr.value = todayStr(); // 复制的唯一差异：日期取今天
  title.value = txn.title ?? '';
  note.value = txn.note ?? '';
  selectedTagIds.value = txn.tags.map((t) => t.id);

  await loadCategories();
  categoryId.value = txn.type === 'transfer' ? null : txn.categoryId;
}

async function initForm(): Promise<void> {
  initializing.value = true;
  initError.value = '';
  try {
    resetFormState();
    const [result, categoriesResult, tagsResult] = await Promise.all([
      accountService.list(), categoryService.list(), tagService.list(),
    ]);
    accounts.value = result.items;
    allCategories.value = categoriesResult;
    tags.value = tagsResult;
    if (editingId.value) await initEdit(editingId.value);
    else if (copyingId.value) await initCopy(copyingId.value);
    else await initCreate();
  } catch (e) { initError.value = (e as Error).message; }
  finally { initializing.value = false; }
}
function retryInitialization(): void { if (initError.value) void initForm(); }

onMounted(() => {
  void initForm();
  window.addEventListener('keydown', onKeydown);
  document.addEventListener('click', dismissAmountKeyboard);
  window.addEventListener('ledger-reload', retryInitialization);
});

watch([editingId, copyingId], () => {
  void initForm();
});

onUnmounted(() => {
  window.removeEventListener('keydown', onKeydown);
  document.removeEventListener('click', dismissAmountKeyboard);
  window.removeEventListener('ledger-reload', retryInitialization);
  if (feedbackTimer) clearTimeout(feedbackTimer);
});
</script>

<template>
  <div class="content add-content">
    <PageSkeleton v-if="initializing" label="交易表单" form />
    <SaveStatus v-if="saving || showSaveError" :saving="saving" :error="saveError" :uncertain="saveUncertain"
      @dismiss="showSaveError = false" @review="router.push('/search')" />
    <template v-if="!initializing">
    <LoadError :message="initError" @retry="initForm" />
    <Teleport v-if="!isEdit" to="#topbar-slot">
      <RouterLink
        class="btn btn-ghost btn-sm"
        :to="{ path: '/batch', query: { account: accountId || undefined, date: dateStr } }"
        @keydown.enter.stop
      >批量记账</RouterLink>
    </Teleport>
    <div v-if="!initError" class="add-card add-card-2col" :aria-busy="saving">

      <div class="add-left">
        <div class="segmented">
          <button class="seg" :class="{ 'on-expense': type === 'expense' }" @click="setType('expense')">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
              <path d="M12 5v14M19 12l-7 7-7-7" />
            </svg>
            支出
          </button>
          <button class="seg" :class="{ 'on-income': type === 'income' }" @click="setType('income')">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
              <path d="M12 19V5M5 12l7-7 7 7" />
            </svg>
            收入
          </button>
          <button class="seg" :class="{ 'on-transfer': type === 'transfer' }" @click="setType('transfer')">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
              <path d="M17 3l4 4-4 4M7 21l-4-4 4-4M21 7H8M3 17h13" />
            </svg>
            转账
          </button>
        </div>


        <div v-if="isMobile" class="amount-display amount-mobile" :class="type">
          <label class="amount-entry">
            <span class="cur" aria-hidden="true">¥</span>
            <input
              ref="amountInputEl"
              class="val num amount-input"
              type="text"
              inputmode="decimal"
              enterkeyhint="done"
              autocomplete="off"
              :spellcheck="false"
              aria-label="金额（元）"
              aria-describedby="amount-help"
              :aria-invalid="amountInputError"
              placeholder="0"
              :value="raw"
              :style="{ width: Math.max(1, raw.length) + 'ch' }"
              @input="onAmountInput"
              @focus="openPicker = null"
              @keydown.enter.prevent.stop="blurAmount"
              @keydown.esc.prevent.stop="blurAmount"
            />
          </label>
          <div id="amount-help" class="amount-help" :class="{ neg: amountInputError }">
            {{ amountInputError ? '请输入数字，最多两位小数' : '点击金额输入' }}
          </div>
        </div>
        <div v-else ref="amountBoxEl" class="amount-display amount-lg" :class="type" tabindex="0" role="group" aria-label="金额">
          <span class="cur">¥</span><span class="val num">{{ displayValue }}</span>
          <div class="expr num">{{ exprLine }}</div>
        </div>


        <div v-if="!isMobile" class="numpad numpad-5">
          <button class="key util" @click="clearAll()" aria-label="清空">C</button>
          <button class="key" @click="press('7')">7</button>
          <button class="key" @click="press('8')">8</button>
          <button class="key" @click="press('9')">9</button>
          <button class="key util" @click="pressOp('/')">÷</button>

          <button class="key util" @click="pressParen('(')">(</button>
          <button class="key" @click="press('4')">4</button>
          <button class="key" @click="press('5')">5</button>
          <button class="key" @click="press('6')">6</button>
          <button class="key util" @click="pressOp('*')">×</button>

          <button class="key util" @click="pressParen(')')">)</button>
          <button class="key" @click="press('1')">1</button>
          <button class="key" @click="press('2')">2</button>
          <button class="key" @click="press('3')">3</button>
          <button class="key util" @click="pressOp('-')">−</button>

          <button class="key util" @click="backspace()" aria-label="删除">⌫</button>
          <button class="key" @click="press('.')">.</button>
          <button class="key" @click="press('0')">0</button>
          <button class="key util accent" @click="equals()" aria-label="等于">=</button>
          <button class="key util accent" @click="pressOp('+')">＋</button>
        </div>
      </div>


      <div class="add-right">

        <div class="field add-f-title">
          <label class="field-label" for="txn-title">标题</label>
          <input id="txn-title" ref="titleInputEl" v-model="title" class="input" placeholder="标题（选填，如：晚饭）" />
        </div>


        <div class="add-pair">

        <div class="field">
          <label class="field-label">账户</label>
          <div class="picker-anchor">
            <button class="pill pill-block" :class="{ 'pill-active': openPicker === 'account' }" @click="toggle('account')">
              <span
                v-if="currentAccount"
                class="ic-tile sm dot"
                :style="{ background: argbToCss(currentAccount.color) }"
              />
              {{ currentAccount?.name ?? '选择账户' }}
              <span class="caret">▾</span>
            </button>
            <div v-if="openPicker === 'account'" class="popover">
              <button
                v-for="a in accounts"
                :key="a.id"
                class="popover-item"
                :class="{ on: a.id === accountId }"
                @click="selectAccount(a.id)"
              >
                <span class="ic-tile sm dot" :style="{ background: argbToCss(a.color) }" />
                {{ a.name }}
                <span v-if="a.kind === 'project'" class="opt-tag">专项</span>
              </button>
            </div>
          </div>
        </div>


        <div class="field">
          <label class="field-label">{{ type === 'transfer' ? '转入账户' : '分类' }}</label>
          <div class="picker-anchor">
            <template v-if="type === 'transfer'">
              <button class="pill pill-block" :class="{ 'pill-active': openPicker === 'toAccount' }" @click="toggle('toAccount')">
                <span
                  v-if="currentToAccount"
                  class="ic-tile sm dot"
                  :style="{ background: argbToCss(currentToAccount.color) }"
                />
                {{ currentToAccount?.name ?? '选择转入账户' }}
                <span class="caret">▾</span>
              </button>
              <div v-if="openPicker === 'toAccount'" class="popover">
                <div v-if="toAccountOptions.length === 0" class="popover-empty">无其他账户</div>
                <button
                  v-for="a in toAccountOptions"
                  :key="a.id"
                  class="popover-item"
                  :class="{ on: a.id === toAccountId }"
                  @click="selectToAccount(a.id)"
                >
                  <span class="ic-tile sm dot" :style="{ background: argbToCss(a.color) }" />
                  {{ a.name }}
                </button>
              </div>
            </template>
            <template v-else>
              <button class="pill pill-block" :class="{ 'pill-active': openPicker === 'category' }" @click="toggle('category')">
                <span
                  v-if="currentCategory"
                  class="ic-tile sm dot"
                  :style="{ background: argbToCss(currentCategory.color) }"
                />
                {{ currentCategory?.name ?? '选择分类' }}
                <span class="caret">▾</span>
              </button>
              <div v-if="openPicker === 'category'" class="popover">
                <div v-if="categories.length === 0" class="popover-empty">该账户暂无分类</div>
                <button
                  v-for="c in categories"
                  :key="c.id"
                  class="popover-item"
                  :class="{ on: c.id === categoryId }"
                  @click="selectCategory(c.id)"
                >
                  <span class="ic-tile sm dot" :style="{ background: argbToCss(c.color) }" />
                  {{ c.name }}
                </button>
              </div>
            </template>
          </div>
        </div>
        </div>



        <div class="add-pair add-pair-date">

        <div class="field">
          <label class="field-label" :for="isMobile ? 'txn-date' : 'txn-date-button'">日期</label>
          <div class="date-row">
            <button class="date-step" aria-label="前一天" @click="shiftDate(-1)">‹</button>
            <input
              v-if="isMobile"
              id="txn-date"
              class="date-input"
              type="date"
              required
              :value="dateStr"
              @focus="openPicker = null"
              @change="onDateInput"
            />
            <div v-else class="picker-anchor date-anchor">
              <button id="txn-date-button" class="pill pill-block" :class="{ 'pill-active': openPicker === 'date' }" @click="toggle('date')">
                <span v-if="isToday" class="date-today-tag">今天 · </span>{{ dateMd }}
                <span class="caret">▾</span>
              </button>
              <div v-if="openPicker === 'date'" class="popover popover-pad">
                <input class="input" type="date" aria-label="日期" :value="dateStr" @change="onDateInput" />
              </div>
            </div>
            <button class="date-step" aria-label="后一天" @click="shiftDate(1)">›</button>
          </div>
        </div>


        <div class="field">
          <label class="field-label">标签</label>
          <div class="picker-anchor">
            <button class="pill pill-block" :class="{ 'pill-active': openPicker === 'tag' }" @click="toggle('tag')">
              <template v-if="selectedTags.length">
                <span v-for="t in selectedTags" :key="t.id" class="chip" style="padding: 2px 8px">{{ t.name }}</span>
              </template>
              <span v-else class="faint">添加标签</span>
              <span style="color: var(--primary); font-weight: 700; margin-left: auto">＋</span>
            </button>
            <div v-if="openPicker === 'tag'" class="popover popover-pad">
              <div v-if="tags.length === 0" class="popover-empty">暂无标签</div>
              <div class="tag-wrap">
                <button
                  v-for="t in tags"
                  :key="t.id"
                  class="chip"
                  :class="{ 'chip-on': selectedTagIds.includes(t.id) }"
                  @click="toggleTag(t.id)"
                >
                  {{ t.name }}
                </button>
              </div>
            </div>
          </div>
        </div>
        </div>



        <div class="field">
          <label class="field-label" for="txn-note">备注</label>
          <div class="note-inline">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M11 4H4v16h16v-7" />
              <path d="M18.5 2.5a2.1 2.1 0 0 1 3 3L12 15l-4 1 1-4z" />
            </svg>
            <input id="txn-note" ref="noteInputEl" v-model="note" placeholder="备注（选填，详细信息）" />
          </div>
        </div>


        <div class="add-right-foot">
          <div v-if="saveError" class="feedback error" role="alert">
            {{ saveError }}
            <RouterLink v-if="saveUncertain" to="/search" class="btn btn-secondary mt-2">查看账目核对</RouterLink>
          </div>
          <div v-if="feedback" class="feedback" :class="feedback.kind">{{ feedback.msg }}</div>
          <button class="btn btn-primary btn-lg btn-block mt-2" :disabled="!canSave || saving" @click="save">
            {{ saving ? '保存中…' : isEdit ? '保存修改' : '保存这一笔' }}
          </button>
          <div class="add-kbd-hint kbd-hint" aria-hidden="true">
            <span class="kbd">↵</span>保存
            <span class="kbd">Esc</span>{{ isEdit ? '返回' : '清空/返回' }}
            <span class="kbd">C</span>清空
          </div>

          <button
            v-if="isEdit"
            class="btn btn-ghost btn-block mt-2"
            :disabled="saving || deleting"
            @click="copyCurrent"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <rect x="9" y="9" width="11" height="11" rx="2" />
              <path d="M5 15V5a2 2 0 0 1 2-2h10" />
            </svg>
            复制这一笔
          </button>

          <button
            v-if="isEdit"
            class="btn btn-ghost btn-block btn-del mt-2"
            :disabled="saving || deleting"
            @click="askDelete"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" />
              <path d="M10 11v6M14 11v6" />
            </svg>
            删除交易
          </button>
        </div>
      </div>
    </div>


    <div v-if="openPicker" class="picker-backdrop" @click="openPicker = null" />


    <div v-if="confirmingDelete" class="confirm-backdrop" @click.self="confirmingDelete = false">
      <div class="confirm-card">
        <div class="confirm-title">删除交易</div>
        <div class="confirm-msg">
          删除后这笔交易将不可恢复（其标签关联会一并移除，账户余额随之调整）。确定删除吗？
        </div>
        <div class="confirm-actions">
          <button class="btn btn-ghost" :disabled="deleting" @click="confirmingDelete = false">取消</button>
          <button class="btn btn-danger" :disabled="deleting" @click="confirmDelete">
            {{ deleting ? '删除中…' : '删除' }}
          </button>
        </div>
      </div>
    </div>
    </template>
  </div>
</template>

<style scoped>
/* 桌面为主战场：主区居中一张宽卡；内容多时允许纵向滚动（不再强制单屏）。 */
.add-content {
  display: flex;
  align-items: flex-start;
  justify-content: center;
  background: var(--bg);
  overflow: auto;
}

/* 两栏卡片：左金额+键盘，右表单。上限约 860px 居中。 */
.add-card-2col {
  width: 100%;
  max-width: 860px;
  margin: 8px auto;
  display: grid;
  grid-template-columns: 1fr 1fr;
}
.add-left {
  padding: 20px 22px;
  border-right: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.add-right {
  padding: 20px 22px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

/* pill 对：桌面下透明（display:contents），两个 .field 照旧各占一行纵向堆叠——桌面零回归。 */
.add-pair {
  display: contents;
}


/* 分段控件里的 seg 是 button，补齐可点击态 */
.segmented .seg {
  width: 100%;
}

/* 左栏金额区：桌面上更醒目 */
.amount-lg {
  padding: 8px 0 4px;
}
.amount-lg .val {
  font-size: 56px;
}

/* 右栏表单字段：标题 + label */
.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.field .field-label {
  margin-bottom: 0;
}

/* 右栏保存区推到底部 */
.add-right-foot {
  margin-top: auto;
}
/* 桌面记一笔快捷键提示：保存按钮下方居中、极淡（手机端由 tokens.css 统一隐藏）。 */
.add-kbd-hint {
  justify-content: center;
  gap: 5px;
  margin-top: 8px;
}
.add-kbd-hint .kbd { margin-left: 3px; }

/* pill 选择器锚点 */
.picker-anchor {
  position: relative;
}
/* 右栏里的 pill 铺满整行、左对齐显示内容 */
.pill-block {
  width: 100%;
  justify-content: flex-start;
}
.pill-block .caret {
  margin-left: auto;
}
.dot {
  width: 20px;
  height: 20px;
}

/* 日期三件套：加减按钮定宽，中间日期按可用宽度伸缩。 */
.date-row {
  display: flex;
  align-items: stretch;
  gap: 8px;
  min-width: 0;
}
.date-anchor {
  flex: 1;
  min-width: 0;
}
.date-step {
  flex: none;
  width: 40px;
  border: 1px solid var(--border);
  background: var(--surface-2);
  border-radius: var(--r-md);
  color: var(--fg-2);
  font-size: 20px;
  font-weight: 700;
  line-height: 1;
  display: grid;
  place-items: center;
}
.date-step:hover {
  background: var(--surface-3);
  border-color: var(--border-strong);
  color: var(--fg);
}
.date-step:active {
  background: var(--surface-3);
}

/* 弹出选择层 */
.popover {
  position: absolute;
  top: calc(100% + 6px);
  left: 0;
  right: 0;
  z-index: 30;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--r-md);
  box-shadow: var(--sh-3);
  padding: 6px;
  max-height: 220px;
  overflow: auto;
}
.popover-pad {
  padding: 10px;
}
.popover-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 8px 10px;
  border-radius: var(--r-sm);
  font-size: var(--fs-sm);
  font-weight: 600;
  color: var(--fg);
  text-align: left;
}
.popover-item:hover {
  background: var(--surface-2);
}
.popover-item.on {
  background: var(--primary-soft);
  color: var(--primary);
}
.opt-tag {
  margin-left: auto;
  padding: 1px 6px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 700;
  background: rgba(147, 52, 230, 0.14);
  color: #9334e6;
}
.popover-empty {
  padding: 10px;
  color: var(--fg-3);
  font-size: var(--fs-sm);
  text-align: center;
}
.tag-wrap {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

/* 5 列数字键盘（工具列 + 3 列数字 + 运算符列），保持设计的行高与底片风格 */
.numpad-5 {
  grid-template-columns: repeat(5, 1fr);
  grid-template-rows: repeat(4, 56px);
}

/* 反馈条 */
.feedback {
  text-align: center;
  font-size: var(--fs-sm);
  font-weight: 600;
  padding: 8px;
  border-radius: var(--r-md);
}
.feedback.success {
  background: var(--income-soft);
  color: var(--income);
}
.feedback.error {
  background: var(--expense-soft);
  color: var(--expense);
}

/* 关闭选择器的透明背板 */
.picker-backdrop {
  position: fixed;
  inset: 0;
  z-index: 20;
}

/* 编辑模式：删除交易——次级危险按钮，平时低调、hover 才转红，避免误点 */
.btn-del {
  color: var(--expense);
  border-color: var(--border);
}
.btn-del:hover:not(:disabled) {
  background: var(--expense-soft);
  border-color: var(--expense);
}
.btn-del svg {
  width: 16px;
  height: 16px;
}

/* 删除二次确认弹层 */
.confirm-backdrop {
  position: fixed;
  inset: 0;
  z-index: 60;
  background: rgba(0, 0, 0, 0.32);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
}
.confirm-card {
  width: 100%;
  max-width: 380px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--r-lg);
  box-shadow: var(--sh-3);
  padding: 22px;
}
.confirm-title {
  font-size: var(--fs-h3);
  font-weight: 700;
  color: var(--fg);
  margin-bottom: 10px;
}
.confirm-msg {
  font-size: var(--fs-sm);
  color: var(--fg-2);
  line-height: 1.6;
  margin-bottom: 20px;
}
.confirm-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
}

/* 手机使用普通纵向表单。视口再矮也只增加滚动，不挤压字段或保存按钮。 */
@media (max-width: 720px) {
  .add-content { display: block; padding: 12px; }
  .add-card-2col {
    grid-template-columns: minmax(0, 1fr);
    margin: 0;
    overflow: visible;
  }
  .add-left { border-right: 0; padding: 16px 16px 0; gap: 16px; }
  .add-right { padding: 16px; gap: 16px; }
  .amount-mobile { padding: 8px 0; }
  .amount-entry { display: flex; align-items: baseline; justify-content: center; gap: 4px; }
  .amount-mobile .amount-input {
    min-width: 1ch; max-width: calc(100% - 32px);
    border: 0; border-bottom: 2px solid var(--border); border-radius: 0;
    padding: 0 0 4px; background: transparent;
    font-size: 42px; line-height: 1.3; text-align: center;
  }
  .amount-input:focus { outline: none; border-bottom-color: currentColor; }
  .amount-input::placeholder { color: inherit; opacity: 1; }
  /* 空金额聚焦时只显示光标；隐藏占位 0，不影响实际输入的 0 或小数。 */
  .amount-input:focus::placeholder { opacity: 0; }
  .amount-help { font-size: var(--fs-sm); color: var(--fg-3); margin-top: 6px; }
  .amount-help.neg { color: var(--expense); }
  .add-pair { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
  .add-pair .field { min-width: 0; }
  .pill-block { min-height: 44px; flex-wrap: wrap; overflow-wrap: anywhere; }
  /* 日期独占一行，直接打开系统日期选择器，不再叠加网页浮层。 */
  .add-pair-date { grid-template-columns: minmax(0, 1fr); gap: 16px; }
  .date-row {
    gap: 0; border: 1px solid var(--border-strong); border-radius: var(--r-md);
    background: var(--surface);
  }
  .date-row:focus-within { border-color: var(--primary); box-shadow: 0 0 0 3px var(--ring); }
  .date-step { width: 44px; min-height: 44px; border: 0; background: transparent; }
  .date-step:first-child { border-right: 1px solid var(--border); border-radius: 9px 0 0 9px; }
  .date-step:last-child { border-left: 1px solid var(--border); border-radius: 0 9px 9px 0; }
  .date-input {
    flex: 1; width: 0; min-width: 0; min-height: 44px; padding: 8px 12px;
    border: 0; border-radius: 0; background: transparent;
    appearance: none; font-size: 16px; line-height: 1.45; text-align: center;
  }
  .date-input:focus { outline: none; }
  .date-input::-webkit-date-and-time-value { min-height: 1.45em; text-align: center; }
  .date-input::-webkit-datetime-edit { padding: 0; }
  .add-right-foot { margin-top: 0; }
}

@media (max-width: 360px) {
  .add-pair { grid-template-columns: minmax(0, 1fr); }
}
</style>

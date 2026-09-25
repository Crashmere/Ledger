<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import {
  accountService,
  categoryService,
  txnService,
  statsService,
  emptySummary,
  ledgerInfo,
  type Account,
  type Category,
  type Transaction,
  type TransactionFilter,
  type TxnType,
  type SearchField,
  type DayTotal,
  type CategoryTotal,
  type DailyResult,
} from "../api";
import { connectionUnavailable } from "../api/connection";
import { useSelectedMonth } from "../composables/useSelectedMonth";
import { usePageRefresh } from "../composables/usePageRefresh";
import { useSaveGuard } from "../composables/useSaveGuard";
import { beijingDate, shiftDay, dayLabel } from "../services/dates";
import { money, color, typeName, txnAmount } from "../services/presentation";
import AppIcon from "../components/AppIcon.vue";
import WorkspaceMenu from "../components/WorkspaceMenu.vue";
import FilterPanel from "../components/FilterPanel.vue";
import InsightView from "../components/InsightView.vue";
import MonthSwitch from "../components/MonthSwitch.vue";
import Pagination from "../components/Pagination.vue";
import PageSkeleton from "../components/PageSkeleton.vue";
import LoadError from "../components/LoadError.vue";
import HighlightText from "../components/HighlightText.vue";
import FabricWorldSync from "../components/FabricWorldSync.vue";
const route = useRoute();
const router = useRouter();
const brandIcon = import.meta.env.BASE_URL + "favicon.svg?v=monogram";
const accounts = ref<Account[]>([]);
const categories = ref<Category[]>([]);
const totalBalance = ref(0);
const queryText = (key: string) =>
  typeof route.query[key] === "string" ? String(route.query[key]) : "";
const parseArray = (key: string) => {
  try {
    const value = JSON.parse(queryText(key));
    return Array.isArray(value)
      ? value.filter((v): v is string => typeof v === "string")
      : [];
  } catch {
    return [];
  }
};
const selectedAccounts = ref(queryText("account").split(",").filter(Boolean));
const selectedCategories = ref(
  queryText("category") ? [queryText("category")] : parseArray("categories"),
);
const selectedTypes = ref<TxnType[]>(
  (queryText("types") || queryText("type"))
    .split(",")
    .filter((v): v is TxnType => ["income", "expense", "transfer"].includes(v)),
);
const keyword = ref(queryText("q"));
const searchFieldLabels: Record<SearchField, string> = {
  title: "标题",
  note: "备注",
  category: "分类",
  amount: "金额",
};
const allSearchFields = Object.keys(searchFieldLabels) as SearchField[];
const parseFields = () => {
  const picked = queryText("fields")
    .split(",")
    .filter((v): v is SearchField => allSearchFields.includes(v as SearchField));
  return picked.length ? [...new Set(picked)] : [...allSearchFields];
};
const fields = ref<SearchField[]>(parseFields());
const min = ref<number | null>(
  queryText("min") && /^[0-9]+$/.test(queryText("min"))
    ? Number(queryText("min"))
    : null,
);
const max = ref<number | null>(
  queryText("max") && /^[0-9]+$/.test(queryText("max"))
    ? Number(queryText("max"))
    : null,
);
const excluded = ref(queryText("excluded").split(",").filter(Boolean));
const sort = ref(
  ["time-desc", "time-asc", "amount-desc", "amount-asc"].includes(
    queryText("sort"),
  )
    ? queryText("sort")
    : "time-desc",
);
const view = ref(queryText("view") === "insights" ? "insights" : "list");
const range = ref(
  queryText("from")
    ? "custom"
    : ["all", "30d", "year"].includes(queryText("range"))
      ? queryText("range")
      : "month",
);
const customFrom = ref(queryText("from") || beijingDate().slice(0, 8) + "01");
const customTo = ref(queryText("to") || beijingDate());
const month = useSelectedMonth();
const period = computed(() => {
  const today = beijingDate();
  switch (range.value) {
    case "all":
      return {};
    case "30d":
      return { dateFrom: shiftDay(today, -29), dateTo: today };
    case "year":
      return {
        dateFrom: today.slice(0, 4) + "-01-01",
        dateTo: today.slice(0, 4) + "-12-31",
      };
    case "custom":
      return { dateFrom: customFrom.value, dateTo: customTo.value };
    default:
      return { dateFrom: month.dateFrom.value, dateTo: month.dateTo.value };
  }
});
const scopeAccount = computed(() =>
  selectedAccounts.value.length === 1
    ? accounts.value.find((a) => a.id === selectedAccounts.value[0])
    : undefined,
);
const scopePeriod = computed(() =>
  scopeAccount.value?.kind === "project"
    ? [
        scopeAccount.value.periodStart
          ? beijingDate(scopeAccount.value.periodStart)
          : "未设开始",
        scopeAccount.value.periodEnd
          ? beijingDate(scopeAccount.value.periodEnd)
          : "未设结束",
      ].join(" — ")
    : "",
);
const scopeName = computed(
  () =>
    scopeAccount.value?.name ||
    (selectedAccounts.value.length
      ? selectedAccounts.value.length + " 个账户"
      : "日常账本"),
);
const uniqueCategories = computed(() => [
  ...new Set(
    categories.value
      .filter(
        (c) =>
          !selectedAccounts.value.length ||
          selectedAccounts.value.includes(c.accountId),
      )
      .map((c) => c.name),
  ),
]);
const filter = computed<TransactionFilter>(() => {
  const categoryIds = categories.value
    .filter((c) => selectedCategories.value.includes(c.name))
    .map((c) => c.id);
  return {
    ...period.value,
    projectScope: "selected",
    accountIds: selectedAccounts.value,
    categoryIds: selectedCategories.value.length
      ? categoryIds.length
        ? categoryIds
        : ["missing-category"]
      : [],
    types: selectedTypes.value,
    keyword: keyword.value,
    searchFields: fields.value,
    excludedIds: excluded.value,
    ...(min.value !== null ? { amountMin: min.value } : {}),
    ...(max.value !== null ? { amountMax: max.value } : {}),
  };
});
const transactions = ref<Transaction[]>([]);
const summary = ref(emptySummary());
const categoryTotals = ref<CategoryTotal[]>([]);
const daily = ref<DailyResult>({
  days: [],
  startWeekday: 0,
  weekCount: 0,
  total: 0,
  activeDays: 0,
});
const dayTotals = ref<Record<string, DayTotal>>({});
const dailyError = ref("");
const page = ref(1);
const pageSize = ref(10);
const totalCount = ref(0);
const loading = ref(true);
const resultView = ref<HTMLElement | null>(null);
const pendingResultHeight = ref(0);
watch(loading, (pending) => {
  // Reserve the previous result height before the loading skeleton replaces it.
  // Otherwise the scroll container shrinks and the browser clamps scrollTop to zero.
  pendingResultHeight.value = pending ? resultView.value?.offsetHeight || 0 : 0;
  if (pending && resultView.value) {
    // Removing a focused pagination control can force layout during Vue's child
    // patch, before the parent's bound style is applied. Reserve the height now.
    resultView.value.style.minHeight = pendingResultHeight.value + "px";
  }
});
const initialized = ref(false);
const error = ref("");
const refreshError = ref("");
const direction = ref<"expense" | "income">("expense");
const filtersOpen = ref(false);
let request = 0;
let timer: ReturnType<typeof setTimeout> | undefined;
const currentQuery = () => {
  const q: Record<string, string> = {};
  if (selectedAccounts.value.length)
    q.account = selectedAccounts.value.join(",");
  if (selectedCategories.value.length)
    q.categories = JSON.stringify(selectedCategories.value);
  if (selectedTypes.value.length) q.types = selectedTypes.value.join(",");
  if (keyword.value) q.q = keyword.value;
  if (fields.value.join(",") !== allSearchFields.join(","))
    q.fields = fields.value.join(",");
  if (min.value !== null) q.min = String(min.value);
  if (max.value !== null) q.max = String(max.value);
  if (excluded.value.length) q.excluded = excluded.value.join(",");
  if (sort.value !== "time-desc") q.sort = sort.value;
  if (range.value !== "month") q.range = range.value;
  if (range.value === "custom") {
    q.from = customFrom.value;
    q.to = customTo.value;
  }
  if (view.value === "insights") q.view = "insights";
  return q;
};
async function loadDaily(
  f: TransactionFilter,
): Promise<{ data: DailyResult; error: string }> {
  const empty = {
    days: [],
    startWeekday: 0,
    weekCount: 0,
    total: 0,
    activeDays: 0,
  };
  if (view.value !== "insights") return { data: empty, error: "" };
  try {
    let dateFrom = f.dateFrom,
      dateTo = f.dateTo;
    if (!dateFrom || !dateTo) {
      const [first, last] = await Promise.all(
        ["asc", "desc"].map((sortDir) =>
          txnService.query({
            filter: f,
            pageSize: 1,
            sortBy: "time",
            sortDir: sortDir as "asc" | "desc",
          }),
        ),
      );
      dateFrom = first.items[0]?.date || beijingDate();
      dateTo = last.items[0]?.date || dateFrom;
    }
    if ((Date.parse(dateTo) - Date.parse(dateFrom)) / 86400000 > 3660)
      return {
        data: empty,
        error:
          "当前跨度超过 10 年，请缩小时间范围查看每日走势和热力图。收支汇总与分类仍包含全部匹配交易。",
      };
    return {
      data: await statsService.daily({ ...f, dateFrom, dateTo }),
      error: "",
    };
  } catch (e) {
    return { data: empty, error: (e as Error).message };
  }
}
function keepUnchanged<T>(previous: T, next: T): T {
  return JSON.stringify(previous) === JSON.stringify(next) ? previous : next;
}
async function load(stats = true, background = false) {
  const id = ++request;
  if (!background) {
    loading.value = true;
    error.value = "";
    refreshError.value = "";
  }
  try {
    const f = filter.value;
    const [result, sum, cats, days] = await Promise.all([
      txnService.query({
        filter: f,
        page: page.value,
        pageSize: pageSize.value,
        includeDayTotals: true,
        sortBy: sort.value.startsWith("amount") ? "amount" : "time",
        sortDir: sort.value.endsWith("asc") ? "asc" : "desc",
      }),
      stats
        ? statsService.summary(f, scopeAccount.value?.id)
        : Promise.resolve(summary.value),
      stats
        ? statsService.categories(f, "name", direction.value)
        : Promise.resolve(categoryTotals.value),
      stats
        ? loadDaily(f)
        : Promise.resolve({ data: daily.value, error: dailyError.value }),
    ]);
    if (id !== request) return;
    error.value = "";
    refreshError.value = "";
    transactions.value = keepUnchanged(transactions.value, result.items);
    totalCount.value = result.totalCount;
    dayTotals.value = keepUnchanged(dayTotals.value, result.dayTotals ?? {});
    summary.value = keepUnchanged(summary.value, sum);
    categoryTotals.value = keepUnchanged(categoryTotals.value, cats);
    if (background && days.error) {
      refreshError.value = "图表更新失败，仍显示上次数据：" + days.error;
    } else {
      daily.value = keepUnchanged(daily.value, days.data);
      dailyError.value = days.error;
    }
  } catch (e) {
    if (id === request) {
      if (background) {
        refreshError.value =
          "更新失败，仍显示上次数据：" + (e as Error).message;
        return;
      }
      error.value = (e as Error).message;
      transactions.value = [];
      totalCount.value = 0;
      dayTotals.value = {};
      summary.value = emptySummary();
      categoryTotals.value = [];
      daily.value = {
        days: [],
        startWeekday: 0,
        weekCount: 0,
        total: 0,
        activeDays: 0,
      };
    }
  } finally {
    if (id === request) loading.value = false;
  }
}
async function initialize(background = false) {
  const id = ++request;
  try {
    if (!background) error.value = "";
    const [a, c] = await Promise.all([
      accountService.list(),
      categoryService.list(),
    ]);
    if (id !== request) return;
    accounts.value = keepUnchanged(accounts.value, a.items);
    totalBalance.value = a.totalBalance;
    categories.value = keepUnchanged(categories.value, c);
    if (queryText("cat")) {
      const cat = c.find((x) => x.id === queryText("cat"));
      if (cat)
        selectedCategories.value = keepUnchanged(selectedCategories.value, [
          cat.name,
        ]);
    }
    await month.refreshBounds();
    if (id !== request) return;
    await load(true, background);
    initialized.value = true;
  } catch (e) {
    if (id !== request) return;
    if (background) {
      refreshError.value = "更新失败，仍显示上次数据：" + (e as Error).message;
    } else {
      error.value = (e as Error).message;
      loading.value = false;
    }
  }
}
const filterKeys = [
  "account",
  "categories",
  "category",
  "types",
  "type",
  "q",
  "fields",
  "min",
  "max",
  "excluded",
  "sort",
  "range",
  "from",
  "to",
  "view",
];
const querySignature = (q: Record<string, unknown>) =>
  JSON.stringify(filterKeys.map((k) => [k, q[k] || ""]));
watch(
  () => route.query,
  () => {
    if (querySignature(route.query) === querySignature(currentQuery())) return;
    selectedAccounts.value = queryText("account").split(",").filter(Boolean);
    selectedCategories.value = queryText("category")
      ? [queryText("category")]
      : parseArray("categories");
    selectedTypes.value = (queryText("types") || queryText("type"))
      .split(",")
      .filter((v): v is TxnType =>
        ["expense", "income", "transfer"].includes(v),
      );
    keyword.value = queryText("q");
    fields.value = parseFields();
    min.value =
      queryText("min") && /^[0-9]+$/.test(queryText("min"))
        ? Number(queryText("min"))
        : null;
    max.value =
      queryText("max") && /^[0-9]+$/.test(queryText("max"))
        ? Number(queryText("max"))
        : null;
    excluded.value = queryText("excluded").split(",").filter(Boolean);
    sort.value = [
      "time-desc",
      "time-asc",
      "amount-desc",
      "amount-asc",
    ].includes(queryText("sort"))
      ? queryText("sort")
      : "time-desc";
    range.value = queryText("from")
      ? "custom"
      : ["all", "30d", "year"].includes(queryText("range"))
        ? queryText("range")
        : "month";
    customFrom.value = queryText("from") || beijingDate().slice(0, 8) + "01";
    customTo.value = queryText("to") || beijingDate();
    view.value = queryText("view") === "insights" ? "insights" : "list";
  },
);
watch(
  // Watch user-selected inputs, not category objects replaced by a refresh.
  () => JSON.stringify([currentQuery(), period.value]),
  () => {
    if (!initialized.value) return;
    clearTimeout(timer);
    request++;
    page.value = 1;
    loading.value = true;
    void router.replace({
      query: {
        ...Object.fromEntries(
          Object.entries(route.query).filter(([k]) => !filterKeys.includes(k)),
        ),
        ...currentQuery(),
      },
    });
    timer = setTimeout(() => void load(), 180);
  },
);
function selectScope(id: string) {
  selectedAccounts.value = id ? [id] : [];
  selectedCategories.value = [];
  excluded.value = [];
  range.value =
    accounts.value.find((a) => a.id === id)?.kind === "project"
      ? "all"
      : "month";
}
function changePage(value: number) {
  if (loading.value) return;
  page.value = value;
  void load(false);
}
function changePageSize(value: number) {
  if (loading.value || ![10, 20, 50, 100].includes(value)) return;
  pageSize.value = value;
  page.value = 1;
  void load(false);
}
const selected = ref<Transaction | null>(null);
const detail = ref<HTMLDialogElement | null>(null);
const sync = ref<Transaction | null>(null);
function openDetail(t: Transaction) {
  selected.value = t;
  void nextTick(() => detail.value?.showModal());
}
function closeDetail() {
  detail.value?.close();
  selected.value = null;
}
function excludeTxn() {
  if (selected.value) excluded.value = [...excluded.value, selected.value.id];
  closeDetail();
}
function openSync() {
  sync.value = selected.value;
  detail.value?.close();
}
async function finishSync(url?: string) {
  sync.value = null;
  if (url) {
    await nextTick();
    window.location.assign(url);
  } else if (selected.value) {
    await nextTick();
    detail.value?.showModal();
  }
}
useSaveGuard(computed(() => sync.value !== null));
const isSheet = computed(() => route.name !== "transactions");
const sheetTitle = computed(
  () =>
    ({
      accounts: "账户与分类",
      add: "记一笔",
      batch: "批量记账",
      "txn-edit": "编辑交易",
    })[String(route.name)] || "",
);
const sheetElement = ref<HTMLElement | null>(null);
let previousFocus: HTMLElement | null = null;
function navigate(path: string, extra: Record<string, string> = {}) {
  closeDetail();
  void router.push({
    path: "/transactions/" + path,
    query: { ...currentQuery(), ...extra },
  });
}
function closeSheet() {
  void router.push({ path: "/transactions", query: currentQuery() });
}
watch(isSheet, async (open) => {
  if (open) {
    previousFocus = document.activeElement as HTMLElement;
    await nextTick();
    if (!sheetElement.value?.contains(document.activeElement))
      sheetElement.value
        ?.querySelector<HTMLButtonElement>(".sheet-close")
        ?.focus();
  } else {
    await initialize();
    await nextTick();
    previousFocus?.focus();
  }
});
function trapSheet(e: KeyboardEvent) {
  if (e.defaultPrevented) return;
  if (e.key === "Escape") {
    e.preventDefault();
    e.stopPropagation();
    closeSheet();
  }
  if (e.key !== "Tab") return;
  const elements = Array.from(
    sheetElement.value?.querySelectorAll<HTMLElement>(
      'button:not(:disabled),a[href],input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex="0"]',
    ) || [],
  ).filter((el) => el.offsetParent !== null);
  const first = elements[0],
    last = elements.at(-1);
  if (e.shiftKey && document.activeElement === first) {
    last?.focus();
    e.preventDefault();
  } else if (!e.shiftKey && document.activeElement === last) {
    first?.focus();
    e.preventDefault();
  }
}
function globalKey(e: KeyboardEvent) {
  if (
    e.defaultPrevented ||
    e.isComposing ||
    connectionUnavailable.value ||
    isSheet.value ||
    document.querySelector("dialog[open]")
  )
    return;
  if (e.altKey && !e.ctrlKey && !e.metaKey && e.code === "KeyN") {
    e.preventDefault();
    navigate("add");
    return;
  }
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.key === "Tab") {
    e.preventDefault();
    e.stopPropagation();
    view.value = view.value === "list" ? "insights" : "list";
    // Switch the view without moving focus through the page's controls.
    (document.activeElement as HTMLElement | null)?.blur();
    return;
  }
  const target = e.target as HTMLElement | null;
  const editing =
    target?.closest("input,textarea") || target?.isContentEditable;
  if (!e.shiftKey && ["ArrowLeft", "ArrowRight"].includes(e.key) && !editing) {
    e.preventDefault();
    e.stopPropagation();
    if (range.value === "month") {
      if (e.key === "ArrowLeft") month.prevMonth();
      else month.nextMonth();
    }
    return;
  }
  if (e.key === "/" && !editing && !target?.closest("select")) {
    e.preventDefault();
    document.querySelector<HTMLInputElement>("#workspace-search")?.focus();
  }
}
function displayAmount(t: Transaction) {
  if (t.type === "transfer" && scopeAccount.value)
    return (
      (t.toAccountId === scopeAccount.value.id ? "+" : "−") + money(t.amount)
    );
  return txnAmount(t);
}
const accountName = (id: string | null) =>
  accounts.value.find((a) => a.id === id)?.name || "未知账户";
const categoryById = computed(
  () => new Map(categories.value.map((c) => [c.id, c])),
);
const categoryName = (id: string | null) =>
  categoryById.value.get(id ?? "")?.name || "未分类";
function categoryStyle(id: string | null) {
  const category = categoryById.value.get(id ?? "");
  return category ? { "--category-color": color(category.color) } : undefined;
}
const txnTitle = (t: Transaction) =>
  t.title || (t.type === "transfer" ? "账户转账" : categoryName(t.categoryId));
const groups = computed(() => {
  const result: { date: string; items: Transaction[] }[] = [];
  for (const t of transactions.value) {
    let group = result.at(-1);
    if (!group || group.date !== t.date) {
      group = { date: t.date, items: [] };
      result.push(group);
    }
    group.items.push(t);
  }
  return result;
});
const recent = ref<string[]>([]);
function rememberSearch() {
  const k = keyword.value.trim();
  if (!k) return;
  recent.value = [k, ...recent.value.filter((v) => v !== k)].slice(0, 8);
  try {
    localStorage.setItem("search:recent", JSON.stringify(recent.value));
  } catch {}
}
function clearRecent() {
  recent.value = [];
  try {
    localStorage.removeItem("search:recent");
  } catch {}
}
function toggleField(v: SearchField) {
  if (fields.value.includes(v)) {
    if (fields.value.length > 1)
      fields.value = fields.value.filter((f) => f !== v);
  } else
    fields.value = allSearchFields.filter(
      (f) => f === v || fields.value.includes(f),
    );
}
function drilldown(name: string) {
  selectedCategories.value = [name];
  selectedTypes.value = [direction.value];
  view.value = "list";
}
const checking = ref(false);
async function reconnect() {
  checking.value = true;
  try {
    await ledgerInfo();
    connectionUnavailable.value = false;
    window.dispatchEvent(new Event("ledger-reload"));
  } catch {
    connectionUnavailable.value = true;
  } finally {
    checking.value = false;
  }
}
function offline() {
  connectionUnavailable.value = true;
}
async function refreshOnReturn() {
  if (
    isSheet.value ||
    selected.value ||
    sync.value ||
    loading.value ||
    connectionUnavailable.value
  )
    return;
  await initialize(initialized.value);
}
usePageRefresh(refreshOnReturn);
onMounted(() => {
  if (isSheet.value)
    void nextTick(() =>
      sheetElement.value
        ?.querySelector<HTMLButtonElement>(".sheet-close")
        ?.focus(),
    );
  try {
    const value = JSON.parse(localStorage.getItem("search:recent") || "[]");
    if (Array.isArray(value))
      recent.value = value.filter((v) => typeof v === "string").slice(0, 8);
  } catch {}
  void initialize();
  window.addEventListener("keydown", globalKey, true);
  window.addEventListener("offline", offline);
});
onUnmounted(() => {
  request++;
  clearTimeout(timer);
  window.removeEventListener("keydown", globalKey, true);
  window.removeEventListener("offline", offline);
});
</script>
<template>
  <div class="workspace">
    <div
      class="workspace workspace-shell"
      :inert="isSheet || connectionUnavailable || undefined"
    >
      <header class="appbar">
        <RouterLink class="wordmark" to="/transactions"
          ><img
            class="wordmark-symbol"
            :src="brandIcon"
            width="34"
            height="34"
            alt=""
          />ledger</RouterLink
        >
        <span class="appbar-label">个人账本</span>
        <select
          class="scope-mobile"
          aria-label="选择账户范围"
          :value="scopeAccount?.id || ''"
          @change="selectScope(($event.target as HTMLSelectElement).value)"
        >
          <option value="">日常账本</option>
          <option v-for="a in accounts" :value="a.id" :key="a.id">
            {{ a.name }}{{ a.kind === "project" ? " · 专项" : "" }}
          </option>
        </select>
        <div class="appbar-actions">
          <WorkspaceMenu @manage="navigate('manage')" />
          <span class="cloud-state"><i />已连接</span
          ><button class="btn btn-ghost" @click="navigate('manage')">
            <AppIcon name="accounts" />管理账户</button
          ><button class="btn btn-ghost" @click="navigate('batch')">
            <AppIcon name="batch" />批量录入</button
          ><button
            class="btn btn-primary desktop-create"
            @click="navigate('add')"
          >
            <AppIcon name="plus" />记一笔
          </button>
        </div>
      </header>
      <div class="workspace-body">
        <aside class="account-rail" aria-label="账户范围">
          <div class="balance-card">
            <div class="rail-head">
              <span><AppIcon name="accounts" :size="15" />账户总额</span
              ><span>CNY</span>
            </div>
            <span class="rail-total num">{{ money(totalBalance) }}</span>
            <span class="balance-caption">让每一笔，都心中有数</span>
          </div>
          <button
            class="scope-all"
            :class="{ on: !selectedAccounts.length }"
            @click="selectScope('')"
          >
            <AppIcon name="ledger" :size="17" />日常账本
          </button>
          <template v-for="kind in ['normal', 'project']" :key="kind"
            ><div class="rail-label">
              <span>{{ kind === "normal" ? "我的账户" : "专项账本" }}</span
              ><button
                :aria-label="kind === 'normal' ? '新建账户' : '新建专项账户'"
                @click="navigate('manage', { create: kind })"
              >
                <AppIcon name="plus" :size="13" />
              </button>
            </div>
            <button
              v-for="a in accounts.filter((a) => a.kind === kind)"
              :key="a.id"
              class="scope-account"
              :class="{ on: selectedAccounts.includes(a.id) }"
              @click="selectScope(a.id)"
            >
              <i
                class="account-mark"
                :style="{ background: color(a.color) }"
              /><span
                ><strong>{{ a.name }}</strong
                ><small v-if="a.archivedAt">已归档</small></span
              ><span class="num">{{ money(a.balance) }}</span>
            </button>
          </template>
          <div v-if="initialized && !accounts.length" class="empty">
            <p>从第一个账户开始</p>
            <button
              class="btn btn-secondary"
              @click="navigate('manage', { create: 'normal' })"
            >
              创建账户
            </button>
          </div>
          <div class="rail-footer">
            日常账本汇总普通账户。<br />选择专项可查看其独立收支。
          </div>
        </aside>
        <main class="work-area">
          <div class="mobile-total">
            <span>账户总额</span><b class="num">{{ money(totalBalance) }}</b
            ><small>CNY</small>
          </div>
          <div class="work-heading">
            <div>
              <h1>{{ scopeName }}</h1>
              <p
                :class="{
                  'project-description': scopeAccount?.kind === 'project',
                }"
              >
                {{
                  scopeAccount?.kind === "project"
                    ? scopePeriod +
                      (scopeAccount.archivedAt ? " · 已归档" : " · 进行中")
                    : "日常的点滴，生活的账迹。"
                }}
              </p>
            </div>
            <div class="period-controls">
              <select
                v-model="range"
                class="range-select"
                aria-label="时间范围"
              >
                <option value="month">按月</option>
                <option value="30d">近 30 天</option>
                <option value="year">本年</option>
                <option value="all">全部时间</option>
                <option value="custom">自定义</option></select
              ><MonthSwitch v-if="range === 'month'" />
              <div v-if="range === 'custom'" class="custom-range">
                <input
                  class="input"
                  type="date"
                  v-model="customFrom"
                  aria-label="起始日期"
                /><span>—</span
                ><input
                  class="input"
                  type="date"
                  v-model="customTo"
                  aria-label="结束日期"
                />
              </div>
              <span v-if="scopeAccount" class="scope-balance"
                >余额 <b class="num">{{ money(scopeAccount.balance) }}</b></span
              >
            </div>
          </div>
          <LoadError :message="error" @retry="initialize()" />
          <LoadError :message="refreshError" @retry="refreshOnReturn()" />
          <PageSkeleton v-if="!initialized && loading" label="账本" />
          <template v-else>
            <dl class="work-metrics">
              <div class="metric-expense">
                <dt>
                  <span>{{ scopeAccount ? "流出" : "支出" }}</span
                  ><AppIcon name="expense" :size="15" />
                </dt>
                <dd class="num">
                  {{ money(scopeAccount ? summary.outflow : summary.expense) }}
                </dd>
                <small>{{ summary.expenseCount }} 笔支出</small>
              </div>
              <div class="metric-income">
                <dt>
                  <span>{{ scopeAccount ? "流入" : "收入" }}</span
                  ><AppIcon name="income" :size="15" />
                </dt>
                <dd class="num">
                  {{ money(scopeAccount ? summary.inflow : summary.income) }}
                </dd>
                <small>{{ summary.incomeCount }} 笔收入</small>
              </div>
              <div class="metric-net">
                <dt>
                  <span>{{ scopeAccount ? "净流入" : "收支净额" }}</span
                  ><AppIcon name="reports" :size="15" />
                </dt>
                <dd
                  class="num net-number"
                  :class="
                    (scopeAccount
                      ? summary.inflow - summary.outflow
                      : summary.net) >= 0
                      ? 'pos'
                      : 'neg'
                  "
                >
                  {{
                    money(
                      scopeAccount
                        ? summary.inflow - summary.outflow
                        : summary.net,
                      true,
                    )
                  }}
                </dd>
                <small>{{
                  scopeAccount ? "包含转入与转出" : "转账不计入收支"
                }}</small>
              </div>
              <div class="metric-annual">
                <dt>
                  <span>折合全年支出</span
                  ><AppIcon name="calendar" :size="15" />
                </dt>
                <dd class="num">
                  {{
                    summary.annual.amount === null
                      ? "—"
                      : money(summary.annual.amount)
                  }}
                </dd>
                <small>{{
                  summary.annual.amount === null
                    ? "支出样本不足以折算"
                    : "基于 " + summary.annual.spanDays + " 天的支出"
                }}</small>
              </div>
            </dl>
            <section class="ledger-content" aria-label="收支记录与分析">
              <div class="data-tools">
                <div
                  class="view-tabs"
                  role="tablist"
                  aria-label="账本视图"
                  :class="{ 'show-insights': view === 'insights' }"
                >
                  <button
                    id="list-tab"
                    role="tab"
                    aria-controls="ledger-view"
                    tabindex="-1"
                    :aria-selected="view === 'list'"
                    :class="{ on: view === 'list' }"
                    @click="view = 'list'"
                  >
                    <AppIcon name="ledger" :size="15" />明细</button
                  ><button
                    id="insights-tab"
                    role="tab"
                    aria-controls="ledger-view"
                    tabindex="-1"
                    :aria-selected="view === 'insights'"
                    :class="{ on: view === 'insights' }"
                    @click="view = 'insights'"
                  >
                    <AppIcon name="reports" :size="15" />洞察
                  </button>
                </div>
                <div class="tool-search">
                  <AppIcon name="search" :size="15" /><input
                    id="workspace-search"
                    v-model="keyword"
                    aria-label="搜索交易"
                    placeholder="搜索标题、备注或分类"
                    @keydown.enter="rememberSearch"
                    @blur="rememberSearch"
                  /><button
                    v-if="keyword"
                    class="icon-btn"
                    aria-label="清除搜索"
                    @click="keyword = ''"
                  >
                    <AppIcon name="close" :size="13" /></button
                  ><kbd v-else class="kbd">/</kbd>
                </div>
                <button
                  class="btn btn-ghost"
                  :class="{ 'filter-active': filtersOpen }"
                  :aria-expanded="filtersOpen"
                  @click="filtersOpen = !filtersOpen"
                >
                  <AppIcon name="filter" :size="15" />筛选<span
                    v-if="
                      selectedTypes.length +
                      selectedCategories.length +
                      (min !== null || max !== null ? 1 : 0)
                    "
                    >·
                    {{
                      selectedTypes.length +
                      selectedCategories.length +
                      (min !== null || max !== null ? 1 : 0)
                    }}</span
                  >
                </button>
              </div>
              <Transition name="filter-reveal">
                <div v-if="filtersOpen" class="filter-reveal">
                  <div class="filter-content">
                    <FilterPanel
                      :accounts="accounts"
                      :categories="uniqueCategories"
                      v-model:types="selectedTypes"
                      v-model:accountIds="selectedAccounts"
                      v-model:categoryNames="selectedCategories"
                      v-model:min="min"
                      v-model:max="max"
                      allow-transfer
                      always-open
                    />
                    <div class="search-settings">
                      搜索范围
                      <label
                        v-for="f in allSearchFields"
                        :key="f"
                        ><input
                          type="checkbox"
                          :checked="fields.includes(f)"
                          :disabled="fields.length === 1 && fields.includes(f)"
                          @change="toggleField(f)"
                        />{{ searchFieldLabels[f] }}</label
                      >
                    </div>
                    <div v-if="recent.length" class="recent-search">
                      <span>最近搜索</span
                      ><button
                        v-for="k in recent"
                        :key="k"
                        @click="keyword = k"
                      >
                        {{ k }}</button
                      ><button @click="clearRecent">清空</button>
                    </div>
                  </div>
                </div>
              </Transition>
              <div class="result-toolbar">
                <span
                  >{{ totalCount }} 笔交易<span
                    v-if="selectedCategories.length"
                  >
                    · {{ selectedCategories.join("、") }}</span
                  ><span v-if="keyword"> · “{{ keyword }}”</span></span
                ><button
                  v-if="excluded.length"
                  class="text-button"
                  @click="excluded = []"
                >
                  恢复 {{ excluded.length }} 笔排除</button
                ><select
                  v-if="view === 'list'"
                  v-model="sort"
                  aria-label="展示排序"
                >
                  <option value="time-desc">时间 · 从新到旧</option>
                  <option value="time-asc">时间 · 从旧到新</option>
                  <option value="amount-desc">金额 · 从高到低</option>
                  <option value="amount-asc">金额 · 从低到高</option>
                </select>
              </div>
              <div
                :key="view"
                ref="resultView"
                id="ledger-view"
                class="view-content"
                :style="
                  pendingResultHeight
                    ? { minHeight: pendingResultHeight + 'px' }
                    : undefined
                "
                role="tabpanel"
                :aria-labelledby="view === 'list' ? 'list-tab' : 'insights-tab'"
                :aria-busy="loading"
              >
                <PageSkeleton v-if="loading" label="筛选结果" compact />
                <template v-else-if="view === 'list'"
                  ><div v-if="!transactions.length && !error" class="empty">
                    <span class="empty-icon"
                      ><AppIcon name="ledger" :size="27"
                    /></span>
                    <strong>当前条件下没有交易</strong>
                    <p>调整账户、日期或筛选，或者记录第一笔。</p>
                    <button class="btn btn-primary" @click="navigate('add')">
                      记一笔
                    </button>
                  </div>
                  <div v-else class="transaction-table">
                    <div class="table-head">
                      <span>交易</span><span>账户</span><span>分类</span
                      ><span>金额 / CNY</span><span />
                    </div>
                    <template
                      v-for="(group, index) in groups"
                      :key="group.date + index"
                      ><div class="day-divider">
                        <strong>{{ dayLabel(group.date) }}</strong
                        ><span
                          >支 {{ money(dayTotals[group.date]?.expense || 0) }} ·
                          收
                          {{ money(dayTotals[group.date]?.income || 0) }}</span
                        >
                      </div>
                      <div
                        v-for="t in group.items"
                        :key="t.id"
                        class="transaction-line"
                        :class="{
                          selected: selected?.id === t.id,
                          'has-category':
                            t.type !== 'transfer' &&
                            categoryById.has(t.categoryId ?? ''),
                        }"
                        :style="
                          t.type !== 'transfer'
                            ? categoryStyle(t.categoryId)
                            : undefined
                        "
                        tabindex="0"
                        role="button"
                        :aria-label="txnTitle(t) + ' ' + displayAmount(t)"
                        @click="openDetail(t)"
                        @keydown.enter="openDetail(t)"
                        @keydown.space.prevent="openDetail(t)"
                      >
                        <div class="transaction-subject">
                          <span class="type-icon" :class="t.type"
                            ><AppIcon :name="t.type" :size="14" /></span
                          ><span
                            ><strong
                              ><HighlightText
                                :text="txnTitle(t)"
                                :keyword="keyword" /></strong
                            ><small class="transaction-note">{{
                              t.note || typeName(t.type)
                            }}</small
                            ><small class="transaction-mobile-meta"
                              >{{ accountName(t.accountId) }} ·
                              <span v-if="t.type === 'transfer'"
                                >→ {{ accountName(t.toAccountId) }}</span
                              >
                              <span v-else class="category-label">{{
                                categoryName(t.categoryId)
                              }}</span></small
                            ></span
                          >
                        </div>
                        <span class="transaction-account"
                          ><i
                            class="account-mark"
                            :style="{
                              background: color(
                                accounts.find((a) => a.id === t.accountId)
                                  ?.color || 0,
                              ),
                            }"
                          />{{ accountName(t.accountId) }}</span
                        ><span class="transaction-category"
                          ><span class="category-label">{{
                            t.type === "transfer"
                              ? "→ " + accountName(t.toAccountId)
                              : categoryName(t.categoryId)
                          }}</span></span
                        ><span
                          class="transaction-amount num"
                          :class="
                            t.type === 'expense'
                              ? 'neg'
                              : t.type === 'income'
                                ? 'pos'
                                : 'tr'
                          "
                          >{{ displayAmount(t) }}</span
                        ><button
                          class="icon-btn"
                          aria-label="编辑交易"
                          @click.stop="navigate('txn/' + t.id + '/edit')"
                          @keydown.stop
                        >
                          <AppIcon name="edit" :size="14" />
                        </button></div
                    ></template>
                  </div>
                  <div class="statement-footer">
                    <span>小计包含当日全部匹配交易</span
                    ><Pagination
                      :page="page"
                      :page-size="pageSize"
                      :total="totalCount"
                      :loading="loading"
                      @change="changePage"
                      @size-change="changePageSize"
                    /></div
                ></template>
                <InsightView
                  v-else
                  :summary="summary"
                  :daily="daily"
                  :daily-error="dailyError"
                  :categories="categoryTotals"
                  :filter="filter"
                  v-model:direction="direction"
                  @drilldown="drilldown"
                />
              </div>
            </section>
          </template>
        </main>
      </div>
      <button class="mobile-create" @click="navigate('add')">
        <AppIcon name="plus" :size="17" />记一笔
      </button>
    </div>
    <Transition name="scrim">
      <div v-if="isSheet" class="sheet-scrim" @click="closeSheet" />
    </Transition>
    <Transition name="sheet">
      <section
        v-if="isSheet"
        ref="sheetElement"
        :inert="connectionUnavailable || undefined"
        class="workspace-sheet"
        :class="{ wide: route.name === 'batch' || route.name === 'accounts' }"
        role="dialog"
        aria-modal="true"
        :aria-label="sheetTitle"
        @keydown="trapSheet"
      >
        <header class="sheet-head">
          <div>
            <h2>{{ sheetTitle }}</h2>
            <small>{{ scopeName }}</small>
          </div>
          <button
            class="icon-btn sheet-close"
            aria-label="关闭面板"
            @click="closeSheet"
          >
            <AppIcon name="close" :size="19" />
          </button>
        </header>
        <div class="sheet-scroll"><RouterView /></div>
      </section>
    </Transition>
    <dialog
      ref="detail"
      class="detail-dialog"
      aria-label="交易详情"
      @cancel.prevent="closeDetail"
      @click="$event.target === detail && closeDetail()"
      @keydown.stop
    >
      <template v-if="selected"
        ><header class="detail-head">
          <h2>交易详情</h2>
          <button class="icon-btn" aria-label="关闭详情" @click="closeDetail">
            <AppIcon name="close" :size="18" />
          </button>
        </header>
        <div class="detail-amount">
          <span class="muted">{{ typeName(selected.type) }}</span
          ><strong
            class="num"
            :class="selected.type === 'expense' ? 'neg' : 'pos'"
            >{{ displayAmount(selected) }}</strong
          >
          <p>{{ txnTitle(selected) }}</p>
        </div>
        <dl class="detail-fields">
          <dt>账户</dt>
          <dd>{{ accountName(selected.accountId) }}</dd>
          <dt>{{ selected.type === "transfer" ? "转入账户" : "分类" }}</dt>
          <dd>
            <template v-if="selected.type === 'transfer'">{{
              accountName(selected.toAccountId)
            }}</template>
            <span
              v-else
              class="category-label"
              :class="{
                'has-category': categoryById.has(selected.categoryId ?? ''),
              }"
              :style="categoryStyle(selected.categoryId)"
              >{{ categoryName(selected.categoryId) }}</span
            >
          </dd>
          <dt>日期</dt>
          <dd>{{ selected.date }}</dd>
          <dt>备注</dt>
          <dd>{{ selected.note || "—" }}</dd>
        </dl>
        <footer class="detail-actions">
          <button
            class="btn btn-primary"
            @click="navigate('txn/' + selected.id + '/edit')"
          >
            <AppIcon name="edit" />编辑</button
          ><button
            class="btn btn-ghost"
            @click="navigate('add', { copy: selected.id })"
          >
            <AppIcon name="copy" />复制</button
          ><button class="btn btn-ghost" @click="excludeTxn">排除</button
          ><button
            v-if="selected.fabricWorldEligible"
            class="btn btn-secondary"
            @click="openSync"
          >
            同步至 FabricWorld
          </button>
        </footer></template
      >
    </dialog>
    <FabricWorldSync
      v-if="sync"
      :transaction-id="sync.id"
      :transaction-title="sync.title || '未命名布料'"
      return-label="否，返回详情"
      @finish="finishSync"
    />
    <div v-if="connectionUnavailable" class="connection-error" role="alert">
      <h2>无法连接服务器</h2>
      <p>恢复连接后才能查看和记账。若刚提交过交易，请先核对保存结果。</p>
      <button class="btn btn-primary" :disabled="checking" @click="reconnect">
        {{ checking ? "连接中…" : "重新连接" }}
      </button>
    </div>
  </div>
</template>

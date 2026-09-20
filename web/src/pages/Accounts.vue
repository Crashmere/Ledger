<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import {
  accountService,
  categoryService,
  AppError,
  type Account,
  type Category,
  type AccountInput,
} from "../api";
import { useSaveGuard } from "../composables/useSaveGuard";
import { money, color } from "../services/presentation";
import { beijingDate } from "../services/dates";
import { yuanToCents } from "../services/money";
import AppIcon from "../components/AppIcon.vue";
import ModalDialog from "../components/ModalDialog.vue";
import LoadError from "../components/LoadError.vue";
import PageSkeleton from "../components/PageSkeleton.vue";
const route = useRoute();
const router = useRouter();
const accounts = ref<Account[]>([]);
const categories = ref<Category[]>([]);
const selectedId = ref(
  typeof route.query.account === "string" ? route.query.account : "",
);
const loading = ref(true);
const saving = ref(false);
const error = ref("");
const notice = ref("");
const uncertain = ref(false);
const selected = computed(() =>
  accounts.value.find((a) => a.id === selectedId.value),
);
const list = computed(() =>
  categories.value.filter((c) => c.accountId === selectedId.value),
);
const editor = ref<"account" | "category" | null>(null);
const editId = ref("");
const name = ref("");
const tint = ref("#3159dc");
const initial = ref("0");
const kind = ref<"normal" | "project">("normal");
const included = ref(true);
const archived = ref(false);
const start = ref("");
const end = ref("");
const formError = ref("");
const deletion = ref<{
  type: "account" | "category";
  id: string;
  name: string;
} | null>(null);
const accountDrag = ref("");
const categoryDrag = ref("");
useSaveGuard(saving);
async function load() {
  loading.value = true;
  try {
    const [a, c] = await Promise.all([
      accountService.list(),
      categoryService.list(),
    ]);
    accounts.value = a.items;
    categories.value = c;
    if (!accounts.value.some((a) => a.id === selectedId.value))
      selectedId.value = accounts.value[0]?.id || "";
    error.value = "";
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    loading.value = false;
  }
}
function openAccount(a?: Account, project = false) {
  if (saving.value) return;
  editor.value = "account";
  editId.value = a?.id || "";
  name.value = a?.name || "";
  tint.value = a ? color(a.color) : "#3159dc";
  initial.value = a ? String(a.initialBalance / 100) : "0";
  kind.value = a?.kind || (project ? "project" : "normal");
  included.value = a?.includeInBalance ?? !project;
  archived.value = !!a?.archivedAt;
  start.value = a?.periodStart ? beijingDate(a.periodStart) : "";
  end.value = a?.periodEnd ? beijingDate(a.periodEnd) : "";
  formError.value = "";
  uncertain.value = false;
}
function openCategory(c?: Category) {
  if (saving.value) return;
  editor.value = "category";
  editId.value = c?.id || "";
  name.value = c?.name || "";
  tint.value = c ? color(c.color) : "#3159dc";
  formError.value = "";
  uncertain.value = false;
}
function fail(e: unknown) {
  uncertain.value =
    !(e instanceof AppError) ||
    ["NETWORK", "RESPONSE", "HTTP", "INTERNAL"].includes(e.code);
  formError.value = uncertain.value
    ? "保存结果未确认，请关闭面板后核对，当前内容不会重复提交。"
    : (e as Error).message;
}
async function save() {
  if (saving.value || uncertain.value) return;
  if (!name.value.trim()) {
    formError.value = "请输入名称";
    return;
  }
  let initialCents = 0;
  if (editor.value === "account") {
    try {
      if (!/^-?[0-9]+(?:[.][0-9]{1,2})?$/.test(initial.value.trim()))
        throw new Error("初始余额最多两位小数");
      initialCents = yuanToCents(initial.value);
      if (
        kind.value === "project" &&
        start.value &&
        end.value &&
        start.value > end.value
      )
        throw new Error("开始日期不能晚于结束日期");
    } catch (e) {
      formError.value = (e as Error).message;
      return;
    }
  }
  saving.value = true;
  try {
    if (editor.value === "account") {
      const input: AccountInput = {
        name: name.value.trim(),
        color: 0xff000000 + parseInt(tint.value.slice(1), 16),
        initialBalance: initialCents,
        kind: kind.value,
        includeInBalance: included.value,
        archived: archived.value,
        periodStart: start.value || null,
        periodEnd: end.value || null,
      };
      const result = editId.value
        ? await accountService.update(editId.value, input)
        : await accountService.create(input);
      selectedId.value = result.id;
    } else {
      const input = {
        name: name.value.trim(),
        color: 0xff000000 + parseInt(tint.value.slice(1), 16),
      };
      if (editId.value) await categoryService.update(editId.value, input);
      else
        await categoryService.create({ ...input, accountId: selectedId.value });
    }
    editor.value = null;
    notice.value = "已保存";
    await load();
  } catch (e) {
    if (e instanceof Error && e.message === "初始余额最多两位小数")
      formError.value = e.message;
    else fail(e);
  } finally {
    saving.value = false;
  }
}
async function remove() {
  const d = deletion.value;
  if (!d || saving.value) return;
  saving.value = true;
  try {
    if (d.type === "account") await accountService.remove(d.id);
    else await categoryService.remove(d.id);
    deletion.value = null;
    notice.value = "已删除";
    await load();
  } catch (e) {
    error.value = (e as Error).message;
    deletion.value = null;
  } finally {
    saving.value = false;
  }
}
async function reorder(
  type: "account" | "category",
  id: string,
  move?: number,
) {
  if (saving.value) return;
  const items = type === "account" ? accounts.value : list.value;
  const source =
    move === undefined
      ? type === "account"
        ? accountDrag.value
        : categoryDrag.value
      : id;
  const from = items.findIndex((x) => x.id === source),
    to = move === undefined ? items.findIndex((x) => x.id === id) : from + move;
  if (from < 0 || to < 0 || to >= items.length || from === to) return;
  const next = [...items];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  saving.value = true;
  try {
    if (type === "account") await accountService.reorder(next.map((a) => a.id));
    else
      await categoryService.reorder(
        selectedId.value,
        next.map((c) => c.id),
      );
    await load();
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    saving.value = false;
  }
}
function showLedger() {
  void router.push({
    path: "/transactions",
    query: {
      account: selectedId.value,
      ...(selected.value?.kind === "project" ? { range: "all" } : {}),
    },
  });
}
onMounted(async () => {
  await load();
  if (route.query.create)
    openAccount(undefined, route.query.create === "project");
});
</script>
<template>
  <div class="management-panel">
    <LoadError :message="error" @retry="load" /><PageSkeleton
      v-if="loading && !accounts.length"
      label="账户"
    /><template v-else
      ><div class="management-toolbar">
        <p>账户负责资金归属，分类整理每一笔用途。</p>
        <div class="row gap-2">
          <button class="btn btn-ghost" @click="openAccount(undefined, true)">
            新建专项</button
          ><button class="btn btn-primary" @click="openAccount()">
            <AppIcon name="plus" />新建账户
          </button>
        </div>
      </div>
      <div v-if="notice" class="management-notice" role="status">
        {{ notice }}
      </div>
      <div class="management-layout">
        <section class="management-accounts">
          <div class="management-label">
            全部账户 <span>{{ accounts.length }}</span>
          </div>
          <div v-if="!accounts.length" class="empty">
            还没有账户，点击上方“新建账户”开始。
          </div>
          <div
            v-for="(a, i) in accounts"
            :key="a.id"
            class="managed-account"
            :class="{ active: selectedId === a.id }"
            draggable="true"
            @dragstart="accountDrag = a.id"
            @dragover.prevent
            @drop="reorder('account', a.id)"
          >
            <button class="managed-account-select" @click="selectedId = a.id">
              <span
                class="account-avatar"
                :style="{
                  background: color(a.color) + '18',
                  color: color(a.color),
                }"
                >{{ a.name.slice(0, 1) }}</span
              ><span
                ><strong>{{ a.name }}</strong
                ><small
                  >{{ a.kind === "project" ? "专项" : "普通账户"
                  }}{{ a.archivedAt ? " · 已归档" : ""
                  }}{{ !a.includeInBalance ? " · 不计总额" : "" }}</small
                ></span
              ><b class="num">{{ money(a.balance) }}</b>
            </button>
            <div class="management-row-actions">
              <button
                class="icon-btn"
                :disabled="i === 0 || saving"
                :aria-label="'上移账户 ' + a.name"
                @click="reorder('account', a.id, -1)"
              >
                ↑</button
              ><button
                class="icon-btn"
                :disabled="i === accounts.length - 1 || saving"
                :aria-label="'下移账户 ' + a.name"
                @click="reorder('account', a.id, 1)"
              >
                ↓</button
              ><button
                class="icon-btn"
                :aria-label="'编辑账户 ' + a.name"
                @click="openAccount(a)"
              >
                <AppIcon name="edit" :size="14" />
              </button>
            </div>
          </div>
        </section>
        <section v-if="selected" class="management-categories">
          <div class="category-management-head">
            <div>
              <h3>{{ selected.name }}</h3>
              <p>{{ list.length }} 个分类 · 拖动或使用箭头排序</p>
            </div>
            <button class="btn btn-ghost btn-sm" @click="showLedger">
              查看流水 <AppIcon name="arrow" />
            </button>
          </div>
          <div class="category-management-actions">
            <span>分类</span
            ><button class="text-button" @click="openCategory()">
              ＋ 新建分类
            </button>
          </div>
          <div
            v-for="(c, i) in list"
            :key="c.id"
            class="managed-category"
            draggable="true"
            @dragstart="categoryDrag = c.id"
            @dragover.prevent
            @drop="reorder('category', c.id)"
          >
            <span
              class="account-mark"
              :style="{ background: color(c.color) }"
            /><strong>{{ c.name }}</strong
            ><button
              class="icon-btn"
              :disabled="i === 0 || saving"
              :aria-label="'上移分类 ' + c.name"
              @click="reorder('category', c.id, -1)"
            >
              ↑</button
            ><button
              class="icon-btn"
              :disabled="i === list.length - 1 || saving"
              :aria-label="'下移分类 ' + c.name"
              @click="reorder('category', c.id, 1)"
            >
              ↓</button
            ><button
              class="icon-btn"
              aria-label="编辑分类"
              @click="openCategory(c)"
            >
              <AppIcon name="edit" :size="14" /></button
            ><button
              class="icon-btn"
              aria-label="删除分类"
              @click="deletion = { type: 'category', id: c.id, name: c.name }"
            >
              <AppIcon name="close" :size="14" />
            </button>
          </div>
          <div v-if="!list.length" class="empty">
            暂无分类。未分类交易仍可正常记账。
          </div>
        </section>
      </div></template
    >
    <ModalDialog
      v-if="editor"
      :label="
        (editId ? '编辑' : '新建') + (editor === 'account' ? '账户' : '分类')
      "
      :busy="saving"
      @close="editor = null"
      ><form class="management-form" @submit.prevent="save">
        <header>
          <h3>
            {{ editId ? "编辑" : "新建"
            }}{{ editor === "account" ? "账户" : "分类" }}
          </h3>
          <button
            type="button"
            class="icon-btn"
            aria-label="关闭"
            @click="!saving && (editor = null)"
          >
            <AppIcon name="close" :size="18" />
          </button>
        </header>
        <div v-if="formError" class="form-error" role="alert">
          {{ formError }}
        </div>
        <label class="field-label" for="entity-name">名称</label
        ><input
          id="entity-name"
          v-model="name"
          class="input"
          autofocus
          required
        />
        <div class="color-field">
          <label for="entity-color">颜色</label
          ><input id="entity-color" v-model="tint" type="color" /><button
            type="button"
            class="text-button"
            @click="
              tint =
                '#' +
                Math.floor(Math.random() * 0xffffff)
                  .toString(16)
                  .padStart(6, '0')
            "
          >
            随机颜色
          </button>
        </div>
        <template v-if="editor === 'account'"
          ><label class="field-label" for="initial-balance"
            >初始余额（元）</label
          ><input
            id="initial-balance"
            v-model="initial"
            class="input"
            inputmode="decimal"
          /><label class="check-field"
            ><input v-model="included" type="checkbox" />计入账户总额</label
          ><label class="field-label" for="account-kind">账户类型</label
          ><select id="account-kind" v-model="kind" class="input">
            <option value="normal">普通账户</option>
            <option value="project">专项账户</option></select
          ><template v-if="kind === 'project'"
            ><p class="form-hint">
              专项默认独立统计，在工作台选择此账户后查看。
            </p>
            <div class="grid g-2">
              <div>
                <label class="field-label" for="project-start">开始日期</label
                ><input
                  id="project-start"
                  v-model="start"
                  type="date"
                  class="input"
                />
              </div>
              <div>
                <label class="field-label" for="project-end">结束日期</label
                ><input
                  id="project-end"
                  v-model="end"
                  type="date"
                  class="input"
                />
              </div>
            </div>
            <label class="check-field"
              ><input v-model="archived" type="checkbox" />已结束（归档）</label
            ></template
          ></template
        >
        <footer>
          <button
            v-if="editId && editor === 'account'"
            :disabled="saving"
            type="button"
            class="text-button neg"
            @click="
              deletion = { type: 'account', id: editId, name };
              editor = null;
            "
          >
            删除账户</button
          ><button
            type="button"
            class="btn btn-ghost"
            @click="!saving && (editor = null)"
          >
            取消</button
          ><button
            class="btn btn-primary"
            :disabled="saving || uncertain"
            type="submit"
          >
            {{ saving ? "正在保存…" : "保存" }}
          </button>
        </footer>
      </form></ModalDialog
    >
    <ModalDialog
      v-if="deletion"
      :label="deletion.type === 'account' ? '删除账户' : '删除分类'"
      :busy="saving"
      @close="deletion = null"
      ><div class="management-form">
        <h3>删除“{{ deletion.name }}”？</h3>
        <p class="form-hint">
          {{
            deletion.type === "account"
              ? "存在分类或交易的账户无法删除。"
              : "交易会保留，并改为未分类。"
          }}
        </p>
        <footer>
          <button class="btn btn-ghost" @click="!saving && (deletion = null)">
            取消</button
          ><button class="btn btn-danger" :disabled="saving" @click="remove">
            {{ deletion.type === "account" ? "删除账户" : "删除分类" }}
          </button>
        </footer>
      </div></ModalDialog
    >
  </div>
</template>
<style scoped>
.management-panel {
  padding: 26px;
}
.management-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  margin-bottom: 22px;
}
.management-toolbar p {
  font-size: 12px;
  color: var(--fg-3);
}
.management-layout {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 26px;
}
.management-label {
  display: flex;
  justify-content: space-between;
  color: var(--fg-2);
  font-size: 11px;
  padding: 14px 0;
  border-bottom: 1px solid var(--border);
}
.managed-account {
  border: 1px solid var(--border);
  padding: 14px;
  border-radius: 13px;
  margin-top: 10px;
  transition:
    background-color var(--duration-fast),
    border-color var(--duration-fast);
}
.managed-account.active {
  background: var(--primary-soft);
  border-color: #c6d9ca;
}
.managed-account-select {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  text-align: left;
}
.account-avatar {
  width: 34px;
  height: 34px;
  border-radius: 9px;
  display: grid;
  place-items: center;
  font-size: 15px;
  flex-shrink: 0;
}
.managed-account-select > span:nth-child(2) {
  min-width: 0;
  flex: 1;
}
.managed-account-select strong {
  font-size: 14px;
  display: block;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.managed-account-select small {
  font-size: 11px;
  color: var(--fg-3);
}
.managed-account-select b {
  font-size: 13px;
  font-weight: 500;
}
.management-row-actions {
  display: flex;
  justify-content: flex-end;
  margin-top: 6px;
}
.management-row-actions .icon-btn {
  width: 32px;
  height: 32px;
  font-size: 12px;
}
.management-categories {
  border-left: 1px solid var(--border);
  padding-left: 26px;
  min-width: 0;
}
.category-management-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  min-height: 64px;
}
.category-management-head h3 {
  font-size: 17px;
}
.category-management-head p {
  font-size: 10px;
  color: var(--fg-3);
  margin-top: 4px;
}
.category-management-actions {
  display: flex;
  justify-content: space-between;
  padding: 18px 0 12px;
  border-bottom: 1px solid var(--border);
  font-size: 11px;
  color: var(--fg-2);
}
.managed-category {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 11px 0;
  border-bottom: 1px solid var(--border);
}
.managed-category strong {
  flex: 1;
  min-width: 0;
  font-size: 13px;
  font-weight: 500;
  overflow-wrap: anywhere;
}
.managed-category .icon-btn {
  width: 32px;
  height: 32px;
  font-size: 12px;
}
.management-notice {
  font-size: 11px;
  color: var(--income);
  margin-bottom: 12px;
}
.management-form {
  padding: 25px;
}
.management-form header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 22px;
}
.management-form h3 {
  font-size: 18px;
}
.management-form .field-label {
  margin-top: 14px;
}
.color-field {
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 12px;
  margin: 16px 0;
}
.color-field input {
  width: 35px;
  height: 28px;
  border: 0;
  background: none;
}
.check-field {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  margin-top: 17px;
}
.management-form footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 25px;
  align-items: center;
}
.management-form footer > .text-button {
  margin-right: auto;
}
.form-hint {
  font-size: 11px;
  color: var(--fg-3);
  margin: 12px 0;
}
.form-error {
  font-size: 12px;
  color: var(--expense);
  background: var(--expense-soft);
  padding: 10px;
  border-radius: 6px;
}
.management-form .input {
  font-size: 13px;
}
.management-form .grid input {
  padding: 9px 6px;
}
@media (max-width: 720px) {
  .management-panel {
    padding: 18px;
  }
  .management-toolbar {
    flex-wrap: wrap;
    gap: 12px;
  }
  .management-toolbar p {
    font-size: 11px;
  }
  .management-toolbar > .row {
    width: 100%;
    justify-content: flex-end;
  }
  .management-layout {
    grid-template-columns: 1fr;
    gap: 25px;
  }
  .management-categories {
    border-left: 0;
    padding-left: 0;
  }
  .managed-account-select strong {
    font-size: 13px;
  }
  .management-form .input {
    font-size: 16px;
  }
  .management-form {
    padding: 20px;
  }
  .management-form .grid {
    grid-template-columns: 1fr;
  }
}
</style>

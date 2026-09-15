<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import ToastHost from './components/ToastHost.vue';
import MonthSwitch from './components/MonthSwitch.vue';
import { connectionUnavailable } from './api/connection';
import { ledgerInfo } from './api';

const checkingConnection = ref(false);
async function reconnect(): Promise<void> {
  if (checkingConnection.value) return;
  checkingConnection.value = true;
  try {
    await ledgerInfo();
    connectionUnavailable.value = false;
    window.dispatchEvent(new Event('ledger-reload'));
  } catch { connectionUnavailable.value = true; }
  finally { checkingConnection.value = false; }
}
function offline(): void { connectionUnavailable.value = true; }

const route = useRoute();
const router = useRouter();

function goBack(): void {
  if (window.history.length > 1) router.back();
  else void router.push('/overview');
}

function isEditableTarget(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  if (!el || typeof el.tagName !== 'string') return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}
function onGlobalKeydown(e: KeyboardEvent): void {
  if (!e.altKey || e.metaKey || e.ctrlKey || e.shiftKey) return;
  if (e.code !== 'KeyN') return;
  if (isEditableTarget(e.target)) return;
  e.preventDefault();
  if (route.name === 'add') return;
  const q =
    route.name === 'accounts' && typeof route.query.account === 'string' && route.query.account
      ? { account: route.query.account }
      : undefined;
  void router.push({ path: '/add', query: q });
}

onMounted(() => {
  window.addEventListener('offline', offline);
  window.addEventListener('keydown', onGlobalKeydown);
});
onUnmounted(() => {
  window.removeEventListener('offline', offline);
  window.removeEventListener('keydown', onGlobalKeydown);
});

const pageTitle = computed(() => (route.meta.title as string | undefined) ?? '记账');
const hasMonthSwitch = computed(() => ['overview', 'accounts', 'reports', 'search'].includes(String(route.name)));

const addShortcutLabel = computed(() =>
  /Mac|iPhone|iPad|iPod/i.test(navigator.platform) ? '⌥N' : 'Alt+N',
);

const isAddRoute = computed(() => route.name === 'add' || route.name === 'txn-edit');

const navItems = [
  { to: '/overview', label: '概览' },
  { to: '/accounts', label: '账户' },
  { to: '/reports', label: '报告' },
  { to: '/search', label: '搜索' },
] as const;

const tabItems = navItems;

</script>

<template>
  <div class="app" :class="{ 'app-add-mode': isAddRoute }">

    <ToastHost />

    <aside class="sidebar">
      <div class="brand">
        <div class="brand-logo">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.2">
            <path d="M3 10h18M7 15h4" />
            <rect x="3" y="5" width="18" height="14" rx="2" />
          </svg>
        </div>
        <div>
          <div class="brand-name">记账</div>
        </div>
      </div>

      <RouterLink to="/add" class="nav-add">
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.4">
          <path d="M12 5v14M5 12h14" />
        </svg>
        记一笔
        <span class="nav-add-kbd" aria-hidden="true"><span class="kbd">{{ addShortcutLabel }}</span></span>
      </RouterLink>

      <nav class="nav-list">
        <RouterLink v-for="item in navItems" :key="item.to" :to="item.to" class="nav-item">

          <svg v-if="item.to === '/overview'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
          </svg>

          <svg v-else-if="item.to === '/accounts'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="2" y="5" width="20" height="14" rx="2" />
            <path d="M2 10h20" />
          </svg>

          <svg v-else-if="item.to === '/reports'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M3 3v18h18" />
            <path d="M18 8l-5 5-3-3-4 4" />
          </svg>

          <svg v-else-if="item.to === '/search'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="11" cy="11" r="7" />
            <path d="m21 21-4-4" />
          </svg>
          <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7" /><path d="m21 21-4-4" /></svg>
          {{ item.label }}
        </RouterLink>
      </nav>

    </aside>


    <div class="main">
      <div class="topbar">

        <button v-if="isAddRoute" class="m-back-btn" aria-label="返回" @click="goBack">
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.2">
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </button>
        <div class="page-title">{{ pageTitle }}</div>
        <MonthSwitch v-if="hasMonthSwitch" class="topbar-month" />
        <div id="topbar-slot" class="topbar-slot"></div>

        <RouterLink to="/search" class="m-search-btn" aria-label="搜索">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="11" cy="11" r="7" />
            <path d="m21 21-4-4" />
          </svg>
        </RouterLink>
      </div>
      <div v-if="connectionUnavailable" class="connection-error" role="alert">
        <h3>无法连接服务器</h3>
        <p>恢复连接后才能查看和记账。若刚提交过交易，请先核对保存结果。</p>
        <button class="btn btn-primary" :disabled="checkingConnection" @click="reconnect">{{ checkingConnection ? '连接中…' : '重新连接' }}</button>
      </div>
      <RouterView v-show="!connectionUnavailable" :key="route.path" />
    </div>


    <RouterLink to="/add" class="m-fab" aria-label="记一笔">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6">
        <path d="M12 5v14M5 12h14" />
      </svg>
    </RouterLink>
    <nav class="m-tabbar">
      <template v-for="(item, idx) in tabItems" :key="item.to">
        <RouterLink :to="item.to" class="m-tab">

          <svg v-if="item.to === '/overview'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
          </svg>

          <svg v-else-if="item.to === '/accounts'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="2" y="5" width="20" height="14" rx="2" />
            <path d="M2 10h20" />
          </svg>

          <svg v-else-if="item.to === '/reports'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M3 3v18h18" />
            <path d="M18 8l-5 5-3-3-4 4" />
          </svg>
          <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7" /><path d="m21 21-4-4" /></svg>
          {{ item.label }}
        </RouterLink>

        <span v-if="idx === 1" class="m-tab-spacer" aria-hidden="true"></span>
      </template>
    </nav>
  </div>
</template>

<style scoped>
.connection-error { margin:24px; padding:24px; border-radius:16px; background:var(--surface); }
.connection-error p { margin:12px 0 20px; }
</style>

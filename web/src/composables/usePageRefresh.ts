import { onMounted, onUnmounted } from 'vue';

// 只在用户回到页面时刷新，不轮询。录入表单不使用此 hook，避免覆盖草稿。
export function usePageRefresh(refresh: () => void | Promise<void>): void {
  const run = () => { if (document.visibilityState === 'visible') void refresh(); };
  onMounted(() => {
    window.addEventListener('focus', run);
    window.addEventListener('ledger-reload', run);
  });
  onUnmounted(() => {
    window.removeEventListener('focus', run);
    window.removeEventListener('ledger-reload', run);
  });
}

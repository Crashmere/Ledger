import { onMounted, onUnmounted } from "vue";

// 只在用户回到页面时刷新，不轮询。录入表单不使用此 hook，避免覆盖草稿。
export function usePageRefresh(refresh: () => void | Promise<void>): void {
  let pending = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const run = async () => {
    if (pending || document.visibilityState !== "visible") return;
    pending = true;
    try {
      await refresh();
    } finally {
      pending = false;
    }
  };
  // Browsers can emit focus and visibilitychange together when a tab returns.
  const schedule = () => {
    clearTimeout(timer);
    if (!pending && document.visibilityState === "visible")
      timer = setTimeout(() => void run(), 60);
  };
  onMounted(() => {
    window.addEventListener("focus", schedule);
    document.addEventListener("visibilitychange", schedule);
    window.addEventListener("ledger-reload", schedule);
  });
  onUnmounted(() => {
    clearTimeout(timer);
    window.removeEventListener("focus", schedule);
    document.removeEventListener("visibilitychange", schedule);
    window.removeEventListener("ledger-reload", schedule);
  });
}

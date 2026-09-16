import { onMounted, onUnmounted, type Ref } from 'vue';
import { onBeforeRouteLeave, onBeforeRouteUpdate } from 'vue-router';

/** 保存期间锁住站内导航，并对刷新/关闭页面触发浏览器离开提示。 */
export function useSaveGuard(saving: Ref<boolean>): void {
  const allowLeave = () => !saving.value;
  const beforeUnload = (event: BeforeUnloadEvent) => {
    if (!saving.value) return;
    event.preventDefault();
    event.returnValue = '';
  };
  onBeforeRouteLeave(allowLeave);
  onBeforeRouteUpdate(allowLeave);
  onMounted(() => window.addEventListener('beforeunload', beforeUnload));
  onUnmounted(() => window.removeEventListener('beforeunload', beforeUnload));
}

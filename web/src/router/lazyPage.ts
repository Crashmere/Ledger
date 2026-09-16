import { defineAsyncComponent, defineComponent, h, type Component } from 'vue';
import PageSkeleton from '../components/PageSkeleton.vue';

// 路由先提交，页面模块在组件内加载；首次慢网点击也立即更新标题和导航。
export function lazyPage(loader: () => Promise<{ default: Component }>, label: string, form = false): Component {
  const page = defineAsyncComponent({
    loader,
    delay: 0,
    loadingComponent: () => h(PageSkeleton, { class: 'content', label, form }),
    errorComponent: () => h('div', { class: 'content', role: 'alert' }, [
      h('p', '页面加载失败，请检查网络后重新加载。'),
      h('button', { class: 'btn btn-primary mt-3', onClick: () => window.location.reload() }, '重新加载页面'),
    ]),
  });
  return defineComponent({ setup: () => () => h(page) });
}

import { expect, it, vi } from 'vitest';
import { createMemoryHistory, createRouter } from 'vue-router';
import { lazyPage } from '../src/router/lazyPage';

it('页面模块尚未下载也立即完成路由切换', async () => {
  const loader = vi.fn(() => new Promise<{ default: object }>(() => {}));
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/accounts', name: 'accounts', component: lazyPage(loader, '账户') }],
  });

  await router.push('/accounts');

  expect(router.currentRoute.value.name).toBe('accounts');
  // 下载由组件挂载接手，路由本身不会等待网络。
  expect(loader).not.toHaveBeenCalled();
});

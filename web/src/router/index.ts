import { createRouter, createWebHistory } from 'vue-router';
import { lazyPage } from './lazyPage';
export const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    { path: '/', redirect: '/overview' },
    { path: '/overview', name: 'overview', component: lazyPage(() => import('../pages/Overview.vue'), '概览'), meta: { title: '概览' } },
    { path: '/accounts', name: 'accounts', component: lazyPage(() => import('../pages/Accounts.vue'), '账户'), meta: { title: '账户' } },
    { path: '/reports', name: 'reports', component: lazyPage(() => import('../pages/Reports.vue'), '报告'), meta: { title: '报告' } },
    { path: '/search', name: 'search', component: lazyPage(() => import('../pages/Search.vue'), '搜索'), meta: { title: '搜索' } },
    { path: '/add', name: 'add', component: lazyPage(() => import('../pages/AddTxn.vue'), '记一笔', true), meta: { title: '记一笔' } },
    { path: '/txn/:id/edit', name: 'txn-edit', component: lazyPage(() => import('../pages/AddTxn.vue'), '编辑交易', true), meta: { title: '编辑交易' } },
    { path: '/batch', name: 'batch', component: lazyPage(() => import('../pages/BatchImport.vue'), '批量记账', true), meta: { title: '批量记账' } },
    { path: '/:pathMatch(.*)*', redirect: '/overview' },
  ],
  scrollBehavior: () => ({ top: 0 }),
});

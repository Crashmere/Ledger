import { createRouter, createWebHistory } from 'vue-router';
export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', redirect: '/overview' },
    { path: '/overview', name: 'overview', component: () => import('../pages/Overview.vue'), meta: { title: '概览' } },
    { path: '/accounts', name: 'accounts', component: () => import('../pages/Accounts.vue'), meta: { title: '账户' } },
    { path: '/reports', name: 'reports', component: () => import('../pages/Reports.vue'), meta: { title: '报告' } },
    { path: '/search', name: 'search', component: () => import('../pages/Search.vue'), meta: { title: '搜索' } },
    { path: '/add', name: 'add', component: () => import('../pages/AddTxn.vue'), meta: { title: '记一笔' } },
    { path: '/txn/:id/edit', name: 'txn-edit', component: () => import('../pages/AddTxn.vue'), meta: { title: '编辑交易' } },
    { path: '/batch', name: 'batch', component: () => import('../pages/BatchImport.vue'), meta: { title: '批量记账' } },
    { path: '/:pathMatch(.*)*', redirect: '/overview' },
  ],
  scrollBehavior: () => ({ top: 0 }),
});

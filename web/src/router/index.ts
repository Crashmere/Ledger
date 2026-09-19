import { createRouter, createWebHistory } from "vue-router";
import { lazyPage } from "./lazyPage";
export const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    { path: "/", redirect: "/transactions" },
    {
      path: "/overview",
      redirect: (to) => ({ path: "/transactions", query: to.query }),
    },
    {
      path: "/search",
      redirect: (to) => ({
        path: "/transactions",
        query: { ...to.query, range: "all" },
      }),
    },
    {
      path: "/reports",
      redirect: (to) => ({
        path: "/transactions",
        query: { ...to.query, view: "insights" },
      }),
    },
    {
      path: "/accounts",
      redirect: (to) => ({ path: "/transactions/manage", query: to.query }),
    },
    {
      path: "/add",
      redirect: (to) => ({ path: "/transactions/add", query: to.query }),
    },
    {
      path: "/batch",
      redirect: (to) => ({ path: "/transactions/batch", query: to.query }),
    },
    {
      path: "/txn/:id/edit",
      redirect: (to) => ({
        path: "/transactions/txn/" + to.params.id + "/edit",
        query: to.query,
      }),
    },
    {
      path: "/transactions",
      name: "transactions",
      component: lazyPage(() => import("../pages/Workspace.vue"), "账本"),
      children: [
        {
          path: "manage",
          name: "accounts",
          component: lazyPage(
            () => import("../pages/Accounts.vue"),
            "账户与分类",
          ),
        },
        {
          path: "add",
          name: "add",
          component: lazyPage(
            () => import("../pages/AddTxn.vue"),
            "记一笔",
            true,
          ),
        },
        {
          path: "batch",
          name: "batch",
          component: lazyPage(
            () => import("../pages/BatchImport.vue"),
            "批量记账",
            true,
          ),
        },
        {
          path: "txn/:id/edit",
          name: "txn-edit",
          component: lazyPage(
            () => import("../pages/AddTxn.vue"),
            "编辑交易",
            true,
          ),
        },
      ],
    },
    { path: "/:pathMatch(.*)*", redirect: "/transactions" },
  ],
});

import { defineConfig, loadEnv } from "vite";
import vue from "@vitejs/plugin-vue";

export default defineConfig(({ mode }) => {
  const base = loadEnv(mode, '.', '').VITE_BASE_PATH || '/';
  if (!new RegExp('^/(?:[a-zA-Z0-9_-]+/)*$').test(base)) {
    throw new Error('VITE_BASE_PATH 必须为 / 或 /ledger/ 这样的绝对目录路径');
  }
  return {
    base,
    plugins: [vue()],
    server: { proxy: { [base + 'api']: {
      target: 'http://127.0.0.1:8080',
      rewrite: (path: string) => '/' + path.slice(base.length),
    } } },
  };
});

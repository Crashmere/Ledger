import { ref } from 'vue';
// 只描述连接状态；不缓存账目，也不安排写请求重试。
export const connectionUnavailable = ref(!navigator.onLine);

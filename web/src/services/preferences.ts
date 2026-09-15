// 浏览器仅保存界面偏好，不存账目或待发送的写操作。
export function readPreference(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}
export function savePreference(key: string, value: string): void {
  try { localStorage.setItem(key, value); } catch { /* 不影响记账 */ }
}

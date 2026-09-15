import { connectionUnavailable } from './connection';

export class AppError extends Error {
  constructor(public code: string, message: string) { super(message); }
}

// 写请求只发送一次；连接中断时无法判断服务器是否已经保存。
export async function request<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const readOnly = method === 'GET' || path.endsWith('/query') || path.includes('/statistics/') || path.endsWith('/preview');
  if (!readOnly && connectionUnavailable.value) throw new AppError('NETWORK', '请先恢复连接并核对账目，再提交。');
  let response: Response;
  try {
    response = await fetch(import.meta.env.BASE_URL + 'api' + path, {
      method, cache: 'no-store',
      headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    connectionUnavailable.value = true;
    throw new AppError('NETWORK', readOnly
      ? '无法连接服务器，请检查网络后重试。'
      : '未收到服务器确认，请先查看账目核对结果，再决定是否重试。');
  }
  let data;
  try { data = await response.json(); }
  catch { throw new AppError('RESPONSE', readOnly ? '服务器返回了无效响应。' : '服务器响应异常，请先核对保存结果。'); }
  if (!response.ok) throw new AppError(data.error?.code ?? 'HTTP', data.error?.message ?? '请求失败');
  return data as T;
}

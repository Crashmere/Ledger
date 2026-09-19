import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { request } from '../src/api/client';
import { connectionUnavailable } from '../src/api/connection';

// Node 没有浏览器的联网状态，每个用例显式从已连接开始。
beforeEach(() => { connectionUnavailable.value = false; });

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  connectionUnavailable.value = false;
});

describe('API 部署路径', () => {
  it('同步失败后可手动重试，普通记账仍禁止盲目重试', async () => {
    connectionUnavailable.value = true;
    const fetcher = vi.fn().mockRejectedValueOnce(new TypeError('offline')).mockResolvedValueOnce(new Response('{}'));
    vi.stubGlobal('fetch', fetcher);
    await expect(request('/transactions/id/fabricworld', 'POST', {}, { retrySafe: true })).rejects.toThrow();
    await expect(request('/transactions', 'POST', {})).rejects.toThrow();
    await expect(request('/transactions/id/fabricworld', 'POST', {}, { retrySafe: true })).resolves.toEqual({});
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  for (const base of ['/', '/ledger/']) {
    it(`${base} 下的读写都使用相同前缀`, async () => {
      vi.stubEnv('BASE_URL', base);
      const fetcher = vi.fn(async () => new Response('{}', { status: 200 }));
      vi.stubGlobal('fetch', fetcher);
      await request('/accounts');
      await request('/transactions', 'POST', { title: '合成测试' });
      expect(fetcher).toHaveBeenNthCalledWith(1, base + 'api/accounts', expect.objectContaining({ method: 'GET', cache: 'no-store' }));
      expect(fetcher).toHaveBeenNthCalledWith(2, base + 'api/transactions', expect.objectContaining({ method: 'POST' }));
    });
  }
  it('网络失败的写请求不自动重试', async () => {
    vi.stubEnv('BASE_URL', '/ledger/');
    const fetcher = vi.fn().mockRejectedValue(new TypeError('offline'));
    vi.stubGlobal('fetch', fetcher);
    await expect(request('/transactions', 'POST', {})).rejects.toThrow('未收到服务器确认');
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(connectionUnavailable.value).toBe(true);
  });
  it('等待完整的保存响应才返回成功', async () => {
    let confirm!: (response: Response) => void;
    const fetcher = vi.fn(() => new Promise<Response>(resolve => { confirm = resolve; }));
    vi.stubGlobal('fetch', fetcher);
    const saved = vi.fn();
    const pending = request('/transactions', 'POST', {}).then(saved);
    await Promise.resolve();
    expect(saved).not.toHaveBeenCalled();
    confirm(new Response(JSON.stringify({ id: 'synthetic-transaction' })));
    await pending;
    expect(saved).toHaveBeenCalledWith({ id: 'synthetic-transaction' });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('保存响应中断不能当作成功，也不重新提交', async () => {
    const fetcher = vi.fn(async () => new Response('{', { status: 200 }));
    vi.stubGlobal('fetch', fetcher);
    await expect(request('/transactions', 'POST', {})).rejects.toMatchObject({
      code: 'RESPONSE', message: '服务器响应异常，请先核对保存结果。',
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});

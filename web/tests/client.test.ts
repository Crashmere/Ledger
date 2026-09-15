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
});

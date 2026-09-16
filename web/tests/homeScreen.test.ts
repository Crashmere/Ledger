import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const manifest = JSON.parse(readFileSync(new URL('../public/manifest.webmanifest', import.meta.url), 'utf8'));

describe('桌面入口的导航范围', () => {
  it.each(['/', '/ledger/'])('在 %s 部署时，所有页面属于同一应用范围', (base) => {
    const manifestURL = new URL(base + 'manifest.webmanifest', 'http://ledger.example');
    const scope = new URL(manifest.scope, manifestURL).pathname;
    expect(scope).toBe(base);
    expect(new URL(manifest.start_url, manifestURL).pathname).toBe(base);
    expect(new URL(manifest.id, manifestURL).pathname).toBe(base);
    for (const route of ['overview', 'accounts', 'reports', 'search', 'add', 'batch', 'txn/example/edit']) {
      expect(new URL(base + route, manifestURL).pathname.startsWith(scope)).toBe(true);
    }
    for (const icon of manifest.icons) {
      expect(new URL(icon.src, manifestURL).pathname.startsWith(scope)).toBe(true);
    }
    expect(manifest.display).toBe('standalone');
  });
});

// Run after building both sibling checkouts. All writes use fresh temporary data.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import http from 'node:http';
const root = resolve(import.meta.dirname, '..');
const fabricRoot = resolve(process.env.FABRICWORLD_CHECKOUT || resolve(root, '../FabricWorld'));
const { chromium } = createRequire(resolve(fabricRoot, 'web/package.json'))('playwright');
const data = await mkdtemp(resolve(tmpdir(), 'ledger-fabricworld-e2e-'));
const output = resolve(root, 'var/fabricworld-verification');
await mkdir(output, { recursive: true });
const processes = [];
let browser;
const gateway = http.createServer((req, res) => {
  const fabric = req.url.startsWith('/fabricworld/');
  const upstream = http.request({ hostname: '127.0.0.1', port: fabric ? 19082 : 19081, method: req.method,
    path: req.url.replace(fabric ? /^\/fabricworld/ : /^\/ledger/, ''), headers: req.headers }, response => {
    res.writeHead(response.statusCode, response.headers); response.pipe(res);
  });
  upstream.on('error', () => { res.writeHead(502); res.end(); });
  req.pipe(upstream);
});
const base = 'http://127.0.0.1:19080';
async function api(path, body) {
  const r = await fetch(base + path, { method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  assert.equal(r.status, 200, await r.clone().text()); return r.json();
}
async function ready(url) {
  for (let i = 0; i < 80; i++) { try { if ((await fetch(url)).ok) return; } catch {} await new Promise(r => setTimeout(r, 100)); }
  throw new Error('Server failed to start: ' + url);
}
try {
  execFileSync(resolve(root, 'bin/ledger'), ['init', '--db', resolve(data, 'ledger.sqlite')]);
  execFileSync(resolve(fabricRoot, 'bin/fabricworld'), ['init', '--data', resolve(data, 'fabric')]);
  processes.push(spawn(resolve(root, 'bin/ledger'), ['serve', '--db', resolve(data, 'ledger.sqlite'), '--addr', '127.0.0.1:19081'], { env: { ...process.env, LEDGER_FABRICWORLD_URL: 'http://127.0.0.1:19082' }, stdio: 'ignore' }));
  processes.push(spawn(resolve(fabricRoot, 'bin/fabricworld'), ['serve', '--data', resolve(data, 'fabric'), '--listen', '127.0.0.1:19082'], { stdio: 'ignore' }));
  await new Promise((r, reject) => gateway.once('error', reject).listen(19080, '127.0.0.1', r));
  await ready(base + '/ledger/healthz'); await ready(base + '/fabricworld/healthz');
  const account = await api('/ledger/api/accounts', { name: '副业', color: -1, initialBalance: 0, includeInBalance: true, kind: 'normal', periodStart: null, periodEnd: null, archived: false });
  const category = await api('/ledger/api/categories', { accountId: account.id, name: '纺织', color: -1 });
  const other = await api('/ledger/api/accounts', { name: '日常', color: -1, initialBalance: 0, includeInBalance: true, kind: 'normal', periodStart: null, periodEnd: null, archived: false });
  await api('/ledger/api/categories', { accountId: other.id, name: '纺织', color: -1 });
  browser = await chromium.launch({ channel: process.env.PW_CHANNEL || 'chrome', headless: true });
  for (const width of [320, 375, 1440]) {
    const page = await browser.newPage({ viewport: { width, height: width === 1440 ? 1000 : 667 } });
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    const count = async () => (await api('/fabricworld/api/fabrics?status=all')).total;
    async function save(name, accountId = account.id, type = '支出') {
      await page.goto(base + '/ledger/add?account=' + accountId);
      await page.locator('#txn-title').fill(name);
      if (type !== '支出') await page.getByRole('button', { name: type, exact: true }).click();
      if (width < 720) {
        await page.getByLabel('金额（元）', { exact: true }).fill('123.45');
        await page.locator('#txn-date').fill('2026-09-18');
      } else {
        await page.getByRole('group', { name: '金额', exact: true }).focus();
        await page.keyboard.type('123.45');
        await page.locator('#txn-date-button').click();
        await page.locator('input[type=date]').fill('2026-09-18');
      }
      const saved = page.waitForResponse(r => r.url().endsWith('/api/transactions') && r.request().method() === 'POST');
      await page.getByRole('button', { name: '保存这一笔', exact: true }).click();
      return (await saved).json();
    }
    const before = await count();
    await save('取消同步');
    await page.getByRole('dialog').waitFor();
    await page.getByRole('button', { name: '否，返回记账' }).click();
    assert.equal(await count(), before);
    for (const [name, id, type] of [['其他账户', other.id, '支出'], ['收入', account.id, '收入']]) {
      const txn = await save(name, id, type); assert.equal(txn.fabricWorldEligible, false);
      await page.locator('dialog').waitFor({ state: 'hidden' });
    }
    const txn = await save('同步测试棉布 ' + width);
    await page.getByRole('dialog').waitFor();
    const bounds = await page.getByRole('dialog').evaluate(el => { const r = el.getBoundingClientRect(); return { left: r.left, right: r.right, bottom: r.bottom, width: innerWidth, height: innerHeight, scroll: el.scrollWidth, client: el.clientWidth }; });
    assert.ok(bounds.left >= 0 && bounds.right <= bounds.width && bounds.bottom <= bounds.height && bounds.scroll <= bounds.client);
    await page.screenshot({ path: resolve(output, 'confirm-' + width + '.png') });
    let attempts = 0;
    await page.route('**/api/transactions/*/fabricworld', async route => {
      attempts++;
      if (attempts === 1) { await route.fulfill({ status: 502, contentType: 'application/json', body: '{"error":{"code":"FABRICWORLD","message":"测试临时失败"}}' }); return; }
      if (attempts === 2) { await route.fetch(); await route.abort('failed'); return; }
      await route.continue();
    });
    await page.getByRole('button', { name: '是，同步', exact: true }).click();
    await page.getByRole('button', { name: '是，重试', exact: true }).click();
    await page.getByRole('button', { name: '是，重试', exact: true }).click();
    await page.getByRole('button', { name: '是，前往编辑', exact: true }).waitFor();
    assert.equal(attempts, 3); assert.equal(await count(), before + 1);
    await page.screenshot({ path: resolve(output, 'success-' + width + '.png') });
    await page.getByRole('button', { name: '是，前往编辑', exact: true }).click();
    await page.waitForURL(/\/fabricworld\/fabrics\/[a-f0-9]{32}\/edit$/);
    await page.getByLabel('布料名称', { exact: true }).waitFor();
    assert.equal(await page.getByLabel('布料名称', { exact: true }).inputValue(), '同步测试棉布 ' + width);
    assert.equal(await page.getByLabel('购买日期', { exact: true }).inputValue(), '2026-09-18');
    assert.equal(await page.getByLabel('购买总价 / 元', { exact: true }).inputValue(), '123.45');
    assert.equal(await page.locator('input[capture="environment"]').count(), 1);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.screenshot({ path: resolve(output, 'editor-' + width + '.png'), fullPage: true });
    if (width === 375) {
      const photo = resolve(data, 'synthetic.jpg'); execFileSync('vips', ['black', photo, '32', '32', '--bands', '3']);
      await page.locator('input[capture="environment"]').setInputFiles(photo);
      await page.getByLabel('布料名称', { exact: true }).fill('已补充照片');
      const saved = page.waitForResponse(r => /\/api\/fabrics\/[a-f0-9]{32}$/.test(r.url()) && r.request().method() === 'PUT');
      await page.getByRole('button', { name: '保存修改', exact: true }).click();
      const result = await (await saved).json(); assert.equal(result.photos.length, 1);
      const replay = await api('/ledger/api/transactions/' + txn.id + '/fabricworld', {});
      const enriched = await api('/fabricworld/api/fabrics/' + replay.fabricId);
      assert.equal(enriched.name, '已补充照片'); assert.equal(enriched.photos.length, 1);
    }
    await page.goto(base + '/ledger/txn/' + txn.id + '/edit');
    await page.getByLabel('标题', { exact: true }).fill('只编辑交易');
    await page.getByRole('button', { name: '保存修改', exact: true }).click();
    await page.waitForURL(url => !url.pathname.includes('/txn/'));
    assert.equal(await page.locator('dialog[open]').count(), 0);
    await page.unroute('**/api/transactions/*/fabricworld');
    await save('成功后留在记账');
    await page.getByRole('button', { name: '是，同步', exact: true }).click();
    await page.getByRole('button', { name: '是，前往编辑', exact: true }).waitFor();
    await page.getByRole('button', { name: '否，返回记账' }).click();
    assert.ok(page.url().includes('/ledger/add'));
    assert.equal(await count(), before + 2);
    await page.route('**/api/transactions/*/fabricworld', route => route.abort('failed'));
    await save('失败后留在记账');
    await page.getByRole('button', { name: '是，同步', exact: true }).click();
    await page.getByRole('button', { name: '是，重试', exact: true }).waitFor();
    await page.getByRole('button', { name: '否，返回记账' }).click();
    assert.equal(await count(), before + 2);
    await page.unroute('**/api/transactions/*/fabricworld');
    if (width === 375) {
      await page.goto(base + '/ledger/batch?account=' + account.id);
      await page.getByLabel('金额 标题 备注', { exact: true }).fill('12 批量棉布\n13 批量麻布\n+5 退款');
      await page.getByLabel('默认分类', { exact: true }).selectOption(category.id);
      await page.getByRole('button', { name: '解析并预览', exact: true }).click();
      await page.getByRole('button', { name: '确认记账 3 笔', exact: true }).click();
      await page.getByRole('button', { name: '保存', exact: true }).click();
      await page.getByRole('dialog', { name: '是否同步到 FabricWorld？' }).waitFor();
      assert.ok(await page.getByRole('dialog').innerText().then(t => t.includes('批量棉布')));
      await page.getByRole('button', { name: '否，返回记账' }).click();
      assert.ok(await page.getByRole('dialog').innerText().then(t => t.includes('批量麻布')));
      await page.getByRole('button', { name: '是，同步', exact: true }).click();
      await page.getByRole('button', { name: '是，前往编辑', exact: true }).waitFor();
      await page.getByRole('button', { name: '否，返回记账' }).click();
      assert.equal(await page.locator('dialog[open]').count(), 0);
    }
    // Existing records use the same flow from both detail surfaces without saving a transaction.
    const previousCount = await count();
    const existing = await api('/ledger/api/transactions', { type: 'expense', amount: 8765, accountId: account.id,
      categoryId: category.id, toAccountId: null, date: '2025-03-04', title: '历史棉布 ' + width, note: null });
    const transactionWrites = [];
    page.on('request', r => { if (['POST', 'PUT'].includes(r.method()) && /\/api\/transactions(?:\/[a-f0-9-]+)?$/.test(new URL(r.url()).pathname)) transactionWrites.push(r.url()); });
    await page.goto(base + '/ledger/txn/' + existing.id + '/edit');
    const syncButton = page.getByRole('button', { name: '同步至 FabricWorld', exact: true });
    await syncButton.waitFor();
    assert.equal(await syncButton.isEnabled(), true);
    await syncButton.scrollIntoViewIfNeeded();
    await page.screenshot({ path: resolve(output, 'existing-detail-' + width + '.png') });
    await syncButton.click();
    await page.getByRole('button', { name: '否，返回详情', exact: true }).click();
    assert.equal(await count(), previousCount);
    await page.getByLabel('标题', { exact: true }).fill('尚未保存');
    assert.equal(await syncButton.isDisabled(), true);
    await page.getByText('请先保存修改，再同步至 FabricWorld。', { exact: true }).waitFor();
    await page.getByLabel('标题', { exact: true }).fill(existing.title);
    assert.equal(await syncButton.isEnabled(), true);
    let existingAttempts = 0;
    await page.route('**/api/transactions/*/fabricworld', async route => {
      existingAttempts++;
      if (existingAttempts === 1) { await route.fetch(); await route.abort('failed'); }
      else await route.continue();
    });
    await syncButton.click();
    await page.getByRole('button', { name: '是，同步', exact: true }).click();
    await page.getByRole('button', { name: '是，重试', exact: true }).click();
    await page.getByRole('button', { name: '是，前往编辑', exact: true }).waitFor();
    await page.getByRole('button', { name: '否，返回详情', exact: true }).click();
    assert.equal(await count(), previousCount + 1);
    await page.unroute('**/api/transactions/*/fabricworld');
    await page.goto(base + '/ledger/search');
    await page.getByLabel('搜索交易', { exact: true }).fill(existing.title);
    await page.locator('.txn-clickable').filter({ hasText: existing.title }).click();
    await syncButton.waitFor();
    await syncButton.scrollIntoViewIfNeeded();
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.screenshot({ path: resolve(output, 'search-detail-' + width + '.png') });
    await syncButton.click();
    await page.getByRole('button', { name: '否，返回详情', exact: true }).click();
    assert.ok(page.url().includes('/ledger/search'));
    await syncButton.click();
    await page.getByRole('button', { name: '是，同步', exact: true }).click();
    await page.getByRole('button', { name: '是，前往编辑', exact: true }).click();
    await page.waitForURL(/\/fabricworld\/fabrics\/[a-f0-9]{32}\/edit$/);
    await page.getByLabel('布料名称', { exact: true }).waitFor();
    assert.equal(await page.getByLabel('布料名称', { exact: true }).inputValue(), existing.title);
    assert.equal(await page.getByLabel('购买日期', { exact: true }).inputValue(), existing.date);
    assert.equal(await page.getByLabel('购买总价 / 元', { exact: true }).inputValue(), '87.65');
    assert.equal(await count(), previousCount + 1);
    assert.deepEqual(transactionWrites, []);
    const nonTarget = await api('/ledger/api/transactions', { type: 'income', amount: 100, accountId: account.id,
      categoryId: category.id, toAccountId: null, date: '2025-03-04', title: '历史退款 ' + width, note: null });
    await page.goto(base + '/ledger/txn/' + nonTarget.id + '/edit');
    await page.getByLabel('标题', { exact: true }).waitFor();
    assert.equal(await syncButton.count(), 0);
    await page.goto(base + '/ledger/search');
    await page.getByLabel('搜索交易', { exact: true }).fill(nonTarget.title);
    await page.locator('.txn-clickable').filter({ hasText: nonTarget.title }).click();
    assert.equal(await syncButton.count(), 0);
    assert.deepEqual(errors, []);
    await page.close();
    console.log('PASS ' + width + 'px: cancel, non-target, failure, lost response, retry, mapping, edit navigation');
  }
} finally {
  await browser?.close();
  await new Promise(r => gateway.close(r));
  await Promise.all(processes.map(p => new Promise(r => { if (p.exitCode !== null) return r(); p.once('exit', r); p.kill('SIGTERM'); })));
  await rm(data, { recursive: true, force: true });
}

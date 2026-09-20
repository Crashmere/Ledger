// Build first: make build BASE_PATH=/ledger/
// All writes use an isolated temporary database; the public service is never contacted.
import { execFileSync, spawn } from "node:child_process";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import assert from "node:assert/strict";
import http from "node:http";
const { chromium } = createRequire(
  resolve(
    process.env.FABRICWORLD_CHECKOUT ||
      resolve(import.meta.dirname, "../../FabricWorld"),
    "web/package.json",
  ),
)("playwright");
const root = resolve(import.meta.dirname, "..");
const output = resolve(root, "var/ui-verification");
await mkdir(output, { recursive: true });
const data = await mkdtemp(resolve(tmpdir(), "ledger-ui-"));
execFileSync(root + "/bin/ledger", ["init", "--db", data + "/test.sqlite"]);
let browser;
const child = spawn(
  root + "/bin/ledger",
  ["serve", "--db", data + "/test.sqlite", "--addr", "127.0.0.1:19191"],
  { stdio: "inherit" },
);
const server = http.createServer((req, res) => {
  const target = http.request(
    {
      hostname: "127.0.0.1",
      port: 19191,
      path: req.url.replace(/^\/ledger/, ""),
      method: req.method,
      headers: req.headers,
    },
    (r) => {
      res.writeHead(r.statusCode, r.headers);
      r.pipe(res);
    },
  );
  target.on("error", () => {
    res.writeHead(502);
    res.end();
  });
  req.pipe(target);
});
try {
  await new Promise((r, reject) =>
    server.once("error", reject).listen(19190, "127.0.0.1", r),
  );
  let ready = false;
  for (let i = 0; i < 50; i++) {
    if (child.exitCode !== null)
      throw new Error("Test backend exited before becoming ready");
    try {
      if ((await fetch("http://127.0.0.1:19190/ledger/healthz")).ok) {
        ready = true;
        break;
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  assert(ready, "Test backend did not become ready");
  const base = 'http://127.0.0.1:19190/ledger';
  const api = async (path, body) => {
    const response = await fetch(base + '/api' + path, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json' }, body: body && JSON.stringify(body) });
    assert(response.ok, await response.clone().text());
    return response.json();
  };
  const accounts = [];
  for (const name of ['日常生活', '储蓄']) accounts.push(await api('/accounts', { name, color: 0xff508b74, initialBalance: 0, kind: 'normal', includeInBalance: true, archived: false, periodStart: null, periodEnd: null }));
  const categories = [await api('/categories', { name: '餐饮', accountId: accounts[0].id, color: 0xff508b74 })];
  const account = accounts.find(a => a.name === '日常生活');
  const category = categories.find(c => c.accountId === account.id);
  const month = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date()).slice(0, 7);
  const date = month + '-20';
  const seeded = [];
  for (let i = 0; i < 36; i++) seeded.push(await api('/transactions', {
    type: i % 3 === 0 ? 'income' : 'expense', amount: (i + 1) * 123,
    accountId: account.id, categoryId: category.id, toAccountId: null,
    title: i === 35 ? '这是用于验证浮窗长标题不会挤压金额的一笔支出' : i === 34 ? null : '浮窗记录 ' + i,
    note: null, date,
  }));
  await api('/transactions', { type: 'transfer', amount: 999999, accountId: account.id, toAccountId: accounts.find(a => a.id !== account.id).id, categoryId: null, title: '不计入收支的转账', note: null, date });
  const incomeOnly = await api('/transactions', { type: 'income', amount: 9800, accountId: account.id, toAccountId: null, categoryId: category.id, title: '退款', note: null, date: month + '-21' });
  browser = await chromium.launch({ channel: process.env.PW_CHANNEL || 'chrome', headless: true });
  for (const width of [1440, 375, 320]) {
    const page = await browser.newPage({ viewport: { width, height: width < 600 ? 667 : 1000 }, isMobile: width < 600, hasTouch: width < 600 });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    const popup = page.getByRole('region', { name: '区间收支明细' });
    const rows = popup.locator('.insight-transaction');
    const go = async (query = '') => page.goto(base + '/transactions?view=insights' + query, { waitUntil: 'networkidle' });
    const click = async locator => width < 600 ? locator.tap() : locator.click();
    const waitReady = async () => {
      await popup.waitFor();
      await page.waitForFunction(() => document.querySelector('.insight-transactions')?.getAttribute('aria-busy') === 'false');
      await page.waitForTimeout(180);
    };
    const checkBounds = async () => {
      const box = await popup.boundingBox();
      assert(box.x >= 9 && box.y >= 9 && box.x + box.width <= width - 9 && box.y + box.height <= (width < 600 ? 667 : 1000) - 9, 'Popup must fit the viewport');
      assert(await popup.evaluate(el => el.scrollWidth <= el.clientWidth), 'No popup horizontal overflow');
    };
    const ids = () => rows.evaluateAll(elements => elements.map(el => el.dataset.id));
    await go();
    const day = page.locator('.heatmap-day[data-date="' + date + '"]');
    await day.scrollIntoViewIfNeeded();
    const scrollBefore = await page.locator('.work-area').evaluate(el => el.scrollTop);
    await click(day);
    await waitReady();
    assert.equal(await rows.count(), 30);
    assert.deepEqual(await ids(), seeded.toReversed().slice(0, 30).map(t => t.id));
    assert.equal(await rows.nth(1).locator('span').innerText(), '未命名交易');
    assert(await rows.locator('.pos').count() > 0 && await rows.locator('.neg').count() > 0);
    assert.equal(await page.locator('.work-area').evaluate(el => el.scrollTop), scrollBefore);
    await checkBounds();
    await page.screenshot({ path: resolve(output, 'insight-popup-' + width + '.png') });
    await click(popup.getByRole('button', { name: /^加载更多/ }));
    await waitReady();
    assert.deepEqual(await ids(), seeded.toReversed().map(t => t.id));
    assert(await popup.locator('.insight-transactions-list').evaluate(el => el.scrollTop > 0));
    await page.keyboard.press('Escape');
    await popup.waitFor({ state: 'hidden' });
    await click(day);
    await waitReady();
    await page.locator('.work-area').evaluate(el => { el.scrollTop -= 20; });
    await popup.waitFor({ state: 'hidden' });
    await go();
    await click(page.locator('.trend-point[data-period="' + date + '"]'));
    await waitReady();
    assert.deepEqual(await ids(), seeded.toReversed().slice(0, 30).map(t => t.id));
    await checkBounds();
    await click(popup.getByRole('button', { name: '关闭收支明细' }));
    // A zero-expense day can still have income; an empty day has a clear empty state.
    await go('&range=custom&from=' + month + '-21&to=' + month + '-21');
    await click(page.locator('.heatmap-day[data-level="0"]').first());
    await waitReady();
    assert.deepEqual(await ids(), [incomeOnly.id]);
    assert.equal(await rows.locator('.pos').count(), 1);
    await go('&range=custom&from=' + month + '-28&to=' + month + '-28');
    await click(page.locator('.heatmap-day').first());
    await waitReady();
    assert.equal(await rows.count(), 0);
    assert(await popup.getByText('这段时间暂无符合筛选的收支').isVisible());
    // Filters are retained rather than querying all records in the date.
    const params = new URLSearchParams({ account: account.id, category: category.name, types: 'expense', q: '浮窗记录', fields: 'title', min: '1000', max: '3500', excluded: seeded[20].id, range: 'custom', from: date, to: date });
    await go('&' + params);
    const queryRequest = page.waitForRequest(r => r.url().endsWith('/transactions/query') && r.postDataJSON().pageSize === 30);
    await click(page.locator('.heatmap-day').first());
    const query = (await queryRequest).postDataJSON();
    await waitReady();
    assert.deepEqual(query.filter, { dateFrom: date, dateTo: date, projectScope: 'selected', accountIds: [account.id], categoryIds: categories.filter(c => c.name === category.name).map(c => c.id), types: ['expense'], keyword: '浮窗记录', searchFields: ['title'], excludedIds: [seeded[20].id], amountMin: 1000, amountMax: 3500 });
    const expected = seeded.filter(t => t.type === 'expense' && t.amount >= 1000 && t.amount <= 3500 && t.id !== seeded[20].id).toReversed();
    assert.deepEqual(await ids(), expected.map(t => t.id));
    await go('&range=custom&from=' + date + '&to=' + date + '&types=transfer');
    let popupRequests = 0;
    const count = r => { if (r.url().endsWith('/transactions/query') && r.postDataJSON().pageSize === 30) popupRequests++; };
    page.on('request', count);
    await click(page.locator('.heatmap-day').first());
    await waitReady();
    assert.equal(await rows.count(), 0);
    assert.equal(popupRequests, 0);
    page.off('request', count);
    // Partial monthly and yearly buckets pass their actual clipped date boundaries.
    for (const [from, to, key, end] of [
      ['2026-01-15', '2026-04-10', '2026-01', '2026-01-31'],
      ['2023-12-20', '2026-01-10', '2023', '2023-12-31'],
    ]) {
      await go('&range=custom&from=' + from + '&to=' + to);
      const pending = page.waitForRequest(r => r.url().endsWith('/transactions/query') && r.postDataJSON().pageSize === 30);
      await click(page.locator('.trend-point[data-period="' + key + '"]'));
      const q = (await pending).postDataJSON();
      await waitReady();
      assert.equal(q.filter.dateFrom, from);
      assert.equal(q.filter.dateTo, end);
      await checkBounds();
    }
    // Local pending/error states and late results must not replace the latest date.
    await go('&range=custom&from=' + date + '&to=' + month + '-28');
    let held;
    await page.route('**/transactions/query', async route => {
      if (route.request().postDataJSON().pageSize === 30) {
        held = route;
      } else await route.continue();
    });
    await click(page.locator('.heatmap-day[data-date="' + date + '"]'));
    await popup.getByRole('status').waitFor();
    assert.equal(await popup.getAttribute('aria-busy'), 'true');
    assert.equal(await page.locator('.page-skeleton').count(), 0);
    for (let attempt = 0; !held && attempt < 100; attempt++) await page.waitForTimeout(20);
    assert(held, 'Popup request must start');
    await held.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: { message: '测试读取失败' } }) });
    await popup.getByRole('button', { name: '重试', exact: true }).waitFor();
    await page.unroute('**/transactions/query');
    await click(popup.getByRole('button', { name: '重试', exact: true }));
    await waitReady();
    assert.equal(await rows.count(), 30);
    await click(popup.getByRole('button', { name: '关闭收支明细' }));
    const blank = page.locator('.heatmap-day[data-date="' + month + '-28"]');
    await blank.scrollIntoViewIfNeeded();
    held = null;
    await page.route('**/transactions/query', async route => {
      const q = route.request().postDataJSON();
      if (q.pageSize === 30 && q.filter.dateFrom === date) held = route;
      else await route.continue();
    });
    // Dispatch coordinates from the displayed grid, then choose another day immediately.
    await page.locator('.heatmap-day[data-date="' + date + '"]').evaluate(el => el.click());
    for (let attempt = 0; !held && attempt < 100; attempt++) await page.waitForTimeout(20);
    assert(held, 'Popup request must start');
    await blank.evaluate(el => el.click());
    await waitReady();
    assert((await popup.locator('strong').innerText()).includes(month + '-28'));
    await held.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: seeded, totalCount: seeded.length, page: 1, pageSize: 30 }) });
    await page.waitForTimeout(200);
    assert.equal(await rows.count(), 0);
    await page.unroute('**/transactions/query');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.keyboard.press('Escape');
    await blank.evaluate(el => el.click());
    await waitReady();
    assert.equal(await popup.evaluate(el => getComputedStyle(el).animationName), 'none');
    await page.keyboard.press('Tab');
    await popup.waitFor({ state: 'hidden' });
    assert.equal(await page.getByRole('tab', { name: '明细' }).getAttribute('aria-selected'), 'true');
    assert.deepEqual(errors, []);
    console.log('PASS chart popup sorting, paging, filters, date grouping, bounds, dismissal, retry and races at ' + width);
    await page.close();
  }
} finally {
  await browser?.close();
  await new Promise((r) => server.close(r));
  await new Promise((r) => {
    if (child.exitCode !== null) return r();
    child.once("exit", r);
    child.kill("SIGTERM");
  });
  await rm(data, { recursive: true, force: true });
}

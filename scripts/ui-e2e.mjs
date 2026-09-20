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
  const seed = async (path, body) => {
    const r = await fetch("http://127.0.0.1:19190/ledger/api" + path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!r.ok) throw new Error(await r.text());
    return r.json();
  };
  const accounts = [];
  for (const [name, color, balance, kind] of [
    ["日常生活", 0xff508b74, 200000, "normal"],
    ["工资储蓄", 0xff7085b4, 3200000, "normal"],
    ["副业", 0xffb58d53, 400000, "normal"],
    ["旅行计划", 0xff9682a8, 0, "project"],
    ["空账户", 0xff617977, 0, "normal"],
  ]) {
    accounts.push(
      await seed("/accounts", {
        name,
        color,
        initialBalance: balance,
        kind,
        includeInBalance: kind === "normal",
        archived: false,
        periodStart: kind === "project" ? "2026-08-01" : null,
        periodEnd: kind === "project" ? "2026-08-31" : null,
      }),
    );
  }
  const cats = [];
  for (const [i, names] of [
    [0, ["餐饮", "交通", "购物", "日用", "订阅", "健康", "食物", "娱乐"]],
    [1, ["工资", "利息"]],
    [2, ["纺织", "工具", "订单"]],
    [3, ["交通", "住宿", "餐饮"]],
  ])
    for (const [k, name] of names.entries())
      cats.push(
        await seed("/categories", {
          accountId: accounts[i].id,
          name,
          color: [0xff508b74, 0xffd5a457, 0xff7e91ba, 0xffc57d69][k % 4],
        }),
      );
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
  }).format(new Date());
  const month = today.slice(0, 7);
  const titles = [
    "午餐",
    "地铁通勤",
    "周末采购",
    "咖啡与面包",
    "鲜花",
    "超市日用品",
    "订阅服务",
    "晚餐",
  ];
  const txns = [];
  for (let i = 0; i < 78; i++) {
    const a = i % 13 === 0 ? accounts[2] : accounts[0];
    const options = cats.filter((c) => c.accountId === a.id);
    const category = options[i % options.length];
    const txn = await seed("/transactions", {
      type: "expense",
      amount: Math.round(150 + i * 37.13),
      accountId: a.id,
      categoryId: category.id,
      toAccountId: null,
      date: month + "-" + String((i % 19) + 1).padStart(2, "0"),
      title:
        i === 3
          ? "这是一个用于验证窄屏省略行为的很长很长的交易标题"
          : a === accounts[2]
            ? "棉麻布料"
            : titles[i % titles.length],
      note: i % 3 === 0 ? "两人份 · 周末采购记录，备注用于查看完整详情" : null,
    });
    txns.push(txn);
  }
  for (const [a, type, amount, date, cat, title] of [
    [
      accounts[1],
      "income",
      1800000,
      month + "-05",
      cats.find((c) => c.name === "工资"),
      "月度工资",
    ],
    [accounts[0], "income", 23000, month + "-12", null, "退款"],
    [
      accounts[3],
      "expense",
      420000,
      "2026-08-15",
      cats.find((c) => c.accountId === accounts[3].id),
      "旅行住宿",
    ],
  ])
    txns.push(
      await seed("/transactions", {
        accountId: a.id,
        type,
        amount,
        date,
        categoryId: cat?.id ?? null,
        toAccountId: null,
        title,
        note: null,
      }),
    );
  txns.push(
    await seed("/transactions", {
      type: "transfer",
      amount: 100000,
      accountId: accounts[1].id,
      toAccountId: accounts[0].id,
      categoryId: null,
      date: month + "-10",
      title: "生活费转入",
      note: "转账不计入收支",
    }),
  );

  const f = { accounts, cats, txns, today, month };
  browser = await chromium.launch({
    channel: process.env.PW_CHANNEL || "chrome",
    headless: true,
  });
  const base = "http://127.0.0.1:19190/ledger";
  const errors = [];
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  page.on("pageerror", (e) => errors.push(e.message));
  const settle = () => page.waitForTimeout(500);
  const go = async (path) => {
    await page.goto(base + path);
    await settle();
  };
  const api = async (path, body, method = body ? "POST" : "GET") => {
    if (body?.filter?.keyword)
      body.filter.searchFields = ["title", "note", "category"];
    const r = await fetch(base + "/api" + path, {
      method,
      headers: { "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    assert(r.ok, await r.clone().text());
    return r.json();
  };
  try {
    await go("/overview");
    assert(page.url().includes("/transactions"));
    assert.equal(await page.locator(".transaction-line").count(), 10);
    for (const width of [1440, 375]) {
      await page.setViewportSize({ width, height: width === 375 ? 667 : 1000 });
      const rows = page.locator(".transaction-line.has-category");
      const row = rows.first();
      const categoryName = (
        await row.locator(".transaction-category").textContent()
      ).trim();
      const accountName = (
        await row.locator(".transaction-account").textContent()
      ).trim();
      const account = f.accounts.find((a) => a.name === accountName);
      const category = f.cats.find(
        (c) => c.name === categoryName && c.accountId === account.id,
      );
      const rgb =
        "rgb(" +
        [
          (category.color >>> 16) & 255,
          (category.color >>> 8) & 255,
          category.color & 255,
        ].join(", ") +
        ")";
      assert.equal(
        await row
          .locator(".type-icon")
          .evaluate((el) => getComputedStyle(el).color),
        rgb,
      );
      const badge = row.locator(
        width === 375
          ? ".transaction-mobile-meta .category-label"
          : ".transaction-category .category-label",
      );
      assert(await badge.isVisible());
      assert.equal(
        await badge.evaluate(
          (el) => getComputedStyle(el, "::before").backgroundColor,
        ),
        rgb,
      );
      assert(
        (await rows.evaluateAll(
          (els) =>
            new Set(
              els.map(
                (el) => getComputedStyle(el.querySelector(".type-icon")).color,
              ),
            ).size,
        )) > 1,
      );
      await row.click();
      assert.equal(
        await page
          .locator("dialog[open] .category-label")
          .evaluate((el) => getComputedStyle(el, "::before").backgroundColor),
        rgb,
      );
      await page.getByLabel("关闭详情", { exact: true }).click();
      assert(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      );
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
    console.log(
      "saved category colors in desktop/mobile ledger and details PASS",
    );

    await page.getByRole("button", { name: "下一页", exact: true }).click();
    await settle();
    assert((await page.locator(".transaction-line").count()) > 0);
    assert.equal(
      await page.locator('.pagination [aria-current="page"]').innerText(),
      "2",
    );
    await page.getByRole("button", { name: "第 5 页", exact: true }).click();
    await settle();
    assert.equal(
      await page.locator('.pagination [aria-current="page"]').innerText(),
      "5",
    );
    await page.getByLabel("每页条数").selectOption("20");
    await settle();
    assert.equal(await page.locator(".transaction-line").count(), 20);
    assert.equal(
      await page.locator('.pagination [aria-current="page"]').innerText(),
      "1",
    );
    assert(
      await page
        .getByRole("button", { name: "上一页", exact: true })
        .isDisabled(),
    );
    await page.getByRole("button", { name: "第 5 页", exact: true }).click();
    await settle();
    assert.equal(await page.locator(".transaction-line").count(), 1);
    assert(
      await page
        .getByRole("button", { name: "下一页", exact: true })
        .isDisabled(),
    );
    await page.getByLabel("每页条数").selectOption("100");
    await settle();
    assert.equal(await page.locator(".transaction-line").count(), 81);
    assert.equal(await page.locator(".page-number").count(), 1);
    await page.getByLabel("每页条数").selectOption("10");
    await settle();
    console.log(
      "numbered pagination, page sizes, first/last boundaries and overview redirect PASS",
    );
    await page.getByLabel("搜索交易", { exact: true }).fill("午餐");
    await settle();
    assert((await page.locator(".transaction-line").count()) > 0);
    assert(
      (await page.locator(".transaction-line").allTextContents()).every((t) =>
        t.includes("午餐"),
      ),
    );
    await page.getByLabel("展示排序").selectOption("amount-asc");
    await settle();
    await page.locator(".transaction-line").first().click();
    await page.locator("dialog[open]").waitFor();
    await page.screenshot({ path: resolve(output, "detail-desktop.png") });
    await page.getByRole("button", { name: "排除", exact: true }).click();
    await settle();
    assert(
      await page.getByRole("button", { name: /恢复 1 笔排除/ }).isVisible(),
    );
    await page.getByRole("button", { name: /恢复 1 笔排除/ }).click();
    await settle();
    await page.locator(".transaction-line").first().click();
    await page
      .locator("dialog[open]")
      .getByRole("button", { name: "编辑", exact: true })
      .click();
    await page.getByLabel("标题", { exact: true }).fill("午餐（已编辑）");
    await page.getByRole("button", { name: "保存修改", exact: true }).click();
    await page.waitForURL(/transactions/);
    await settle();
    assert.equal(await page.getByLabel("搜索交易").inputValue(), "午餐");
    assert.equal(await page.getByLabel("展示排序").inputValue(), "amount-asc");
    console.log("search sort details exclude edit and restored filters PASS");
    await page.getByRole("button", { name: /^筛选/ }).click();
    await page.getByRole("button", { name: "转账", exact: true }).click();
    await page.getByLabel("清除搜索").click();
    await settle();
    assert.equal(await page.locator(".transaction-line").count(), 1);
    assert(
      (await page.locator(".transaction-line").innerText()).includes(
        "生活费转入",
      ),
    );
    await page.getByLabel("最低金额").fill("100");
    await page.getByLabel("最高金额").fill("50");
    await page.getByRole("button", { name: "应用金额" }).click();
    assert(
      await page.getByRole("alert").filter({ hasText: "最低金额" }).isVisible(),
    );
    await page.getByRole("button", { name: "清空筛选", exact: true }).click();
    await settle();
    await page
      .getByRole("button", { name: "旅行计划专项", exact: true })
      .click();
    await page.getByLabel("时间范围", { exact: true }).selectOption("all");
    await settle();
    assert.equal(await page.locator(".transaction-line").count(), 1);
    console.log("transfer project amount validation PASS");
    // A one-cent bar stays distinguishable from zero beside a very large amount,
    // including after the SVG is scaled down on a phone. Only the read response is mocked.
    await page.route("**/api/statistics/daily", (route) =>
      route.fulfill({
        json: {
          days: [
            {
              date: "2026-09-01",
              time: 0,
              income: 100000000,
              expense: 1,
              incomeCount: 1,
              expenseCount: 1,
              transferCount: 0,
              level: 1,
            },
            {
              date: "2026-09-02",
              time: 0,
              income: 1,
              expense: 0,
              incomeCount: 1,
              expenseCount: 0,
              transferCount: 0,
              level: 0,
            },
            {
              date: "2026-09-03",
              time: 0,
              income: 0,
              expense: 0,
              incomeCount: 0,
              expenseCount: 0,
              transferCount: 0,
              level: 0,
            },
          ],
          startWeekday: 2,
          weekCount: 1,
          total: 1,
          activeDays: 1,
        },
      }),
    );
    await go("/reports");
    for (const width of [1440, 375, 320, 768]) {
      await page.setViewportSize({ width, height: width < 600 ? 667 : 1000 });
      await settle();
      const geometry = await page
        .locator(".trend-point")
        .evaluateAll((points) =>
          points.map((point) =>
            ["income-bar", "expense-bar"].map((name) => {
              const bar = point.querySelector("." + name);
              return {
                height: bar.getBoundingClientRect().height,
                bottom:
                  Number(bar.getAttribute("y")) +
                  Number(bar.getAttribute("height")),
              };
            }),
          ),
        );
      assert(
        geometry[0][1].height >= 3.99,
        "Small expense minimum height at " + width,
      );
      assert(
        geometry[1][0].height >= 3.99,
        "Small income minimum height at " + width,
      );
      assert.equal(geometry[1][1].height, 0);
      assert.equal(geometry[2][0].height, 0);
      assert.equal(geometry[2][1].height, 0);
      assert(
        geometry.flat().every((bar) => Math.abs(bar.bottom - 169) < 0.001),
      );
      assert(geometry[0][0].height > geometry[0][1].height * 10);
      await page.locator(".flow-chart").focus();
      await page.keyboard.press("Home");
      assert(
        (await page.locator(".chart-readout").innerText()).includes(
          "支出 0.01",
        ),
      );
    }
    await page.unroute("**/api/statistics/daily");
    await page.setViewportSize({ width: 1440, height: 1000 });
    console.log(
      "minimum visible income/expense heights, true zero, baseline and exact amount PASS",
    );
    await go("/reports");
    await page.getByLabel("时间范围", { exact: true }).selectOption("year");
    await settle();
    const year = Number(f.today.slice(0, 4));
    const yearDays =
      (Date.UTC(year + 1, 0, 1) - Date.UTC(year, 0, 1)) / 86400000;
    assert.equal(await page.locator(".heatmap-day").count(), yearDays);
    assert.equal(await page.locator(".heatmap-month").count(), 12);
    assert.equal(await page.locator(".trend-point").count(), 12);
    // Check the actual content containers: document overflow alone misses a clipped workspace.
    for (const width of [320, 375, 768, 900, 1440, 1920]) {
      await page.setViewportSize({ width, height: width < 600 ? 667 : 1000 });
      await settle();
      const overflow = await page.evaluate(() => {
        const area = document
          .querySelector(".work-area")
          .getBoundingClientRect();
        return [
          ...document.querySelectorAll(
            ".work-area,.ledger-content,.insight-view,.insight-bottom,.distribution,.activity-section,.expense-heatmap,.heatmap-month-grid,.heatmap-month",
          ),
        ]
          .filter((el) => {
            const rect = el.getBoundingClientRect();
            return (
              el.scrollWidth > el.clientWidth + 1 ||
              rect.right > area.right + 1 ||
              rect.left < area.left - 1
            );
          })
          .map((el) => el.className);
      });
      assert.deepEqual(overflow, [], "Year insights overflow at " + width);
      assert.equal(await page.locator(".heatmap-day").count(), yearDays);
      if ([375, 1440].includes(width)) {
        await page.locator(".heatmap-month").first().scrollIntoViewIfNeeded();
        await page.screenshot({
          path: resolve(output, "year-insights-" + width + ".png"),
        });
      }
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.locator(".flow-chart").focus();
    await page.keyboard.press("End");
    assert(
      (await page.locator(".chart-readout").textContent()).includes(
        year + "-12-31",
      ),
    );
    await page.getByLabel("时间范围", { exact: true }).selectOption("custom");
    await page.getByLabel("起始日期").fill("2024-01-01");
    await page.getByLabel("结束日期").fill("2026-12-31");
    await settle();
    assert.equal(await page.locator(".trend-point").count(), 3);
    await page.getByLabel("热力图年份").selectOption("2024");
    assert.equal(await page.locator(".heatmap-day").count(), 366);
    const leapDay = page.locator('.heatmap-day[data-date="2024-02-29"]');
    await leapDay.focus();
    await page.keyboard.press("ArrowRight");
    assert.equal(
      await page.evaluate(() => document.activeElement.dataset.date),
      "2024-03-01",
    );
    await page.keyboard.press("Home");
    assert.equal(
      await page.evaluate(() => document.activeElement.dataset.date),
      "2024-01-01",
    );
    await page.keyboard.press("End");
    assert.equal(
      await page.evaluate(() => document.activeElement.dataset.date),
      "2024-12-31",
    );
    await page.getByLabel("热力图年份").selectOption("2025");
    assert.equal(await page.locator(".heatmap-day").count(), 365);
    console.log(
      "year insights layout, trend grouping, leap-year calendar and keyboard PASS",
    );
    await page.getByLabel("时间范围", { exact: true }).selectOption("30d");
    await settle();
    assert.equal(await page.locator(".heatmap-day").count(), 30);
    assert.equal(await page.locator(".trend-point").count(), 30);
    await page.getByLabel("时间范围", { exact: true }).selectOption("custom");
    await page.getByLabel("起始日期").fill(f.month + "-01");
    await page.getByLabel("结束日期").fill(f.month + "-10");
    await settle();
    assert.equal(await page.locator(".heatmap-day").count(), 10);
    await page.locator(".category-rank").first().click();
    await page.waitForURL(/transactions/);
    await settle();
    assert(page.url().includes("categories"));
    assert(
      (await page
        .getByRole("tab", { name: "明细", exact: true })
        .getAttribute("aria-selected")) === "true",
    );
    await page.getByLabel("时间范围", { exact: true }).selectOption("month");
    await settle();
    assert(!new URL(page.url()).searchParams.has("from"));
    console.log("report ranges and drilldown PASS");
    await go("/accounts");
    await page
      .locator(".management-panel")
      .getByRole("button", { name: "新建账户", exact: true })
      .click();
    await page.getByLabel("名称", { exact: true }).fill("临时验证账户");
    await page
      .locator("dialog[open]")
      .getByRole("button", { name: "保存", exact: true })
      .click();
    await settle();
    const acc = (await api("/accounts")).items.find(
      (a) => a.name === "临时验证账户",
    );
    assert(acc);
    await page
      .getByRole("button", { name: "＋ 新建分类", exact: true })
      .click();
    await page.getByLabel("名称", { exact: true }).fill("临时验证分类");
    await page
      .locator("dialog[open]")
      .getByRole("button", { name: "保存", exact: true })
      .click();
    await settle();
    await page
      .locator(".managed-category")
      .filter({ hasText: "临时验证分类" })
      .getByLabel("编辑分类", { exact: true })
      .click();
    await page.getByLabel("名称", { exact: true }).fill("更名分类");
    await page
      .locator("dialog[open]")
      .getByRole("button", { name: "保存", exact: true })
      .click();
    await settle();
    await page
      .locator(".managed-category")
      .filter({ hasText: "更名分类" })
      .getByLabel("删除分类", { exact: true })
      .click();
    await page
      .locator("dialog[open]")
      .getByRole("button", { name: "删除分类", exact: true })
      .click();
    await settle();
    await page.getByLabel("编辑账户 临时验证账户", { exact: true }).click();
    await page.getByRole("button", { name: "删除账户", exact: true }).click();
    await page
      .locator("dialog[open]")
      .getByRole("button", { name: "删除账户", exact: true })
      .click();
    await settle();
    assert(!(await api("/accounts")).items.some((a) => a.id === acc.id));
    console.log("account and category CRUD PASS");
    await page.getByLabel("下移账户 日常生活", { exact: true }).click();
    await settle();
    assert.equal((await api("/accounts")).items[0].id, f.accounts[1].id);
    await page
      .locator(".managed-account-select")
      .filter({ hasText: "日常生活" })
      .click();
    await page.getByLabel("下移分类 餐饮", { exact: true }).click();
    await settle();
    assert.equal(
      (await api("/categories?accountId=" + f.accounts[0].id))[0].name,
      "交通",
    );
    await page.getByLabel("编辑账户 旅行计划", { exact: true }).click();
    await page.getByLabel("已结束（归档）", { exact: true }).check();
    await page
      .locator("dialog[open]")
      .getByRole("button", { name: "保存", exact: true })
      .click();
    await settle();
    assert(
      (await api("/accounts")).items.find((a) => a.id === f.accounts[3].id)
        .archivedAt > 0,
    );
    await page.getByRole("button", { name: "查看流水", exact: true }).click();
    await settle();
    assert.equal(await page.locator(".transaction-line").count(), 1);
    assert.equal(
      await page.getByLabel("时间范围", { exact: true }).inputValue(),
      "all",
    );
    await page.getByLabel("时间范围", { exact: true }).selectOption("month");
    await settle();
    assert.equal(
      await page.locator(".transaction-line").count(),
      f.month === "2026-08" ? 1 : 0,
    );
    console.log(
      "account/category ordering, project archive, scope hydration PASS",
    );
    await go("/add?account=" + f.accounts[0].id);
    await page.getByRole("button", { name: "转账", exact: true }).click();
    await page.getByRole("group", { name: "金额", exact: true }).focus();
    await page.keyboard.type("100+25.50");
    await page.getByRole("button", { name: "等于", exact: true }).click();
    await page
      .getByLabel("转入账户", { exact: true })
      .selectOption(f.accounts[1].id);
    await page.getByLabel("标题", { exact: true }).fill("桌面转账验证");
    await page.getByRole("button", { name: "保存这一笔", exact: true }).click();
    await settle();
    const transfer = (
      await api("/transactions/query", {
        filter: { keyword: "桌面转账验证", projectScope: "all" },
      })
    ).items[0];
    assert.equal(transfer.type, "transfer");
    assert.equal(transfer.amount, 12550);
    assert.notEqual(transfer.accountId, transfer.toAccountId);
    console.log("desktop calculator and transfer creation PASS");
    await page.setViewportSize({ width: 375, height: 667 });
    await go("/add?account=" + f.accounts[0].id);
    await page.getByLabel("金额（元）", { exact: true }).fill("12.34");
    await page.getByLabel("标题", { exact: true }).fill("移动端记账测试");
    await page.getByRole("button", { name: "保存这一笔", exact: true }).click();
    await settle();
    assert.equal(
      await page.getByLabel("金额（元）", { exact: true }).inputValue(),
      "",
    );
    let items = await api("/transactions/query", {
      filter: { keyword: "移动端记账测试", projectScope: "all" },
    });
    assert.equal(items.totalCount, 1);
    const saved = items.items[0];
    await go("/txn/" + saved.id + "/edit");
    assert.equal(
      await page.getByLabel("金额（元）", { exact: true }).inputValue(),
      "12.34",
    );
    await page.getByRole("button", { name: "复制这一笔", exact: true }).click();
    await settle();
    assert.equal(
      await page.getByLabel("标题", { exact: true }).inputValue(),
      "移动端记账测试",
    );
    await page.getByLabel("标题", { exact: true }).fill("复制测试");
    await page.getByRole("button", { name: "保存这一笔", exact: true }).click();
    await settle();
    await go("/txn/" + saved.id + "/edit");
    await page.getByRole("button", { name: "删除交易", exact: true }).click();
    await page
      .getByRole("dialog", { name: "删除交易", exact: true })
      .getByRole("button", { name: /删除/ })
      .click();
    await settle();
    items = await api("/transactions/query", {
      filter: { keyword: "移动端记账测试", projectScope: "all" },
    });
    assert.equal(items.totalCount, 0);
    console.log("mobile create copy delete PASS");
    await go("/transactions");
    await page.locator(".transaction-line").first().click();
    await page.screenshot({ path: resolve(output, "detail-mobile.png") });
    const box = await page.locator("dialog[open]").boundingBox();
    assert(box.x >= 0 && box.x + box.width <= 375);
    await page.getByRole("button", { name: "关闭详情" }).click();
    await go("/batch");
    await page
      .getByLabel("默认账户", { exact: true })
      .selectOption(f.accounts[0].id);
    await page
      .locator("#import-source")
      .fill("-12.30 批量一 备注\n+9.90 批量二\nabc 错误行");
    await page.getByRole("button", { name: "生成待记账清单" }).click();
    await settle();
    assert(await page.getByText("1 行待修正", { exact: false }).count());
    await page.getByLabel("移出第 3 行", { exact: true }).click();
    await settle();
    await page
      .getByRole("button", { name: "确认记账 2 笔", exact: true })
      .click();
    await page
      .locator("dialog[open]")
      .getByRole("button", { name: "保存", exact: true })
      .click();
    await settle();
    items = await api("/transactions/query", {
      filter: { keyword: "批量", projectScope: "all" },
    });
    assert(items.totalCount >= 2);
    console.log("batch validation removal and save PASS");
    // Unknown save results keep the form and prevent duplicate writes.
    await go("/add?account=" + f.accounts[0].id);
    await page.getByLabel("金额（元）", { exact: true }).fill("23.45");
    await page.getByLabel("标题", { exact: true }).fill("响应丢失验证");
    await page.route("**/api/transactions", async (route) => {
      await route.fetch();
      await route.abort("failed");
    });
    await page.getByRole("button", { name: "保存这一笔", exact: true }).click();
    await settle();
    assert(await page.locator("dialog[open]").isVisible());
    assert(
      (await page.getByLabel("标题", { exact: true }).inputValue()) ===
        "响应丢失验证",
    );
    await page
      .locator("dialog[open]")
      .getByRole("button", { name: /返回|关闭/ })
      .click();
    await page.getByRole("button", { name: "重新连接", exact: true }).click();
    await settle();
    assert(
      await page
        .getByRole("button", { name: "保存这一笔", exact: true })
        .isDisabled(),
    );
    await page.unroute("**/api/transactions");
    items = await api("/transactions/query", {
      filter: { keyword: "响应丢失验证" },
    });
    assert.equal(items.totalCount, 1);
    console.log("uncertain write protection PASS");
    await go("/transactions");
    const monthBefore = await page.locator(".m-label").innerText();
    await page.locator(".work-area").click({ position: { x: 10, y: 10 } });
    await page.keyboard.press("ArrowLeft");
    await settle();
    assert.notEqual(await page.locator(".m-label").innerText(), monthBefore);
    await page.keyboard.press("ArrowRight");
    await settle();
    await page.keyboard.press("/");
    assert(
      await page
        .getByLabel("搜索交易", { exact: true })
        .evaluate((el) => el === document.activeElement),
    );
    await page.getByLabel("搜索交易", { exact: true }).fill("午餐");
    await settle();
    await page.keyboard.press("Alt+n");
    await settle();
    assert(await page.locator(".workspace-sheet").isVisible());
    await page.getByRole("link", { name: "批量记账", exact: true }).click();
    await settle();
    await page.locator("#import-source").fill("-1 草稿");
    page.once("dialog", (dialog) => dialog.dismiss());
    await page.getByLabel("关闭面板", { exact: true }).click();
    await settle();
    assert(await page.locator(".workspace-sheet").isVisible());
    page.once("dialog", (dialog) => dialog.accept());
    await page.getByLabel("关闭面板", { exact: true }).click();
    await settle();
    assert.equal(
      await page.getByLabel("搜索交易", { exact: true }).inputValue(),
      "午餐",
    );
    await page.keyboard.press("Alt+n");
    await settle();
    await page.getByLabel("关闭面板", { exact: true }).focus();
    await page.keyboard.press("Shift+Tab");
    assert(
      await page
        .locator(".workspace-sheet")
        .evaluate((el) => el.contains(document.activeElement)),
    );
    await page.keyboard.press("Escape");
    await settle();
    assert.equal(await page.locator(".workspace-sheet").count(), 0);
    await page.getByRole("button", { name: /^筛选/ }).click();
    await page.getByLabel("最低金额", { exact: true }).fill("5");
    await page.getByRole("button", { name: "应用金额", exact: true }).click();
    await settle();
    await page.getByRole("button", { name: /^筛选/ }).click();
    await page.getByRole("button", { name: /^筛选/ }).click();
    assert.equal(
      await page.getByLabel("最低金额", { exact: true }).inputValue(),
      "5",
    );
    const old = await seed("/transactions", {
      type: "expense",
      amount: 100,
      accountId: f.accounts[0].id,
      categoryId: null,
      toAccountId: null,
      date: "2000-01-01",
      title: "历史跨度验证",
      note: null,
    });
    await go("/transactions?range=all");
    assert((await page.locator(".transaction-line").count()) > 0);
    assert.equal(await page.locator(".load-error").count(), 0);
    await page.getByRole("tab", { name: "洞察", exact: true }).click();
    await settle();
    assert(await page.getByText(/当前跨度超过 10 年/).isVisible());
    assert((await page.locator(".category-rank").count()) > 0);
    await api("/transactions/" + old.id, undefined, "DELETE");
    console.log(
      "keyboard, panel focus, draft leave guard, filter restore and long-history PASS",
    );

    assert.deepEqual(errors, []);
    console.log("ALL FLOWS PASS");
  } catch (e) {
    await page.screenshot({ path: resolve(output, "flow-failure.png") });
    throw e;
  }
  // Transitions must keep controls usable, preserve filters, and honor reduced motion.
  await go("/transactions");
  await page.getByLabel("搜索交易").fill("午餐");
  await settle();
  await page.getByRole("tab", { name: "明细" }).focus();
  await page.keyboard.press("ArrowRight");
  await settle();
  assert.equal(
    await page.getByRole("tab", { name: "洞察" }).getAttribute("aria-selected"),
    "true",
  );
  assert.equal(
    await page.evaluate(() => document.activeElement?.id),
    "insights-tab",
  );
  assert.equal(await page.getByLabel("搜索交易").inputValue(), "午餐");
  await page.keyboard.press("Home");
  await settle();
  assert.equal(
    await page.getByRole("tab", { name: "明细" }).getAttribute("aria-selected"),
    "true",
  );
  assert((await page.locator(".transaction-line").count()) > 0);
  for (const reducedMotion of ["no-preference", "reduce"]) {
    await page.emulateMedia({ reducedMotion });
    const filterButton = page.getByRole("button", { name: /^筛选/ });
    await filterButton.click();
    await settle();
    assert(await page.locator(".filter-content").isVisible());
    await filterButton.click();
    await page.locator(".filter-content").waitFor({ state: "detached" });
    for (let i = 0; i < 2; i++) {
      await page
        .getByRole("button", { name: "记一笔", exact: true })
        .first()
        .click();
      await page.getByLabel("标题", { exact: true }).waitFor();
      if (reducedMotion === "reduce") {
        assert.equal(
          await page
            .locator(".workspace-sheet")
            .evaluate((el) => getComputedStyle(el).transitionDuration),
          "0s",
        );
      }
      await page.getByRole("button", { name: "关闭面板" }).click();
      await page.locator(".workspace-sheet").waitFor({ state: "detached" });
      await settle();
      assert.equal(
        await page.locator(".workspace-shell").getAttribute("inert"),
        null,
      );
      assert.equal(await page.getByLabel("搜索交易").inputValue(), "午餐");
    }
    if (reducedMotion === "reduce") {
      assert.equal(
        await page
          .locator(".view-content")
          .evaluate((el) => getComputedStyle(el).animationName),
        "none",
      );
    }
  }
  await page.emulateMedia({ reducedMotion: "no-preference" });
  console.log(
    "tab keyboard navigation, transitions, filters and reduced motion PASS",
  );
  for (const width of [320, 375, 768, 1440]) {
    const p = await browser.newPage({
      viewport: { width, height: width > 720 ? 1000 : 667 },
    });
    p.on("pageerror", (e) => errors.push(e.message));
    const go = async (r) => {
      await p.goto("http://127.0.0.1:19190/ledger/" + r);
      await p.waitForTimeout(500);
    };
    for (const route of [
      "transactions",
      "accounts",
      "reports",
      "add",
      "batch",
    ]) {
      await go(route);
      assert(
        await p.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      );
      await p.screenshot({
        path: resolve(output, "final-" + route + "-" + width + ".png"),
      });
      if (route === "reports") {
        assert(await p.locator(".flow-chart").isVisible());
      }
    }
    await go("accounts");
    await p.getByRole("button", { name: "新建专项", exact: true }).click();
    const dialog = p.locator("dialog[open]");
    assert(await dialog.isVisible());
    await dialog
      .getByRole("button", { name: "保存", exact: true })
      .scrollIntoViewIfNeeded();
    const rect = await dialog.boundingBox();
    assert(
      rect.x >= 0 &&
        rect.y >= 0 &&
        rect.y + rect.height <= (width > 720 ? 1000 : 667),
    );
    await p.screenshot({
      path: resolve(output, "project-dialog-" + width + ".png"),
    });
    await dialog.getByRole("button", { name: "取消", exact: true }).click();
    await go("transactions?q=" + encodeURIComponent("不存在的交易"));
    assert(
      await p.getByText("当前条件下没有交易", { exact: true }).isVisible(),
    );
    // A stale category link must return no matches rather than all transactions.
    await go("transactions?category=" + encodeURIComponent("已删除的分类"));
    assert.equal(await p.locator(".transaction-line").count(), 0);
    // Empty account list remains actionable on phones.
    await p.route("**/api/accounts", (r) =>
      r.request().method() === "GET"
        ? r.fulfill({ json: { items: [], totalBalance: 0 } })
        : r.continue(),
    );
    await go("accounts");
    assert(
      await p
        .locator(".management-panel")
        .getByRole("button", { name: "新建账户", exact: true })
        .isVisible(),
    );
    await go("add");
    assert(
      await p.getByRole("link", { name: "创建账户", exact: true }).isVisible(),
    );
    await p.unroute("**/api/accounts");
    // Delayed loading and recoverable server response errors.
    await p.route("**/api/transactions/query", async (r) => {
      await new Promise((x) => setTimeout(x, 1500));
      await r.continue();
    });
    await p.goto("http://127.0.0.1:19190/ledger/transactions");
    await p.waitForTimeout(200);
    assert(await p.getByRole("status").count());
    await p.waitForTimeout(1600);
    await p.unroute("**/api/transactions/query");
    await p.route("**/api/statistics/summary", (r) =>
      r.fulfill({
        status: 503,
        json: { error: { code: "INTERNAL", message: "合成读取失败" } },
      }),
    );
    await go("transactions");
    await p.getByRole("alert").filter({ hasText: "合成读取失败" }).waitFor();
    await p.unroute("**/api/statistics/summary");
    await p.getByRole("button", { name: "重试", exact: true }).click();
    await p.waitForTimeout(500);
    assert(await p.locator(".transaction-line").count());
    console.log("PASS edges " + width);
    await p.close();
  }
  assert.deepEqual(errors, []);
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

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
    // Real clicks focus the pagination control. Removing it can force a layout
    // before Vue applies the result container's height reservation.
    for (const width of [1440, 375]) {
      await page.setViewportSize({ width, height: width === 375 ? 667 : 1000 });
      for (const reducedMotion of ["no-preference", "reduce"]) {
        await page.emulateMedia({ reducedMotion });
        await go("/transactions");
        await page.route("**/api/transactions/query", async (route) => {
          await new Promise((resolve) => setTimeout(resolve, 400));
          await route.continue();
        });
        const checkPaginationScroll = async (action, expectedPage) => {
          const top = await page.locator(".work-area").evaluate((area) => {
            area.scrollTop = area.scrollHeight;
            return area.scrollTop;
          });
          await page.evaluate((top) => {
            window.paginationFailures = [];
            const sample = () => {
              const area = document.querySelector(".work-area");
              const expected = Math.min(top, area.scrollHeight - area.clientHeight);
              if (Math.abs(area.scrollTop - expected) > 1)
                window.paginationFailures.push({ actual: area.scrollTop, expected });
              window.paginationFrame = requestAnimationFrame(sample);
            };
            sample();
          }, top);
          try {
            await action();
            await page.getByLabel("正在加载筛选结果", { exact: true }).waitFor();
            assert.equal(
              await page.locator(".work-area").evaluate((area) => area.scrollTop),
              top,
              "pagination must preserve scroll while loading",
            );
            await page.getByLabel("正在加载筛选结果", { exact: true })
              .waitFor({ state: "detached" });
            await page.waitForTimeout(80);
            assert.equal(
              await page.locator('.pagination [aria-current="page"]').innerText(),
              String(expectedPage),
            );
            assert.equal(
              await page.locator("#ledger-view").evaluate((el) => el.style.minHeight),
              "",
              "completed pagination must release its height reservation",
            );
            assert.deepEqual(
              await page.evaluate(() => window.paginationFailures),
              [],
              "pagination scroll at " + width + " / " + reducedMotion,
            );
          } finally {
            await page.evaluate(() => cancelAnimationFrame(window.paginationFrame));
          }
        };
        await checkPaginationScroll(
          () => page.getByLabel("每页条数").selectOption("20"), 1,
        );
        for (const [name, target] of [
          ["下一页", 2], ["上一页", 1], ["第 3 页", 3],
          ["第 1 页", 1], ["第 5 页", 5], ["上一页", 4],
        ]) {
          await checkPaginationScroll(
            () => page.getByRole("button", { name, exact: true }).click(), target,
          );
        }
        // A user may continue scrolling during the request; do not restore a
        // stale position when the new page arrives.
        await page.getByRole("button", { name: "上一页", exact: true }).click();
        await page.getByLabel("正在加载筛选结果", { exact: true }).waitFor();
        const movedTop = await page.locator(".work-area").evaluate((area) => {
          area.scrollTop -= 80;
          return area.scrollTop;
        });
        await page.getByLabel("正在加载筛选结果", { exact: true })
          .waitFor({ state: "detached" });
        assert.equal(
          await page.locator(".work-area").evaluate((area) => area.scrollTop),
          movedTop,
        );
        await page.unroute("**/api/transactions/query");
      }
      console.log("pagination click scroll, page sizes, short last page and loading scroll PASS " + width);
    }
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await go("/transactions");
    await page.getByLabel("搜索交易", { exact: true }).fill("¥230");
    await settle();
    assert.equal(await page.locator(".transaction-line").count(), 1);
    assert((await page.locator(".transaction-line").innerText()).includes("退款"));
    await page.getByRole("button", { name: /^筛选/ }).click();
    await page.getByLabel("金额", { exact: true }).uncheck();
    await settle();
    assert.equal(await page.locator(".transaction-line").count(), 0);
    assert.equal(
      new URL(page.url()).searchParams.get("fields"),
      "title,note,category",
    );
    await page.getByLabel("金额", { exact: true }).check();
    await settle();
    assert.equal(new URL(page.url()).searchParams.get("fields"), null);
    assert.equal(await page.locator(".transaction-line").count(), 1);
    console.log("amount search field PASS");
    await go("/transactions");
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
      await page.locator(".trend-point").first().click();
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
    await page.locator(".trend-point").last().click();
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
    await leapDay.click();
    for (const key of [
      "ArrowRight",
      "ArrowLeft",
      "ArrowDown",
      "ArrowUp",
      "Home",
      "End",
    ]) {
      await page.keyboard.press(key);
      assert.equal(
        await page.evaluate(() => document.activeElement.dataset.date),
        "2024-02-29",
      );
      assert(
        (await page.locator(".heatmap-detail").textContent()).includes(
          "2024-02-29",
        ),
      );
    }
    assert.equal(
      await leapDay.evaluate((el) => getComputedStyle(el).boxShadow),
      "none",
    );
    await page.getByLabel("热力图年份").selectOption("2025");
    assert.equal(await page.locator(".heatmap-day").count(), 365);
    console.log(
      "year insights layout, trend grouping, leap-year calendar and no keyboard selection PASS",
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
    assert(
      await page
        .getByLabel("金额（元）", { exact: true })
        .evaluate((el) => el === document.activeElement),
    );
    await page.keyboard.press("Escape");
    await settle();
    assert(await page.locator(".workspace-sheet").isVisible());
    assert(await page.getByText("再按一次 ESC 关闭").isVisible());
    await page.waitForTimeout(2000);
    assert.equal(await page.getByText("再按一次 ESC 关闭").count(), 0);
    await page.getByLabel("关闭面板", { exact: true }).focus();
    await page.keyboard.press("Shift+Tab");
    assert(
      await page
        .locator(".workspace-sheet")
        .evaluate((el) => el.contains(document.activeElement)),
    );
    await page.keyboard.press("Escape");
    assert(await page.locator(".workspace-sheet").isVisible());
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
  // Direction is a local presentation choice: no fetch, global skeleton, or layout jump.
  for (const width of [1440, 375]) {
    await page.setViewportSize({ width, height: width === 375 ? 667 : 1000 });
    await go("/transactions?view=insights");
    await page.locator(".trend-point").first().click();
    await page.locator(".heatmap-day").first().click();
    await page.locator(".direction-tabs").scrollIntoViewIfNeeded();
    await page.mouse.move(0, 0);
    const requests = [];
    const recordRequest = (request) => {
      if (new URL(request.url()).pathname.includes("/api/"))
        requests.push(new URL(request.url()).pathname);
    };
    page.on("request", recordRequest);
    await page.evaluate(() => {
      const selectors = [
        ".trend-section",
        ".activity-section",
        ".work-metrics",
      ];
      const area = document.querySelector(".work-area");
      const original = selectors.map((selector) => {
        const node = document.querySelector(selector);
        return {
          selector,
          node,
          html: node.innerHTML,
          top: node.getBoundingClientRect().top,
        };
      });
      const top = area.scrollTop;
      window.distributionFailures = [];
      const sample = () => {
        if (document.querySelector(".page-skeleton"))
          window.distributionFailures.push("global skeleton");
        if (Math.abs(area.scrollTop - top) > 1)
          window.distributionFailures.push("scroll moved");
        for (const entry of original) {
          const current = document.querySelector(entry.selector);
          if (current !== entry.node || current.innerHTML !== entry.html)
            window.distributionFailures.push("changed " + entry.selector);
          if (Math.abs(current.getBoundingClientRect().top - entry.top) > 1)
            window.distributionFailures.push("moved " + entry.selector);
        }
        window.distributionFrame = requestAnimationFrame(sample);
      };
      sample();
    });
    const tabs = page.locator(".direction-tabs");
    const activePanel = page.locator(".distribution-panel.is-active");
    await tabs.getByRole("button", { name: "收入", exact: true }).click();
    assert(
      await page.getByLabel("正在切换分类统计", { exact: true }).isVisible(),
    );
    assert.equal(
      await page.locator("#ledger-view").getAttribute("aria-busy"),
      "false",
    );
    await settle();
    assert.equal(
      await activePanel.locator(".distribution-total > .num").innerText(),
      await page.locator(".metric-income dd").innerText(),
    );
    assert((await activePanel.innerText()).includes("工资"));
    const values = await activePanel
      .locator(".category-rank strong")
      .allTextContents();
    const amounts = values.map((value) => Number(value.replaceAll(",", "")));
    assert.deepEqual(
      amounts,
      [...amounts].sort((a, b) => b - a),
    );
    // Repeat while the previous transition is still running; the last click wins.
    for (const name of ["支出", "收入", "支出"])
      await tabs.getByRole("button", { name, exact: true }).click();
    await settle();
    assert.equal(
      await tabs
        .getByRole("button", { name: "支出", exact: true })
        .getAttribute("aria-pressed"),
      "true",
    );
    assert.equal(
      await activePanel.locator(".distribution-total > .num").innerText(),
      await page.locator(".metric-expense dd").innerText(),
    );
    await page.emulateMedia({ reducedMotion: "reduce" });
    await tabs.getByRole("button", { name: "收入", exact: true }).click();
    await settle();
    assert.equal(
      await page.getByLabel("正在切换分类统计", { exact: true }).count(),
      0,
    );
    assert.equal(
      await activePanel.evaluate(
        (el) => getComputedStyle(el).transitionDuration,
      ),
      "0s",
    );
    assert.equal(
      await page
        .locator(".distribution-panel:not(.is-active)")
        .evaluate((el) => el.inert),
      true,
    );
    assert.deepEqual(
      await page.evaluate(() => {
        cancelAnimationFrame(window.distributionFrame);
        return [...new Set(window.distributionFailures)];
      }),
      [],
    );
    page.off("request", recordRequest);
    assert.deepEqual(
      requests,
      [],
      "Direction switching must reuse both totals",
    );
    // Element screenshots may scroll a tall panel; capture after movement assertions.
    await page.locator(".distribution").screenshot({
      path: resolve(output, "distribution-income-" + width + ".png"),
    });
    // Clicking a displayed income category still opens the matching filtered transactions.
    await activePanel.getByRole("button").filter({ hasText: "工资" }).click();
    await settle();
    assert.equal(new URL(page.url()).searchParams.get("types"), "income");
    assert.deepEqual(
      JSON.parse(new URL(page.url()).searchParams.get("categories")),
      ["工资"],
    );
    assert((await page.locator(".transaction-line").count()) > 0);
    await page.emulateMedia({ reducedMotion: "no-preference" });
    console.log(
      "local category transition, no requests or layout jumps, rapid switching, reduced motion and income drilldown PASS " +
        width,
    );
  }
  // Returning to the tab refreshes data without replacing content or resetting page/state.
  const returnToPage = () =>
    page.evaluate(() => {
      document.dispatchEvent(new Event("visibilitychange"));
      window.dispatchEvent(new Event("focus"));
      window.dispatchEvent(new Event("focus"));
    });
  for (const width of [1440, 375]) {
    await page.setViewportSize({ width, height: width === 375 ? 667 : 1000 });
    for (const view of ["list", "insights"]) {
      await go("/transactions?view=" + view);
      if (view === "list") {
        await page
          .getByLabel("展示排序", { exact: true })
          .selectOption("time-asc");
        await settle();
        await page
          .getByRole("button", { name: "第 2 页", exact: true })
          .click();
        await settle();
      } else {
        await page.locator(".trend-point").first().click();
        await page.locator(".heatmap-day").first().click();
        // Chart clicks now open a popup. Close it before capturing unchanged
        // chart markup so intentional scroll-dismissal is not a refresh failure.
        await page.getByRole("region", { name: "区间收支明细" }).waitFor();
        await page.keyboard.press("Escape");
        await page.getByRole("region", { name: "区间收支明细" }).waitFor({ state: "hidden" });
      }
      await page.mouse.move(0, 0);
      let queries = 0,
        accounts = 0,
        bounds = 0;
      const count = (request) => {
        const path = new URL(request.url()).pathname;
        if (path.endsWith("/transactions/query")) queries++;
        if (path.endsWith("/accounts")) accounts++;
        if (path.endsWith("/ledger/info")) bounds++;
      };
      page.on("request", count);
      await page.route("**/api/transactions/query", async (route) => {
        await new Promise((resolve) => setTimeout(resolve, 450));
        await route.continue();
      });
      const before = await page.evaluate(() => {
        const area = document.querySelector(".work-area");
        document.activeElement?.blur();
        area.scrollTop = Math.min(250, area.scrollHeight - area.clientHeight);
        const original =
          document.querySelector(".view-content").firstElementChild;
        const html = original.innerHTML;
        const top = area.scrollTop;
        window.refreshFailures = [];
        const sample = () => {
          if (document.querySelector(".page-skeleton"))
            window.refreshFailures.push("skeleton");
          if (
            document.querySelector(".view-content").firstElementChild !==
            original
          )
            window.refreshFailures.push("remount");
          if (original.innerHTML !== html)
            window.refreshFailures.push("unchanged data rerendered");
          if (Math.abs(area.scrollTop - top) > 1)
            window.refreshFailures.push("scroll moved");
          window.refreshFrame = requestAnimationFrame(sample);
        };
        sample();
        return {
          url: location.href,
          currentPage: document.querySelector('[aria-current="page"]')
            ?.textContent,
        };
      });
      const updated = page.waitForResponse((response) =>
        response.url().endsWith("/api/transactions/query"),
      );
      await returnToPage();
      await page.waitForTimeout(180);
      await returnToPage();
      await updated;
      await settle();
      assert.deepEqual(
        await page.evaluate(() => {
          cancelAnimationFrame(window.refreshFrame);
          return [...new Set(window.refreshFailures)];
        }),
        [],
      );
      assert.equal(queries, 1);
      assert.equal(accounts, 1);
      assert.equal(bounds, 1);
      assert.equal(page.url(), before.url);
      assert.equal(
        await page.evaluate(
          () => document.querySelector('[aria-current="page"]')?.textContent,
        ),
        before.currentPage,
      );
      page.off("request", count);
      await page.unroute("**/api/transactions/query");
      console.log(
        "background return refresh preserves content, scroll, pagination and chart state PASS " +
          width +
          " " +
          view,
      );
    }
  }
  // Changes from another client become visible after returning, including current category filters.
  await go("/transactions?category=" + encodeURIComponent("餐饮"));
  const extra = await api("/transactions", {
    type: "expense",
    amount: 12345,
    accountId: f.accounts[0].id,
    categoryId: f.cats.find(
      (category) =>
        category.accountId === f.accounts[0].id && category.name === "餐饮",
    ).id,
    toAccountId: null,
    date: f.today,
    title: "其他窗口新增验证",
    note: null,
  });
  try {
    await returnToPage();
    await page.getByText("其他窗口新增验证", { exact: true }).waitFor();
    assert(page.url().includes("category"));
    // Failed background reads keep previous results visible and offer a retry.
    await page.route("**/api/statistics/summary", (route) =>
      route.fulfill({
        status: 503,
        json: { error: { code: "INTERNAL", message: "合成后台失败" } },
      }),
    );
    await returnToPage();
    await page
      .getByRole("alert")
      .filter({ hasText: "更新失败，仍显示上次数据" })
      .waitFor();
    assert(
      await page.getByText("其他窗口新增验证", { exact: true }).isVisible(),
    );
    assert.equal(await page.locator(".page-skeleton").count(), 0);
    await page.unroute("**/api/statistics/summary");
    await page.getByRole("button", { name: "重试", exact: true }).click();
    await page
      .getByRole("alert")
      .filter({ hasText: "更新失败" })
      .waitFor({ state: "detached" });
  } finally {
    await page.unroute("**/api/statistics/summary");
    await api("/transactions/" + extra.id, undefined, "DELETE");
  }
  // A delayed background result cannot overwrite a newer user-selected filter.
  for (const endpoint of ["accounts", "transactions/query"]) {
    await go("/transactions");
    let delayed = false;
    await page.route("**/api/" + endpoint, async (route) => {
      if (!delayed) {
        delayed = true;
        const response = await route.fetch();
        await new Promise((resolve) => setTimeout(resolve, 650));
        await route.fulfill({ response });
      } else await route.continue();
    });
    const started = page.waitForRequest((request) =>
      request.url().endsWith("/api/" + endpoint),
    );
    await returnToPage();
    await started;
    await page
      .getByLabel("搜索交易", { exact: true })
      .fill("不存在的返回刷新结果");
    await page.getByText("当前条件下没有交易", { exact: true }).waitFor();
    await page.waitForTimeout(750);
    assert.equal(await page.locator(".transaction-line").count(), 0);
    assert.equal(
      await page.getByLabel("搜索交易", { exact: true }).inputValue(),
      "不存在的返回刷新结果",
    );
    await page.unroute("**/api/" + endpoint);
  }
  await go("/add");
  await page.waitForLoadState("networkidle");
  await page.getByLabel("标题", { exact: true }).fill("切回保留草稿");
  let draftRequests = 0;
  const draftRequest = (request) => {
    if (new URL(request.url()).pathname.includes("/api/")) draftRequests++;
  };
  page.on("request", draftRequest);
  await returnToPage();
  await settle();
  page.off("request", draftRequest);
  assert.equal(draftRequests, 0);
  assert.equal(
    await page.getByLabel("标题", { exact: true }).inputValue(),
    "切回保留草稿",
  );
  console.log(
    "return refresh updates data, preserves filters/drafts, recovers from failure and rejects stale results PASS",
  );
  // Page shortcuts never traverse unrelated controls or intercept modal/input editing.
  for (const width of [1440, 375]) {
    await page.setViewportSize({ width, height: width === 375 ? 667 : 1000 });
    await go("/transactions");
    const initialMonth = await page.locator(".m-label").innerText();
    const search = page.getByLabel("搜索交易", { exact: true });
    await search.fill("午餐");
    await search.evaluate((el) => el.setSelectionRange(2, 2));
    await page.keyboard.press("ArrowLeft");
    assert.equal(await search.evaluate((el) => el.selectionStart), 1);
    assert.equal(await page.locator(".m-label").innerText(), initialMonth);
    await page.keyboard.press("Tab");
    await settle();
    assert.equal(
      await page
        .getByRole("tab", { name: "洞察" })
        .getAttribute("aria-selected"),
      "true",
    );
    assert(await page.evaluate(() => document.activeElement === document.body));
    assert.equal(await search.inputValue(), "午餐");
    // A clicked tab or calendar day must not steal month shortcuts.
    await page.getByRole("tab", { name: "洞察" }).focus();
    await page.keyboard.press("ArrowLeft");
    await settle();
    assert.notEqual(await page.locator(".m-label").innerText(), initialMonth);
    assert.equal(
      await page
        .getByRole("tab", { name: "洞察" })
        .getAttribute("aria-selected"),
      "true",
    );
    await page.locator(".heatmap-day").first().click();
    await page.keyboard.press("ArrowRight");
    await settle();
    assert.equal(await page.locator(".m-label").innerText(), initialMonth);
    await page.keyboard.press("Shift+Tab");
    await settle();
    assert.equal(
      await page
        .getByRole("tab", { name: "明细" })
        .getAttribute("aria-selected"),
      "true",
    );
    await page.locator(".transaction-line").first().click();
    await page.keyboard.press("Tab");
    await page.keyboard.press("ArrowLeft");
    assert(
      await page
        .locator("dialog[open]")
        .evaluate((el) => el.contains(document.activeElement)),
    );
    assert.equal(await page.locator(".m-label").innerText(), initialMonth);
    assert.equal(
      await page
        .getByRole("tab", { name: "明细" })
        .getAttribute("aria-selected"),
      "true",
    );
    await page.getByLabel("关闭详情", { exact: true }).click();
    const dateRead = page.waitForResponse((r) =>
      r.url().endsWith("/api/statistics/daily"),
    );
    await page.getByRole("button", { name: /^筛选/ }).focus();
    await page.keyboard.press("Tab");
    await dateRead;
    await settle();
    assert(await page.evaluate(() => document.activeElement === document.body));
    await page.keyboard.press("Tab");
    await settle();
    await go("/add?account=" + f.accounts[0].id);
    const amount =
      width === 375
        ? page.getByLabel("金额（元）", { exact: true })
        : page.getByRole("group", { name: "金额", exact: true });
    const title = page.getByLabel("标题", { exact: true });
    const note = page.locator("#txn-note");
    const focused = async (locator) =>
      assert(await locator.evaluate((el) => el === document.activeElement));
    await focused(amount);
    await page.getByLabel("关闭面板", { exact: true }).focus();
    await page.keyboard.press("Tab");
    await focused(amount);
    await page.keyboard.type("12.34");
    await page.keyboard.press("Tab");
    await focused(title);
    await page.keyboard.type("键盘草稿");
    await page.keyboard.press("Tab");
    await focused(note);
    await page.keyboard.type("备注草稿");
    await page.keyboard.press("ArrowLeft");
    assert.equal(await note.evaluate((el) => el.selectionStart), 3);
    await page.keyboard.press("Tab");
    await focused(amount);
    await page.keyboard.press("Shift+Tab");
    await focused(note);
    await page.keyboard.press("Shift+Tab");
    await focused(title);
    await page.keyboard.press("Shift+Tab");
    await focused(amount);
    await page.getByLabel("账户", { exact: true }).focus();
    await page.keyboard.press("Tab");
    await focused(amount);
    await page.getByLabel("关闭面板", { exact: true }).focus();
    await page.keyboard.press("Shift+Tab");
    await focused(note);
    for (const field of [amount, title, note]) {
      await field.focus();
      const style = await field.evaluate((el) => {
        const styles = getComputedStyle(el);
        return { outline: styles.outlineStyle, shadow: styles.boxShadow };
      });
      assert.deepEqual(style, { outline: "none", shadow: "none" });
    }
    assert.equal(
      await page
        .locator(".entry-amount")
        .evaluate((el) => getComputedStyle(el).boxShadow),
      "none",
    );
    assert.equal(await title.inputValue(), "键盘草稿");
    assert.equal(await note.inputValue(), "备注草稿");
    assert.equal(await page.locator(".m-label").innerText(), initialMonth);
    if (width === 375) assert.equal(await amount.inputValue(), "12.34");
    else assert((await amount.innerText()).includes("12.34"));
    await page.getByLabel("关闭面板", { exact: true }).click();
    await settle();
    await page.keyboard.press("Tab");
    await settle();
    assert.equal(
      await page
        .getByRole("tab", { name: "洞察" })
        .getAttribute("aria-selected"),
      "true",
    );
    console.log(
      "page shortcuts, field cycle, modal isolation and no focus highlights PASS " +
        width,
    );
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  // Transitions must keep controls usable, preserve filters, and honor reduced motion.
  await go("/transactions");
  await page.getByLabel("搜索交易").fill("午餐");
  await settle();
  await page.getByRole("tab", { name: "明细" }).focus();
  await page.keyboard.press("Tab");
  await settle();
  assert.equal(
    await page.getByRole("tab", { name: "洞察" }).getAttribute("aria-selected"),
    "true",
  );
  assert.equal(
    await page.evaluate(() => document.activeElement === document.body),
    true,
  );
  assert.equal(await page.getByLabel("搜索交易").inputValue(), "午餐");
  await page.keyboard.press("Shift+Tab");
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
  // Closing a panel refreshes in the background without swapping in a skeleton.
  for (const view of ["list", "insights"]) {
    await go(
      "/transactions?range=all" + (view === "insights" ? "&view=insights" : ""),
    );
    const scrollBefore = await page.locator(".work-area").evaluate((area) => {
      area.scrollTop = Math.min(120, area.scrollHeight - area.clientHeight);
      return area.scrollTop;
    });
    await page.getByRole("button", { name: "记一笔", exact: true }).first().click();
    await page.getByLabel("标题", { exact: true }).waitFor();
    await page.evaluate(() => {
      window.__panelCloseFlashes = [];
      const area = document.querySelector(".work-area");
      window.__panelCloseObserver = new MutationObserver(() => {
        if (
          area.querySelector(".page-skeleton") ||
          area.querySelector('[aria-busy="true"]')
        )
          window.__panelCloseFlashes.push(performance.now());
      });
      window.__panelCloseObserver.observe(area, {
        subtree: true,
        childList: true,
        attributes: true,
        attributeFilter: ["aria-busy"],
      });
    });
    let refreshed = false;
    await page.route("**/api/transactions/query", async (r) => {
      refreshed = true;
      await new Promise((resolve) => setTimeout(resolve, 400));
      await r.continue();
    });
    await page.getByRole("button", { name: "关闭面板" }).click();
    await page.locator(".workspace-sheet").waitFor({ state: "detached" });
    await page.waitForTimeout(900);
    await page.unroute("**/api/transactions/query");
    assert(refreshed, "closing the panel should refresh in the background");
    assert.deepEqual(
      await page.evaluate(() => {
        window.__panelCloseObserver.disconnect();
        return window.__panelCloseFlashes;
      }),
      [],
    );
    assert.equal(
      await page.locator(".work-area").evaluate((area) => area.scrollTop),
      scrollBefore,
    );
  }
  console.log("panel close background refresh without skeleton PASS");
  // A short loading skeleton must not shrink the scroll range during view/month changes.
  const previousMonthDate = new Date(f.month + "-01T00:00:00Z");
  previousMonthDate.setUTCMonth(previousMonthDate.getUTCMonth() - 1);
  const previousMonth = previousMonthDate.toISOString().slice(0, 7);
  const scrollFixtures = [];
  try {
    for (let i = 0; i < 14; i++)
      scrollFixtures.push(
        await seed("/transactions", {
          type: "expense",
          amount: 100 + i,
          accountId: f.accounts[0].id,
          categoryId: null,
          toAccountId: null,
          date: previousMonth + "-" + String(i + 1).padStart(2, "0"),
          title: "滚动位置验证",
          note: null,
        }),
      );
    const delayedQuery = async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 600));
      await route.continue();
    };
    for (const width of [1440, 375]) {
      await page.setViewportSize({ width, height: width === 375 ? 667 : 1000 });
      await go("/transactions");
      await page.route("**/api/transactions/query", delayedQuery);
      const position = width === 375 ? 700 : 240;
      const beginScrollCheck = async () => {
        await page.locator(".work-area").evaluate((area, position) => {
          document.activeElement?.blur();
          area.scrollTop = position;
        }, position);
        await page.waitForTimeout(50);
        assert.equal(
          await page.locator(".work-area").evaluate((area) => area.scrollTop),
          position,
        );
        await page.evaluate(() => {
          window.scrollSamples = [];
          const sample = () => {
            window.scrollSamples.push(
              document.querySelector(".work-area").scrollTop,
            );
            window.scrollSampleFrame = requestAnimationFrame(sample);
          };
          sample();
        });
      };
      const endScrollCheck = async (label, expected = position) => {
        const samples = await page.evaluate(() => {
          cancelAnimationFrame(window.scrollSampleFrame);
          return window.scrollSamples;
        });
        assert(samples.length > 0);
        assert(
          samples.every((top) => Math.abs(top - expected) <= 1),
          label +
            " moved scroll position at " +
            width +
            ": " +
            JSON.stringify([...new Set(samples)]),
        );
      };
      for (const reducedMotion of ["no-preference", "reduce"]) {
        await page.emulateMedia({ reducedMotion });
        for (const key of ["Tab", "Shift+Tab", "ArrowLeft", "ArrowRight"]) {
          await beginScrollCheck();
          await page.keyboard.press(key);
          await page.getByLabel("正在加载筛选结果", { exact: true }).waitFor();
          await page
            .getByLabel("正在加载筛选结果", { exact: true })
            .waitFor({ state: "detached" });
          await page.waitForTimeout(100);
          await endScrollCheck(reducedMotion + " " + key);
        }
      }
      // Requests can overlap when the user switches quickly; the reservation must survive them.
      await beginScrollCheck();
      await page.keyboard.press("Tab");
      await page.waitForTimeout(220);
      await page.keyboard.press("ArrowLeft");
      await page.waitForTimeout(220);
      await page.keyboard.press("ArrowRight");
      await page.waitForTimeout(220);
      await page.keyboard.press("Tab");
      await page.getByLabel("正在加载筛选结果", { exact: true }).waitFor();
      await page
        .getByLabel("正在加载筛选结果", { exact: true })
        .waitFor({ state: "detached" });
      await page.waitForTimeout(100);
      await endScrollCheck("rapid switches");
      // Scrolling remains usable during loading; completion must not restore an old snapshot.
      await beginScrollCheck();
      await page.keyboard.press("Tab");
      await page.getByLabel("正在加载筛选结果", { exact: true }).waitFor();
      await page.evaluate(() => cancelAnimationFrame(window.scrollSampleFrame));
      await page.locator(".work-area").evaluate((area, top) => {
        area.scrollTop = top;
      }, position - 80);
      await page
        .getByLabel("正在加载筛选结果", { exact: true })
        .waitFor({ state: "detached" });
      assert.equal(
        await page.locator(".work-area").evaluate((area) => area.scrollTop),
        position - 80,
      );
      await page.keyboard.press("Tab");
      await page
        .getByLabel("正在加载筛选结果", { exact: true })
        .waitFor({ state: "detached" });
      await page.unroute("**/api/transactions/query", delayedQuery);
      // A genuinely shorter result clamps once to its natural end and leaves no blank filler.
      await page.route("**/api/transactions/query", async (route) => {
        await new Promise((resolve) => setTimeout(resolve, 600));
        await route.fulfill({
          json: { items: [], totalCount: 0, dayTotals: {} },
        });
      });
      await beginScrollCheck();
      await page.keyboard.press("ArrowLeft");
      await page.getByLabel("正在加载筛选结果", { exact: true }).waitFor();
      assert.equal(
        await page.locator(".work-area").evaluate((area) => area.scrollTop),
        position,
      );
      await page
        .getByLabel("正在加载筛选结果", { exact: true })
        .waitFor({ state: "detached" });
      const shorter = await page
        .locator(".work-area")
        .evaluate((area) => ({
          top: area.scrollTop,
          max: area.scrollHeight - area.clientHeight,
          minHeight: document.querySelector(".view-content").style.minHeight,
        }));
      assert.equal(shorter.top, Math.min(position, shorter.max));
      assert.equal(shorter.minHeight, "");
      await page.evaluate(() => cancelAnimationFrame(window.scrollSampleFrame));
      await page.unroute("**/api/transactions/query");
      await page.keyboard.press("ArrowRight");
      await settle();
      console.log(
        "scroll continuity, rapid switching, loading scroll and short result boundary PASS " +
          width,
      );
    }
  } finally {
    await page.evaluate(() => cancelAnimationFrame(window.scrollSampleFrame));
    await page.unroute("**/api/transactions/query");
    for (const txn of scrollFixtures)
      await api("/transactions/" + txn.id, undefined, "DELETE");
    await page.emulateMedia({ reducedMotion: "no-preference" });
  }
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

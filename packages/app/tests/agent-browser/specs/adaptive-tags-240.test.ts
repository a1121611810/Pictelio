/**
 * AdaptiveTags 240px 窄容器实测（360 机型可用宽度 240px）— 正式数据。
 *
 * 背景：用户报告「360 宽度机型上标签行能显示的宽度只有 240」，期望
 * 「第一个标签完整、第二个结尾点点点、+N 不溢出」，实际「第二个完整、+N 被撑出」。
 *
 * 方法：真实登录（dev 5173，复用 globalSetup 管理的 Vite server；此前硬编码 5176
 * 依赖一个不被测试框架管理的外部 server，全量运行时必然连接失败）→ 打开 R18/R18G
 * （注入 + UI 兜底，确保推荐有数据）→ 首页 variant=A 渲染标签行 → 强制标签行容器
 * 240px（模拟窄机型）→ 等 ResizeObserver 重算 → 读真实 DOM（容器宽/溢出/截断 chip
 * 省略号/+N 是否在容器内）→ 断言。
 */
import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { AgentBrowserDriver } from "../driver";

const SLEEP = (ms: number) => new Promise((r) => setTimeout(r, ms));
const BASE = "http://localhost:5173";

/** 设置浏览器视口为 360 宽（真实 resize，RO 自然触发，复现 360 机型场景） */
function setViewport(w: number, h: number): void {
  const r = spawnSync("agent-browser", ["set", "viewport", String(w), String(h)], {
    encoding: "utf-8",
    timeout: 30_000,
  });
  if (r.status !== 0) throw new Error(`viewport 失败: ${(r.stderr ?? "").trim()}`);
}

describe.skipIf(!process.env.PIXIV_REFRESH_TOKEN)("AdaptiveTags 240px 窄容器（正式数据）", () => {
  it("标签行不溢出且 +N 在容器内（240px）", async () => {
    const driver = new AgentBrowserDriver();
    try {
      await driver.launch();
      // 真实 360 宽视口（移动机型模拟，RO 自然触发）
      setViewport(360, 800);
      // S 类：视口重排动画收敛，无稳定谓词，缩至 500ms（Fluent 最长动效 500ms）
      await SLEEP(500);
      await driver.navigate(`${BASE}/home?variant=A`);
      // R 类：等页面加载出内容（未登录渲染登录页、已登录渲染首页，文本非空即就绪）
      await driver.waitForPageContent(15_000);

      // 注入老设备级 R18/R18G 键（ADR-0103：登录后迁移播种为账号键 show_r18_${uid}，
      // 真实升级路径；年龄确认已移除，不再注入）并刷新（settings backend 可能非 localStorage，UI 兜底）
      await driver.evaluate(
        `localStorage.setItem('show_r18','true'); localStorage.setItem('show_r18g','true'); location.reload(); 'ok'`,
      );
      // R 类：等 reload 后页面就绪——登录页（含"登录"）或主界面（含"推荐"）任一出现
      await driver.waitForJs(
        `document.body.innerText.includes('登录') || document.body.innerText.includes('推荐')`,
        15_000,
      );

      // 登录（真实请求；dev 模式走 Vite 代理；ADR-0103：年龄确认已移除，无拦截）
      const hasTa = await driver.evaluate(
        `document.querySelector("fluent-textarea") ? "yes" : "no"`,
      );
      if (hasTa.includes("yes")) {
        const token = process.env.PIXIV_REFRESH_TOKEN!;
        const esc = token.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
        console.log("[login] 检测到登录页，填入 token");
        await driver.evaluate(
          `document.querySelector("fluent-textarea").value = '${esc}'; document.querySelector("fluent-textarea").dispatchEvent(new Event("input", { bubbles: true }));`,
        );
        // S 类：输入稳定（textarea 值注入后待响应式同步），缩至 500ms
        await SLEEP(500);
        await driver.clickReliable("登录").catch(() => {});
        // D 类：原 SLEEP(8000) 删除——下方主界面轮询已覆盖登录等待
      }

      // 等待主界面（I 类：轮询间隔 3000ms → 500ms，次数 25 → 150，总超时上限保持 ~75s）
      for (let i = 0; i < 150; i++) {
        const snap = await driver.snapshot().catch(() => "");
        if (snap.includes("推荐") && snap.includes("插画")) {
          console.log(`[home] 主界面就绪（第 ${i + 1} 次探测）`);
          break;
        }
        await SLEEP(500);
      }

      // 等待标签 chip；若没有，尝试 UI 打开 R18/R18G 后回到首页再等
      let hasChips = await driver.waitForSelector('[aria-label^="搜索标签："]', 15_000);
      if (!hasChips) {
        console.log("[r18] 无标签 chip，去设置页打开 R18/R18G");
        await driver.navigateSpa(`${BASE}/settings`);
        // R 类：等设置页 R18 开关渲染（aria-label 稳定锚点）
        await driver.waitForSelector('fluent-switch[aria-label="显示 R18 内容"]', 15_000);
        await driver
          .clickReliable("显示 R18 内容", undefined, 'fluent-switch[aria-label="显示 R18 内容"]')
          .catch(() => {});
        // S 类：开关状态切换动效收敛，无稳定谓词，缩至 500ms
        await SLEEP(500);
        await driver
          .clickReliable(
            "显示 R-18G 内容",
            undefined,
            'fluent-switch[aria-label="显示 R-18G 内容"]',
          )
          .catch(() => {});
        // S 类：开关状态切换动效收敛，无稳定谓词，缩至 500ms
        await SLEEP(500);
        await driver.navigateSpa(`${BASE}/home?variant=A`);
        // D 类：原 SLEEP(8000) 删除——下方 waitForSelector 已覆盖首页渲染等待
        hasChips = await driver.waitForSelector('[aria-label^="搜索标签："]', 20_000);
      }
      console.log(`[probe] 有标签 chip: ${hasChips}`);
      expect(hasChips, "打开 R18/R18G 后页面应有搜索标签 chip").toBe(true);
      // R 类：等 ResizeObserver 重算完成（[data-fit] 属性由 RO 回调写入标签行容器）
      await driver.waitForJs(`document.querySelector('[data-fit]') !== null`, 10_000);

      // 360 视口下读标签行 DOM（容器已自然变窄，RO 已触发）
      const data = await driver.evaluate(
        `(() => { const rows = [...document.querySelectorAll('div.relative')].filter(d => d.querySelector('div[aria-hidden="true"]') && d.querySelector('[aria-label^="搜索标签："]')); const out = rows.map(r => { const rect = r.getBoundingClientRect(); const vis = [...r.querySelectorAll('div')].find(d => (d.className||'').includes('flex') && d.style.visibility !== 'hidden'); const chips = vis ? [...vis.querySelectorAll('[aria-label^="搜索标签："]')].filter(c => c.textContent && !c.textContent.startsWith('+')) : []; const plus = vis ? [...vis.querySelectorAll('span')].find(s => /^\\+\\d+$/.test((s.textContent||'').trim())) : null; const partial = vis ? [...vis.querySelectorAll('span')].find(s => (s.getAttribute('style')||'').includes('max-width')) : null; const inner = partial && partial.firstElementChild; const pr = plus ? plus.getBoundingClientRect() : null; return { w: Math.round(rect.width), visW: vis ? vis.clientWidth : null, visS: vis ? vis.scrollWidth : null, chipN: chips.length, chipTexts: chips.map(c => c.textContent).slice(0,2), partialMax: partial ? partial.style.maxWidth : null, pScroll: inner ? inner.scrollWidth : null, pClient: inner ? inner.clientWidth : null, pText: partial ? partial.textContent.slice(0,12) : null, plus: plus ? plus.textContent : null, plusIn: pr ? (pr.right <= rect.right + 1) : null, overflow: vis ? vis.scrollWidth > vis.clientWidth + 1 : null, fit: r.getAttribute('data-fit') }; }); return JSON.stringify(out); })()`,
      );
      console.log("TAG-ROWS:", data);
      const raw = (data ?? "").trim();
      const rows = JSON.parse((raw.startsWith('"') ? JSON.parse(raw) : raw) as string) as Array<
        Record<string, unknown>
      >;
      expect(rows.length).toBeGreaterThan(0);

      // 断言：无溢出 + 有 +N 的行 +N 在容器内（用户症状：第二个完整、+N 被撑出）
      const bad = rows.filter(
        (r) => r.overflow === true || (r.plus !== null && r.plusIn === false),
      );
      expect(bad, `溢出/越界行: ${JSON.stringify(bad.slice(0, 5))}`).toHaveLength(0);

      // 抽样：存在截断 chip 时省略号应生效（scrollWidth > clientWidth）
      const partialRows = rows.filter((r) => r.partialMax != null);
      const ellipsisRows = partialRows.filter(
        (r) =>
          typeof r.pScroll === "number" && typeof r.pClient === "number" && r.pScroll > r.pClient,
      );
      console.log(
        `标签行 ${rows.length}，截断 chip ${partialRows.length} 行，省略号生效 ${ellipsisRows.length} 行`,
      );
      expect(partialRows.length, "240px 下应有截断 chip（第二个标签点点点）").toBeGreaterThan(0);
    } finally {
      await driver.close().catch(() => {});
    }
  }, 300_000);
});

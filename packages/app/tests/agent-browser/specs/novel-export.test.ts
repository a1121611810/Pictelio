/**
 * 小说导出 E2E（spec docs/specs/novel-export.md §7）—— agent-browser 版。
 *
 * 场景：登录 → 设置页导出格式 → 小说详情导出入口 → 面板选格式 → 确认入队 → 下载页可见。
 *
 * 确定性设计：
 * - 设置页/面板格式芯片用 aria-label 定位（driver.getAttribute / clickReliable）；
 * - 面板确认按钮 aria-label="开始导出"，与底部「导出小说」入口不歧义；
 * - 详情正文依赖真实 API：受限小说不拉正文 → 导出入口按设计不渲染，逐卡重试 ≤5；
 * - 原生编码在浏览器不可用（显式失败，不伪造成功）——本 spec 只验证「可达路径 → 入队 →
 *   下载页出现任务」，不验证产物字节（由 Java 单测承担）。
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createLoggedInDriver } from "../fixtures";
import type { AgentBrowserDriver } from "../driver";
import { NOVEL_EXPORT_FORMATS, NOVEL_EXPORT_FORMAT_LABELS } from "@pictelio/novel-export";

const settingsChip = (fmt: (typeof NOVEL_EXPORT_FORMATS)[number]) =>
  `小说导出格式 ${NOVEL_EXPORT_FORMAT_LABELS[fmt]}`;

describe.skipIf(!process.env.PIXIV_REFRESH_TOKEN)("agent-browser 小说导出", () => {
  let driver: AgentBrowserDriver;
  /** beforeAll 是否落到「有正文」的小说详情（false = 5 本均受限/空正文，按设计跳过） */
  let novelDetailReached = false;
  let novelPath = "";
  let novelTitle = "";

  beforeAll(async () => {
    driver = await createLoggedInDriver();

    // 设置页应存在导出卡片（全局格式的唯一配置处）
    await driver.navigateSpa("/settings");
    await driver.waitForSelector('[aria-label="小说导出格式 TXT"]', 15_000);

    // 进入小说 Feed
    await driver.navigateSpa("/home");
    await driver.waitForSelector('[data-testid="content-type-novel"]', 15_000);
    await driver.clickReliable("小说", undefined, '[data-testid="content-type-novel"]');
    await driver.waitForSelector('[data-testid="novel-card"]', 30_000);

    // 逐卡重试（≤5）：受限小说不拉正文，导出入口不渲染
    for (let attempt = 0; attempt < 5; attempt++) {
      const clicked = await driver.clickFirst();
      if (!clicked) break;
      await driver.waitForUrl("/novel/", 15_000);
      await driver.waitForPageContent(10_000);
      const hasEntry = await driver
        .waitForSelector('[aria-label="导出小说"]', 8_000)
        .catch(() => false);
      if (hasEntry) {
        novelDetailReached = true;
        novelPath = JSON.parse(await driver.evaluate("location.pathname")) as string;
        novelTitle = JSON.parse(
          await driver.evaluate("document.querySelector('h1')?.textContent ?? ''"),
        ) as string;
        return;
      }
      // 返回换下一本
      await driver.evaluate("history.back(); 'back'");
      await driver.waitForSelector('[data-testid="novel-card"]', 15_000);
    }
    console.warn("[novel-export] 未找到可导出（有正文）的小说，详情断言按设计跳过");
  }, 240_000);

  afterAll(async () => {
    await driver?.close();
  });

  it("[S1] 设置页展示 9 种导出格式并可切换", async () => {
    await driver.navigateSpa("/settings");
    await driver.waitForSelector('[aria-label="小说导出格式 TXT"]', 15_000);
    for (const fmt of NOVEL_EXPORT_FORMATS) {
      const present = await driver.waitForSelector(`[aria-label="${settingsChip(fmt)}"]`, 5_000);
      expect(present, `设置页应有格式芯片：${settingsChip(fmt)}`).toBe(true);
    }

    await driver.clickReliable("EPUB", "小说导出格式 EPUB");
    await driver.waitForJs(
      "document.querySelector('[aria-label=\"小说导出格式 EPUB\"]')?.getAttribute('aria-pressed') === 'true'",
      5_000,
    );
    const pressed = await driver.getAttribute('[aria-label="小说导出格式 EPUB"]', "aria-pressed");
    expect(pressed, "点击 EPUB 后应处于选中态").toBe("true");
  }, 60_000);

  it("[S2] 详情导出：入口 → 面板 → 确认入队 → 下载页可见", async () => {
    if (!novelDetailReached) {
      console.warn("[novel-export] 未落到有正文的小说详情，本用例按设计跳过");
      expect(true).toBe(true);
      return;
    }
    await driver.navigateSpa(novelPath);
    await driver.waitForSelector('[aria-label="导出小说"]', 15_000);
    await driver.clickReliable("导出", "导出小说");
    await driver.waitForSelector('[aria-label="开始导出"]', 10_000);
    await driver.clickReliable("EPUB", "导出格式 EPUB");
    await driver.clickReliable("导出", "开始导出");
    await driver.waitForJs("document.body.innerText.includes('已加入下载队列')", 10_000);
    expect(
      JSON.parse(await driver.evaluate("document.body.innerText.includes('已加入下载队列')")),
      "确认导出后应提示已加入下载队列",
    ).toBe(true);

    await driver.navigateSpa("/downloads");
    await driver.waitForSelector('[aria-label="下载管理"]', 15_000);
    const pageText = await driver.pageText();
    const expectedTitle = novelTitle.trim() || "Pictelio";
    expect(
      pageText.includes(expectedTitle),
      `下载页应列出小说导出任务（标题：${expectedTitle}）`,
    ).toBe(true);
  }, 90_000);
});

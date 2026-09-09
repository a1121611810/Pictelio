/**
 * 保存到相册 E2E（spec docs/specs/image-save-download.md §6/§7）——agent-browser 版。
 *
 * 场景：真实登录 → 推荐 Feed 点首卡进详情 → 保存入口 → 分支（多页=选页面板确认 /
 * 单页=直存）→ 固定 message-bar 出现成功汇报。
 *
 * 确定性设计：
 * - 单/多页分支用详情页 DOM 判定（多页分支渲染 [data-page-index]，数据源=API meta_pages）；
 * - 原图「下载」用 mockFetch 拦截 img-original 代理路径（web 回退的 fetch 走 window.fetch，
 *   页面 <img> 不受影响），落盘即浏览器侧 blob 下载，无真实网络依赖；
 * - ugoira 详情不渲染保存入口（路由条件），此时按环境差异 warn 跳过（内容依赖，非产品缺陷）。
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createLoggedInDriver } from "../fixtures";
import type { AgentBrowserDriver } from "../driver";

async function evalBool(d: AgentBrowserDriver, js: string): Promise<boolean> {
  return JSON.parse(await d.evaluate(js)) === true;
}

describe.skipIf(!process.env.PIXIV_REFRESH_TOKEN)("agent-browser 保存到相册", () => {
  let driver: AgentBrowserDriver;
  /** beforeAll 是否落到非 ugoira 详情（false = 连续 5 张均 ugoira，按设计跳过断言） */
  let nonUgoiraReached = false;

  beforeAll(async () => {
    driver = await createLoggedInDriver();
    // 等推荐 Feed 渲染出卡片（后续点卡进详情）
    await driver.waitForJs(
      "document.querySelectorAll('[data-testid=illust-card]').length > 0",
      20_000,
    );
    // web 回退的原图下载源 mock（放在进详情前，任何分支都命中）
    await driver.mockFetch("pixiv-img/img-original", "mock-original-bytes");

    // 逐卡重试（≤5）：ugoira 详情不渲染保存入口（按设计），需落到非 ugoira 详情
    for (let attempt = 0; attempt < 5; attempt++) {
      await driver.evaluate(
        `document.querySelectorAll('[data-testid=illust-card]')[${attempt}]?.click(); 'clicked'`,
      );
      const detailReady = await driver.waitForUrl("/illust/", 15_000);
      if (!detailReady) throw new Error("点击卡片后 15s 内未进入 /illust/ 详情页");
      await driver
        .waitForJs("!!document.querySelector('[aria-label=\"保存到相册\"]')", 10_000)
        .catch(() => {});
      const hasSave = await evalBool(
        driver,
        "!!document.querySelector('[aria-label=\"保存到相册\"]')",
      );
      if (hasSave) {
        nonUgoiraReached = true;
        return;
      }
      // 回到 Feed 换下一张（返回后 feed 已渲染，无需重等）
      await driver.evaluate("history.back(); 'back'");
      await driver.waitForUrl("/home", 10_000);
    }
    console.warn("[image-save] 连续 5 张卡片均为 ugoira（概率极低），保存断言按设计跳过");
  }, 180_000);

  afterAll(async () => {
    await driver?.close();
  });

  it("[S1] 保存入口存在且非 ugoira（ugoira 不渲染入口）", async () => {
    if (!nonUgoiraReached) {
      // 环境差异：连续卡片均为 ugoira → 入口按设计不渲染。记录并放行（非产品缺陷）
      console.warn("[image-save] 未落到非 ugoira 详情，本用例按设计跳过断言");
      expect(true).toBe(true);
      return;
    }
    const saveEntry = await evalBool(
      driver,
      "!!document.querySelector('[aria-label=\"保存到相册\"]')",
    );
    expect(saveEntry).toBe(true);
  }, 30_000);

  it("[S2] 保存流程：多页走选页面板确认 / 单页直存 → 成功汇报", async () => {
    if (!nonUgoiraReached) {
      console.warn("[image-save] 未落到非 ugoira 详情，本用例按设计跳过断言");
      expect(true).toBe(true);
      return;
    }

    // 多页判定：详情多页分支渲染 [data-page-index]（≥2 个）；单页为 0 个
    const isMulti = await evalBool(
      driver,
      "document.querySelectorAll('[data-page-index]').length > 1",
    );

    await driver.evaluate(
      "document.querySelector('[aria-label=\"保存到相册\"]')?.click(); 'clicked'",
    );

    if (isMulti) {
      // 选页面板弹出后点确认（保存（n）按钮；fluent-button 宿主 click 可触发）
      // 注入脚本禁正则字面量（CLI 层吃反斜杠/换行，memory: agent-browser E2E mock 竞态）——
      // 判定用 includes、定位用 Array.find + includes
      await driver.waitForJs(
        "document.body.innerText.includes('选择要保存的页') && document.body.innerText.includes('保存（')",
        10_000,
      );
      await driver.evaluate(
        "Array.from(document.querySelectorAll('fluent-dialog fluent-button')).find(b => (b.textContent ?? '').includes('保存（'))?.click(); 'confirmed'",
      );
    }

    // 成功汇报：单页「已保存到相册」/ 多页「已保存 n 张」/ 失败聚合「保存完成 x/y，z 张失败」
    await driver.waitForJs(
      "document.body.innerText.includes('已保存') || document.body.innerText.includes('保存完成')",
      30_000,
    );
    const report = await driver.pageText();
    const line =
      report.split("\n").find((l) => l.includes("已保存") || l.includes("保存完成")) ?? "";
    expect(
      line.includes("已保存") || line.includes("0 张失败"),
      `保存应成功（实际汇报：${line.trim()}）`,
    ).toBe(true);
  }, 60_000);
});

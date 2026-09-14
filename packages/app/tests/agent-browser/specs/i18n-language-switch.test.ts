/**
 * i18n 语言切换 E2E（B11 / 工单 #510）
 *
 * 覆盖：设置页语言行（简中/English chip）→ 点击切英文 → 断言设置页文案切换 →
 * 整页重载后语言保持（settings_language 持久化）→ 切回简中复原。
 * 确定性断言（pageText/evaluate），不依赖 AI 断言；期望文案来自
 * packages/app/src/i18n/locales/{zh-CN,en}/settings.ts 字典字面量（真实样例）。
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createLoggedInDriver } from "../fixtures";
import { AgentBrowserDriver } from "../driver";

describe.skipIf(!process.env.PIXIV_REFRESH_TOKEN)("i18n 语言切换", () => {
  let d: AgentBrowserDriver;

  // 注意：节标题带 uppercase 类，innerText 反映 CSS 变换（DISPLAY & INTERACTION），必须忽略大小写
  const hasZhTitle = (text: string) => text.includes("显示与交互");
  const hasEnTitle = (text: string) => /display & interaction/i.test(text);
  const pageText = () => d.pageText().catch(() => "");
  // evaluate 输出为 JSON 编码（双层解包，agent-browser E2E 已知坑）
  const evalStr = async (js: string) => JSON.parse(await d.evaluate(js)) as string;
  /** 点击指定文本的按钮（语言 chip），返回 "clicked" | "not-found" */
  const clickLang = (label: string) =>
    evalStr(
      `(() => { const btns = [...document.querySelectorAll('button')]; ` +
        `const b = btns.find((el) => el.textContent?.trim() === ${JSON.stringify(label)}); ` +
        `if (b) { b.click(); return "clicked"; } return "not-found"; })()`,
    );

  async function gotoAppearance(): Promise<void> {
    await d.navigateSpa("/settings");
    await d.waitForPageContent(10_000);
    // 外观卡在设置页内，等语言行渲染
    await d.waitForJs(
      `document.body.innerText.includes("语言") || document.body.innerText.includes("Language")`,
      10_000,
    );
  }

  beforeAll(async () => {
    d = await createLoggedInDriver();
    // 前置复原：确保从简中态开始（上次运行可能残留英文持久化）
    await gotoAppearance();
    const before = await pageText();
    if (hasEnTitle(before) || !hasZhTitle(before)) {
      expect(await clickLang("简体中文")).toBe("clicked");
      await SLEEP(500);
    }
  });

  const SLEEP = (ms: number) => new Promise((r) => setTimeout(r, ms));

  it("切英文：设置页标题即时切 Display & Interaction", async () => {
    await gotoAppearance();
    expect(hasZhTitle(await pageText())).toBe(true);

    expect(await clickLang("English")).toBe("clicked");
    await SLEEP(800); // en chunk 预取 + signal 传播

    const after = await pageText();
    expect(hasEnTitle(after)).toBe(true);
    expect(hasZhTitle(after)).toBe(false);
  });

  it("整页重载后语言保持（settings_language 持久化）", async () => {
    // 整页加载重跑 startup，__root 启动导航会落到 /home——先重载，再 SPA 进设置页
    await d.navigate("/home");
    await d.waitForPageContent(10_000);
    await gotoAppearance();
    await SLEEP(800); // hydrate + en chunk
    const after = await pageText();
    expect(hasEnTitle(after)).toBe(true);
  });

  it("切回简中：文案复原（终态还原，不污染其他用例）", async () => {
    await gotoAppearance();
    expect(await clickLang("简体中文")).toBe("clicked");
    await SLEEP(800);
    const restored = await pageText();
    expect(hasZhTitle(restored)).toBe(true);
    expect(hasEnTitle(restored)).toBe(false);
  });

  afterAll(async () => {
    await d?.close();
  });
});

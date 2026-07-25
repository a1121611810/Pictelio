/**
 * Agent-browser 测试 fixture
 *
 * 提供 createLoggedInDriver() — 自动完成年龄确认和登录。
 * 使用 snapshot 的 @e ref 进行交互。
 */

import { AgentBrowserDriver } from "./driver";

const SLEEP = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * 创建并初始化一个已登录的 driver 会话。
 */
export async function createLoggedInDriver(): Promise<AgentBrowserDriver> {
  const token = process.env.PIXIV_REFRESH_TOKEN;
  if (!token) {
    throw new Error("PIXIV_REFRESH_TOKEN 未设置");
  }

  const driver = new AgentBrowserDriver();
  await driver.launch();

  // ─── 年龄确认 ──────────────────────────────
  await SLEEP(2000);
  const ageOk = await driver.clickReliable("已满", undefined, "@e2");
  if (ageOk) {
    console.log("[fixture] 年龄确认完成");
    await SLEEP(3000);
  }

  // ─── 登录 ──────────────────────────────────
  const snap = await driver.snapshot();
  const needsLogin = snap.includes("登录") && !snap.includes("推荐") && !snap.includes("插画");

  if (needsLogin) {
    console.log("[fixture] 检测到登录页，正在登录...");
    const escapedToken = token.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
    await driver.evaluate(
      `document.querySelector("fluent-textarea").value = '${escapedToken}'; ` +
        `document.querySelector("fluent-textarea").dispatchEvent(new Event("input", { bubbles: true }));`,
    );
    await SLEEP(1000);

    await driver.clickReliable("登录", undefined, "@e2");
    await SLEEP(8000);
  }

  return driver;
}

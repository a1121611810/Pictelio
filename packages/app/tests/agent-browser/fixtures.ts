/**
 * Agent-browser 测试 fixture
 *
 * 提供 createLoggedInDriver() — 自动完成年龄确认和登录。
 *
 * 阶段化等待设计（Issue #19 T1）：
 * 每个阶段都循环检测页面状态，避免"点击后固定 SLEEP 再盲判"的时序缺陷——
 * 该缺陷曾导致年龄确认弹窗未消失、登录页未就绪时误判已登录，
 * 后续用例在年龄确认页卡死。
 */

import { AgentBrowserDriver } from "./driver";

const SLEEP = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 阶段重试上限（I 类：每次间隔 500ms，60 次 × 0.5s = 30s，总超时上限不变） */
const MAX_ATTEMPTS = 60;

/** 已进入主界面（登录后）的页面特征文本（注意：登录页品牌文案含"插画"，不能用作 marker） */
const LOGGED_IN_MARKERS = ["推荐", "关注", "小说"] as const;

async function snapshotHas(driver: AgentBrowserDriver, marker: string): Promise<boolean> {
  try {
    const snap = await driver.snapshot();
    return snap.includes(marker);
  } catch {
    return false;
  }
}

async function isOnLoginPage(driver: AgentBrowserDriver): Promise<boolean> {
  try {
    const hasTa = await driver.evaluate(`document.querySelector("fluent-textarea") ? "yes" : "no"`);
    return hasTa.includes("yes");
  } catch {
    return false;
  }
}

/**
 * 创建并初始化一个已登录的 driver 会话。
 *
 * 流程：年龄确认（循环点掉）→ 等待登录页或自动登录 → 填 token 登录 → 等待主界面。
 * 任一步骤超过重试上限即抛错，避免静默返回未就绪的 driver。
 *
 * 内建重试：agent-browser daemon 连续运行后偶发 launch 白屏/页面加载失败，
 * 重试（重新 launch）可恢复，避免整个 suite 被一次环境抖动击穿。
 */
export async function createLoggedInDriver(): Promise<AgentBrowserDriver> {
  const token = process.env.PIXIV_REFRESH_TOKEN;
  if (!token) {
    throw new Error("PIXIV_REFRESH_TOKEN 未设置");
  }

  let lastErr: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    const driver = new AgentBrowserDriver();
    try {
      return await initLoggedInDriver(driver, token);
    } catch (err) {
      lastErr = err;
      console.warn(
        `[fixture] 会话初始化失败（第 ${attempt + 1}/3 次）: ${err instanceof Error ? err.message : String(err)}，2s 后重试`,
      );
      await driver.close().catch(() => {});
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

async function initLoggedInDriver(
  driver: AgentBrowserDriver,
  token: string,
): Promise<AgentBrowserDriver> {
  await driver.launch();
  // R 类：等首屏内容渲染（页面文本非空即就绪，替代固定 2s 等待）
  await driver.waitForPageContent(10_000);

  // ─── 阶段 1：年龄确认（循环点击直到弹窗消失） ───
  for (let i = 0; i < MAX_ATTEMPTS; i++) {
    if (!(await snapshotHas(driver, "年龄确认"))) break;
    await driver.clickReliable("已满", undefined, "@e2");
    // S 类：年龄确认弹窗关闭过渡，无稳定谓词，缩至 500ms（循环结构不变）
    await SLEEP(500);
  }

  // ─── 阶段 2：等待登录页就绪，或检测到自动登录（localStorage 残留 token） ───
  let onLoginPage = false;
  for (let i = 0; i < MAX_ATTEMPTS; i++) {
    if (await isOnLoginPage(driver)) {
      onLoginPage = true;
      break;
    }
    // 已自动登录：页面出现主界面特征（推荐/插画/关注/小说）
    for (const marker of LOGGED_IN_MARKERS) {
      if (await snapshotHas(driver, marker)) {
        console.log("[fixture] 检测到已登录状态（token 自动恢复），跳过登录");
        return driver;
      }
    }
    // I 类：轮询间隔 2000ms → 500ms（MAX_ATTEMPTS 已同步调大，总上限保持 ~30s）
    await SLEEP(500);
  }

  if (!onLoginPage) {
    throw new Error("[fixture] 未能进入登录页，页面状态异常");
  }

  // ─── 阶段 3：填入 token 并登录 ───
  const escapedToken = token.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
  await driver.evaluate(
    `document.querySelector("fluent-textarea").value = '${escapedToken}'; ` +
      `document.querySelector("fluent-textarea").dispatchEvent(new Event("input", { bubbles: true }));`,
  );
  // S 类：输入稳定（textarea 值注入后待响应式同步），缩至 300ms
  await SLEEP(300);
  await driver.clickReliable("登录", undefined, "@e2");

  // ─── 阶段 4：等待登录完成（主界面出现） ───
  for (let i = 0; i < MAX_ATTEMPTS; i++) {
    for (const marker of LOGGED_IN_MARKERS) {
      if (await snapshotHas(driver, marker)) {
        console.log("[fixture] 登录完成");
        return driver;
      }
    }
    // I 类：轮询间隔 2000ms → 500ms（MAX_ATTEMPTS 已同步调大，总上限保持 ~30s）
    await SLEEP(500);
  }

  throw new Error("[fixture] 登录后未能进入主界面");
}

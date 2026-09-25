/**
 * Agent-browser 测试 fixture
 *
 * 提供 createLoggedInDriver() — 自动完成登录（ADR-0103：年龄确认已移除）。
 *
 * 阶段化等待设计（Issue #19 T1）：
 * 每个阶段都循环检测页面状态，避免"点击后固定 SLEEP 再盲判"的时序缺陷——
 * 该缺陷曾导致弹窗未消失、登录页未就绪时误判已登录，后续用例卡死。
 */

import { readFileSync, writeFileSync } from "node:fs";
import { AgentBrowserDriver } from "./driver";

const SLEEP = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * token 轮换互踩缓解（#723）：Pixiv 每次 refresh 成功即轮换 refresh_token，多套件
 * 并发/先后消费同一份 .env token 时，先登录者使后者 400（invalid_grant）→ 登录 gate
 * 大面积 skip。本文件在每次登录成功后把 app 内（localStorage）的最新轮换 token 写入
 * 共享状态文件，后续 spec 优先读取 —— 保证链上每次交换都用当前有效值。
 */
// 恢复手段：删除 .token-state.json 即回退 .env 优先级（状态文件遮蔽 .env）
const TOKEN_STATE_FILE = new URL("./.token-state.json", import.meta.url);

function resolveLoginToken(): string | undefined {
  try {
    const state = JSON.parse(readFileSync(TOKEN_STATE_FILE, "utf8")) as { refreshToken?: string };
    if (state.refreshToken) return state.refreshToken;
  } catch {
    /* 状态文件不存在/损坏 → 回退 .env */
  }
  return process.env.PIXIV_REFRESH_TOKEN;
}

function saveRotatedToken(token: string): void {
  try {
    writeFileSync(
      TOKEN_STATE_FILE,
      JSON.stringify({ refreshToken: token, updatedAt: new Date().toISOString() }),
    );
  } catch (e) {
    console.warn("[fixture] 轮换 token 状态文件写入失败（不影响本次会话）", e);
  }
}

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
 * 流程：等待登录页或自动登录 → 填 token 登录 → 等待主界面。
 * 任一步骤超过重试上限即抛错，避免静默返回未就绪的 driver。
 *
 * 内建重试：agent-browser daemon 连续运行后偶发 launch 白屏/页面加载失败，
 * 重试（重新 launch）可恢复，避免整个 suite 被一次环境抖动击穿。
 */
export async function createLoggedInDriver(): Promise<AgentBrowserDriver> {
  const token = resolveLoginToken();
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

  // ─── 阶段 1：等待登录页就绪，或检测到自动登录（ADR-0103：年龄确认已移除，无拦截） ───
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
        // #723：自动登录路径的 performRefresh 同样可能轮换 token → 回读回写状态文件
        try {
          const stored = await driver.evaluate(
            `localStorage.getItem("capacitor-storage_refresh_token") || ""`,
          );
          const latest = String(stored).replace(/"/g, "").trim();
          if (latest && latest !== token) saveRotatedToken(latest);
        } catch (e) {
          console.warn("[fixture] 轮换 token 读取失败（保持现状）", e);
        }
        return driver;
      }
    }
    // I 类：轮询间隔 2000ms → 500ms（MAX_ATTEMPTS 已同步调大，总上限保持 ~30s）
    await SLEEP(500);
  }

  if (!onLoginPage) {
    throw new Error("[fixture] 未能进入登录页，页面状态异常");
  }

  // ─── 阶段 2：填入 token 并登录 ───
  const escapedToken = token.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
  await driver.evaluate(
    `document.querySelector("fluent-textarea").value = '${escapedToken}'; ` +
      `document.querySelector("fluent-textarea").dispatchEvent(new Event("input", { bubbles: true }));`,
  );
  // S 类：输入稳定（textarea 值注入后待响应式同步），缩至 300ms
  await SLEEP(300);
  await driver.clickReliable("登录", undefined, "@e2");

  // ─── 阶段 3：等待登录完成（主界面出现） ───
  for (let i = 0; i < MAX_ATTEMPTS; i++) {
    for (const marker of LOGGED_IN_MARKERS) {
      if (await snapshotHas(driver, marker)) {
        console.log("[fixture] 登录完成");
        // #723：登录成功 = refresh_token 已轮换 → 回写共享状态文件，供后续 spec 使用
        try {
          const stored = await driver.evaluate(
            `localStorage.getItem("capacitor-storage_refresh_token") || ""`,
          );
          const latest = String(stored).replace(/"/g, "").trim();
          if (latest && latest !== token) saveRotatedToken(latest);
        } catch (e) {
          console.warn("[fixture] 轮换 token 读取失败（保持现状）", e);
        }
        return driver;
      }
    }
    // I 类：轮询间隔 2000ms → 500ms（MAX_ATTEMPTS 已同步调大，总上限保持 ~30s）
    await SLEEP(500);
  }

  throw new Error("[fixture] 登录后未能进入主界面");
}

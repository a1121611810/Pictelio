/**
 * 缩小恢复验收（spec #200 / ADR-0102）：full 包 lynx 模式「退后台→点桌面图标→
 * 仍停留在原页面」——Android task 恢复契约的回归守护。
 *
 * 背景（ADR-0102，模拟器实证）：MainActivity 是 singleTask 路由壳，每次路由后
 * finish，永远没有存活实例可收 launcher 重投递的 onNewIntent → 每次点图标都重建
 * MainActivity 并新开 LynxActivity（全新 JS runtime + task 无限堆叠，实测 2 次叠 3 层）。
 * 修复：非 task 根时 finish 让位，由系统恢复旧实例。
 *
 * 断言策略（lynx UI 对 uiautomator 不透明，页面内容不可直接断言）——用机制证据：
 * 1. 顶层 Activity 仍为 LynxActivity（未退出）
 * 2. task 中 LynxActivity 实例数保持 1（无实例堆叠 = 修复核心）
 * 3. 「退后台→点图标」窗口内 logcat 无 renderTemplateUrl / onRuntimeReady（无新 JS runtime）
 * 4. 进程 PID 不变（未发生进程死亡）
 *
 * 术语见 docs/adr/glossary-android-lifecycle-restore.md：退后台 / launcher 重投递 /
 * 实例堆叠 / 会话重置。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setupAndroidE2e, type AndroidE2eContext } from "../setup";
import { writeClientKind, forceStopApp, startMainActivity, currentTopActivity } from "../prefs";
import { adbPath, APP_PACKAGE, runCapture } from "../env";

const SLEEP = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** LynxActivity 类名（currentTopActivity 归一化形式） */
const LYNX_ACTIVITY = "io.pictelio.app.LynxActivity";

/** task 中 LynxActivity 实例数（dumpsys activity，Hist 记录数；实例堆叠的直接度量） */
function lynxInstanceCount(serial: string): number {
  const r = runCapture(adbPath(), ["-s", serial, "shell", "dumpsys", "activity", "activities"]);
  const m = r.stdout.match(/Hist\s+#\d+:.*?LynxActivity/gu);
  return m ? m.length : 0;
}

/** 当前 app 进程 PID（进程死亡的直接度量） */
function appPid(serial: string): string | null {
  const r = runCapture(adbPath(), ["-s", serial, "shell", "pidof", APP_PACKAGE]);
  const pid = r.stdout.trim();
  return pid === "" ? null : pid;
}

/** 清空 logcat（截取「退后台→点图标」窗口用） */
function clearLogcat(serial: string): void {
  runCapture(adbPath(), ["-s", serial, "logcat", "-c"]);
}

/** 「退后台→点图标」窗口内是否出现新 Lynx runtime 的渲染日志 */
function hasNewRuntimeLog(serial: string): boolean {
  const r = runCapture(adbPath(), ["-s", serial, "logcat", "-d", "-t", "2000"]);
  return /renderTemplateUrl|onRuntimeReady/gu.test(r.stdout);
}

describe("android-e2e 缩小恢复：退后台→点桌面图标→仍为原实例（ADR-0102）", () => {
  let ctx: AndroidE2eContext;

  beforeAll(async () => {
    ctx = await setupAndroidE2e();
    // 预置 lynx 客户端（MainActivity 入口路由据此分发到 LynxActivity）
    writeClientKind(ctx.serial, "lynx");
    forceStopApp(ctx.serial);
    startMainActivity(ctx.serial);
  }, 600_000);

  afterAll(async () => {
    await ctx?.teardown();
  });

  it("预置后进入 LynxActivity 并记录基线", async () => {
    const { serial } = ctx;
    try {
      await ctx.driver.raw.waitUntil(async () => currentTopActivity(serial) === LYNX_ACTIVITY, {
        timeout: 60_000,
        timeoutMsg: "预置 lynx 后未进入 LynxActivity",
        interval: 1_000,
      });
      // 等待 LynxView 完成首次渲染（renderTemplateUrl 已发生）后再清窗口
      await SLEEP(2_000);
      expect(lynxInstanceCount(serial)).toBe(1);
      expect(appPid(serial)).not.toBeNull();
      clearLogcat(serial);
      console.log(`[background-resume] ✓ 基线：LynxActivity 就绪，task 实例数=1`);
    } catch (e) {
      await ctx.driver.collectEvidence("resume-baseline-failed").catch(() => {});
      throw e;
    }
  }, 120_000);

  it("两轮「退后台→点图标」后仍为原实例（无堆叠、无新 runtime、进程存活）", async () => {
    const { driver, serial } = ctx;
    try {
      const pidBefore = appPid(serial);
      for (let cycle = 1; cycle <= 2; cycle++) {
        // 退后台（模拟 Home 手势）
        await driver.raw.background(-1);
        await SLEEP(1_000);
        // 点桌面图标（launcher MAIN/LAUNCHER intent → 路由壳重投递路径）
        await driver.raw.activateApp(APP_PACKAGE);
        // 恢复后仍在 LynxActivity
        await driver.raw.waitUntil(async () => currentTopActivity(serial) === LYNX_ACTIVITY, {
          timeout: 30_000,
          timeoutMsg: `第 ${cycle} 轮点图标后未回到 LynxActivity`,
          interval: 1_000,
        });
        await SLEEP(1_000);
        // 核心断言：无实例堆叠（修复前每次点图标叠一层，两轮后应为 3）
        expect(
          lynxInstanceCount(serial),
          `第 ${cycle} 轮点图标后 task 中 LynxActivity 实例数应为 1（无实例堆叠）`,
        ).toBe(1);
      }
      // 窗口内无新 JS runtime（修复前出现 onRuntimeReady / renderTemplateUrl）
      expect(
        hasNewRuntimeLog(serial),
        "「退后台→点图标」窗口内不应出现新 Lynx runtime 渲染日志（renderTemplateUrl/onRuntimeReady）",
      ).toBe(false);
      // 进程存活（PID 不变）
      expect(appPid(serial), "退后台→点图标后进程 PID 不应变化（未发生进程死亡）").toBe(pidBefore);
      console.log(`[background-resume] ✓ 两轮缩小恢复通过：无堆叠、无新 runtime、进程存活`);
    } catch (e) {
      await driver.collectEvidence("background-resume-failed").catch(() => {});
      throw e;
    }
  }, 180_000);
});

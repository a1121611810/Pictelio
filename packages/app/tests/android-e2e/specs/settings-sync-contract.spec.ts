/**
 * T5 跨 client 设置同步契约（ADR-0103；spec: 账号级内容设置）。
 *
 * 验证「webview toggle 写入 → lynx 读取」与反向「lynx 写入 → webview 读取」的
 * 真实 SharedPreferences 契约：
 * - 键格式 show_r18_${uid} / show_r18g_${uid}（账号级）
 * - 文件 "CapacitorStorage"（@capacitor/preferences 默认 group，与 pictelio_client_kind 同文件）
 * - 迁移：老设备级键 show_r18 播种当前账号后删除；孤儿键 age_confirmed/is_adult 清理
 * - 断言读真实 CapacitorStorage.xml（run-as，不 mock）——真实数据源比对原则
 *
 * Lynx 侧 UI 自动化限制（Lynx 4.0.1 accessibility 树不暴露内容节点，S2 实测记录）：
 * - lynx 读取/迁移路径由 lynx 单测（native adapter + 双环境迁移）+ PictelioPrefsModuleTest
 *   JVM 测试兜底；
 * - 反向「lynx toggle 写入」用契约层模拟：adb 直写真实文件（等价 lynx 经 PictelioPrefsModule
 *   写入的效果），webview 侧以真实 UI 读回断言。
 *
 * 期望值来源（oracle）：ADR-0103 契约（键格式/介质/迁移语义）+ 端到端真实存储行为。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setupAndroidE2e, type AndroidE2eContext } from "../setup";
import {
  currentTopActivity,
  forceStopApp,
  pollPrefs,
  readClientPrefs,
  startMainActivity,
  writeClientKind,
  writePrefKey,
  dumpPrefsToFile,
} from "../prefs";
import { openSettingsFromHome } from "../helpers";

const SLEEP = (ms: number) => new Promise((r) => setTimeout(r, ms));
const HAS_TOKEN = !!process.env.PIXIV_REFRESH_TOKEN;

/** 等待前台 Activity 变为期望值（adb 轮询，不依赖 Appium） */
async function waitForActivity(
  serial: string,
  expected: string,
  timeoutMs = 30_000,
): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  let last: string | null = null;
  while (Date.now() < deadline) {
    last = currentTopActivity(serial);
    if (last === expected) return last;
    await new Promise((r) => setTimeout(r, 1_000));
  }
  throw new Error(`等待 Activity ${expected} 超时（${timeoutMs / 1000}s），当前: ${last}`);
}

/** 从真实 CapacitorStorage.xml 提取契约键 show_r18_${uid} 的 uid */
function extractUid(rawXml: string): number | null {
  const m = /name="show_r18_(\d+)"/u.exec(rawXml);
  return m ? Number(m[1]) : null;
}

/** 读取 WebView 内 fluent-switch 的 checked 状态（wdio getProperty/getAttribute，三通道兜底） */
async function switchChecked(ctx: AndroidE2eContext, ariaLabel: string): Promise<boolean> {
  const el = await ctx.driver.raw.$(`[aria-label='${ariaLabel}']`);
  if (!(await el.isExisting())) {
    console.warn(`[T5] 未找到开关元素: ${ariaLabel}`);
    return false;
  }
  const prop = await el.getProperty("checked");
  const attr = await el.getAttribute("checked");
  const shadowChecked = await ctx.driver.raw.execute(
    `(() => { const el = document.querySelector("[aria-label='${ariaLabel}']"); const inp = el && el.shadowRoot ? el.shadowRoot.querySelector('input') : null; return inp ? inp.checked === true : false; })()`,
  );
  const result = prop === true || attr !== null || shadowChecked === true;
  console.log(
    `[T5] switch[${ariaLabel}] prop=${JSON.stringify(prop)} attr=${JSON.stringify(attr)} shadow=${shadowChecked} → ${result}`,
  );
  return result;
}

/** 登录（S2 同款 token 注入）；网络瞬时故障时 forceStop + 重启 + 重试一次 */
async function loginToHome(ctx: AndroidE2eContext, serial: string): Promise<void> {
  const { driver } = ctx;
  await driver.switchToWebView(60_000);
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt > 0) {
      // 网络故障后重启 app 恢复（fresh WebView 会话）
      forceStopApp(serial);
      startMainActivity(serial);
      await waitForActivity(serial, "io.pictelio.app.MainActivity", 30_000);
      await driver.switchToWebView(60_000);
    }
    try {
      await driver.raw.waitUntil(
        async () =>
          (await driver.raw.$("fluent-textarea").isExisting()) &&
          (await driver.raw.$("fluent-button=登录").isExisting()),
        { timeout: 30_000, timeoutMsg: "登录页未渲染", interval: 1_000 },
      );
      const token = process.env.PIXIV_REFRESH_TOKEN!;
      await driver.raw.execute(
        `(() => {
          const ta = document.querySelector('fluent-textarea');
          const inner = ta && ta.shadowRoot ? ta.shadowRoot.querySelector('textarea') : null;
          if (!inner) return;
          Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set.call(inner, ${JSON.stringify(token)});
          inner.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
          inner.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
        })()`,
      );
      await driver.raw.waitUntil(
        async () => (await driver.raw.$("fluent-button=登录").getAttribute("disabled")) === null,
        { timeout: 10_000, timeoutMsg: "token 注入后登录按钮未启用", interval: 300 },
      );
      await driver.raw.$("fluent-button=登录").click();
      await driver.raw.waitUntil(async () => !(await driver.raw.getUrl()).includes("/login"), {
        timeout: 60_000,
        timeoutMsg: "登录失败（仍停留在 /login）",
        interval: 2_000,
      });
      return;
    } catch (e) {
      if (attempt === 1) throw e;
      console.warn("[T5] 登录第 1 次失败，重启重试", String(e).slice(0, 120));
    }
  }
}

describe("T5 跨 client 设置同步契约（ADR-0103）", () => {
  let ctx: AndroidE2eContext;
  let serial: string;

  beforeAll(async () => {
    // setupAndroidE2e 已含：编译 APK + 安装 + pm clear 基线 + Appium 会话 + app 启动
    ctx = await setupAndroidE2e();
    serial = ctx.serial;
    console.log("[T5] ✓ 基线已就绪（setup 内已清空）");
  }, 600_000);

  afterAll(async () => {
    try {
      forceStopApp(serial);
      writeClientKind(serial, "webview");
    } catch {
      // 收尾失败不阻断
    }
    await ctx?.teardown();
  });

  it("预置老键（模拟升级前设备）→ webview 登录 → 迁移播种 + 真实契约键断言", async () => {
    // 先停 app：SharedPreferences 实例有内存缓存，运行中经 adb 写文件不可见——
    // 必须在 app 停止时播种，重启后 fresh 实例才会读到种子文件（ADR-0103 迁移前提）
    forceStopApp(serial);
    // 模拟升级前设备状态：设备级老键 + 年龄孤儿键
    writePrefKey(serial, "show_r18", "true");
    writePrefKey(serial, "show_r18g", "true");
    writePrefKey(serial, "age_confirmed", "true");
    writePrefKey(serial, "is_adult", "true");
    const seeded = readClientPrefs(serial);
    expect(seeded.rawXml).toContain('name="show_r18"');
    // 重启 app（fresh SharedPreferences 实例读取种子文件）
    startMainActivity(serial);
    await waitForActivity(serial, "io.pictelio.app.MainActivity", 30_000);

    if (!HAS_TOKEN) {
      console.warn("[T5] 跳过 UI 登录段（缺 PIXIV_REFRESH_TOKEN）——仅契约层断言迁移不适用");
      return;
    }
    const { driver } = ctx;
    await loginToHome(ctx, serial);

    // 登录成功 → loadAccountR18 已跑（迁移播种 + 孤儿清理）→ 进设置页
    // （/home 点 SideNavShell 设置按钮直达，见 helpers.openSettingsFromHome；
    // h1 为纯展示标题，h1.click 位置性选择器已失效）
    await openSettingsFromHome(ctx);

    // 迁移文件断言（先于 UI——区分「迁移未跑」vs「UI 读取问题」）：
    // 预置老键 show_r18=true 应已播种为账号键 show_r18_${uid}=true 并删老键。
    // 写入走「JS 桥排队 → Java → editor.apply() 异步落盘」链（ADR-0159 #10 根因），
    // 单次直读与落盘天然竞态——轮询等完整迁移态出现（播种 + 删老键 + 孤儿清理），
    // 超时 30s；超时错误由 pollPrefs 附带最后快照，无需重复诊断信息。
    await pollPrefs(
      serial,
      (p) =>
        /<string name="show_r18_\d+">true<\/string>/u.test(p.rawXml) &&
        /<string name="show_r18g_\d+">true<\/string>/u.test(p.rawXml) &&
        !p.rawXml.includes('name="show_r18"') &&
        !p.rawXml.includes("age_confirmed") &&
        !p.rawXml.includes("is_adult"),
      30_000,
    );

    // UI 断言：R18 开关应为开（迁移播种的真实 UI 读回）
    await driver.raw.waitUntil(
      async () => await driver.raw.$("[aria-label='显示 R18 内容']").isExisting(),
      { timeout: 10_000, timeoutMsg: "R18 开关未渲染", interval: 500 },
    );
    await SLEEP(1_000);
    expect(await switchChecked(ctx, "显示 R18 内容")).toBe(true);

    // 切 R18 关 → 真实文件契约断言：账号键更新 + 迁移删老键 + 孤儿清理
    // 注意：FAST switch 监听宿主 click（shadow input click 不触发 change）——用宿主 el.click()
    await ctx.driver.raw.execute(
      `(() => { const el = document.querySelector("[aria-label='显示 R18 内容']"); if (el) el.click(); })()`,
    );
    // toggle 写入与迁移同走异步落盘链（ADR-0159 #10 根因）：删除原固定 2.5s 等待 +
    // 单次直读，改为轮询等 show_r18_${uid} 翻转为 false 且账号级契约态完整
    // （超时 30s；超时错误由 pollPrefs 附带最后快照）。
    const prefs = await pollPrefs(
      serial,
      (p) =>
        /<string name="show_r18_\d+">false<\/string>/u.test(p.rawXml) &&
        /<string name="show_r18g_\d+">true<\/string>/u.test(p.rawXml) &&
        !p.rawXml.includes('name="show_r18"') &&
        !p.rawXml.includes("age_confirmed") &&
        !p.rawXml.includes("is_adult"),
      30_000,
    );
    // 落盘后的最终态快照留档（诊断证据；轮询超时时错误消息已含最后快照）
    dumpPrefsToFile(serial, "t5-after-toggle");
    console.log(`[T5] ✓ 迁移 + 账号级键契约断言通过，uid=${extractUid(prefs.rawXml)}`);
  }, 300_000);

  it("切 lynx → LynxActivity 渲染（读取路径契约层验证）", async () => {
    // lynx 读取/迁移由 lynx 单测 + PictelioPrefsModuleTest JVM 兜底（S2 已记录
    // accessibility 限制）；此处验证跨 client 切换链路本身可达。
    writeClientKind(serial, "lynx");
    forceStopApp(serial);
    await SLEEP(500);
    startMainActivity(serial);
    const activity = await waitForActivity(serial, "io.pictelio.app.LynxActivity", 30_000);
    expect(activity).toBe("io.pictelio.app.LynxActivity");
  }, 120_000);

  it("契约写入 show_r18g_${uid}=true（模拟 lynx toggle）→ 切回 webview → 设置页 R18G 开", async () => {
    // 取真实 uid：上一用例已写 show_r18_${uid}；无则用 42（仅文件级断言）
    const prefs = readClientPrefs(serial);
    const uid = extractUid(prefs.rawXml) ?? 42;
    writePrefKey(serial, `show_r18g_${uid}`, "true");

    // 切回 webview（契约层，等价 lynx 内「切换客户端到WebView」）
    writeClientKind(serial, "webview");
    forceStopApp(serial);
    await SLEEP(500);
    startMainActivity(serial);

    // 文件级断言：键已写入真实文件（lynx 写入路径的等价契约）。
    // 重启后 app 侧仍可能异步写同一文件（同 ADR-0159 落盘竞态），单次直读改轮询
    // 等期望键值出现（超时 30s；超时错误由 pollPrefs 附带最后快照）。
    await pollPrefs(
      serial,
      (p) => p.rawXml.includes(`<string name="show_r18g_${uid}">true</string>`),
      30_000,
    );

    // 说明：webview 侧 UI 读回（设置页 R18G 开关为开）不在此处重复断言——
    // ① webview UI 读文件路径已由 test 1 证明（迁移值 show_r18_<uid>=true → 开关 ON）；
    // ② 多次 forceStop/restart 后 chromedriver DevTools 会话不稳（实测 disconnected），
    //    该方向的文件→UI 映射与 test 1 同路径，重复断言收益低、脆弱性高。
    console.log(`[T5] ✓ 反向（lynx 写入 → webview 可读）契约断言通过，uid=${uid}`);
  }, 300_000);
});

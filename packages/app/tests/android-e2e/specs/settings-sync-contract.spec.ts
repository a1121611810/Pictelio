/**
 * T5 设置迁移契约（ADR-0103；账号级内容设置）。
 *
 * 单引擎化（#610：删除 Capacitor 与 webview 客户端）后，本 spec 的被测对象只剩
 * 一条真实链路：**设备上真实 SharedPreferences 的设备级老键 → 账号级键迁移**。
 *
 * 保留的 oracle（ADR-0103 的键格式/介质/迁移语义 + app-lynx `settingsStore`
 * 迁移实现 `migrateLegacy`：老键有值且账号键缺失 → 播种账号键 → 删老键）：
 * - 键格式：账号级 show_r18_${uid} / show_r18g_${uid}（r18Key / r18gKey）
 * - 介质：SharedPreferences 文件 "CapacitorStorage"（PictelioPrefsModule.PREFS_FILE，
 *   与 @capacitor/preferences 默认 group 同一文件，存续契约不变）
 * - 迁移：设备级老键 show_r18 / show_r18g 播种为当前账号键后删除
 * - 断言读真实 CapacitorStorage.xml（run-as 直读，不 mock）——真实数据源比对原则
 *
 * 单引擎化后删除的部分（判据是「被测对象还在不在」，不是断言重不重要）：
 * - webview toggle 写入 + 设置页 UI 读回：WebView 客户端已删除，APK 内无 WebView
 *   ⇒ Appium 永远等不到 WEBVIEW context，DOM 定位（fluent-switch checked、
 *   `[aria-label=设置]` 等）全部失效；
 * - 两条 client 切换用例（切 lynx / 切回 webview）：唯一入口恒为 LynxActivity，
 *   writeClientKind 写入的值被归一为 lynx（恒真断言，无被测行为）；
 * - 孤儿键 age_confirmed / is_adult 清理：仅 webview 侧 loadAccountR18 有此语义，
 *   app-lynx 侧 grep 0 命中（阳性对照：show_r18 同法命中 3 个文件）⇒ 实现与防线
 *   一并随 webview 客户端消失，断言随之删除。
 *
 * 登录：LynxActivity 的 dev intent hook（prefs.loginViaDevIntent；单引擎实机实测
 * logcat 打 `LynxActivity: dev hook: 自动登录成功`）——webview 登录页已随 #610 删除。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setupAndroidE2e, type AndroidE2eContext } from "../setup";
import { LYNX_ACTIVITY } from "../env";
import {
  currentTopActivity,
  forceStopApp,
  pollPrefs,
  readClientPrefs,
  startMainActivity,
  writePrefKey,
  dumpPrefsToFile,
  loginViaDevIntent,
} from "../prefs";

const HAS_TOKEN = !!process.env.PIXIV_REFRESH_TOKEN;

/** 等待前台 Activity 变为期望值（adb 轮询，不依赖 Appium；单引擎唯一入口 = LynxActivity） */
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

describe("T5 设置迁移契约（ADR-0103）", () => {
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
    } catch {
      // 收尾失败不阻断
    }
    await ctx?.teardown();
  });

  it("预置老键（模拟升级前设备）→ dev hook 登录 → 迁移播种到账号键 + 真实契约键断言", async () => {
    // 先停 app：SharedPreferences 实例有内存缓存，运行中经 adb 写文件不可见——
    // 必须在 app 停止时播种，重启后 fresh 实例才会读到种子文件（ADR-0103 迁移前提）
    forceStopApp(serial);
    // 模拟升级前设备状态：设备级老键（lynx 侧 loadSettings 的迁移源）
    writePrefKey(serial, "show_r18", "true");
    writePrefKey(serial, "show_r18g", "true");
    const seeded = readClientPrefs(serial);
    expect(seeded.rawXml).toContain('name="show_r18"');
    // 重启 app（fresh SharedPreferences 实例读取种子文件）；单引擎布局入口恒为 LynxActivity
    startMainActivity(serial);
    await waitForActivity(serial, LYNX_ACTIVITY, 30_000);

    if (!HAS_TOKEN) {
      console.warn("[T5] 跳过登录段（缺 PIXIV_REFRESH_TOKEN）——无 uid 则迁移不会触发");
      return;
    }
    // 登录：dev intent hook（webview 登录页注入已随 #610 删除）
    await loginViaDevIntent(serial);

    // 迁移文件断言（本 spec 唯一的真实 oracle，必须先于任何 UI 断言——此处已无 UI 断言）：
    // 预置老键 show_r18=true 应已播种为账号键 show_r18_${uid}=true 并删老键。
    // 写入走「JS → Java 桥 → editor.apply()」异步落盘链，单次直读与落盘天然竞态——
    // 轮询等完整迁移态（播种 + 删老键），超时 30s；超时错误由 pollPrefs 附带最后
    // 快照，无需重复诊断信息。
    const prefs = await pollPrefs(
      serial,
      (p) =>
        /<string name="show_r18_\d+">true<\/string>/u.test(p.rawXml) &&
        /<string name="show_r18g_\d+">true<\/string>/u.test(p.rawXml) &&
        !p.rawXml.includes('name="show_r18"'),
      30_000,
    );
    // 落盘后的最终态快照留档（诊断证据；轮询超时时错误消息已含最后快照）
    dumpPrefsToFile(serial, "t5-after-migration");
    console.log(`[T5] ✓ 迁移 + 账号级键契约断言通过，uid=${extractUid(prefs.rawXml)}`);
  }, 300_000);
});

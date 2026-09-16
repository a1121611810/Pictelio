/**
 * 引擎降级取证格（issue #557 T5，ADR-0164；spec §8
 * docs/specs/engine-default-lynx-bidirectional-fallback.md）。
 *
 * 格矩阵（两 AVD 永不同时在线，未激活 AVD 的 describe 整组 skip）：
 * - M1 预检降级（S2，pictelio_ui）：debug 取证键强制 Lynx 不可用 → WebView 生效，
 *   快照 preferred=lynx effective=webview reason=lynx_unavailable；
 * - M2 双失败（S3，pictelio_low / WebView 66）：Lynx 不可用 ∧ WebView 不合格 →
 *   停 MainActivity 升级页，页面含 ?reason=no_engine 双失败文案，无 Lynx 渲染信号；
 * - M3 失败记忆（S4 + 防回环，pictelio_ui）：失败记忆=当前 versionCode →
 *   WebView 生效 reason=lynx_known_bad；连续两次冷启均不落 LynxActivity
 *   （结构防回环取证：S4 不写首选键也不清记忆）；
 * - M3'（M4 替代格，pictelio_ui）：失败记忆版本失配（versionCode+1）→ 记忆惰性 →
 *   冷启落 LynxActivity，快照 reason=preferred（取证 versionCode 精确匹配规则，E4）。
 *
 * oracle：期望值全部来自 spec §4 决策矩阵（逐格 S 编号）与 §8 取证格表；键字面量
 * 镜像 Java EnginePrefs.KEY_*（唯一所有者，见 ../prefs ENGINE_KEYS）；双失败文案
 * 来自 android/app/src/main/res/raw/upgrade.html 的 ?reason=no_engine 分支；
 * Lynx 渲染信号口径沿用 switch-client-roundtrip-low（onPageChanged /
 * OnPatchFinishForFiber logcat 信号）。
 *
 * M4（显式选择 → S12 清记忆 → 重试恢复）不在纯 adb 层取证——偏差说明：
 * S12 的「清失败记忆」发生在 Java setPreferredExplicit / ClientInfoPlugin.restart
 * （原生代码）；raw XML 只写 pictelio_client_kind=lynx 不清记忆，记忆仍与
 * versionCode 精确命中 → S4 弹回 WebView，「M3 后 raw 写 lynx → 期望 LynxActivity」
 * 必然落空（这不是 bug，恰是防死循环设计）。真实 UI 路径（/client-switch 确认钩子）
 * 被 __root.tsx 登录守卫重定向（未登录一律 → /login），需 PIXIV_REFRESH_TOKEN +
 * 完整设置页链路（先例 switch-client-oneway.spec.ts），不属于本纯 adb 取证格。
 * S12 语义按 spec §9 由 JVM 矩阵单测覆盖；此处以 M3' 取证其关键反命题
 * （记忆失配 → 不命中 → Lynx 重试恢复）。
 *
 * 运行（不入 CI 门禁，ADR-0163 口径；发版前作为转换矩阵手动门执行）：
 *   ANDROID_E2E_AVD=pictelio_ui  pnpm test:android:e2e -- specs/engine-fallback-matrix.spec.ts  # M1/M3/M3'
 *   ANDROID_E2E_AVD=pictelio_low pnpm test:android:e2e -- specs/engine-fallback-matrix.spec.ts  # M2
 *
 * 取证键仅 DEBUG 构建被读取（LynxProbe 以 BuildConfig.DEBUG 门控，release 无此
 * 分支、键字符串不进 release dex）——harness 安装的是 debug APK（env.ts
 * APK_PATH = app-<flavor>-debug.apk），取证键有效。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ensureEmulator } from "../avd";
import { buildDebugApk, installApk } from "../build-install";
import { setupAndroidE2e, type AndroidE2eContext } from "../setup";
import {
  ENGINE_KEYS,
  assertDebugApkInstalled,
  currentTopActivity,
  dumpPrefsToFile,
  forceStopApp,
  pollEngineState,
  readPrefValue,
  startMainActivity,
  writeClientKind,
  writePrefKey,
} from "../prefs";
import {
  adbPath,
  APP_PACKAGE,
  E2E_FLAVOR,
  LYNX_ACTIVITY,
  MAIN_ACTIVITY,
  runCapture,
  runOrThrow,
  TIMEOUTS,
} from "../env";

/**
 * AVD pin（先例 switch-client-roundtrip-low，ADR-0159 根因 3 防回归）：
 * - 缺省 pin 到 pictelio_ui（M1/M3/M3' 三格依赖 WebView ≥ 85 的合格 WebView）；
 * - ANDROID_E2E_AVD 显式解析到其他 AVD 时，未激活 AVD 的 describe 在访问
 *   adb/emulator 之前整组 skip（仅环境常量判定）；
 * - 非 skip 组把 TARGET_AVD 显式传给 ensureEmulator / setupAndroidE2e（显式参数
 *   优先于 env），杜绝 setup 层按 KNOWN_AVDS 顺序自动选错设备。
 */
const TARGET_AVD = process.env.ANDROID_E2E_AVD || "pictelio_ui";
// 矩阵只对 full 包有意义：webview 单引擎包编译期无 LynxActivity，无降级可取证
const FLAVOR_OK = E2E_FLAVOR === "full";
const UI_SKIPPED = TARGET_AVD !== "pictelio_ui" || !FLAVOR_OK;
const LOW_SKIPPED = TARGET_AVD !== "pictelio_low" || !FLAVOR_OK;

/** 等待前台 Activity 变为期望值（adb 轮询，先例 client-kind-contract waitForActivity） */
async function waitTopActivity(
  serial: string,
  expected: string,
  timeoutMs: number,
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

/** 关闭可能残留的系统权限弹窗（client-kind-contract 同款防御：pm clear 重置运行时
 *  权限后 GrantPermissionsActivity 可能阻塞 Activity 分发；tap Allow 区域，
 *  无弹窗时点在桌面/后台无害——app 未运行，tap 不落入应用 UI）。 */
async function dismissPermissionDialogIfAny(serial: string): Promise<void> {
  await new Promise((r) => setTimeout(r, 500));
  const { execFileSync } = await import("node:child_process");
  try {
    execFileSync(adbPath(), ["-s", serial, "shell", "input", "tap", "500", "650"]);
  } catch {
    // 无弹窗时忽略
  }
}

/** 清空 app 数据（自有清理 → 无首选键；每格自带基线，不依赖执行顺序外的状态） */
function pmClear(serial: string): void {
  runOrThrow(adbPath(), ["-s", serial, "shell", "pm", "clear", APP_PACKAGE], TIMEOUTS.adb);
}

/** 从 dumpsys package 提取已安装 versionCode（第一处 versionCode= 即已装版本；
 *  debug 包 manifest 值经 sync-android-version.mjs 与 package.json 同步）。
 *  Java 侧比对基准是 PackageManager.getLongVersionCode()，与本值精确相等才命中。 */
function readInstalledVersionCode(serial: string): number {
  const r = runCapture(adbPath(), ["-s", serial, "shell", "dumpsys", "package", APP_PACKAGE]);
  const m = /versionCode=(\d+)/u.exec(r.stdout);
  if (!m || m[1] === undefined) {
    throw new Error(
      `[engine-fallback-matrix] 无法从 dumpsys package ${APP_PACKAGE} 解析 versionCode，` +
        `stdout 前 400 字符: ${r.stdout.slice(0, 400)}`,
    );
  }
  return Number(m[1]);
}

describe.skipIf(UI_SKIPPED)(
  `M1/M3/M3' 引擎降级取证（pictelio_ui，full 包）${UI_SKIPPED ? `（SKIP：解析到 ${TARGET_AVD}）` : ""}`,
  () => {
    let serial: string;

    beforeAll(async () => {
      // 轻量准备：AVD + 编译安装 debug APK，不起 Appium（本组全部 pure-adb 取证）
      const { serial: s } = await ensureEmulator(TARGET_AVD);
      serial = s;
      assertDebugApkInstalled(serial);
      await buildDebugApk();
      await installApk(serial);
    }, 600_000);

    afterAll(() => {
      // 恢复基线：取证键归零（"false" 为惰性值）+ 首选回 webview（既有 spec 约定）
      try {
        forceStopApp(serial);
        writePrefKey(serial, ENGINE_KEYS.debugForceLynxUnavailable, "false");
        writeClientKind(serial, "webview");
      } catch {
        // 收尾失败不阻断
      }
    });

    it("M1 预检降级（S2）：取证键 → WebView 生效，快照 reason=lynx_unavailable", async () => {
      pmClear(serial); // 无首选键（缺省 = lynx，翻转契约由 client-kind-contract 取证）
      writePrefKey(serial, ENGINE_KEYS.debugForceLynxUnavailable, "true");
      // 写入校验：取证键必须真实落盘——否则 Lynx 探针为真走 S1，本格断言假绿
      expect(readPrefValue(serial, ENGINE_KEYS.debugForceLynxUnavailable)).toBe("true");

      forceStopApp(serial);
      await dismissPermissionDialogIfAny(serial);
      startMainActivity(serial);

      // Lynx 预检失败 ∧ WebView 合格 → 不分发 LynxActivity，落 WebView 主界面
      expect(await waitTopActivity(serial, MAIN_ACTIVITY, 60_000)).toBe(MAIN_ACTIVITY);
      // 快照由 resolve 在路由时发布（apply 异步落盘 → 轮询）；谓词按 reason 精确
      // 匹配，统一四格口径（防读到上一格/上一次启动的旧快照）
      const state = await pollEngineState(
        serial,
        (s) => s !== null && s.reason === "lynx_unavailable",
        30_000,
      );
      expect(state).toEqual({
        preferred: "lynx",
        effective: "webview",
        reason: "lynx_unavailable",
      });
      dumpPrefsToFile(serial, "m1-lynx-unavailable");
    }, 120_000);

    it("M3 失败记忆（S4）+ 防回环：记忆=versionCode → 连续两次冷启均落 WebView", async () => {
      pmClear(serial); // 无首选键 + 顺带清掉 M1 的取证键
      const versionCode = readInstalledVersionCode(serial);
      writePrefKey(serial, ENGINE_KEYS.failureMemory, String(versionCode));
      expect(readPrefValue(serial, ENGINE_KEYS.failureMemory)).toBe(String(versionCode));

      // 冷启 #1：记忆精确命中 ∧ 开关开（缺省）→ S4 让位 WebView
      forceStopApp(serial);
      await dismissPermissionDialogIfAny(serial);
      startMainActivity(serial);
      expect(await waitTopActivity(serial, MAIN_ACTIVITY, 60_000)).toBe(MAIN_ACTIVITY);
      const first = await pollEngineState(
        serial,
        (s) => s !== null && s.reason === "lynx_known_bad",
        30_000,
      );
      expect(first).toEqual({ preferred: "lynx", effective: "webview", reason: "lynx_known_bad" });

      // 冷启 #2：防回环取证——S4 既不写首选键也不清记忆，再次冷启必须仍落
      // WebView（若 S4 误清记忆/误写首选，此处会落到 LynxActivity）
      forceStopApp(serial);
      startMainActivity(serial);
      expect(await waitTopActivity(serial, MAIN_ACTIVITY, 60_000)).toBe(MAIN_ACTIVITY);
      const second = await pollEngineState(
        serial,
        (s) => s !== null && s.reason === "lynx_known_bad",
        30_000,
      );
      expect(second).toEqual({ preferred: "lynx", effective: "webview", reason: "lynx_known_bad" });
      dumpPrefsToFile(serial, "m3-lynx-known-bad");
    }, 240_000);

    it("M3'（M4 替代格）记忆失配（E4）：versionCode+1 → 记忆惰性 → 冷启落 LynxActivity", async () => {
      // 承接 M3 终态（失败记忆仍在 = versionCode）：写入失配版本 → 精确匹配不命中
      // → F 惰性 → S1（pictelio_ui Lynx 可用，无取证键）→ BOOT_LYNX。
      // 取证 versionCode 精确匹配规则（应用升级自动遗忘的前提，spec E4）。
      const versionCode = readInstalledVersionCode(serial);
      writePrefKey(serial, ENGINE_KEYS.failureMemory, String(versionCode + 1));

      forceStopApp(serial);
      await dismissPermissionDialogIfAny(serial);
      startMainActivity(serial);

      expect(await waitTopActivity(serial, LYNX_ACTIVITY, 60_000)).toBe(LYNX_ACTIVITY);
      // 谓词精确匹配：承接 M3 终态时旧快照（lynx_known_bad）仍在盘上，null-check
      // 会读到旧值假失败——必须等新发布的 reason=preferred 快照
      const state = await pollEngineState(
        serial,
        (s) => s !== null && s.reason === "preferred",
        30_000,
      );
      expect(state).toEqual({ preferred: "lynx", effective: "lynx", reason: "preferred" });
      dumpPrefsToFile(serial, "m3p-memory-mismatch-lynx");
    }, 120_000);
  },
);

describe.skipIf(LOW_SKIPPED)(
  `M2 双失败取证（pictelio_low，full 包）${LOW_SKIPPED ? `（SKIP：解析到 ${TARGET_AVD}）` : ""}`,
  () => {
    let ctx: AndroidE2eContext;

    beforeAll(async () => {
      // M2 需要读升级页 WebView 内容 → 走 Appium harness（先例 webview-only-upgrade）
      ctx = await setupAndroidE2e(TARGET_AVD);
    }, 600_000);

    afterAll(async () => {
      // 恢复基线（同 M1 组约定），再关 session
      try {
        forceStopApp(ctx.serial);
        writePrefKey(ctx.serial, ENGINE_KEYS.debugForceLynxUnavailable, "false");
        writeClientKind(ctx.serial, "webview");
      } catch {
        // 收尾失败不阻断
      }
      await ctx?.teardown();
    });

    it("M2 双失败（S3）：取证键 + WebView 66 → 升级页双失败文案，无 Lynx 渲染", async () => {
      const { driver, serial } = ctx;
      // setup.ts 播种了 pictelio_client_kind=webview（E2E 基线）——pm clear 恢复
      // 「无首选键 = 缺省 lynx」前提（spec §8 M2 播种列同 M1）
      pmClear(serial);
      writePrefKey(serial, ENGINE_KEYS.debugForceLynxUnavailable, "true");
      expect(readPrefValue(serial, ENGINE_KEYS.debugForceLynxUnavailable)).toBe("true");

      // 清 logcat：Lynx 渲染信号断言只看本次启动的日志（降低缓冲区残留误报）
      runCapture(adbPath(), ["-s", serial, "shell", "logcat", "-c"]);

      forceStopApp(serial);
      await dismissPermissionDialogIfAny(serial);
      startMainActivity(serial);

      // 双失败：Lynx 不可用 ∧ WebView 不合格 → 升级页（UPGRADE_PAGE），top 停 MainActivity
      expect(await waitTopActivity(serial, MAIN_ACTIVITY, 60_000)).toBe(MAIN_ACTIVITY);

      // 升级页内容在 WebView 内渲染：native context 的 page source 可读 WebView
      // 文本（先例 webview-only-upgrade.spec.ts）；轮询直到 ?reason=no_engine
      // 双失败文案出现（替代固定 sleep，避免渲染慢误报）
      await driver.switchToNative();
      await driver.raw.waitUntil(
        async () => {
          const src = await driver.raw.getPageSource();
          return src.includes("应用无法启动") || src.includes("本机无法运行 Lynx 引擎");
        },
        {
          timeout: 30_000,
          timeoutMsg:
            "双失败文案未出现（?reason=no_engine 分支未生效，或升级页仍显示缺省 WebView 过低文案）",
          interval: 2_000,
        },
      );

      // 终态取证：top 仍是 MainActivity，绝无 LynxActivity
      expect(currentTopActivity(serial), "双失败不应分发 LynxActivity").not.toBe(LYNX_ACTIVITY);

      // 无 Lynx 渲染信号（roundtrip-low 同款 logcat oracle：onPageChanged /
      // OnPatchFinishForFiber 是 Lynx 渲染成功的唯一可靠信号）
      const { execFileSync } = await import("node:child_process");
      const pid = execFileSync(adbPath(), ["-s", serial, "shell", "pidof", APP_PACKAGE])
        .toString()
        .trim();
      expect(pid, "app 进程应存活（MainActivity 承载升级页）").not.toBe("");
      const logs = execFileSync(adbPath(), [
        "-s",
        serial,
        "shell",
        "logcat",
        "-d",
        "--pid",
        pid,
      ]).toString();
      const lynxSignals = logs.match(/onPageChanged|OnPatchFinishForFiber/gu) ?? [];
      expect(lynxSignals, `不应出现 Lynx 渲染信号（实际: ${lynxSignals.join("; ")}）`).toEqual([]);
      dumpPrefsToFile(serial, "m2-no-engine");
    }, 180_000);
  },
);

/**
 * android-e2e 测试编排：AVD → 编译安装 → Appium → driver session。
 *
 * 每个 spec 文件调用一次 setupAndroidE2e()（建议放 beforeAll），返回共享的
 * driver 与 teardown。Appium server / 模拟器在用例结束后保持运行（复用策略，
 * 下次运行直接复用），只关闭 WebdriverIO session；若 server 是本进程启动的
 * 则由 teardown 一并停止。
 */
import { AndroidE2eDriver } from "./driver";
import { ensureAppiumServer, assertUiautomator2DriverInstalled } from "./appium";
import { ensureEmulator, assertDeviceOnline } from "./avd";
import { ensureChromedriver } from "./chromedriver";
import { buildDebugApk, installApk } from "./build-install";
import { adbPath, APP_PACKAGE, runCapture, runOrThrow, sdkRoot, TIMEOUTS } from "./env";

// uiautomator2 driver 的 session 创建在 vitest 进程内执行（remote()），
// 用的是 process.env；本机可能未导出 ANDROID_HOME，启动即注入探测值。
process.env.ANDROID_HOME ??= sdkRoot();
process.env.ANDROID_SDK_ROOT ??= sdkRoot();

export interface AndroidE2eContext {
  driver: AndroidE2eDriver;
  /** 目标模拟器 adb serial（如 emulator-5554） */
  serial: string;
  /** 实际使用的 AVD 名 */
  avd: string;
  /** 收尾：关闭 session；本进程启动的 Appium server 一并停止 */
  teardown: () => Promise<void>;
}

/**
 * 完整端到端准备流程：
 * 1. 校验 uiautomator2 driver 已安装（appium:setup）
 * 2. 检测/启动 AVD 并等待 boot 完成
 * 3. 编译 debug APK（可 ANDROID_E2E_SKIP_BUILD=1 跳过）并 adb install
 * 4. 启动/复用 Appium server
 * 5. 创建 WebdriverIO session，等待 MainActivity 前台就绪
 */
export async function setupAndroidE2e(avdName?: string): Promise<AndroidE2eContext> {
  const requestedAvd = avdName ?? process.env.ANDROID_E2E_AVD;

  assertUiautomator2DriverInstalled();

  const { avd, serial } = await ensureEmulator(requestedAvd);
  assertDeviceOnline(serial);

  // 预置与设备 WebView 匹配的 chromedriver（缺失时走代理下载，避免 Appium 自动下载失败）
  await ensureChromedriver(serial);

  await buildDebugApk();
  // 真机（ANDROID_E2E_SERIAL）：ColorOS 的「PC install attack」防护拦截 adb 安装通道
  //（无论覆盖/全新，均 -99；手动安装走系统安装器可绕过）→ 跳过 installApk，
  // 约定真机 APK 由外部预装（e2e 构建），基建仅负责 run-as 清数据基线。
  if (!process.env.ANDROID_E2E_SERIAL) {
    await installApk(serial);
  } else {
    // 真机：依赖外部预装的 e2e 构建 full-debug APK（adb install 被 ColorOS 拦截）。
    // 校验包确实存在，避免基线不对齐（被测 APK 非本次构建产物）。
    const installed = runCapture(adbPath(), ["-s", serial, "shell", "pm", "path", APP_PACKAGE]);
    if (!installed.includes("package:")) {
      throw new Error(`真机 ${serial} 未预装 ${APP_PACKAGE}（e2e full-debug APK）——请先手动安装`);
    }
    console.log(`[android-e2e] ✓ 真机 ${serial} 已预装 ${APP_PACKAGE}（外部预装约定）`);
  }

  // 冒烟基线：清掉 app 数据（含可能残留的 pictelio_client_kind=lynx，否则
  // MainActivity 入口路由会分发到 LynxActivity，冒烟断言 MainActivity 必失败）。
  // 后续 #105 S1 契约测试会在本步之后显式写入目标值。
  // 真机（ANDROID_E2E_SERIAL）：部分 ROM（ColorOS）pm clear 无 CLEAR_APP_USER_DATA
  // 权限、adb install 被「PC install attack」防护拦截 → 只用 run-as 清数据目录
  //（debug 包可 run-as，幂等，无需卸载/重装）。
  if (process.env.ANDROID_E2E_SERIAL) {
    runOrThrow(adbPath(), ["-s", serial, "shell", "am", "force-stop", APP_PACKAGE], TIMEOUTS.adb);
    // 单字符串命令：adb shell 会把整个字符串发给设备 shell 执行（数组参数会被拆散）
    runOrThrow(
      adbPath(),
      [
        "-s",
        serial,
        "shell",
        `run-as ${APP_PACKAGE} sh -c 'rm -rf shared_prefs databases files cache code_cache'`,
      ],
      TIMEOUTS.adb,
    );
    console.log(`[android-e2e] ✓ 真机基线：覆盖安装 + run-as 清数据（替代 pm clear）`);
  } else {
    runOrThrow(adbPath(), ["-s", serial, "shell", "pm", "clear", APP_PACKAGE], TIMEOUTS.adb);
    console.log(`[android-e2e] ✓ 已清空 ${APP_PACKAGE} 数据（冒烟基线干净）`);
  }

  const appium = await ensureAppiumServer();

  const driver = new AndroidE2eDriver({ serial, avd });
  try {
    await driver.launch();
  } catch (e) {
    // session 创建失败也尽量收集证据（此时 driver 可能无 session，collectEvidence 内部逐项容错）
    await driver.collectEvidence("session-launch-failed").catch(() => {});
    await appium.stop();
    throw e;
  }

  const teardown = async (): Promise<void> => {
    await driver.dispose();
    await appium.stop();
  };

  return { driver, serial, avd, teardown };
}

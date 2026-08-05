/**
 * Android E2E Driver：WebdriverIO standalone 封装。
 *
 * 沿用 agent-browser 的「driver 封装 + vitest 断言」模式（spec「既有先例」），
 * driver 换成 Appium：负责 session 创建、NATIVE_APP ↔ WEBVIEW context 切换、
 * Chromedriver 版本匹配的清晰报错、失败证据收集（Activity / 截屏 / logcat）。
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { remote, type Browser } from "webdriverio";
import { adbPath, APP_PACKAGE, APP_ROOT, MAIN_ACTIVITY, runCapture, TIMEOUTS } from "./env";
import { APPIUM_HOST, APPIUM_PORT } from "./appium";
import { webviewMajorVersion } from "./avd";

const RESULTS_DIR = resolve(APP_ROOT, "test-results/android-e2e");

/** 把 Appium/Chromedriver 的版本不匹配错误翻译成可操作的指引 */
function translateChromedriverError(e: unknown, webviewMajor: number | null): Error {
  const msg = e instanceof Error ? e.message : String(e);
  if (/chromedriver|chrome version|session not created/iu.test(msg)) {
    const detected = /Chrome version (\d+)/iu.exec(msg)?.[1];
    const deviceVer = detected ?? (webviewMajor !== null ? String(webviewMajor) : "未知");
    return new Error(
      `[android-e2e] Chromedriver 与设备 WebView 版本不匹配（设备 WebView 主版本: ${deviceVer}）。\n` +
        `原始错误: ${msg}\n` +
        `解决方案：\n` +
        `  1. 让 Appium 自动下载匹配版本（默认已开启 chromedriverAutodownload，需能访问 googleapis 存储）；\n` +
        `  2. 或手动下载匹配版本的 Chromedriver，通过环境变量 CHROMEDRIVER_EXECUTABLE 指定路径（基建会自动映射到 appium:chromedriverExecutable）；\n` +
        `  3. 参考 https://chromedriver.chromium.org/downloads 版本对照表。`,
    );
  }
  return e instanceof Error ? e : new Error(msg);
}

export interface AndroidE2eDriverOptions {
  /** 目标设备 adb serial（如 emulator-5554） */
  serial: string;
  /** AVD 名（capabilities 中 avd 字段，供 Appium 日志/审计） */
  avd: string;
}

export class AndroidE2eDriver {
  private browser: Browser | null = null;
  private readonly serial: string;
  private readonly avd: string;
  private evidenceSeq = 0;

  constructor(options: AndroidE2eDriverOptions) {
    this.serial = options.serial;
    this.avd = options.avd;
  }

  /** 底层 WebdriverIO browser 实例（测试内需要原生 API 时使用） */
  get raw(): Browser {
    if (!this.browser) throw new Error("[android-e2e] driver 尚未启动，请先调用 launch()");
    return this.browser;
  }

  /** 创建 Appium session 并等待 App 主界面就绪 */
  async launch(): Promise<void> {
    const webviewMajor = webviewMajorVersion(this.serial);
    if (webviewMajor !== null) {
      console.log(`[android-e2e] 设备 WebView 主版本: ${webviewMajor}（Chromedriver 将自动匹配）`);
    } else {
      console.warn(
        "[android-e2e] 未能探测设备 WebView 版本，Chromedriver 匹配失败时将无法给出版本提示",
      );
    }

    try {
      const browserOptions: Parameters<typeof remote>[0] = {
        hostname: APPIUM_HOST,
        port: APPIUM_PORT,
        path: "/",
        logLevel: "warn",
        connectionRetryTimeout: TIMEOUTS.session,
        connectionRetryCount: 3,
        capabilities: {
          platformName: "Android",
          "appium:automationName": "UiAutomator2",
          "appium:udid": this.serial,
          "appium:avd": this.avd,
          "appium:appPackage": APP_PACKAGE,
          "appium:appActivity": MAIN_ACTIVITY,
          // 测试前已通过 adb install 装好最新 APK，session 不重复安装
          "appium:noReset": true,
          "appium:newCommandTimeout": 300,
          // android-28 模拟器冷启动慢，Appium 默认 adbExecTimeout 20s 不够
          "appium:adbExecTimeout": 60_000,
          // WebView 已开 setWebContentsDebuggingEnabled(true)，Chromedriver 自动匹配设备 WebView 主版本
          "appium:chromedriverAutodownload": true,
          "appium:recreateChromeDriverSessions": true,
        },
      };
      // 手动指定 Chromedriver（chromedriverAutodownload 下载失败时的逃生通道）
      if (process.env.CHROMEDRIVER_EXECUTABLE) {
        (browserOptions.capabilities as Record<string, unknown>)["appium:chromedriverExecutable"] =
          process.env.CHROMEDRIVER_EXECUTABLE;
      }
      this.browser = await remote(browserOptions);
    } catch (e) {
      throw translateChromedriverError(e, webviewMajor);
    }

    // 显式等待主 Activity 前台就绪（App 首屏渲染可能慢于 session 创建）
    await this.waitForActivity(MAIN_ACTIVITY, TIMEOUTS.session);
  }

  /** 显式等待当前 Activity 变为期望值（不用固定 sleep） */
  async waitForActivity(activity: string, timeoutMs = 60_000): Promise<void> {
    await this.raw.waitUntil(async () => (await this.currentActivity()) === activity, {
      timeout: timeoutMs,
      timeoutMsg: `等待 Activity ${activity} 超时（${timeoutMs / 1000}s），当前 Activity: ${await this.currentActivity().catch(() => "(未知)")}`,
      interval: 1_000,
    });
  }

  /** 当前前台 Activity 短名（如 .MainActivity / .LynxActivity） */
  async currentActivity(): Promise<string> {
    const activity = await this.raw.getCurrentActivity();
    // Appium 返回 ".MainActivity" 或全限定名，统一归一化为全限定短比较
    return activity.startsWith(".") ? `${APP_PACKAGE}${activity}` : activity;
  }

  /** 当前 context（NATIVE_APP / WEBVIEW_io.pictelio.app / ...） */
  async currentContext(): Promise<string> {
    const ctx = await this.raw.getContext();
    return typeof ctx === "string" ? ctx : String(ctx);
  }

  /** 列出全部 context */
  async contexts(): Promise<string[]> {
    const list = await this.raw.getContexts();
    return list.map((c) => (typeof c === "string" ? c : String(c)));
  }

  /** 等待 WEBVIEW context 出现并切换过去（返回实际 context 名） */
  async switchToWebView(timeoutMs = 30_000): Promise<string> {
    let target: string | null = null;
    await this.raw.waitUntil(
      async () => {
        const webviews = (await this.contexts()).find((c) => c.startsWith("WEBVIEW"));
        target = webviews ?? null;
        return target !== null;
      },
      {
        timeout: timeoutMs,
        timeoutMsg: `等待 WEBVIEW context 超时（${timeoutMs / 1000}s）。请确认 MainActivity 已开启 setWebContentsDebuggingEnabled(true)`,
        interval: 1_000,
      },
    );
    if (target === null) {
      // waitUntil 成功时 target 必然非空；此分支仅为类型收窄兜底
      throw new Error("[android-e2e] 内部错误：WEBVIEW context 等待成功但未记录目标");
    }
    const webviewContext: string = target;
    await this.switchContextWithRetry(webviewContext);
    console.log(`[android-e2e] 已切换到 ${webviewContext}`);
    return webviewContext;
  }

  /** 切回 NATIVE_APP context */
  async switchToNative(): Promise<void> {
    await this.switchContextWithRetry("NATIVE_APP");
    console.log("[android-e2e] 已切换到 NATIVE_APP");
  }

  /**
   * context 切换带重试 + Chromedriver 报错翻译。
   * WEBVIEW 切换会按需拉起 Chromedriver，版本不匹配在这里爆发。
   */
  private async switchContextWithRetry(name: string): Promise<void> {
    try {
      await this.raw.switchContext(name);
    } catch (e) {
      throw translateChromedriverError(e, webviewMajorVersion(this.serial));
    }
  }

  /**
   * 收集失败证据（spec「稳定性与可观测性」）：当前 Activity、截屏、logcat 尾部 200 行，
   * 输出到 test-results/android-e2e/。尽力而为，单项失败不影响其他项。
   */
  async collectEvidence(label: string): Promise<string> {
    this.evidenceSeq += 1;
    const tag = `${String(this.evidenceSeq).padStart(2, "0")}-${label.replace(/[^a-zA-Z0-9一-鿿-]+/gu, "-").slice(0, 40)}`;
    const dir = resolve(RESULTS_DIR, tag);
    mkdirSync(dir, { recursive: true });

    // 1. 当前 Activity
    try {
      const activity = await this.currentActivity();
      writeFileSync(resolve(dir, "activity.txt"), `${activity}\n`);
      console.log(`[android-e2e] 证据-当前 Activity: ${activity}`);
    } catch (e) {
      console.warn(`[android-e2e] 证据-Activity 采集失败: ${e instanceof Error ? e.message : e}`);
    }

    // 2. 截屏（优先 Appium，失败回退 adb screencap）
    try {
      const pngBase64 = await this.raw.takeScreenshot();
      writeFileSync(resolve(dir, "screenshot.png"), Buffer.from(pngBase64, "base64"));
    } catch {
      try {
        const r = runCapture(adbPath(), [
          "-s",
          this.serial,
          "shell",
          "screencap",
          "-p",
          "/sdcard/__e2e_shot.png",
        ]);
        if (r.code === 0) {
          const pull = runCapture(adbPath(), [
            "-s",
            this.serial,
            "pull",
            "/sdcard/__e2e_shot.png",
            resolve(dir, "screenshot.png"),
          ]);
          if (pull.code !== 0)
            console.warn(`[android-e2e] 证据-截屏 adb pull 失败: ${pull.stderr}`);
        }
      } catch (e2) {
        console.warn(`[android-e2e] 证据-截屏失败: ${e2 instanceof Error ? e2.message : e2}`);
      }
    }

    // 3. logcat 尾部 200 行
    try {
      const r = runCapture(adbPath(), ["-s", this.serial, "logcat", "-d", "-t", "200"]);
      writeFileSync(resolve(dir, "logcat-tail.txt"), `${r.stdout}\n${r.stderr}\n`);
    } catch (e) {
      console.warn(`[android-e2e] 证据-logcat 采集失败: ${e instanceof Error ? e.message : e}`);
    }

    console.log(`[android-e2e] 失败证据已写入 ${dir}`);
    return dir;
  }

  /** 结束 session（不卸载 App、不关模拟器——模拟器复用策略见 ADR-0061） */
  async dispose(): Promise<void> {
    if (this.browser) {
      try {
        await this.browser.deleteSession();
      } catch (e) {
        console.warn(
          `[android-e2e] deleteSession 失败（忽略）: ${e instanceof Error ? e.message : e}`,
        );
      }
      this.browser = null;
    }
  }
}

// @vitest-environment node
/**
 * lynx 详情页图片加载失败 · 调查取证（#543 Part2，非验收 spec）。
 *
 * 目的：按决策树抓取根因判别证据——「详情页图片全部『图片加载失败』而推荐页封面
 * 正常」的异常类别（logcat `图片加载失败: <url>` 行的 Throwable 类别）：
 *   - OutOfMemoryError /「Bitmap 解码失败」→ 内存/解码分支（master1200 解码 + copy
 *     ≈16MB/张 × N 页并发；ImageMemoryCache 无上界审计）
 *   - IOException 带 HTTP 状态 → 网络分支（403 Referer / 429 并发突发限流 / 超时）
 *   - IllegalArgumentException("image url is null") → JS 缝（resolvePageSrcs 产空）
 *
 * 流程（复用既有 harness，全程无 UI 点击）：
 *   1. setupAndroidE2e（AVD + Appium + APK，可选 ANDROID_E2E_HTTP_PROXY 设备全局代理）
 *   2. webview 侧 CDP 注入 token 登录（fab/bookmark-tags 同款；lynx 经共享
 *      WSSecureStorage 种子恢复，ADR-0050/#126）
 *   3. 切 pictelio_client_kind=lynx → 重启 → **benchNav 深链直达详情页**
 *      （`--es benchNav illust-detail --es benchNavIllustId <id>`，#542 建成的通道，
 *      取代 bookmark-tags spec 的「轮播首卡点击进入」像素定位法）
 *   4. 等 20s（四次广播 6s + 详情请求 + 图片并发窗口）→ logcat -d 全量落盘 + 分类
 *
 * 断言口径（调查 spec 不预设根因，但禁止空转通过）：
 *   - LynxActivity 必须前台（深链必须生效）
 *   - 图片链路信号二选一（成功在 logcat 静默——服务只打失败日志，故辅以像素判定）：
 *     a) logcat 有 `图片加载失败` 行 → 失败复现，证据行 + Throwable 类别落盘
 *     b) 截图海报区色彩方差显著（unique colors > 200）→ 图片加载成功
 *     两者皆无 → 重试一次启动再验；仍无 = 环境未复现，spec 红以暴露环境问题
 *
 * 前置：`BENCH_NAV=1 pnpm build:android`（整链注入，见 README benchNav 节——
 * build:android 内部重跑 lynx build，单独注入会被覆盖）；设备全局代理按需
 * （ANDROID_E2E_HTTP_PROXY=10.0.2.2:10808，DNS 污染环境必备）；PIXIV_REFRESH_TOKEN。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createCanvas, loadImage } from "canvas";
import { setupAndroidE2e, type AndroidE2eContext } from "../setup";
import {
  adbPath,
  APP_PACKAGE,
  E2E_FLAVOR,
  LYNX_ACTIVITY,
  MAIN_ACTIVITY,
  REPO_ROOT,
  runCapture,
  runOrThrow,
} from "../env";
import { clickByText } from "../helpers";
import { forceStopApp, startMainActivity, writeClientKind } from "../prefs";

const SLEEP = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 目标插画（env 可覆盖）：默认用 #376 验收同源的真实插画 id */
const ILLUST_ID = process.env.ANDROID_E2E_ILLUST_ID ?? "149179678";

const EVIDENCE_DIR = resolve(
  REPO_ROOT,
  "packages/app/test-results/android-e2e/lynx-detail-image-probe",
);

const TARGET_AVD = process.env.ANDROID_E2E_AVD || "pictelio_ui";
const SKIPPED = TARGET_AVD !== "pictelio_ui" || E2E_FLAVOR === "webview";
const SKIP_REASON =
  TARGET_AVD !== "pictelio_ui"
    ? `调查取证绑定 pictelio_ui（复现环境口径），当前 ANDROID_E2E_AVD=${TARGET_AVD}`
    : `本调查需要 full 包（Lynx 引擎）；当前 ANDROID_E2E_FLAVOR=webview`;
if (SKIPPED) {
  console.log(`[lynx-detail-image-probe] SKIP: ${SKIP_REASON}`);
}

let ctx: AndroidE2eContext;

/** APK 内 bundle 必须含详情页深链钩子（BENCH_NAV=1 整链构建），否则 spec 红并给指令 */
function assertDeepLinkHookPresent(): void {
  const bundle = resolve(REPO_ROOT, "packages/app/android/app/src/main/assets/main.lynx.bundle");
  const r = runCapture("grep", ["-a", "-c", "pictelioBenchNavIllustDetail", bundle]);
  if (r.stdout.trim() === "0") {
    throw new Error(
      "[lynx-detail-image-probe] APK 内 lynx bundle 无详情页深链钩子——请先 `BENCH_NAV=1 pnpm build:android` " +
        "（整链注入；build:android 内部重跑 lynx build，单独注入 build:app-lynx 会被覆盖，#542 实测坑）",
    );
  }
}

/** webview 侧 CDP 注入 token 登录（fab 回归同款；lynx 经共享 WSSecureStorage 恢复） */
async function loginViaWebview(loginCtx: AndroidE2eContext): Promise<void> {
  const { driver } = loginCtx;
  await driver.switchToWebView(60_000);

  await driver.raw.waitUntil(
    async () => {
      const url = await driver.raw.getUrl();
      if (!url.includes("/age-confirmation")) return true;
      await clickByText(loginCtx, "已满 18 岁");
      return false;
    },
    { timeout: 60_000, timeoutMsg: "年龄确认页未通过", interval: 1_000 },
  );

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
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
      setter.call(inner, ${JSON.stringify(token)});
      inner.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
      inner.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
    })()`,
  );
  await driver.raw.waitUntil(
    async () => {
      const btn = await driver.raw.$("fluent-button=登录");
      return (await btn.getAttribute("disabled")) === null;
    },
    { timeout: 10_000, timeoutMsg: "token 注入后登录按钮未启用", interval: 300 },
  );
  await clickByText(loginCtx, "登录");
  await driver.raw.waitUntil(async () => !(await driver.raw.getUrl()).includes("/login"), {
    timeout: 90_000,
    timeoutMsg: "登录失败（仍停留在 /login）",
    interval: 2_000,
  });
  console.log(`[probe] ✓ webview 登录成功: ${await driver.raw.getUrl()}`);
}

/** 截图到本地文件（exec-out 二进制直传，不经 utf-8 编码） */
function screencapTo(serial: string, dest: string): void {
  const r = spawnSync(adbPath(), ["-s", serial, "exec-out", "screencap", "-p"], {
    encoding: "buffer",
    timeout: 30_000,
    maxBuffer: 64 * 1024 * 1024,
  });
  if (r.status !== 0 || !r.stdout || r.stdout.length < 100) {
    throw new Error(`[probe] screencap 失败 (exit ${r.status})`);
  }
  writeFileSync(dest, r.stdout);
}

/** 截图海报区（屏幕顶部 30%~60%、水平 10%~90%）unique colors——加载成功数千色，失败平底色+文字 */
async function posterColorVariety(shotPath: string): Promise<number> {
  const img = await loadImage(shotPath);
  const canvas = createCanvas(400, 300);
  const c2d = canvas.getContext("2d");
  c2d.drawImage(
    img,
    img.width * 0.1,
    img.height * 0.3,
    img.width * 0.8,
    img.height * 0.3,
    0,
    0,
    400,
    300,
  );
  const data = c2d.getImageData(0, 0, 400, 300).data;
  const colors = new Set<string>();
  for (let i = 0; i < data.length; i += 16) {
    colors.add(`${data[i]},${data[i + 1]},${data[i + 2]}`);
  }
  return colors.size;
}

beforeAll(async () => {
  if (SKIPPED) return;
  assertDeepLinkHookPresent();
  ctx = await setupAndroidE2e(TARGET_AVD);
  const serial = ctx.serial;

  // ① webview 侧登录（token → 共享 WSSecureStorage）
  writeClientKind(serial, "webview");
  forceStopApp(serial);
  startMainActivity(serial);
  await SLEEP(6_000);
  await loginViaWebview(ctx);

  // ② 切 lynx 重启（benchNav 钩子仅 lynx 生效）
  forceStopApp(serial);
  writeClientKind(serial, "lynx");
}, 600_000);

afterAll(() => {
  if (SKIPPED) return;
  try {
    forceStopApp(ctx.serial);
  } catch {
    /* 收尾失败不阻断 */
  }
});

describe("lynx 详情页图片失败取证（#543 Part2）", () => {
  it("深链进详情页，抓取图片链路失败/成功证据并落盘", async () => {
    if (SKIPPED) return;
    const serial = ctx.serial;
    mkdirSync(EVIDENCE_DIR, { recursive: true });

    const launchDeepLink = () => {
      forceStopApp(serial);
      runOrThrow(adbPath(), ["-s", serial, "logcat", "-c"]);
      runOrThrow(adbPath(), [
        "-s",
        serial,
        "shell",
        "am",
        "start",
        "-n",
        APP_PACKAGE + "/" + MAIN_ACTIVITY,
        "--es",
        "benchNav",
        "illust-detail",
        "--es",
        "benchNavIllustId",
        ILLUST_ID,
      ]);
    };

    const captureRound = async (tag: string) => {
      await SLEEP(tag === "first" ? 20_000 : 15_000);
      const top = runCapture(adbPath(), [
        "-s",
        serial,
        "shell",
        "dumpsys",
        "activity",
        "activities",
      ]);
      expect(top.stdout).toContain(LYNX_ACTIVITY);

      const full = runCapture(adbPath(), ["-s", serial, "logcat", "-d"], 60_000, 64 * 1024 * 1024);
      writeFileSync(resolve(EVIDENCE_DIR, `logcat-full-${tag}.txt`), full.stdout);
      const failLines = full.stdout.split("\n").filter((l) => l.includes("图片加载失败"));
      const causes = failLines.map((l) => {
        const lines = full.stdout.split("\n");
        const idx = lines.indexOf(l);
        return lines.slice(idx + 1, idx + 3).join("\n");
      });
      writeFileSync(resolve(EVIDENCE_DIR, `image-failures-${tag}.txt`), failLines.join("\n"));
      writeFileSync(
        resolve(EVIDENCE_DIR, `image-failure-causes-${tag}.txt`),
        causes.join("\n---\n"),
      );

      const shotPath = resolve(EVIDENCE_DIR, `detail-${tag}.png`);
      screencapTo(serial, shotPath);
      const variety = await posterColorVariety(shotPath);
      console.log(`[probe/${tag}] 失败行 ${failLines.length}；海报区 unique colors ${variety}`);
      return { failLines, variety };
    };

    launchDeepLink();
    const first = await captureRound("first");
    if (first.failLines.length > 0 || first.variety > 200) {
      // 失败复现 或 加载成功——二者均为有效取证，结论由人工按决策树归类
      expect(true).toBe(true);
      return;
    }

    // 首跑零信号（冷启动登录态/请求时序偶发）→ 重试一次启动再验
    console.log("[probe] 首跑零信号，重试一次深链启动…");
    launchDeepLink();
    const retry = await captureRound("retry");
    expect(retry.failLines.length > 0 || retry.variety > 200).toBe(true);
  }, 300_000);
});

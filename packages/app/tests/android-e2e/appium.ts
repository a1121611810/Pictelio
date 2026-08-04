/**
 * Appium server 生命周期管理：本地启动、健康检查、用完后只杀自己启动的实例。
 *
 * Appium 2/3 的 driver 安装（`appium driver install uiautomator2`）是一次性
 * 环境准备，通过 `pnpm appium:setup` 执行（见 packages/app/package.json），
 * 驱动装到 ~/.appium，本模块只做 server 进程管理。
 */
import { spawn, type ChildProcess } from "node:child_process";
import { createRequire } from "node:module";
import { APP_ROOT, cleanEnv, proxyEnv, TIMEOUTS, waitFor } from "./env";

const require = createRequire(import.meta.url);

export const APPIUM_PORT = Number(process.env.ANDROID_E2E_APPIUM_PORT ?? 4723);
export const APPIUM_HOST = "127.0.0.1";

/** 本地 node_modules 中的 appium CLI 入口 */
function appiumBin(): string {
  return require.resolve("appium/index.js");
}

/** /status 健康检查：能连通即视为 Appium 就绪（兼容带 / 根路径的 Appium 2 默认布局） */
async function isServerUp(): Promise<boolean> {
  try {
    const res = await fetch(`http://${APPIUM_HOST}:${APPIUM_PORT}/status`, {
      signal: AbortSignal.timeout(2_000),
    });
    if (!res.ok) return false;
    const body = (await res.json()) as { value?: { ready?: boolean } };
    // Appium 2 返回 { value: { ready: true, ... } }；个别代理实现无 ready 字段，能返回 JSON 即可用
    return body.value?.ready !== false;
  } catch {
    return false;
  }
}

export interface AppiumHandle {
  /** 是否是本模块启动的（复用外部实例时为 false，stop 时不杀） */
  owned: boolean;
  stop: () => Promise<void>;
}

/** 确保 Appium server 可用：先探测端口上既有实例，没有再本地 spawn */
export async function ensureAppiumServer(): Promise<AppiumHandle> {
  if (await isServerUp()) {
    console.log(`[android-e2e] 复用已运行的 Appium server（${APPIUM_HOST}:${APPIUM_PORT}）`);
    return { owned: false, stop: async () => {} };
  }

  console.log(`[android-e2e] 启动 Appium server（端口 ${APPIUM_PORT}）...`);
  // --allow-insecure *:chromedriver_autodownload：Appium 3 用 allow-insecure 启用
  // Chromedriver 自动下载 feature（capability 已废弃）；feature 名须含 automationName
  // 前缀（`*` 通配所有 driver）+ 冒号。设备 WebView 主版本与 Chromedriver 必须匹配，
  // 自动下载否则会报 No Chromedriver found。
  const proc: ChildProcess = spawn(process.execPath, [appiumBin(), "--address", APPIUM_HOST, "--port", String(APPIUM_PORT), "--allow-insecure", "*:chromedriver_autodownload"], {
    cwd: APP_ROOT,
    // proxyEnv：Chromedriver 自动下载走 googleapis，本机直连超时，必须走代理
    env: proxyEnv(),
    stdio: ["ignore", "pipe", "pipe"],
  });
  let exitedEarly: number | null = null;
  proc.on("exit", (code) => {
    exitedEarly = code;
  });
  proc.stdout?.on("data", (d: Buffer) => {
    for (const line of d.toString().split("\n")) {
      if (line.trim()) console.log(`[appium] ${line}`);
    }
  });
  proc.stderr?.on("data", (d: Buffer) => {
    for (const line of d.toString().split("\n")) {
      if (line.trim()) console.log(`[appium:err] ${line}`);
    }
  });

  await waitFor(
    "Appium server /status 就绪",
    async () => {
      if (exitedEarly !== null) {
        throw new Error(
          `Appium server 提前退出（code ${exitedEarly}）。常见原因：未安装 uiautomator2 driver——` +
            `请先执行 pnpm appium:setup（packages/app 下）`,
        );
      }
      return isServerUp();
    },
    TIMEOUTS.appium,
    1_000,
    // failFast：server 已退出时立即报错，不等满超时
    true,
  );

  const stop = async (): Promise<void> => {
    if (proc.killed) return;
    proc.kill("SIGTERM");
    // 给 server 5s 优雅退出，之后强杀
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline) {
      if (proc.exitCode !== null) return;
      await new Promise((r) => setTimeout(r, 200));
    }
    proc.kill("SIGKILL");
  };
  return { owned: true, stop };
}

/** 检查 uiautomator2 driver 是否已安装（提前失败，避免 session 创建时报错难懂） */
export function assertUiautomator2DriverInstalled(): void {
  const { spawnSync } = require("node:child_process") as typeof import("node:child_process");
  const r = spawnSync(process.execPath, [appiumBin(), "driver", "list", "--installed"], {
    cwd: APP_ROOT,
    encoding: "utf-8",
    env: cleanEnv(),
    timeout: 30_000,
  });
  const out = `${r.stdout ?? ""}\n${r.stderr ?? ""}`;
  if (r.status !== 0 || !/uiautomator2/iu.test(out)) {
    throw new Error(
      `[android-e2e] 未检测到 Appium uiautomator2 driver。\n` +
        `请先在 packages/app 下执行：pnpm appium:setup\n` +
        `（等价于 appium driver install uiautomator2，driver 装在 ~/.appium）`,
    );
  }
  console.log("[android-e2e] ✓ uiautomator2 driver 已安装");
}

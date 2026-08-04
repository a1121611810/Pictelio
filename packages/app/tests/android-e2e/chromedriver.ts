/**
 * Chromedriver 预置模块：确保 Appium 能匹配设备 WebView 主版本。
 *
 * 背景（实测 2026-08-04）：Appium 的 chromedriver 自动下载走
 * chromedriver.storage.googleapis.com，本机直连大文件下载会超时（curl HEAD 200
 * 但 GET 超时，需走代理），且 Appium 的下载器不读 http_proxy env —— 实测自动
 * 下载必然 UND_ERR_SOCKET 失败。因此改为手动预置：探测设备 WebView 主版本 →
 * 若 uiautomator2-driver 自带的 chromedriver 目录无匹配二进制 → 通过代理 curl
 * 下载对应版本 zip 并解压到该目录，Appium 扫描本地即可复用，不再走网络。
 *
 * 依赖的 zip URL 走 googleapis，本机必须能访问代理（如 127.0.0.1:10808）。
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { webviewMajorVersion } from "./avd";
import { proxyEnv, runCapture } from "./env";

/** Appium 全局 driver 目录（与 env.ts cleanEnv 的 APPIUM_HOME 注入保持一致） */
export function appiumHome(): string {
  return process.env.APPIUM_HOME ?? resolve(homedir(), ".appium");
}

/** uiautomator2-driver 实际扫描的 chromedriver 目录（Appium 从这发现本地二进制） */
export function chromedriverCacheDir(): string {
  return resolve(
    appiumHome(),
    "node_modules/appium-uiautomator2-driver/node_modules/appium-chromedriver/chromedriver/mac",
  );
}

/** 代理地址（与本机 proxy 约定一致） */
function proxyUrl(): string | undefined {
  return (
    process.env.https_proxy ??
    process.env.HTTPS_PROXY ??
    process.env.http_proxy ??
    process.env.HTTP_PROXY ??
    undefined
  );
}

/**
 * 从 appium-chromedriver 的 mapping.json 查 Chrome 主版本对应的精确 chromedriver 版本。
 * mapping 形如 { "113.0.5672.63": "113.0.5672.63" }（cd 版本 → chrome 版本）。
 */
function chromedriverVersionFor(major: number): string | null {
  const mappingPath = resolve(
    appiumHome(),
    "node_modules/appium-uiautomator2-driver/node_modules/appium-chromedriver/config/mapping.json",
  );
  try {
    const mapping = JSON.parse(readFileSync(mappingPath, "utf8")) as Record<string, string>;
    // 找 chrome 版本以 major 开头的条目，取 cd 版本
    for (const [cdVersion, chromeVersion] of Object.entries(mapping)) {
      if (String(chromeVersion).startsWith(`${major}.`)) {
        return cdVersion;
      }
    }
  } catch {
    // mapping 读取失败，fallback 到主版本推测
  }
  return null;
}

/**
 * 确保本地有匹配设备 WebView 主版本的 chromedriver 二进制。
 * 已有则复用；缺失则通过代理下载 googleapis 对应版本并解压。
 */
export async function ensureChromedriver(serial: string): Promise<number | null> {
  const major = webviewMajorVersion(serial);
  if (major === null) {
    console.warn("[android-e2e] 未能探测设备 WebView 版本，跳过 chromedriver 预置");
    return null;
  }

  const dir = chromedriverCacheDir();
  const binary = resolve(dir, "chromedriver");
  if (existsSync(binary)) {
    // 已有二进制：校验 cd 版本与设备 WebView 匹配（用 mapping 对照，而非直接比 major——
    // 老版 cd 如 2.40 的版本号 major 是 2，对应 chrome 66）。不匹配则重新下载对应版本。
    const expectedCd = chromedriverVersionFor(major);
    try {
      const v = runCapture(binary, ["--version"]).stdout;
      const m = /ChromeDriver ([\d.]+)/u.exec(v);
      const haveCd = m?.[1] ?? "";
      // 版本匹配：cd 精确相等，或已有版本以期望版本开头（2.40.565386 ↔ 需 2.40），
      // 或已有版本号以 chrome 主版本开头（113.0.x ↔ chrome 113）
      if (
        expectedCd === null ||
        haveCd === expectedCd ||
        haveCd.startsWith(`${expectedCd}.`) ||
        haveCd.startsWith(`${major}.`)
      ) {
        console.log(`[android-e2e] ✓ chromedriver 已预置（${v.trim().slice(0, 40)}）`);
        return major;
      }
      console.log(
        `[android-e2e] chromedriver 版本不匹配（有 ${haveCd}，需 ${expectedCd ?? major}），重新下载`,
      );
    } catch {
      // 二进制损坏，走下载
    }
  }

  // 缺失/不匹配 → 通过代理下载（直连 googleapis 大文件超时）
  const proxy = proxyUrl();
  if (!proxy) {
    throw new Error(
      `[android-e2e] 需要下载 chromedriver ${major}，但未检测到代理（http_proxy/https_proxy）。` +
        `请设置代理后重试，或手动将 chromedriver ${major} 放入 ${dir}`,
    );
  }

  console.log(`[android-e2e] 通过代理下载 chromedriver ${major}（${proxy}）...`);
  const cdVersion = chromedriverVersionFor(major) ?? `${major}.0.0.0`;
  // zip 文件名随 CPU 架构：arm64（Apple Silicon）/ mac64（Intel）。
  // 老版 chromedriver（2.x 等）无 arm64 构建——arm64 下载失败时 fallback mac64。
  const archList = process.arch === "arm64" ? ["arm64", "64"] : ["64"];
  const tmpZip = resolve(process.env.TMPDIR ?? "/tmp", `cd-${major}.zip`);
  let downloaded = false;
  for (const arch of archList) {
    const zipUrl = `https://chromedriver.storage.googleapis.com/${cdVersion}/chromedriver_mac_${arch}.zip`;
    try {
      execFileSync("curl", ["-sL", "--max-time", "120", "-x", proxy, "-o", tmpZip, zipUrl], {
        env: proxyEnv(),
        timeout: 150_000,
        stdio: "ignore",
      });
      // 校验是 zip（googleapis 不存在时返回 XML 错误页）
      const head = readFileSync(tmpZip).subarray(0, 2).toString("latin1");
      if (head === "PK") {
        downloaded = true;
        break;
      }
    } catch {
      // 尝试下一个架构
    }
  }
  if (!downloaded) {
    throw new Error(
      `[android-e2e] chromedriver ${major} 下载失败（尝试 ${archList.join("/")} 架构）。` +
        `请确认代理可用，或手动下载解压到 ${dir}。`,
    );
  }

  mkdirSync(dir, { recursive: true });
  execFileSync("unzip", ["-o", tmpZip, "-d", dir], { timeout: 30_000, stdio: "ignore" });
  console.log(`[android-e2e] ✓ chromedriver ${major} 已下载并解压到 ${dir}`);
  return major;
}

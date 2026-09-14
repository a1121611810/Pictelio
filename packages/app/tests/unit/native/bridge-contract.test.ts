// ─── 原生桥接口一致性契约测试（#249，规格「测试决策」契约测试③） ───
// 模式对齐 backupRulesConsistency.test.ts：从真实源码提取契约常量比对，防
// 「TS 声明了/改名了但 Java 未实现」与「bundle 依赖了幽灵 API」两类漂移。
// oracle = 双侧源码本身（Java @PluginMethod 注解 ↔ TS interface 声明），
// 非手写自洽字段——单侧改动即测试报警。
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Solid 2.0 迁移注：happy-dom 测试姿态下 vite 会改写 `new URL(rel, import.meta.url)`
// 资产模式（http URL 下抛 "The URL must be of scheme file"）。改用与
// differential 契约测试相同的 fileURLToPath 显式路径解析（import.meta.url 恒 file://）。
const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const JAVA_DIR = resolve(TEST_DIR, "../../../android/app/src/webview/java/io/pictelio/app/");
const OTA_PLUGIN_JAVA = readFileSync(resolve(JAVA_DIR, "OtaPlugin.java"), "utf-8");
// #252 重构后安装流水线拆至 OtaInstaller（插件与 Worker 共用），契约面 = 两文件并集
const OTA_INSTALLER_JAVA = readFileSync(resolve(JAVA_DIR, "OtaInstaller.java"), "utf-8");
const OTA_WORKER_JAVA = readFileSync(resolve(JAVA_DIR, "OtaWorker.java"), "utf-8");
const OTA_TS = readFileSync(resolve(TEST_DIR, "../../../src/native/Ota.ts"), "utf-8");

/** Java @PluginMethod 方法名（紧随注解的 public void x(PluginCall ...)） */
function extractJavaPluginMethods(source: string): string[] {
  const names: string[] = [];
  const re = /@PluginMethod\s+public\s+void\s+(\w+)\s*\(\s*PluginCall/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) {
    names.push(m[1]!);
  }
  return names;
}

/** TS interface OtaPlugin 方法名（x(): Promise<...> / x(opts: ...): Promise<...>） */
function extractTsInterfaceMethods(source: string): string[] {
  const iface = source.match(/interface OtaPlugin \{([\s\S]*?)\n\}/);
  if (!iface) throw new Error("Ota.ts 缺少 interface OtaPlugin 块（契约锚点漂移）");
  const names: string[] = [];
  const re = /^\s{2}(\w+)\(/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(iface[1]!)) !== null) {
    names.push(m[1]!);
  }
  return names;
}

describe("Ota 桥接口一致性（Java @PluginMethod ↔ TS 声明）", () => {
  it("Java 侧 @PluginMethod 方法名与 TS interface 完全一致（顺序无关）", () => {
    const java = extractJavaPluginMethods(OTA_PLUGIN_JAVA);
    const ts = extractTsInterfaceMethods(OTA_TS);
    expect(
      java.length,
      "Java 侧应至少有 status/install/notifyReady/applyNow/prewarm",
    ).toBeGreaterThanOrEqual(5);
    expect(ts.toSorted()).toEqual(java.toSorted());
  });

  it("install 的 reject 原因机器可读（规格「选型与架构」失败语义，实现在 OtaInstaller）", () => {
    for (const reason of [
      "bad-signature",
      "apk-too-old",
      "checksum",
      "size-mismatch",
      "unzip-missing-index",
    ]) {
      expect(OTA_INSTALLER_JAVA, `缺少 OtaInstallException("${reason}")`).toContain(`"${reason}"`);
    }
  });

  it("签名走 OtaSignatureVerifier（不重复实现验签逻辑）", () => {
    expect(OTA_INSTALLER_JAVA).toContain("OtaSignatureVerifier.verifyManifest");
    expect(OTA_INSTALLER_JAVA).toContain("BuildConfig.OTA_ED25519_PUBLIC_KEY_B64");
  });

  it("快慢双通道共用 OtaInstaller（#252：插件与 Worker 不得各自实现流水线）", () => {
    expect(OTA_PLUGIN_JAVA).toContain("OtaInstaller.installBundle");
    expect(OTA_WORKER_JAVA).toContain("OtaInstaller.installBundle");
    // JS 侧契约：T0 走 prewarm（慢通道），门槛自愈走 install（前台快路径）
    expect(OTA_TS).toContain("prewarm(opts");
    expect(OTA_TS).toContain("install(opts");
  });
});

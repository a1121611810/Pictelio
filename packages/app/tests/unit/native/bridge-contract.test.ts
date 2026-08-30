// ─── 原生桥接口一致性契约测试（#249，规格「测试决策」契约测试③） ───
// 模式对齐 backupRulesConsistency.test.ts：从真实源码提取契约常量比对，防
// 「TS 声明了/改名了但 Java 未实现」与「bundle 依赖了幽灵 API」两类漂移。
// oracle = 双侧源码本身（Java @PluginMethod 注解 ↔ TS interface 声明），
// 非手写自洽字段——单侧改动即测试报警。
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const OTA_PLUGIN_JAVA = readFileSync(
  new URL("../../../android/app/src/webview/java/io/pictelio/app/OtaPlugin.java", import.meta.url),
  "utf-8",
);
const OTA_TS = readFileSync(new URL("../../../src/native/Ota.ts", import.meta.url), "utf-8");

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
      "Java 侧应至少有 status/install/notifyReady/applyNow",
    ).toBeGreaterThanOrEqual(4);
    expect(ts.toSorted()).toEqual(java.toSorted());
  });

  it("install 的 reject 原因机器可读（规格「选型与架构」失败语义）", () => {
    for (const reason of [
      "bad-signature",
      "apk-too-old",
      "checksum",
      "size-mismatch",
      "unzip-missing-index",
    ]) {
      expect(OTA_PLUGIN_JAVA, `缺少 reject("${reason}")`).toContain(`"${reason}"`);
    }
  });

  it("签名走 OtaSignatureVerifier（不重复实现验签逻辑）", () => {
    expect(OTA_PLUGIN_JAVA).toContain("OtaSignatureVerifier.verifyManifest");
    expect(OTA_PLUGIN_JAVA).toContain("BuildConfig.OTA_ED25519_PUBLIC_KEY_B64");
  });
});

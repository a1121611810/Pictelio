// WebDAV 桥跨语言契约一致性（spec docs/specs/webdav-backup.md §4 / ADR-0156 D1）
// 差分 oracle：Java 侧 Kind 枚举与两个 TS 桥的 WEBDAV_ERROR_KINDS 必须逐字一致；
// 四个文件（Java 插件/模块 + 双端 TS 桥）必须暴露同一组动词；注册点必须存在。
// 任一漂移 = 桥静默失效（TS 调不存在的方法 / kind 映射落到 SERVER 兜底）。
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const read = (...p: string[]) => readFileSync(path.resolve(testDir, ...p), "utf8");

const appBridge = read("../../../src/native/WebDav.ts");
const lynxBridge = read("../../../../app-lynx/src/utils/webDavBridge.ts");
const webDavPlugin = read(
  "../../../android/app/src/webview/java/io/pictelio/app/WebDavPlugin.java",
);
const webDavModule = read(
  "../../../android/app/src/lynx/java/io/pictelio/app/PictelioWebDavModule.java",
);
const clientJava = read("../../../android/app/src/main/java/io/pictelio/app/WebDavClient.java");
const mainActivity = read("../../../android/app/src/full/java/io/pictelio/app/MainActivity.java");
const lynxInitializer = read(
  "../../../android/app/src/lynx/java/io/pictelio/app/LynxRuntimeInitializer.java",
);

/** spec §5 错误分类 + §6 解密失败归类（CRYPTO 仅 TS/桥层，无对应 Java 枚举） */
const KINDS = [
  "AUTH_FAILED",
  "FORBIDDEN",
  "NOT_FOUND",
  "QUOTA_EXCEEDED",
  "CONFLICT",
  "NETWORK",
  "SERVER",
  "CRYPTO",
] as const;

/** WebDavClient 协议子集（spec §4）+ 加解密 */
const VERBS = [
  "ensureDir",
  "upload",
  "uploadWithVerify",
  "download",
  "list",
  "stat",
  "delete",
  "prune",
  "encrypt",
  "decrypt",
  "isEncrypted",
] as const;

describe("WebDAV 桥跨语言契约", () => {
  it("Kind 枚举（Java）与双端 TS WEBDAV_ERROR_KINDS 逐字一致", () => {
    // Java 枚举名从源码提取（不含 CRYPTO——那是桥层对 CryptoException 的归类）
    const enumBlock = clientJava.match(/public enum Kind \{([\s\S]*?)\}/)?.[1] ?? "";
    const javaKinds = [...enumBlock.matchAll(/\b([A-Z][A-Z_]+)\b/g)]
      .map((m) => m[1])
      .filter((n) => n !== "BINARY" && !n.startsWith("HTTP"));
    const expectedJava = KINDS.filter((k) => k !== "CRYPTO");
    for (const kind of expectedJava) {
      expect(javaKinds, `Java Kind 缺 ${kind}`).toContain(kind);
    }
    // 两个 TS 桥声明同一集合（含 CRYPTO）
    for (const kind of KINDS) {
      expect(appBridge).toContain(`"${kind}"`);
      expect(lynxBridge).toContain(`"${kind}"`);
    }
  });

  it("错误 payload 键三处一致（kind / statusCode / message）", () => {
    // Java 模块产出的 JSON 键 == TS 桥解析读取的键
    for (const key of ["kind", "statusCode", "message"]) {
      expect(webDavModule).toContain(`"${key}"`);
      expect(lynxBridge).toContain(key);
    }
    expect(appBridge).toContain("WebDavErrorKind");
  });

  it("四个桥文件暴露同一组动词", () => {
    for (const verb of VERBS) {
      expect(webDavPlugin, `WebDavPlugin 缺 ${verb}`).toContain(`void ${verb}(`);
      expect(webDavModule, `PictelioWebDavModule 缺 ${verb}`).toContain(`void ${verb}(`);
      expect(appBridge, `app 桥缺 ${verb}`).toContain(`${verb}(`);
      expect(lynxBridge, `lynx 桥缺 ${verb}`).toContain(`${verb}(`);
    }
  });

  it("注册点存在（漏注册 = 桥静默失效）", () => {
    expect(mainActivity).toContain("registerPlugin(WebDavPlugin.class)");
    expect(lynxInitializer).toContain(
      'registerModule("PictelioWebDav", PictelioWebDavModule.class)',
    );
    // TS 侧模块名与注册名一致
    expect(appBridge).toContain('registerPlugin<WebDavPluginInterface>("WebDav")');
    expect(lynxBridge).toContain("PictelioWebDav");
  });

  it("lynx Callback 契约：双参 invoke（无 null 参数坑）", () => {
    expect(webDavModule).toContain("callback.invoke(0,");
    expect(webDavModule).toContain("callback.invoke(1,");
    expect(lynxBridge).toContain("(code: number, payload: string)");
  });

  it("协议子集常量与 spec §5 固定值一致（3 次重试 / 保留 10 份）", () => {
    expect(clientJava).toContain("VERIFY_MAX_ATTEMPTS = 3");
    expect(clientJava).toContain("KEEP_BACKUPS = 10");
    // 插件默认值引用常量而非字面量（防两处漂移）
    expect(webDavPlugin).toContain("WebDavClient.VERIFY_MAX_ATTEMPTS");
    expect(webDavPlugin).toContain("WebDavClient.KEEP_BACKUPS");
    expect(webDavModule).toContain("WebDavClient.VERIFY_MAX_ATTEMPTS");
    expect(webDavModule).toContain("WebDavClient.KEEP_BACKUPS");
  });
});

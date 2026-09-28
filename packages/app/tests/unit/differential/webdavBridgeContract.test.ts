// WebDAV 桥跨语言契约一致性（spec docs/specs/webdav-backup.md §4 / ADR-0156 D1）
// 差分 oracle：Java 侧 Kind 枚举与两个 TS 桥的 WEBDAV_ERROR_KINDS 必须逐字一致；
// 各桥文件必须暴露同一组动词；Lynx 注册点必须存在。
// 任一漂移 = 桥静默失效（TS 调不存在的方法 / kind 映射落到 SERVER 兜底）。
//
// #808 步 2（#610 手术）适配：webview flavor 整体下线，以下三个源已随手术删除，
// 其断言一并摘除——**不是**因为契约不重要，而是被测对象不存在了：
//   - WebDavPlugin.java        （src/webview）→ 插件层无 Lynx 对应物，
//     桥层实现在 PictelioWebDavModule + WebDavClient
//   - MainActivity.java        （src/full）
//   - MainActivityWebview.java （src/webview）
// 存活的防线（Kind 枚举 oracle、错误 payload 键、Callback 双参契约、
// WebDavClient 协议常量）全部保留，见各用例。
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const read = (...p: string[]) => readFileSync(path.resolve(testDir, ...p), "utf8");

const appBridge = read("../../../src/native/WebDav.ts");
const lynxBridge = read("../../../../app-lynx/src/utils/webDavBridge.ts");
const webDavModule = read(
  "../../../android/app/src/lynx/java/io/pictelio/app/PictelioWebDavModule.java",
);
const clientJava = read("../../../android/app/src/main/java/io/pictelio/app/WebDavClient.java");
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
    // 先剥行注释（"// 连接/超时/IO" 里的 IO 会被裸正则误抓），再取全大写枚举名
    const enumBody = enumBlock.replace(/\/\/.*$/gm, "");
    const javaKinds = [...enumBody.matchAll(/\b([A-Z][A-Z_]+)\b/g)].map((m) => m[1]);
    const expectedJava = KINDS.filter((k) => k !== "CRYPTO");
    // 集合相等（双向）：Java 枚举多出/缺少任何 kind 都必须失败（防漂移）
    expect(new Set(javaKinds)).toEqual(new Set(expectedJava));
    // 两个 TS 桥声明同一集合（含 CRYPTO）
    for (const kind of KINDS) {
      expect(appBridge).toContain(`"${kind}"`);
      expect(lynxBridge).toContain(`"${kind}"`);
    }
  });

  it("错误 payload 键四处一致（kind / statusCode / message）", () => {
    // Java 模块产出的 JSON 键 == 双端 TS 桥解析读取的键（app 侧经 err.data.statusCode）
    for (const key of ["kind", "statusCode", "message"]) {
      expect(webDavModule).toContain(`"${key}"`);
      expect(lynxBridge).toContain(key);
      expect(appBridge).toContain(key);
    }
    expect(appBridge).toContain("WebDavErrorKind");
  });

  it("各桥文件暴露同一组动词", () => {
    for (const verb of VERBS) {
      expect(webDavModule, `PictelioWebDavModule 缺 ${verb}`).toContain(`void ${verb}(`);
      expect(appBridge, `app 桥缺 ${verb}`).toContain(`${verb}(`);
      expect(lynxBridge, `lynx 桥缺 ${verb}`).toContain(`${verb}(`);
    }
  });

  it("注册点存在（漏注册 = 桥静默失效）", () => {
    // B1 防线：手术后只剩 Lynx 一条注册路径（webview / full 的 registerPlugin 已随
    // 对应 Activity 删除）。#610 前的双注册检查在单引擎下已无被测对象。
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
    // 桥层引用常量而非字面量（防与 WebDavClient 漂移）
    expect(webDavModule).toContain("WebDavClient.VERIFY_MAX_ATTEMPTS");
    expect(webDavModule).toContain("WebDavClient.KEEP_BACKUPS");
  });
});

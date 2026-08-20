import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { URL_REWRITE_CASES } from "./sharedUrlRewriteCases";

/**
 * 共享 URL 重写差分契约表双端一致性测试（防漂移，backupRulesConsistency 模式）
 *
 * app 与 app-lynx 各存一份 sharedUrlRewriteCases.ts（rewriteUrl web 分支差分契约表，
 * 期望值来源 = 差分契约 oracle，ticket #194）。两端各自的参数化测试都消费本 fixture——
 * 若任一侧单独改动而不同步另一侧，两端 rewriteUrl 差分测试将基于不同 oracle，
 * 契约即漂移。本测试直接 readFileSync 比对两份文件 raw 文本，逐字节断言一致
 * （任何格式/内容差异即红灯）。
 */

const testDir = path.dirname(fileURLToPath(import.meta.url));

const appFixture = path.join(testDir, "sharedUrlRewriteCases.ts");
const lynxFixture = path.resolve(
  testDir,
  "../../../../app-lynx/tests/differential/sharedUrlRewriteCases.ts",
);

describe("sharedUrlRewriteCases 双端一致性（防漂移）", () => {
  it("app 与 app-lynx 的 fixture 文件逐字节一致", () => {
    const appRaw = readFileSync(appFixture, "utf8");
    const lynxRaw = readFileSync(lynxFixture, "utf8");
    expect(appRaw).toBe(lynxRaw);
  });

  it("fixture 为纯 TS 数据，零框架依赖（不得 import vue/solid/@capacitor）", () => {
    const appRaw = readFileSync(appFixture, "utf8");
    expect(appRaw).not.toMatch(/^\s*import .* from ["'](vue|solid-js|@capacitor)/m);
  });

  it("覆盖 ticket #194 规定的全部输入类别（8 例），且含两端期望列", () => {
    const ids = URL_REWRITE_CASES.map((c) => c.id);
    for (const required of [
      "relative-path",
      "absolute-app-api",
      "absolute-oauth",
      "oauth-with-query",
      "proxied-image",
      "proxied-api-path",
      "evil-suffix-app-api",
      "non-pixiv-absolute",
    ]) {
      expect(ids).toContain(required);
    }
    for (const c of URL_REWRITE_CASES) {
      expect(typeof c.id).toBe("string");
      expect(c.id.length).toBeGreaterThan(0);
      expect(typeof c.input).toBe("string");
      expect(c.input.length).toBeGreaterThan(0);
      expect(typeof c.expectedWebApp).toBe("string");
      expect(typeof c.expectedWebLynx).toBe("string");
    }
  });

  it("记录的契约差异行：evil 伪后缀域两端期望不同且带 note 说明", () => {
    const evil = URL_REWRITE_CASES.find((c) => c.id === "evil-suffix-app-api");
    expect(evil).toBeDefined();
    if (evil) {
      expect(evil.expectedWebApp).not.toBe(evil.expectedWebLynx);
      expect(evil.note).toBeTruthy();
    }
  });
});

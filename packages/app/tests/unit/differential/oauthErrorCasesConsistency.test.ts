import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { OAUTH_ERROR_CLASSIFY_CASES, PIXIV_OAUTH_400_RAW_SNAPSHOT } from "./sharedOAuthErrorCases";

/**
 * 共享 OAuth 400 错误分类差分契约表双端一致性测试（防漂移，backupRulesConsistency 模式）
 *
 * app 与 app-lynx 各存一份 sharedOAuthErrorCases.ts（classifyError 差分契约表，
 * 期望值来源 = 真实 OAuth 快照 pixivpy#374 / gallery-dl#9331 + 契约语义，ticket #194）。
 * 两端各自的参数化测试都消费本 fixture——若任一侧单独改动而不同步另一侧，
 * 两端 classifyError 差分测试将基于不同 oracle，契约即漂移。本测试直接 readFileSync
 * 比对两份文件 raw 文本，逐字节断言一致（任何格式/内容差异即红灯）。
 */

const testDir = path.dirname(fileURLToPath(import.meta.url));

const appFixture = path.join(testDir, "sharedOAuthErrorCases.ts");
const lynxFixture = path.resolve(
  testDir,
  "../../../../app-lynx/tests/differential/sharedOAuthErrorCases.ts",
);

describe("sharedOAuthErrorCases 双端一致性（防漂移）", () => {
  it("app 与 app-lynx 的 fixture 文件逐字节一致", () => {
    const appRaw = readFileSync(appFixture, "utf8");
    const lynxRaw = readFileSync(lynxFixture, "utf8");
    expect(appRaw).toBe(lynxRaw);
  });

  it("fixture 为纯 TS 数据，零框架依赖（不得 import vue/solid/@capacitor）", () => {
    const appRaw = readFileSync(appFixture, "utf8");
    expect(appRaw).not.toMatch(/^\s*import .* from ["'](vue|solid-js|@capacitor)/m);
  });

  it("真实快照原始字节可解析且字段与线上一致（oracle 溯源）", () => {
    const snap = JSON.parse(PIXIV_OAUTH_400_RAW_SNAPSHOT) as unknown;
    const d = snap as Record<string, unknown>;
    const system = (d.errors as Record<string, unknown>).system as Record<string, unknown>;
    expect(d.has_error).toBe(true);
    expect(d.error).toBe("invalid_grant");
    expect(system.message).toBe("Invalid refresh token");
    expect(system.code).toBe(1508);
  });

  it("覆盖 ticket #194 规定的全部输入类别，期望 type 合法且 oracle 可追溯", () => {
    const ids = OAUTH_ERROR_CLASSIFY_CASES.map((c) => c.id);
    for (const required of [
      "oauth-snapshot-string-invalid-grant",
      "oauth-object-invalid-request",
      "oauth-object-invalid-grant",
      "non-oauth-400-error-object",
      "non-oauth-400-plain-body",
      "proxy-error",
      "network-typeerror",
    ]) {
      expect(ids).toContain(required);
    }
    const allowed = new Set(["UNAUTHORIZED", "UNKNOWN", "PROXY", "NETWORK"]);
    for (const c of OAUTH_ERROR_CLASSIFY_CASES) {
      expect(typeof c.status).toBe("number");
      expect(allowed.has(c.expectedTypeKey)).toBe(true);
      expect(c.oracle.length).toBeGreaterThan(0);
      // OAuth 形态行必须全部为 UNAUTHORIZED；非 OAuth 行为非 UNAUTHORIZED
      if (c.id.startsWith("oauth-")) {
        expect(c.expectedTypeKey).toBe("UNAUTHORIZED");
      }
      if (c.id.startsWith("non-oauth-")) {
        expect(c.expectedTypeKey).not.toBe("UNAUTHORIZED");
      }
    }
  });
});

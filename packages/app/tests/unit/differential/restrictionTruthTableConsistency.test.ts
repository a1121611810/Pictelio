import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { RESTRICTION_TRUTH_TABLE } from "./sharedRestrictionTruthTable";

/**
 * 共享 truth-table fixture 双端一致性测试（防漂移，backupRulesConsistency 模式）
 *
 * app 与 app-lynx 各存一份 sharedRestrictionTruthTable.ts（isRestricted 12 例全矩阵，
 * 期望值来源 = x_restrict 契约语义，独立 oracle）。两端各自的参数化测试都消费
 * 本 fixture——若任一侧单独改动而不同步另一侧，两端 isRestricted 差分测试将基于
 * 不同 oracle，契约即漂移。本测试直接 readFileSync 比对两份文件 raw 文本，
 * 逐字节断言一致（任何格式/内容差异即红灯）。
 */

const testDir = path.dirname(fileURLToPath(import.meta.url));

const appFixture = path.join(testDir, "sharedRestrictionTruthTable.ts");
const lynxFixture = path.resolve(
  testDir,
  "../../../../app-lynx/tests/differential/sharedRestrictionTruthTable.ts",
);

describe("sharedRestrictionTruthTable 双端一致性（防漂移）", () => {
  it("app 与 app-lynx 的 fixture 文件逐字节一致", () => {
    const appRaw = readFileSync(appFixture, "utf8");
    const lynxRaw = readFileSync(lynxFixture, "utf8");
    expect(appRaw).toBe(lynxRaw);
  });

  it("fixture 为纯 TS 数据，零框架依赖（不得 import vue/solid/@capacitor）", () => {
    const appRaw = readFileSync(appFixture, "utf8");
    expect(appRaw).not.toMatch(/^\s*import .* from ["'](vue|solid-js|@capacitor)/m);
  });

  it("fixture 恰好覆盖 3×2×2 全矩阵（12 例唯一组合，无重无缺）", () => {
    expect(RESTRICTION_TRUTH_TABLE).toHaveLength(12);
    const combos = RESTRICTION_TRUTH_TABLE.map(
      (c) => `x-restrict=${c.x_restrict}/s18=${c.showR18}/s18g=${c.showR18G}`,
    );
    expect(new Set(combos).size).toBe(12);
    for (const c of RESTRICTION_TRUTH_TABLE) {
      expect([0, 1, 2]).toContain(c.x_restrict);
      expect(typeof c.showR18).toBe("boolean");
      expect(typeof c.showR18G).toBe("boolean");
      expect(typeof c.expectedRestricted).toBe("boolean");
    }
  });
});

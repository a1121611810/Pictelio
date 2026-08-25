import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ILLUST_TYPE_BADGE_CASES } from "./sharedIllustTypeBadgeCases";

/**
 * 共享 truth-table fixture 双端一致性测试（防漂移，restrictionTruthTableConsistency 模式）
 *
 * app 与 app-lynx 各存一份 sharedIllustTypeBadgeCases.ts（类型角标判定 7 例矩阵，
 * 期望值来源 = spec 决策 1 + ADR-0113 决策 2，独立 oracle）。两端各自的差分测试都消费
 * 本 fixture——若任一侧单独改动而不同步另一侧，两端判定语义即漂移。本测试直接
 * readFileSync 比对两份文件 raw 文本，逐字节断言一致（任何格式/内容差异即红灯）。
 */

const testDir = path.dirname(fileURLToPath(import.meta.url));

const appFixture = path.join(testDir, "sharedIllustTypeBadgeCases.ts");
const lynxFixture = path.resolve(
  testDir,
  "../../../../app-lynx/tests/differential/sharedIllustTypeBadgeCases.ts",
);

describe("sharedIllustTypeBadgeCases 双端一致性（防漂移）", () => {
  it("app 与 app-lynx 的 fixture 文件逐字节一致", () => {
    const appRaw = readFileSync(appFixture, "utf8");
    const lynxRaw = readFileSync(lynxFixture, "utf8");
    expect(appRaw).toBe(lynxRaw);
  });

  it("fixture 为纯 TS 数据，零框架依赖（不得 import vue/solid/@capacitor）", () => {
    const appRaw = readFileSync(appFixture, "utf8");
    expect(appRaw).not.toMatch(/^\s*import .* from ["'](vue|solid-js|@capacitor)/m);
  });

  it("fixture 覆盖 spec 要求的五种输入形态（普通/动图/多图/并存/异常），无重复组合", () => {
    const combos = ILLUST_TYPE_BADGE_CASES.map((c) => `type=${c.type}/pc=${c.page_count}`);
    expect(new Set(combos).size).toBe(ILLUST_TYPE_BADGE_CASES.length);
    // 五种形态各自存在（期望值出处：spec Testing Decisions 的条件矩阵）
    expect(ILLUST_TYPE_BADGE_CASES.some((c) => c.expectedBadges.length === 0)).toBe(true);
    expect(
      ILLUST_TYPE_BADGE_CASES.some(
        (c) => c.expectedBadges.length === 1 && c.expectedBadges[0].kind === "ugoira",
      ),
    ).toBe(true);
    expect(
      ILLUST_TYPE_BADGE_CASES.some(
        (c) => c.expectedBadges.length === 1 && c.expectedBadges[0].kind === "multi",
      ),
    ).toBe(true);
    expect(ILLUST_TYPE_BADGE_CASES.some((c) => c.expectedBadges.length === 2)).toBe(true);
    expect(ILLUST_TYPE_BADGE_CASES.some((c) => c.page_count === 0)).toBe(true);
    // 并存形态的顺序契约：动图在前
    for (const c of ILLUST_TYPE_BADGE_CASES) {
      if (c.expectedBadges.length === 2) {
        expect(c.expectedBadges[0].kind).toBe("ugoira");
        expect(c.expectedBadges[1].kind).toBe("multi");
      }
    }
  });
});

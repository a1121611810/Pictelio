// AI badge 守卫跨组件一致性（ADR-0155 D1 / 测试硬约束 #4：行为变更须有机器防线）。
// oracle = ADR-0155 D1「ai_type >= 1 都算 AI」，独立于实现；防回归：任一卡片退回 >1 即失败。
// 覆盖 6 个 AI badge 渲染点（其中 NovelCard 两处）。
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const srcDir = path.resolve(testDir, "../../../src");

const AI_BADGE_FILES = [
  "components/ImageCard.tsx",
  "components/GridCard.tsx",
  "components/home/IllustSingleCard.tsx",
  "components/NovelCard.tsx",
  "components/NovelTextListCard.tsx",
  "components/home/NovelRowCard.tsx",
] as const;

describe("AI badge 守卫跨组件一致性（ADR-0155 D1）", () => {
  for (const rel of AI_BADGE_FILES) {
    it(`${rel} 使用 ai_type >= 1（禁止退回 > 1 死分支）`, () => {
      const src = readFileSync(path.join(srcDir, rel), "utf8");
      expect(src).toContain("_ai_type >= 1");
      expect(src).not.toContain("_ai_type > 1");
    });
  }
});

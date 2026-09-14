// app 侧消费共享 AI 真值表：经 isAiHiddenByType 断言与 fixture 一致。
import { describe, expect, it } from "vitest";
import { isAiHiddenByType } from "@/utils/aiFilter";
import { AI_FILTER_TRUTH_TABLE } from "./sharedAiFilterTruthTable";

describe("aiFilter × 共享 truth table（app）", () => {
  it("fixture 覆盖 3 模式 × 4 值 = 12 例唯一组合", () => {
    const keys = AI_FILTER_TRUTH_TABLE.map((c) => `${c.mode}:${String(c.aiType)}`);
    expect(new Set(keys).size).toBe(12);
    expect(AI_FILTER_TRUTH_TABLE).toHaveLength(12);
  });

  it.each(AI_FILTER_TRUTH_TABLE)(
    "mode=$mode, aiType=$aiType → hidden=$hidden",
    ({ mode, aiType, hidden }) => {
      expect(isAiHiddenByType(aiType ?? 0, mode)).toBe(hidden);
    },
  );
});

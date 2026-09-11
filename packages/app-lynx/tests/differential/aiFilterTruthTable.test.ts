// lynx 侧消费共享 AI 真值表：经 isAiRestricted / isAiOnlyFiltered 断言与 fixture 一致。
// fixture 与 app 侧逐字节一致（app.tests/unit/differential/aiFilterTruthTableConsistency.test.ts 守护）。
// 期望值 oracle = ADR-0155 三态语义（独立来源）。
import { beforeEach, describe, expect, it, vi } from "vitest";
import { setActivePinia, createPinia } from "pinia";
import { useSettingsStore } from "../../src/stores/settingsStore";
import { AI_FILTER_TRUTH_TABLE } from "./sharedAiFilterTruthTable";

vi.mock("../../src/utils/idbKV", () => ({
  idbGet: vi.fn(),
  idbSet: vi.fn(async () => {}),
}));

let store: ReturnType<typeof useSettingsStore>;

beforeEach(() => {
  setActivePinia(createPinia());
  store = useSettingsStore();
});

describe("settingsStore × 共享 AI truth table（12 例差分 fixture）", () => {
  it("fixture 覆盖 3 模式 × 4 值 = 12 例唯一组合", () => {
    const keys = AI_FILTER_TRUTH_TABLE.map((c) => `${c.mode}:${String(c.aiType)}`);
    expect(new Set(keys).size).toBe(12);
  });

  it.each(AI_FILTER_TRUTH_TABLE)(
    "mode=$mode, aiType=$aiType → hidden=$hidden",
    ({ mode, aiType, hidden }) => {
      store.setAiFilterMode(mode);
      const item = { illust_ai_type: aiType };
      // 遮罩态：hidden 等价于 isAiRestricted；仅看态：等价于 isAiOnlyFiltered
      const hiddenByMode =
        mode === "mask" ? store.isAiRestricted(item) : store.isAiOnlyFiltered(item);
      expect(hiddenByMode).toBe(hidden);
      // shouldHideByAi 是统一过滤谓词，show 恒 false
      expect(store.shouldHideByAi(item)).toBe(hidden);
    },
  );
});

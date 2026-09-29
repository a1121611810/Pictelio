// Lynx 单端行为基准：settingsStore 以 AI 真值表 fixture 为 oracle。
// 形态说明（ADR-0203 决策 5）：WebView 客户端删除后差分对侧消失，本文件只断言 Lynx 侧。
// fixture 为 Lynx 唯一事实源（其自洽门见 truthTableFixtureIntegrity.test.ts）。
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

describe('Lynx 单端行为基准：settingsStore × AI truth table（12 例）', () => {
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

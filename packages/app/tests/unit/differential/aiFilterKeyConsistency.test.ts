// AI 三态存储键双端一致性（ADR-0155 / ADR-0103 跨 client 契约）。
// oracle = ADR-0155 的字面键 `ai_filter_mode_${uid}`（独立来源，不从实现推导）。
// 防漂移：app 与 app-lynx 必须使用同一键前缀，否则切引擎后设置读不到。
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const appStore = readFileSync(
  path.resolve(testDir, "../../../src/stores/settingsStore.ts"),
  "utf8",
);
const appAiFilter = readFileSync(path.resolve(testDir, "../../../src/utils/aiFilter.ts"), "utf8");
const lynxStore = readFileSync(
  path.resolve(testDir, "../../../../app-lynx/src/stores/settingsStore.ts"),
  "utf8",
);

describe("AI 三态设置键双端一致（ADR-0155）", () => {
  it("app 与 app-lynx 均声明 ai_filter_mode 键前缀", () => {
    expect(appStore).toContain('"ai_filter_mode"');
    expect(lynxStore).toContain("ai_filter_mode_");
  });

  it("三态值 show/mask/only 双端一致", () => {
    // app 的三态字面量在 aiFilter.ts（类型/守卫），lynx 在 settingsStore.ts 本地定义
    for (const v of ['"show"', '"mask"', '"only"']) {
      expect(appAiFilter).toContain(v);
      expect(lynxStore).toContain(v);
    }
  });

  it("默认值均为 show", () => {
    expect(appStore).toMatch(/aiFilterModeFactory[\s\S]*?default:\s*"show"/);
    expect(lynxStore).toMatch(/_aiFilterMode\s*=\s*ref<AiFilterMode>\("show"\)/);
  });
});

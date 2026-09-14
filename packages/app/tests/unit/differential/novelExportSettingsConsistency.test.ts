// 小说导出设置键双端一致性（spec docs/specs/novel-export.md §6 / ADR-0103）
// oracle = spec §6 四个字面键 + ADR-0154 D4 默认格式（独立来源，不从实现推导）。
// 防漂移：app settingsStore 与 app-lynx settingsStore 必须使用同一组键字符串，
// 否则同一设备切换引擎后设置读不到（跨引擎契约破坏）。
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const appStore = readFileSync(
  path.resolve(testDir, "../../../src/stores/settingsStore.ts"),
  "utf8",
);
const lynxStore = readFileSync(
  path.resolve(testDir, "../../../../app-lynx/src/stores/settingsStore.ts"),
  "utf8",
);

const KEYS = [
  "settings_novel_export_format",
  "settings_novel_export_include_metadata",
  "settings_novel_export_include_cover",
  "settings_novel_export_include_images",
] as const;

describe("小说导出设置键双端一致（spec novel-export §6）", () => {
  for (const key of KEYS) {
    it(`app 与 app-lynx 均声明 ${key}`, () => {
      expect(appStore).toContain(`"${key}"`);
      expect(lynxStore).toContain(`"${key}"`);
    });
  }

  it("默认格式白名单来自共享包（单一事实源，ADR-0154 D1/D4）", () => {
    expect(appStore).toContain("DEFAULT_NOVEL_EXPORT_FORMAT");
    expect(lynxStore).toContain("DEFAULT_NOVEL_EXPORT_FORMAT");
    expect(appStore).toContain("NOVEL_EXPORT_FORMATS");
    expect(lynxStore).toContain("NOVEL_EXPORT_FORMATS");
  });
});

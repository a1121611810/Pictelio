// 小说导出跨层桥契约（spec docs/specs/novel-export.md §8；模式对齐 native/bridge-contract.test.ts）
// oracle = 各层真实源码：TS native 接口声明 ↔ Java @PluginMethod/@LynxMethod 参数与 kind 路由。
// 防漂移：任一层漏加 payloadJson / 漏路由 "novel" 即报警。
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const APP = resolve(TEST_DIR, "../../.."); // packages/app
const WEBVIEW_PLUGIN = readFileSync(
  resolve(APP, "android/app/src/webview/java/io/pictelio/app/PictelioDownloaderPlugin.java"),
  "utf-8",
);
const LYNX_MODULE = readFileSync(
  resolve(APP, "android/app/src/lynx/java/io/pictelio/app/PictelioDownloaderModule.java"),
  "utf-8",
);
const DOWNLOADER = readFileSync(
  resolve(APP, "android/app/src/main/java/io/pictelio/app/PictelioDownloader.java"),
  "utf-8",
);
const CAP_TS = readFileSync(resolve(APP, "src/utils/capacitorDownloadExecutor.ts"), "utf-8");
const LYNX_TS = readFileSync(
  resolve(APP, "../app-lynx/src/utils/lynxDownloadExecutor.ts"),
  "utf-8",
);

describe("小说导出桥契约（spec novel-export §8）", () => {
  it("两端 Java 薄壳均接受 payloadJson 并路由 kind=novel", () => {
    for (const src of [WEBVIEW_PLUGIN, LYNX_MODULE]) {
      expect(src).toContain("payloadJson");
      expect(src).toContain('"novel"');
      expect(src).toContain("downloadNovel");
    }
  });

  it("原生执行器深模块 downloadNovel 调用 NovelExporter.export", () => {
    expect(DOWNLOADER).toContain("downloadNovel");
    expect(DOWNLOADER).toContain("NovelExporter.export");
  });

  it("TS 侧两端 executor 声明并透传 payloadJson（载荷字段名不漂移）", () => {
    for (const src of [CAP_TS, LYNX_TS]) {
      expect(src).toContain("payloadJson");
    }
    // webview executor 的 kind 联合类型收窄含 "novel"；lynx 侧 kind 为 string（桥以字符串路由）
    expect(CAP_TS).toContain('"novel"');
  });
});

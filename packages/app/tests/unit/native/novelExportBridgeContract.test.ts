// 小说导出跨层桥契约（spec docs/specs/novel-export.md §8；模式对齐已随 OTA 退役的
// native/bridge-contract.test.ts）
// oracle = 各层真实源码：TS executor 声明 ↔ Java @LynxMethod 参数与 kind 路由。
// 防漂移：参数顺序/元数、payloadJson、kind=novel 路由任一处漂移即报警（不只是子串包含）。
//
// #808 步 2（#610 手术）适配：`PictelioDownloaderPlugin.java`（webview flavor）已随
// 手术删除，Capacitor 薄壳无 Lynx 对应物，相关断言摘除。存活的防线**全部保留**，其中
// 「lynx 桥 start 参数顺序与元数 == Java 声明」最关键——位置参数摊平正是 #806 修的
// 同一类陷阱（`Callback.invoke(Object...)` 变参）。
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const APP = resolve(TEST_DIR, "../../.."); // packages/app
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

/** Java 方法参数名（按声明顺序；去类型只留变量名） */
function javaParamNames(source: string, method: string): string[] {
  const m = source.match(new RegExp(`public\\s+void\\s+${method}\\s*\\(([^)]*)\\)`));
  if (!m) throw new Error(`Java 方法 ${method} 签名缺失（契约锚点漂移）`);
  return m[1]!
    .split(",")
    .map((p) => p.trim())
    .filter((p) => p.length > 0)
    .map((p) => p.split(/\s+/).pop()!);
}

describe("小说导出桥契约（spec novel-export §8）", () => {
  it("Lynx 薄壳接受 payloadJson 并路由 kind=novel", () => {
    expect(LYNX_MODULE).toContain("payloadJson");
    expect(LYNX_MODULE).toContain('"novel"');
    expect(LYNX_MODULE).toContain("downloadNovel");
  });

  it("原生执行器深模块 downloadNovel 调用 NovelExporter.export", () => {
    expect(DOWNLOADER).toContain("downloadNovel");
    expect(DOWNLOADER).toContain("NovelExporter.export");
  });

  it("lynx 桥 start 参数顺序与元数 == Java 声明（位置参数不可重排）", () => {
    const java = javaParamNames(LYNX_MODULE, "start");
    expect(java).toEqual([
      "id",
      "sourceUrl",
      "fileName",
      "kind",
      "targetFormat",
      "framesJson",
      "payloadJson",
      "dir",
      "callback",
    ]);
    const call = LYNX_TS.match(/native\.start\(([\s\S]*?)\(uri, err\)/);
    expect(call, "lynxDownloadExecutor 未找到 native.start 调用").not.toBeNull();
    const tsArgs = call![1]!
      .split(",")
      .map((a) =>
        a
          .trim()
          .replace(/^task\./, "")
          .replace(/\s*\?\? ''$/, ""),
      )
      .filter((a) => a.length > 0);
    // 末位 callback 由 TS 传箭头函数（已在 match 中切走），故与 Java 前 8 个形参对齐
    expect(tsArgs).toEqual(java.slice(0, -1));
  });

  // 原「webview 桥 start 键集合 == Java call.getString 键集合 == TS options 键集合」
  // 已随 #610 手术移除：它的 Java oracle（`call.getString(...)`，Capacitor 薄壳）随
  // `PictelioDownloaderPlugin.java` 一起消失，留下的「TS 键集合 == 硬编码列表」只是
  // 自洽反推，不构成独立 oracle（AGENTS.md 测试硬约束 6）。SPA 侧
  // `capacitorDownloadExecutor.ts` 本身归决策 ④ 退役（#803），届时一并处理。

  it("TS 侧两端 executor 声明并透传 payloadJson（载荷字段名不漂移）", () => {
    for (const src of [CAP_TS, LYNX_TS]) {
      expect(src).toContain("payloadJson");
    }
    // webview executor 的 kind 联合类型收窄含 "novel"；lynx 侧 kind 为 string（桥以字符串路由）
    expect(CAP_TS).toContain('"novel"');
  });
});

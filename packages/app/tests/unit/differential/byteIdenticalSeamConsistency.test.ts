// 双端 byte-identical seam 一致性守卫（ADR-0181 D2 / ADR-0182 D3；issue #706）。
//
// 为什么存在：P1/P2 引入的跨引擎共享工具（assertNever.ts / id.ts）采用「双端
// byte-identical 复制」策略——两包各持一份逐字相同的副本，以规避跨包依赖 seam。
// 代价是「手动同步」：任一单边修改都会造成双端行为漂移。本测试是该策略的机器
// 防线（ADR-0181 / ADR-0182 的 P3 挂账落地）：任一份非逐字节相同 → CI 红。
//
// oracle 溯源：期望值 = app 端文件内容本身（唯一事实源），非从任一实现反推。
//
// 空集防护（ArchUnit failOnEmptyShould 教训）：断言清单非空、文件存在、内容非空、
// 含关键哨兵词——防止路径失效导致全称断言恒真。
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const testDir = path.dirname(fileURLToPath(import.meta.url));

/**
 * 双端 byte-identical seam 清单。
 * 新增跨引擎共享 seam（复制型）时在此加行——守卫自动覆盖。
 */
const SEAM_PAIRS = [
  {
    name: "assertNever（P1，ADR-0181 D2）",
    app: "../../../src/utils/assertNever.ts",
    lynx: "../../../../app-lynx/src/utils/assertNever.ts",
    sentinel: "export function assertNever(value: never): never",
  },
  {
    name: "Branded Types id seam（P2，ADR-0182 D3）",
    app: "../../../src/api/id.ts",
    lynx: "../../../../app-lynx/src/api/id.ts",
    sentinel: "export function toChapterId(raw: number): ChapterId",
  },
] as const;

describe("双端 byte-identical seam 一致性（P1/P2 挂账守卫）", () => {
  it("清单非空且每对文件均存在（空集防护）", () => {
    expect(SEAM_PAIRS.length).toBeGreaterThanOrEqual(2);
    for (const pair of SEAM_PAIRS) {
      expect(existsSync(path.resolve(testDir, pair.app)), `app 侧缺失: ${pair.app}`).toBe(true);
      expect(existsSync(path.resolve(testDir, pair.lynx)), `lynx 侧缺失: ${pair.lynx}`).toBe(true);
      // 两侧必须解析到不同文件（防同文件坍缩致比对恒真；review NIT-1）
      expect(path.resolve(testDir, pair.app)).not.toBe(path.resolve(testDir, pair.lynx));
    }
  });

  it.each(SEAM_PAIRS)("$name：双端逐字节相同", ({ app, lynx, sentinel }) => {
    const appSrc = readFileSync(path.resolve(testDir, app), "utf8");
    const lynxSrc = readFileSync(path.resolve(testDir, lynx), "utf8");
    // 内容非空 + 哨兵词存在（防路径指向错误文件致比对恒真）
    expect(appSrc.length).toBeGreaterThan(0);
    expect(appSrc).toContain(sentinel);
    expect(lynxSrc).toContain(sentinel);
    // 核心断言：逐字节相同（漂移即红；vitest 输出首个差异）
    expect(lynxSrc).toBe(appSrc);
  });
});

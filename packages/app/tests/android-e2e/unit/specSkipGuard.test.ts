/**
 * android-e2e spec 的**跳过形态**契约（issue #819 第 12 轮 review）。
 *
 * ## 为什么需要它
 *
 * 设备门控有两种写法，后果完全相反：
 * - ✅ `describe.skipIf(SKIPPED)(…)` —— vitest 记 **skipped**，进 `Tests … | N skipped` 计数；
 * - ❌ 在 `it` 体内写 `if (SKIPPED) return;` —— vitest 记 **passed**，计数贡献 **0**。
 *
 * 后者是「**冒充通过**」：测试什么都没验，却在结果里显示为通过；而发版门唯一的人工核对项
 * （`docs/release-checklist.md` 第 5 项：核 skipped 计数）对它**结构性失明**。
 * 本仓已发生过一次：`lynx-detail-image-probe.spec.ts` 用第二种写法，2026-09-29 才改成
 * `describe.skipIf`。改完**没有任何机器防线**——`grep -rln "SKIPPED" packages/app/tests
 * --include=*.test.ts` 实测 0 命中，唯一相关的契约测试只读 `transition-matrix.spec.ts`。
 * 于是「别再写回去」这件事只靠人记。
 *
 * ## 判据
 *
 * 扫全部 `specs/*.spec.ts`：**`it(` / `test(` 体前若干行内不得出现 `if (SKIPPED) return`**。
 * 只扫 `it` 体、不扫 `beforeAll` / `afterAll`——那两处挂在**文件 suite** 上、不在
 * `describe.skipIf` 的覆盖范围内，是**正当**的防御性写法（`lynx-detail-image-probe:123/134`
 * 就保留着）。
 *
 * ⚠️ 抽取器必须**断言扫到了文件**（ArchUnit `failOnEmptyShould` 教训）：文件清单为空时
 * 全称断言会静默恒真——那正是本组要防的假绿。
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const SPEC_DIR = path.resolve(testDir, "../specs");
const specFiles = readdirSync(SPEC_DIR)
  .filter((f) => f.endsWith(".spec.ts"))
  .toSorted();
const sources = specFiles.map((f) => ({
  file: f,
  lines: readFileSync(path.join(SPEC_DIR, f), "utf8").split("\n"),
}));

/** 门控常量：全大写标识符（`SKIPPED` / `HAS_TOKEN` / `ENABLED` …）。 */
const GATE_NAME = "[A-Z][A-Z0-9_]*";
/** `if (…门控…) return;` 或 `if (…门控…) {` 的守卫头。 */
const GUARD_HEAD = new RegExp(`^if\\s*\\(\\s*!?\\s*${GATE_NAME}\\b.*\\)\\s*(\\{|return;?$)`);

/**
 * 在 `it(` / `test(` 的**整个回调体**内找「门控早退」。
 *
 * ## 体边界怎么定（以及它的代价）
 *
 * 按**缩进**界定：从 `it(` 行往后取「空行 或 缩进更深」的行。
 * ⚠️ 这类锚点会随格式化漂移（老教训：接线契约的切片终点静默漂移），所以：
 * **① 必须带非空/下界断言**（下方有「扫到的 it 体数」那条）；**② 改这里必须跑反事实**
 * ——把一个 `if (GATE) { … return; }` 塞回某个 `it` 体内，本组必须转红。
 *
 * ## 为什么要扫「整个体」而不是「开头几行」
 *
 * 早先只扫体首 8 行（针对 `if (SKIPPED) return;` 紧跟签名的形态），实测
 * `settings-sync-contract.spec.ts` 的 `if (!HAS_TOKEN)` 在签名后 13 行、且前面
 * 已有 `await` 语句（触发提前 break）⇒ 放回去仍全绿 ⇒ **假绿**。
 * 门控早退可以出现在体中任意位置，所以窗口不能是常数。
 */
function skipReturnInTestBody(lines: string[]): { line: number; text: string }[] {
  const indentOf = (l: string): number => l.match(/^ */)?.[0].length ?? 0;
  const hits: { line: number; text: string }[] = [];
  lines.forEach((l, i) => {
    if (!/^\s*(?:it|test)(?:\.\w+)?\(/.test(l)) return;
    const base = indentOf(l);
    for (let j = i + 1; j < lines.length; j++) {
      const raw = lines[j] ?? "";
      const t = raw.trim();
      // 体的结束：非空行且缩进不再更深
      if (t !== "" && indentOf(raw) <= base) break;
      if (!GUARD_HEAD.test(t)) continue;
      // 带块的形态要往后看几行，确认块内确有 early return
      const tail = t.endsWith("{")
        ? lines
            .slice(j + 1, j + 6)
            .map((x) => x.trim())
            .join(" ")
        : t;
      if (/\breturn;/.test(tail)) {
        hits.push({ line: j + 1, text: t });
        break;
      }
    }
  });
  return hits;
}

describe("android-e2e 跳过形态契约（it 体内 return = 冒充通过）", () => {
  it("必须真的扫到 spec 文件（清单为空会让下一条全称断言静默恒真）", () => {
    expect(specFiles.length, "specs/*.spec.ts 文件数").toBeGreaterThanOrEqual(10);
    expect(specFiles).toContain("transition-matrix.spec.ts");
    // 下界取 20 行：`smoke.spec.ts` 实测只有 43 行，卡 50 会因无关的文件大小变化而红
    for (const { file, lines } of sources) {
      expect(lines.length, `${file} 没读到空串`).toBeGreaterThan(20);
    }
  });

  it("抽取器必须真的定位到 it/test 体（缩进锚点静默失配会让下一条全称断言恒真）", () => {
    let bodies = 0;
    for (const { lines } of sources) {
      bodies += lines.filter((l) => /^\s*(?:it|test)(?:\.\w+)?\(/.test(l)).length;
    }
    expect(bodies, "扫到的 it/test 体总数").toBeGreaterThanOrEqual(10);
  });

  it("任何 it/test 体内都不得用「门控常量 + 早退」跳过（要改用 describe.skipIf 或 t.skip）", () => {
    const offenders = sources
      .map(({ file, lines }) => ({
        file,
        hits: skipReturnInTestBody(lines),
      }))
      .filter((x) => x.hits.length > 0);
    expect(
      offenders,
      offenders
        .map(
          (o) =>
            `${o.file}:${o.hits.map((h) => h.line).join(",")} 用了 it 体内 ${String(o.hits[0]?.text).slice(0, 40)}`,
        )
        .join("；"),
    ).toEqual([]);
  });

  it("带设备门控的 spec 必须走 describe.skipIf（清单可枚举）", () => {
    // 交叉核对：本仓的设备门控常量统一叫 SKIPPED。声明了它却没走 describe.skipIf 的文件，
    // 几乎必然是用 it 体内 return 实现了跳过（上一条已拦）；这条从另一侧锁枚举口径，
    // 防止将来新增一个用别的常量名跳过、两条都溜过去的 spec。
    const declared = sources
      .filter(({ lines }) => lines.some((l) => /^const SKIPPED\b/.test(l.trim())))
      .map(({ file }) => file)
      .toSorted();
    expect(declared.length, "声明了 SKIPPED 门控常量的 spec 数").toBeGreaterThanOrEqual(4);
    for (const file of declared) {
      const { lines } = sources.find((s) => s.file === file)!;
      expect(
        lines.some((l) => /^\s*describe\.skipIf\(/.test(l)),
        `${file} 声明了 SKIPPED 门控却没有 describe.skipIf —— 跳过形态不可枚举`,
      ).toBe(true);
    }
  });
});

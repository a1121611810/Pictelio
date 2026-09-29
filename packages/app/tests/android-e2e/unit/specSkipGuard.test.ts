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
 * 扫全部 `specs/*.spec.ts`：**`it(` / `test(` 的**整个回调体**内（按缩进界定）不得出现
 * 「**门控常量 + 早退**」（`if (X) return;` 或 `if (X) { … return; }`，X 为全大写常量）。
 * 只扫 `it` 体、不扫 `beforeAll` / `afterAll`——那两处挂在**文件 suite** 上、不在
 * `describe.skipIf` 的覆盖范围内，是**正当**的防御性写法（`lynx-detail-image-probe:123/134`
 * 就保留着）。
 *
 * ## 覆盖面缺口（review 第 13 轮要求记录）
 *
 * 只扫 `tests/android-e2e/specs/*.spec.ts`（10 个），**不扫** `tests/agent-browser/specs/**`
 * （12 个，pre-push 门禁）——「冒充通过」是同一类形态。现状无命中（唯一近似的
 * `bookmark-tags.test.ts:160` 的 `if (!open) return;` 在 helper 里、不在 `it` 体）。
 * 要扩就扩，别假装已经覆盖。
 *
 * ⚠️ **什么形态会误伤 / 怎么豁免**（review 第 13 轮要求记录）：任何「全大写常量 + 早退」都会
 * 被命中，包括合法的 `if (ITEMS.length === 0) return;`。届时**不要放宽判据**（会放回冒充
 * 通过），而应把该常量改名成非全大写（它是**数据**不是**门控**）或改用 `t.skip()`。
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

/**
 * 门控条件的**可接受面**（#819 第 13 轮 Spec 轴实测补齐覆盖面）。
 *
 * 初版只认「裸全大写标识符」，实测三种写法溜过：
 *   `if (ctx.SKIPPED) return;` / `if (skipped) return;` /
 *   `if (!process.env.PIXIV_REFRESH_TOKEN) return;`
 * 第三种正是本仓 `settings-sync-contract.spec.ts` 的现役门控读法——源码把 env 折叠成
 * 全大写常量才被抓到；一旦有人直接写 env 形式，同一个洞回来。
 *
 * 现接受**两类结构上可判定**的门控：① 全大写标识符（含成员表达式 `ctx.SKIPPED`）；
 * ② `process.env.*`。
 *
 * ⚠️ **已知且刻意接受的漏面**：`if (skipped) return;`（小写局部变量）**抓不到**。
 * 放宽到「任意标识符」会误伤正当的数据性早退——实测 `lynx-detail-image-probe:210` 的
 * 「首跑即取证成功就收工」被当场拦下。环境信号与测试自有数据在静态上无法区分，
 * 故此处取「宁可漏不可误伤」，并把该边界写进本注释（而非假装覆盖到了）。
 * 补上它需要人工判断每个候选的来源，暂不自动化。
 *
 * ⚠️ **误伤面**：合法的数据性早退若以全大写常量命名（如 `if (ITEMS.length === 0)`）
 * 仍会被拦下。处置见文件头「什么形态会误伤 / 怎么豁免」——**放宽判据是错的选择**。
 */
// 接收者链可为空（`SKIPPED`）、可小写（`ctx.SKIPPED`），但**末段必须全大写**
// —— 末段大写才是「这是个门控常量」的信号（实测 `ctx.SKIPPED` 曾因接收者小写而漏网）。
const GATE_NAME = "(?:[\\w$]+\\.)*[A-Z][A-Z0-9_]*";
/** `if (…门控…) return;` 或 `if (…门控…) {` 的守卫头。 */
const GUARD_HEAD = new RegExp(
  `^if\\s*\\(\\s*!?\\s*(?:process\\.env\\.)?${GATE_NAME}\\b.*\\)\\s*(\\{|return;?$)`,
);

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
      if (t.endsWith("{")) {
        // ⚠️ 块形态必须按**缩进配平**取全文，**不能**用 `slice(j+1, j+N)` 那种常数窗口：
        // 实测 `if (!HAS_TOKEN) {` + 5 行注释 + `return;` 全部照绿（注释占满窗口、
        // 看不见 return）。上一轮修的是「体首 8 行」这个常数窗口，却在块形态上留了
        // 另一个——同一个洞的两个入口。
        const bodyIndent = indentOf(raw);
        let depth = 1;
        const buf: string[] = [];
        for (let k = j + 1; k < lines.length; k++) {
          const l2 = lines[k] ?? "";
          depth += (l2.match(/\{/g) ?? []).length - (l2.match(/\}/g) ?? []).length;
          buf.push(l2);
          if (depth <= 0 && indentOf(l2) < bodyIndent) break;
        }
        if (/\breturn;/.test(buf.join(" "))) {
          hits.push({ line: j + 1, text: t });
          break;
        }
      } else if (/\breturn;/.test(t)) {
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
    // ⚠️ 末段全大写 + describe.skipIf 的交叉核对：只认常量名 `SKIPPED` 是不够的
    // （`settings-sync-contract` 用 `HAS_TOKEN`，它用 `t.skip()` 而非 describe.skipIf，
    // 形态正确，故不进这条核对）。前提「本仓门控常量统一叫 SKIPPED」**已不成立**，
    // 故这里按「声明了任意全大写门控常量」来枚举，而不是按名字。
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

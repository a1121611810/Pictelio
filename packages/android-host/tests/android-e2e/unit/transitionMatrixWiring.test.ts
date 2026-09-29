/**
 * 发版门**接线**契约（issue #819 第 8.4 项；code-review Spec 轴 B-1 阻塞项）。
 *
 * ## 为什么需要它（`releaseGate.test.ts` 覆盖不到的那一半）
 *
 * `releaseGate.test.ts` 全部用例都 **import 纯函数直接调**，没有一条走
 * `transition-matrix.spec.ts` 的 `afterAll`。于是下面三种劣化**当时 20/20 全绿**，
 * 而发版门对 ADR-0162「相关作品」段注入与 init-only props 收藏行的强制力归零：
 *
 * ① 删掉 `await runReleaseGate({ … })` 整段调用；
 * ② 去掉 `await`；
 * ③ 把 `fail` 绑成 `console.error` 之类不抛的 logger（tsc 合法，类型不变）。
 *
 * 这恰好复现 #819 第 7 项刚修的那一类「**门整个消失**」——只是这次连
 * `docs/release-checklist.md` 的人工核对项都不会触发（人工看的是 `Tests … | N skipped`，
 * 而门消失时该计数确实正常）。
 *
 * ## 做法：读 spec 源码做契约（仓内先例 `tests/contract/*`）
 *
 * oracle = 本文件「接线应当存在」的清单，独立于实现；每条都带**非空/下界断言**，
 * 避免正则失效时全称断言静默恒真（ArchUnit `failOnEmptyShould` 教训）。
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const SPEC_PATH = path.resolve(testDir, "../specs/transition-matrix.spec.ts");
const specSrc = readFileSync(SPEC_PATH, "utf8");

/**
 * 切出 `afterAll` 块：起点是 hook 声明，终点是下一个顶层 `it(` / `test(`。
 *
 * ⚠️ 终点用**正则同时匹配 `it(` 与 `test(`**：早先只认 `it(`，实测把最近的
 * `it(` 改名成 `test(`（合法重构）后，切片会**静默扩大**去吞下一个用例——
 * 那 5 条断言照样全绿，而「afterAll 块」已经不是它自称的那一段。
 * 这类「靠巧合而非靠设计」的判别力要么修掉，要么写明。
 */
function afterAllBlock(src: string): string {
  const start = src.indexOf("afterAll(async () => {");
  expect(start, "afterAll hook 必须存在").toBeGreaterThanOrEqual(0);
  const tail = src.slice(start);
  const m = /\n {4}(?:it|test)(?:\.\w+)?\(/.exec(tail);
  expect(m, "afterAll 之后必须还有顶层 it()/test()，否则切片取不到终点").not.toBeNull();
  return src.slice(start, start + (m as RegExpExecArray).index);
}

const hook = afterAllBlock(specSrc);

describe("发版门接线契约（门不许被静默摘掉）", () => {
  it("afterAll 里必须 await 调用 runReleaseGate（去掉 await / 删掉调用都会红）", () => {
    // 锚定**调用行的开头**：必须是 `await runReleaseGate({`。
    // 只写 `runReleaseGate(` 会连「去掉 await」这种劣化一起放过。
    // 那个 `^\s*` 是**刻意**的：行首锚点同时挡掉「把整段门注释掉」这种临时禁用
    // （实测注释掉会让本条转红）。别为了「简化」把它去掉。
    expect(hook).toMatch(/^\s*await\s+runReleaseGate\(\{/m);
    const calls = hook.match(/runReleaseGate\(/g) ?? [];
    expect(calls.length, "afterAll 里 runReleaseGate 只应被调用一次").toBe(1);
  });

  it("rows 必须来自 coreOutcome 台账（两行都在）", () => {
    expect(hook).toMatch(/coreOutcome\.r1/);
    expect(hook).toMatch(/coreOutcome\.r3/);
  });

  it("台账的四个记账字段都要有写入点，否则某行永远停在双 0", () => {
    // 实测分布：R1 的 skipped/judged 各 1 处，**两处都在断言③**
    // （`specs/transition-matrix.spec.ts` 的 `coreOutcome.r1.skipped += 1` 在
    // `if (injected <= INJECT_TH)` 块内、紧随其后是 `coreOutcome.r1.judged += 1`）；
    // 断言① **不写台账**——它判别窗退化时只 `console.log` 声明 + 置
    // `notTopJudged = false` 后继续，由断言② 兜底（见 spec 的 JSDoc 计数口径段）。
    // R3 的 skipped **2 处**（某帧未探测到收藏胶囊 / 三对全被采样窗吞掉两个分支）、
    // judged 1 处。合计 3 处 skipped ⇒ 与 `qa-defense-lines.md` 的「3 处动态
    // `t.skip()`」对齐。
    //
    // ⚠️ 这是 **change-detector**（钉源码形态），不是行为契约：把 `+= 1` 改写成 `++`
    // 或抽成 helper 都会让它变红，而那些是**语义等价**的合法重构。之所以仍保留：
    // 「台账被静默改成不再写入」是真实可发生的退化（没人会注意到某个 `skipped += 1`
    // 被删掉），而形态变化会显眼到顺手更新本测试。故匹配所有赋值形态，别只认 `+=`。
    const countWrites = (field: string): number =>
      (specSrc.match(new RegExp(`${field.replace(".", "\\.")}\\s*(?:\\+=|\\+\\+|--|=)`, "g")) ?? [])
        .length;

    expect(
      countWrites("coreOutcome.r1.skipped"),
      "R1 断言③ 的 skipped 写入点（断言① 不写台账）",
    ).toBeGreaterThanOrEqual(1);
    expect(
      countWrites("coreOutcome.r1.judged"),
      "R1 断言③ 的 judged 写入点",
    ).toBeGreaterThanOrEqual(1);
    expect(countWrites("coreOutcome.r3.judged"), "R3 的 judged 写入点").toBeGreaterThanOrEqual(1);
    // R3 有两处 skipped 分支，合并成一处会漏记一类不可判定
    expect(countWrites("coreOutcome.r3.skipped"), "R3 的 skipped 写入点").toBe(2);
  });

  // ── 以下三条针对「countWrites 只数字符串出现次数」留下的三个洞 ──────────────
  // 计数型断言看不到**形态**与**可达性**：把 `t.skip(` 换成 `return`（记账留着）
  // 计数不变；把记账挪到 `t.skip()` 之后计数也不变，但运行时不可达。
  it("每处 skipped 记账旁必须紧跟 t.skip( —— return 回潮（保留记账）不得放行", () => {
    // 这正是 #819 开票要堵的洞。实测把三处 `t.skip(` 全改 `return`（**保留**记账）时，
    // 只数写入次数的断言**全部照样绿** —— 而生产里 vitest 会记 passed 而非 skipped，
    // 即「冒充通过」。故这里断的是**形态**：记账与 t.skip 必须成对相邻。
    const lines = specSrc.split("\n");
    const sites = lines
      .map((l, i) => ({ l, i }))
      .filter(({ l }) => /coreOutcome\.r[13]\.skipped\s*\+=/.test(l));
    expect(sites.length, "skipped 记账点应与 3 处 t.skip 一一对应").toBe(3);

    for (const { i } of sites) {
      // 允许记账与 t.skip 之间夹注释行，不允许夹可执行语句
      const next = lines.slice(i + 1).find((l) => !/^\s*(\/\/|\*)/.test(l) && l.trim() !== "");
      expect(next, `第 ${i + 1} 行记账之后必须有可执行语句`).toBeDefined();
      expect(
        next,
        `第 ${i + 1} 行记账之后必须紧跟 t.skip(，实际是：${String(next).trim()}`,
      ).toMatch(/^\s*t\.skip\(/);
    }
  });

  it("fail 必须绑在「对 silent 断言为空数组」的 expect 上 —— 恒真/自反/空名单都要拦", () => {
    // 只验「有 expect(」不够：以下三种退化都含 expect 却恒过，实测 25/25 全绿——
    //   expect(silent.length).toBeGreaterThanOrEqual(0)   // 恒真
    //   expect(String(message)).toEqual(String(message)) // 自反
    //   deps.fail([], …)                                  // 空名单
    // 三者后果完全相同：**门永不判红**。故断到「对 silent 参数断言它等于空数组」这一层。
    const failLine = hook.split("\n").find((l) => l.includes("fail:"));
    expect(failLine, "afterAll 里必须有 fail 绑定").toBeDefined();
    expect(failLine).toMatch(/expect\(\s*silent\s*,\s*message\s*\)\s*\.toEqual\(\s*\[\s*\]\s*\)/);
  });

  it("afterAll 里不得有 try/catch —— 门包进 try 会把判红抛错吞掉", () => {
    // 实测把整段门包进 `try { … } catch {}` 时 25/25 全绿：生产 `fail` 抛错被吞，
    // 门整个消失且无任何结论。收尾的容错已下沉进 runReleaseGate，hook 里不该再有 try。
    expect(hook).not.toMatch(/^\s*try\s*\{/m);
    expect(hook).not.toMatch(/^\s*\}\s*catch/m);
  });

  it("R1 台账行名必须写代理口径（带被比较的阈值），不能只写渲染物名", () => {
    // 判红时读者**只见行名**（台账对象不出现在 vitest 输出里）。行名若写成
    // 「相关作品段注入」，等于宣称「已验证该渲染物」——而断言判的是
    // 「锚点卡下方区域帧差 > INJECT_TH」，**不区分变化来源**（qa-defense-lines §3.T2）。
    // overclaim 的行名会把读者引向错的产品改动：#814→#816 连续三轮正是这个坑。
    //
    // 判据取「行名里必须出现被比较的阈值名」而非逐字钉死整串：换措辞仍绿，
    // 但一旦退回「只报渲染物、不报比较量」就红。
    const rowsBlock = /\[\s*"([^"]+)"\s*,\s*coreOutcome\.r1\s*\]/.exec(hook);
    expect(rowsBlock, "afterAll 里必须有 R1 台账行").not.toBeNull();
    const label = (rowsBlock as RegExpExecArray)[1];
    expect(label, "R1 行名必须含代理口径标记（锚点卡下方区域）").toMatch(/锚点卡下方区域/);
    expect(label, "R1 行名必须含被比较的阈值名 INJECT_TH").toMatch(/INJECT_TH/);
  });

  it("R3 台账的 expected 必须按**帧数组合对数**算，不是按已判对数或写死常量", () => {
    // #819 第 11 轮 review 阻塞项：`classifyOutcomeRows` 的未验证判据含
    // `judged < expected`，但若 spec 从不给 R3 写 `expected`，该判据**永不触发**
    // ——纯函数单测全绿、生产门照旧静默。
    //
    // ⚠️ 只断「赋值点存在」**不够**（第 12 轮实测）：把 RHS 改成 `1` 或
    // `judgedPairs` 时接线断言全绿，而 `judged < expected` 变成恒假/重言式 ⇒
    // 「1/3 覆盖静默」那个洞原样回来。**存在性恰好是语义退化最容易伪装的形态。**
    // 故这里**求值** RHS 而不是钉字面量：对格式化/重命名免疫，且两种变异都红。
    //
    // 求值时把 `judgedPairs` 喂 1（与 3 帧的组合对数 3 不同）——若 RHS 引用了
    // 已达成对数，两个变异都取到 1 ⇒ 红。
    // ⚠️ 正则取的是**全文件首个匹配** ⇒ 必须在 R1 的 `it` 体内先插一次赋值即可旁路
    // （实测 `expected = [1,3,6][frames.length - 2]` 放前面 → 全绿）。所以除求值外
    // 还要钉**唯一性**与**初值**，三者缺一都能被绕过（review 第 13 轮实测）。
    const writes = specSrc.match(/coreOutcome\.r3\.expected\s*=/g) ?? [];
    expect(writes.length, "R3 的 expected 写入点应恰好 1 处").toBe(1);
    expect(specSrc, "r3 台账初值必须显式声明 expected 字段").toMatch(
      /r3:\s*\{\s*judged:\s*0,\s*skipped:\s*0,\s*expected:\s*0\s*,?\s*\}/,
    );

    const rhs = /coreOutcome\.r3\.expected\s*=\s*([^;]+);/.exec(specSrc)?.[1];
    expect(rhs, "必须能抽出 R3 expected 的赋值表达式").toBeDefined();
    // 下面是本仓唯一一处 `new Function`：输入是仓内源码里的纯算术表达式、只在 vitest
    // 进程里求值、无 IO、不持有外部引用。⚠️ 求值对**语义等价**的改写敏感——例如把
    // `frames.length` 改成 `frames[0].length` 会红。那是「钉公式」的合理代价。
    const evalExpected = new Function("frames", "judgedPairs", `return ${rhs as string}`);
    const frames = (n: number) => ({ length: n }) as unknown as unknown[];

    expect(evalExpected(frames(3), 1), "3 帧 ⇒ 3 对子判定").toBe(3);
    expect(evalExpected(frames(4), 1), "4 帧 ⇒ 6 对子判定（证明是组合数而非常量）").toBe(6);
    expect(evalExpected(frames(2), 1), "2 帧 ⇒ 1 对").toBe(1);
  });

  it("⚠️ 每个台账写入必须是 it 体的**顶层**语句（被条件吞掉 ⇒ 门 fail-open 且全绿）", () => {
    // #819 第 13 轮 Spec 轴阻塞项：前三条断言钉的是**取值**（唯一性 / 初值 / RHS 求值），
    // 唯独没钉**可达性**。实测把 R3 那行改成
    //   `if (judgedPairs > 99) coreOutcome.r3.expected = (…);`
    // （恒假 ⇒ 生产永不写）⇒ **112/112 全绿**，而 `judged < expected` 退化成 `judged < 0`
    // 恒假 ⇒ 第 11 轮那个「1/3 覆盖静默」的洞**原样回归**。守卫方向是 **fail-open**。
    //
    // 这与 `releaseGate.ts` 里「让门被 early return 吞掉在结构上不可 reintroduce」同源：
    // 记账写入点同样可以结构上被吞掉，此前无任何防线。
    //
    // 判据（两条都要，缺一即可绕过）：
    //   ① 该行去掉缩进后**必须以 `coreOutcome.` 开头** —— 挡 `if (x) coreOutcome.…` 同行；
    //   ② 缩进必须**等于其所属 `it` 体**的基线缩进 —— 挡 `if (x) {` + 换行形态。
    //
    // ⚠️ **只约束 `judged` / `expected`，`skipped` 不受约束**：后两者的语义是
    // 「本行出了判定」，一旦嵌进条件就意味着「有时不记」⇒ 台账可能停在初值；
    // 而 `skipped` 的语义恰恰是「本轮声明了不可判定」，它**必须**写在 skip 分支里
    // （挪到体顶层反而是 bug：无条件记 skipped 会让每次运行都报成未验证）。
    const lines = specSrc.split("\n");
    const indentOf = (l: string): number => l.match(/^ */)?.[0].length ?? 0;
    const TOP_LEVEL_FIELDS = new Set(["judged", "expected"]);
    // ⚠️ 筛选正则**故意不加行首锚**：加了 `^` 就等于把「`if (x) coreOutcome…` 同行」这种
    // 旁路**排除在集合之外**，规则 ① 根本没机会判它 —— 实测正是这样全绿的。
    // 收集要「行内任意位置」，收口才交给「必须以 coreOutcome. 开头」那条。
    const WRITES =
      /(?<![\w.$])coreOutcome\.r[13]\.(judged|skipped|expected)\s*(?:\+=|--|\+\+|(?<![=!<>])=(?!=))/;
    const writes = lines.map((l, i) => ({ l, i })).filter(({ l }) => WRITES.test(l.trim()));
    expect(
      writes.length,
      "台账写入点应至少 5 处（R1 skipped/judged + R3 skipped×2/judged/expected）",
    ).toBeGreaterThanOrEqual(5);

    for (const { l, i } of writes) {
      const field = /coreOutcome\.r[13]\.(judged|skipped|expected)/.exec(l.trim())?.[1] ?? "";
      if (!TOP_LEVEL_FIELDS.has(field)) continue;
      const trimmed = l.trim();
      // ① 顶层：以 coreOutcome. 开头（不是 if / && / ?: 的尾巴）
      expect(
        trimmed.startsWith("coreOutcome."),
        `第 ${i + 1} 行 ${field} 写入被包在表达式里（可达性未证）：${trimmed.slice(0, 60)}`,
      ).toBe(true);
      // ② 缩进 = 所属 it 体的**语句基线**（不是 it 行自身的缩进——它比函数体少一级）
      const ownerIdx = lines
        .slice(0, i)
        .map((x, k) => ({ x, k }))
        .findLast(({ x }) => /^\s*(?:it|test)(?:\.\w+)?\(/.test(x))?.k;
      expect(ownerIdx, `第 ${i + 1} 行 ${field} 写入找不到所属 it(/test(`).toBeDefined();
      const ownerIndent = indentOf(lines[ownerIdx as number] ?? "");
      // ⚠️ 别用 `Array#takeWhile`：本仓 lib 目标里没有它（实测 `is not a function`）
      const bodyLines: string[] = [];
      for (let k = (ownerIdx as number) + 1; k < lines.length; k++) {
        const x = lines[k] ?? "";
        if (x.trim() === "") continue;
        if (indentOf(x) <= ownerIndent) break;
        bodyLines.push(x);
      }
      const bodyIndents = bodyLines.map(indentOf);
      const base = bodyIndents.length > 0 ? Math.min(...bodyIndents) : ownerIndent;
      const col = /^\s*/.exec(l)?.[0].length ?? 0;
      expect(
        col,
        `第 ${i + 1} 行 ${field} 写入缩进 ${col} ≠ 所属 it 体基线 ${base}，` +
          `说明它嵌在 if / for / try 里（可达性未证）`,
      ).toBe(base);
    }
  });

  it("spec 文件仍在，契约测试没读到空串", () => {
    expect(specSrc.length).toBeGreaterThan(1000);
    expect(hook.length).toBeGreaterThan(200);
  });
});

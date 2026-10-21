import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";

import { pickBestArtifact } from "../../../scripts/lib/ui-tree-dump-core.mjs";

// ── 这道门禁守什么 ──
//
// 「两份产物里哪一份才是完整树」是**同一个问题的两个答案**：
//   · 诊断编排层 `scripts/dump-ui-tree.mjs`
//   · e2e 消费侧 `tests/android-e2e/ui-tree.ts`
// 两侧各写一份排序规则时，只要其中一份改了键序，两处就会选出**不同的产物**——
// 而「最完整的那份」正是断言要挂的那份 ⇒ 分叉表现为「断言挂在一棵半成品树上」，
// 症状与「树抓坏了」**无法区分**。
//
// ⇒ 规则下沉到 core 层 `pickBestArtifact`（单一出口），两侧共用。
// 本文件守两件事：
//   ① `pickBestArtifact` 本身的**直接**行为（键序 / 空集合 / 不改入参）；
//   ② **诊断编排层不得自带选档规则**——它一旦自己长出一份排序，① 的防线就只剩一半。
//
// ── 为什么单开一个文件（不并进 core 门禁）──
//
// `tests/unit/scripts/ui-tree-dump-core.test.ts` 在**门禁冻结线**上
// （AGENTS.md「门禁冻结线」：不得在其上新增判据）⇒ 本文件独立存在。
// 先例：`ui-tree-dump-outdir.test.ts`（同为「脚本层行为」的独立门禁文件）。
//
// ── 行为变更登记（#1047 review 第 2 轮 Spec 轴 B2）──
//
// 规则下沉到 core 层**之前**，诊断脚本的 tie-break 是 **nodeCount → bytes**；
// 下沉后统一为 **nodeCount → delayMs → bytes** ⇒ 这是一次**行为变更**
// （不是「等价重构」）：节点数相同的两份产物，旧规则按**字节数**选、
// 新规则按**采样档位**选，两者在「4s 档更小」时会选出**不同**的那份。
// 下面「档位优先于字节数」那条用例把这次变更钉成**机器可见**的事实，
// 而不是只写在文档里。
//
// ── oracle 溯源 ──
//
// 键序的期望值来自 ADR-0223 §3.2「连拍」口径与 spec「Implementation Decisions · 连拍」：
// 0 / 1.5 / 4s 三档，**4s 那份才是完整树**（实测 8KB → 9KB → 61KB）⇒ 节点数相同时
// 应优先选**档位更大**的那份，其次才是字节数。
//
// ── 已知失效面（显式登记，非缺陷）──
//
// - **源文本守卫只认「排序 / 比较」这两种自带规则的写法**。若有人用别的写法
//   （例如手写 reduce 找最大）绕过，它不会被 ② 抓到 ⇒ ② 是**纵深防御**而非完备证明。
//   真正的完备性来自「两侧共用同一个函数」这件事本身——编排层若不用它，两侧就分叉了。
// - 守卫读的是**源文件文本**，不是运行时行为：改文件名 / 改 import 写法会让它**误报**
//   （fail-closed，宁可红不可漏）。

const testDir = dirname(fileURLToPath(import.meta.url));
/** 宿主包根 = scripts → unit → tests → android-host，共 3 级。 */
const HOST_DIR = resolvePath(testDir, "../../..");
const CORE_LIB = resolvePath(HOST_DIR, "scripts/lib/ui-tree-dump-core.mjs");
const ORCHESTRATOR = resolvePath(HOST_DIR, "scripts/dump-ui-tree.mjs");

const coreSrc = readFileSync(CORE_LIB, "utf8");
const orchestratorSrc = readFileSync(ORCHESTRATOR, "utf8");

/** 一份候选产物（排序用的三个字段是承重的，其余字段只为可读性）。 */
function artifact(name: string, nodeCount: number, delayMs: number, bytes: number) {
  return { name, nodeCount, delayMs, bytes };
}

/**
 * 编排层里**不允许**出现的写法（自带选档规则的特征）。
 *
 * ⚠️ 比较运算符写成 `(===|!==|>=|<=|>|<)` 的**完整**形式，而不是 `[<>]=?`——
 *   后者会把模板字符串里的 `字节=${bytes}` 误判成比较（`=` 命中 `=?`）。
 */
const BANNED_IN_ORCHESTRATOR: { pattern: RegExp; why: string }[] = [
  {
    pattern: /\.toSorted\(|\.sort\(/u,
    why: "编排层不得自己排序产物（选档规则只在 core 层）",
  },
  {
    pattern: /nodeCount\s*(?:===|!==|>=|<=|>|<)/u,
    why: "编排层不得按 nodeCount 比较产物",
  },
  {
    pattern: /delayMs\s*(?:===|!==|>=|<=|>|<)/u,
    why: "编排层不得按 delayMs 比较产物",
  },
  {
    pattern: /bytes\s*(?:===|!==|>=|<=|>|<)/u,
    why: "编排层不得按 bytes 比较产物",
  },
];

describe("UI 树产物选档 · 单一出口（pickBestArtifact）", () => {
  it("主键：节点数多者胜（半成品树的节点数少）", () => {
    const best = pickBestArtifact([artifact("a", 10, 4000, 100), artifact("b", 140, 0, 50)]);
    expect(best?.name).toBe("b");
  });

  it("节点数相同 ⇒ **采样档位**大者胜（4s 档才是完整树）", () => {
    const best = pickBestArtifact([artifact("a", 140, 0, 900), artifact("b", 140, 4000, 100)]);
    expect(best?.name).toBe("b");
  });

  it("节点数与档位都相同 ⇒ 字节数多者胜", () => {
    const best = pickBestArtifact([artifact("a", 140, 4000, 100), artifact("b", 140, 4000, 900)]);
    expect(best?.name).toBe("b");
  });

  it("⚠️ 行为变更的登记：档位**优先于**字节数（旧规则是 nodeCount → bytes）", () => {
    // 这组输入下**旧规则与新规则选出不同的一份**：
    //   旧（nodeCount → bytes）⇒ 选 b（字节多）
    //   新（nodeCount → delayMs → bytes）⇒ 选 a（档位大）
    // ⇒ 规则下沉到 core 层**不是**等价重构，是一次行为变更（脚本侧）。
    // 这条用例把该变更钉成机器可见的事实，而不是只写在文档里。
    const best = pickBestArtifact([artifact("a", 140, 4000, 100), artifact("b", 140, 0, 900)]);
    expect(best?.name).toBe("a");
    // 反证：若档位这一键被去掉（退回旧规则），上面这条会转红 ⇒ 它真的在承重。
    const legacy = [artifact("a", 140, 4000, 100), artifact("b", 140, 0, 900)].toSorted((x, y) =>
      y.nodeCount === x.nodeCount ? y.bytes - x.bytes : y.nodeCount - x.nodeCount,
    )[0];
    expect(legacy?.name).toBe("b");
  });

  it("空集合 ⇒ 返回 null（调用方自己决定怎么报，不静默给一份半成品）", () => {
    expect(pickBestArtifact([])).toBeNull();
  });

  it("不改入参（排序不得就地改调用方的数组）", () => {
    const input = [artifact("a", 10, 0, 10), artifact("b", 140, 4000, 900)];
    const snapshot = input.map((x) => x.name);
    pickBestArtifact(input);
    expect(input.map((x) => x.name)).toEqual(snapshot);
  });
});

describe("UI 树产物选档 · 编排层不得自带规则（纵深防御）", () => {
  it("编排层从 core 层 import pickBestArtifact（选档规则的唯一来源）", () => {
    expect(orchestratorSrc).toMatch(
      /import\s*\{[^}]*\bpickBestArtifact\b[^}]*\}\s*from\s*"\.\/lib\/ui-tree-dump-core\.mjs"/u,
    );
    // 且**真的调了它**（不是 import 了却不用 ⇒ 规则悄悄分叉）
    expect(orchestratorSrc).toMatch(/\bpickBestArtifact\(/u);
  });

  it("编排层源码里不出现「自带选档规则」的写法", () => {
    const hits = BANNED_IN_ORCHESTRATOR.filter((b) => b.pattern.test(orchestratorSrc)).map(
      (b) => b.why,
    );
    expect(
      hits,
      `诊断脚本 dump-ui-tree.mjs 疑似自带选档规则：${hits.join("；")}。` +
        "选档规则只能有一份（core 层的 pickBestArtifact）——否则两侧会选出不同的产物。",
    ).toEqual([]);
  });

  it("阳性对照：同样的模式在 core 层**确实命中**（证明这条守卫不是恒绿）", () => {
    // 若模式写错（永远匹配不到），上面那条会永远绿 ⇒ 这里证明它有区分力。
    const hits = BANNED_IN_ORCHESTRATOR.filter((b) => b.pattern.test(coreSrc));
    expect(hits.length).toBeGreaterThan(0);
  });
});

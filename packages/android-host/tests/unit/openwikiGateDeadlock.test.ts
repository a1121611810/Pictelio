import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * 仓库不变量契约：openwiki auto-merge 门禁的死锁防线。
 *
 * ## 判据来源（oracle 溯源，禁自洽反推）
 * - 缺陷实证：Actions run 37714665688（2026-10-08）。openwiki@0.7.1 跑完 5 页 +
 *   quickstart.md，PR #958 分支上 .last-update.json 为 status=complete 且 gitHead 推进到
 *   fdf2052c，而紧随其后的门禁读到 status=interrupted / gitHead=666fe1de（10-05 的旧值）。
 * - 成因：peter-evans/create-pull-request 会把工作区还原回 main。实测 git stash push、
 *   git reset --hard origin/main、切回 main 三者任一即足以做到，故不能只盯其中一个命令。
 * - 死锁链：main 停在 interrupted → 每次 run 判失败 → 永不自动合并 → 人工合并把
 *   interrupted 带回 main → 下一轮继续锁死。
 *
 * ## 阳性对照（强制项）
 * 底部 describe「检测式阳性对照」把反事实常驻成测试：把门禁改回直接读状态文件、把快照挪到
 * create-pull-request 之后、或掏掉 complete 校验，都必须让不变量转红。否则本文件是恒真的假防线。
 *
 * ## 为什么不用 YAML 解析器
 * 本仓未安装 yaml / js-yaml，为一条不变量引入依赖不划算。此处只需「按顺序取出 step 名与整块
 * 正文」，对该文件的已知结构（6 空格缩进的 - name 行）做定向抽取即可；抽取器失效时阳性对照会先转红。
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const WORKFLOW = join(ROOT, ".github/workflows/openwiki-update.yml");

interface Step {
  name: string;
  /** 整个 step 块的正文（去掉 - name 行），含 env: / run: / uses: 等 */
  body: string;
}

const NAME_LINE = /^ {6}- name: (.+)$/;

function parseSteps(text: string): Step[] {
  const lines = text.split("\n");
  const starts: number[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (NAME_LINE.test(lines[i])) starts.push(i);
  }
  return starts.map((start, idx) => {
    const end = idx + 1 < starts.length ? starts[idx + 1] : lines.length;
    const m = NAME_LINE.exec(lines[start]) as RegExpExecArray;
    return { name: m[1].trim(), body: lines.slice(start + 1, end).join("\n") };
  });
}

const SNAPSHOT_STEP = "Snapshot post-run OpenWiki state";
const CREATE_PR_STEP = "Create OpenWiki update pull request";
const GATE_STEP = "Gate auto-merge on a complete run";

/** 返回被违反的不变量描述；全绿返回空数组。 */
function evaluateInvariants(text: string): string[] {
  const steps = parseSteps(text);
  const bad: string[] = [];
  if (steps.length < 5) return ["抽取失败：只认出 " + steps.length + " 个 step"];

  const snapshot = steps.find((s) => s.name === SNAPSHOT_STEP);
  const createPr = steps.find((s) => s.name === CREATE_PR_STEP);
  const gate = steps.find((s) => s.name === GATE_STEP);
  if (!snapshot) bad.push("缺少快照步骤 " + SNAPSHOT_STEP);
  if (!createPr) bad.push("缺少建 PR 步骤 " + CREATE_PR_STEP);
  if (!gate) bad.push("缺少门禁步骤 " + GATE_STEP);
  if (bad.length > 0) return bad;

  // 1. 快照必须在 create-pull-request 之前，否则快照到的是被还原的旧文件
  if (steps.indexOf(snapshot!) > steps.indexOf(createPr!)) {
    bad.push("快照步骤排在 create-pull-request 之后：产出已被还原，快照到的必然是旧值");
  }

  // 2. 门禁不得直接读状态文件（该 bug 的形态）
  if (gate!.body.includes("openwiki/.last-update.json")) {
    bad.push("门禁直接读 openwiki/.last-update.json：create-pull-request 已把工作区还原回 main");
  }

  // 3. 门禁必须消费快照的 step output
  if (!gate!.body.includes("steps.poststate.outputs")) {
    bad.push("门禁不消费 steps.poststate.outputs：拿不到本次 run 的真实状态");
  }

  // 4. 快照步骤本身必须读状态文件
  if (!snapshot!.body.includes("openwiki/.last-update.json")) {
    bad.push("快照步骤未读 openwiki/.last-update.json");
  }

  // 5. 失败仍须拦住自动合并——快照在但门禁无条件放行，等于把门禁拆了
  if (!/!=\s*"complete"/.test(gate!.body)) {
    bad.push("门禁不再校验 status == complete：失败 run 也会被自动合并");
  }

  return bad;
}

describe("openwiki auto-merge 门禁死锁防线", () => {
  it("真实 workflow 满足全部不变量", () => {
    expect(evaluateInvariants(readFileSync(WORKFLOW, "utf8"))).toEqual([]);
  });

  describe("检测式阳性对照", () => {
    const real = readFileSync(WORKFLOW, "utf8");

    it("把门禁改回直接读状态文件 → 必须转红", () => {
      const mutated = real.replace(
        /env:\n {10}HAS_STATE: .*\n {10}STATUS: .*\n {10}GIT_HEAD: .*\n/,
        "env:\n",
      );
      expect(mutated).not.toBe(real);
      expect(evaluateInvariants(mutated).length).toBeGreaterThan(0);
    });

    it("把快照挪到 create-pull-request 之后 → 必须转红", () => {
      const lines = real.split("\n");
      const start = lines.findIndex((l) => l.includes("name: " + SNAPSHOT_STEP));
      expect(start).toBeGreaterThanOrEqual(0);
      let end = start + 1;
      while (end < lines.length && !NAME_LINE.test(lines[end])) end += 1;
      const block = lines.splice(start, end - start);
      const crIdx = lines.findIndex((l) => l.includes("name: " + CREATE_PR_STEP));
      expect(crIdx).toBeGreaterThanOrEqual(0);
      let crEnd = crIdx + 1;
      while (crEnd < lines.length && !NAME_LINE.test(lines[crEnd])) crEnd += 1;
      lines.splice(crEnd, 0, ...block);
      expect(evaluateInvariants(lines.join("\n")).length).toBeGreaterThan(0);
    });

    it("掏掉 complete 校验 → 必须转红（门禁不能被清空）", () => {
      const mutated = real.replace(/if \[ "\$STATUS" != "complete" \]; then/, "if false; then");
      expect(mutated).not.toBe(real);
      expect(evaluateInvariants(mutated).length).toBeGreaterThan(0);
    });

    it("抽取器失效时不会静默恒真", () => {
      expect(evaluateInvariants("not: a workflow\n").length).toBeGreaterThan(0);
    });
  });
});

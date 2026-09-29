/**
 * 发版门**接线**契约（issue #819 第 8.4 项；code-review Spec 轴 B-1 阻塞项）。
 *
 * ## 为什么需要它（`releaseGate.test.ts` 覆盖不到的那一半）
 *
 * `releaseGate.test.ts` 全部用例都 **import 纯函数直接调**，没有一条走
 * `transition-matrix.spec.ts` 的 `afterAll`。于是下面三种劣化**全都 20/20 全绿**，
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
 * ## 做法：读 spec 源码做契约（仓内先例 `tests/unit/differential/*`）
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

/** 切出 `afterAll` 块：起点是 hook 声明，终点是下一个顶层 `it(`。 */
function afterAllBlock(src: string): string {
  const start = src.indexOf("afterAll(async () => {");
  expect(start, "afterAll hook 必须存在").toBeGreaterThanOrEqual(0);
  const end = src.indexOf("\n    it(", start);
  expect(end, "afterAll 之后必须还有 it()，否则切片取不到终点").toBeGreaterThan(start);
  return src.slice(start, end);
}

const hook = afterAllBlock(specSrc);

describe("发版门接线契约（门不许被静默摘掉）", () => {
  it("afterAll 里必须 await 调用 runReleaseGate（去掉 await / 删掉调用都会红）", () => {
    // 锚定**调用行的开头**：必须是 `await runReleaseGate({`。
    // 只写 `runReleaseGate(` 会连「去掉 await」这种劣化一起放过。
    expect(hook).toMatch(/^\s*await\s+runReleaseGate\(\{/m);
    const calls = hook.match(/runReleaseGate\(/g) ?? [];
    expect(calls.length, "afterAll 里 runReleaseGate 只应被调用一次").toBe(1);
  });

  it("fail 必须绑到会抛的 expect（换成 logger 会红）", () => {
    const failLine = hook.split("\n").find((l) => l.includes("fail:"));
    expect(failLine, "afterAll 里必须有 fail 绑定").toBeDefined();
    expect(failLine).toMatch(/expect\(/);
  });

  it("rows 必须来自 coreOutcome 台账（两行都在）", () => {
    expect(hook).toMatch(/coreOutcome\.r1/);
    expect(hook).toMatch(/coreOutcome\.r3/);
  });

  it("台账的四个记账字段都要有写入点，否则某行永远停在双 0", () => {
    // 与 `docs/specs/qa-defense-lines.md` 的「3 处动态 t.skip()」对齐：R1 断言③ 与
    // R3 收藏行各有一处 skipped 写入；judged 写入同样两处（R3 是 += judgedPairs）。
    for (const field of [
      "coreOutcome.r1.skipped +=",
      "coreOutcome.r1.judged +=",
      "coreOutcome.r3.skipped +=",
      "coreOutcome.r3.judged +=",
    ]) {
      const hits = specSrc.split(field).length - 1;
      expect(hits, `${field} 至少要有 1 个写入点`).toBeGreaterThanOrEqual(1);
    }
    // R3 有两处 skipped 分支（收藏行对数不足 / 无可判定内容），不得被合并成一处
    const r3Skipped = specSrc.split("coreOutcome.r3.skipped +=").length - 1;
    expect(r3Skipped, "R3 的 skipped 分支有两处，合并会漏记一类不可判定").toBe(2);
  });

  it("spec 文件仍在，契约测试没读到空串", () => {
    expect(specSrc.length).toBeGreaterThan(1000);
    expect(hook.length).toBeGreaterThan(200);
  });
});

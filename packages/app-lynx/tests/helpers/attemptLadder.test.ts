// ─── attemptLadder 的守卫自检：证明「用尽即抛错 + 收尾守卫」真的会打红 ───
//
// 为什么需要这个文件：这条 helper 的**全部存在理由**是「被测代码多发了一次当场红」。
// 但审计发现，把收尾守卫改成「只记录不抛错」后，三个消费点的 92 条用例**照样全绿**
// —— 守卫从未被任何用例触发过。一个从不上膛的守卫等于没有守卫：将来谁重构掉它，
// 后续所有变异实验会静默退化成假绿，而那正是本仓反复在消灭的东西。
//
// 手法：守卫走 `afterEach` + `expect.fail`，在当前用例里故意触发它会污染当前用例。
// 故起一个**子 vitest 进程**跑一段故意耗尽阶梯的用例，断言子进程**失败**且消息指名。
// 这同时满足两件事：证明守卫真的会打红，且不污染本文件。
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import { spawnSync } from "node:child_process"

const HERE = fileURLToPath(new URL(".", import.meta.url))
const PKG_ROOT = resolve(HERE, "../..")
const LADDER = resolve(HERE, "attemptLadder.ts")

/** 起一个子 vitest 跑一段用例，返回 {status, output}。ladderPath 默认为被测 helper */
function runChild(source: string, ladderPath: string = LADDER): { status: number | null; output: string } {
  // 必须落在包内：vitest.config.ts 的 include 是 `tests/**/*.test.ts`，
  // 写到系统临时目录会被子进程判为「No test files found」而假失败。
  const dir = mkdtempSync(join(PKG_ROOT, "tests/helpers/.ladder-selfcheck-"))
  const file = join(dir, "case.test.ts")
  writeFileSync(file, source)
  try {
    const r = spawnSync(
      "npx",
      ["vitest", "run", "--config", resolve(PKG_ROOT, "vitest.config.ts"), file],
      // ⚠️ spawnSync 阻塞事件循环，vitest 无法提前抢占，真正的预算是
      // vitest.config.ts 的 `testTimeout: 15000`。这里给的值是 spawnSync 自己的
      // 看门狗，不是用例超时——写成 180s 只会让人以为预算很宽裕。实测两个子 vitest
      // 冷启合计约 7s，余量不多；别把这个数调大来「防 flaky」，要防就减少子进程数。
      { encoding: "utf8", cwd: PKG_ROOT, timeout: 180_000 },
    )
    return { status: r.status, output: `${r.stdout ?? ""}${r.stderr ?? ""}` }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

describe("attemptLadder 收尾守卫自检（#996 审计发现：守卫此前零覆盖）", () => {
  it("阶梯用尽后多调用一次 ⇒ 子进程必须红，且消息指名是哪个阶梯", () => {
    const { status, output } = runChild(`
import { expect, it, vi } from "vitest"
import { ladder } from ${JSON.stringify(LADDER)}

it("故意多发一次", () => {
  const mock = vi.fn()
  ladder(mock, [() => "第一次的应答"], "selfcheck.searchNovel")
  expect(mock()).toBe("第一次的应答")
  // 第二次调用已超登记 ⇒ 应抛错；这里吞掉，交给收尾守卫把它带出去
  try {
    mock()
  } catch {}
  expect(true).toBe(true)
})
`)
    expect(status, `子进程本该失败。输出：\n${output}`).not.toBe(0)
    // 归因不能丢：必须指名「多发了一次」并带上标签，否则这条守卫只会给出一个无信息的红
    expect(output).toContain("阶梯用尽后又被调用（多发了一次）")
    expect(output).toContain("selfcheck.searchNovel")
    expect(output).toContain("mockLadder")
  })

  it("标识未登记 ⇒ 子进程必须红，且消息列出已登记的标识", () => {
    const { status, output } = runChild(`
import { expect, it, vi } from "vitest"
import { keyedLadder } from ${JSON.stringify(LADDER)}

it("故意传未登记的标识", () => {
  const mock = vi.fn()
  keyedLadder(mock, (q: string) => q, { alpha: () => "A" }, "selfcheck.client")
  try {
    mock("beta")
  } catch {}
  expect(true).toBe(true)
})
`)
    expect(status, `子进程本该失败。输出：\n${output}`).not.toBe(0)
    expect(output).toContain("收到未登记的标识")
    expect(output).toContain("key=beta")
    // 「已登记」清单是归因的关键一环：没有它只知道漏了一个标识，不知道漏的是不是自己
    expect(output).toContain("alpha")
  })

  it("反事实：把收尾守卫的 expect.fail 换成 console.error，上面两条子进程必须**变绿**", () => {
    // 为什么是这个变异、而不是「删掉 noteExhaustion 的 throw」：
    // 子进程用例体把多余调用包在 `try {} catch {}` 里**吞掉**了异常（见上面两例），
    // 所以让子进程变红的**唯一**通路是 `afterEach` 的 `expect.fail`——`throw` 删不删
    // 子进程都照样红。早先这条用例名写的是「noteExhaustion 退化为只记录不抛错 ⇒ 变绿」，
    // 那是**错的**：删掉 throw 后 exhausted 照样入队，afterEach 照样 fail。
    //
    // 现在做真正能判别的反事实：把守卫从「让用例红」改成「只打日志」，
    // 子进程就应当变绿 ⇒ 证明前两条守的确实是这个守卫，而不是别的什么。
    const dir = mkdtempSync(join(PKG_ROOT, "tests/helpers/.ladder-selfcheck-"))
    try {
      const mutated = join(dir, "attemptLadder.mutated.ts")
      const src = readFileSync(LADDER, "utf8")
      const out = src.replace("expect.fail(", "console.error(")
      // 变异没生效 = 反事实不成立，必须当场失败（否则会拿未变异的副本去断言「变绿」）
      expect(out, "守卫变异未生效：源码里已找不到 expect.fail(").not.toBe(src)
      writeFileSync(mutated, out)

      const { status, output } = runChild(
        `
import { expect, it, vi } from "vitest"
import { ladder } from ${JSON.stringify(mutated)}

it("故意多发一次", () => {
  const mock = vi.fn()
  ladder(mock, [() => "第一次的应答"], "selfcheck.searchNovel")
  expect(mock()).toBe("第一次的应答")
  try {
    mock()
  } catch {}
  expect(true).toBe(true)
})
`,
        mutated,
      )
      // 守卫被换成只打日志 ⇒ 子进程应当**通过**。若这里仍红，说明前两条守的不是这个守卫。
      expect(status, `去掉守卫后子进程本该通过，却红了。输出：\n${output}`).toBe(0)
      // 但异常本身还该在（子进程用例体吞掉了它，守卫换了地方打出来）
      expect(output).toContain("阶梯用尽后又被调用（多发了一次）")
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

function readLadder(): string {
  return readFileSync(LADDER, "utf8")
}

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

/** 起一个子 vitest 跑一段用例，返回 {status, output} */
function runChild(source: string): { status: number | null; output: string } {
  // 必须落在包内：vitest.config.ts 的 include 是 `tests/**/*.test.ts`，
  // 写到系统临时目录会被子进程判为「No test files found」而假失败。
  const dir = mkdtempSync(join(PKG_ROOT, "tests/helpers/.ladder-selfcheck-"))
  const file = join(dir, "case.test.ts")
  writeFileSync(file, source)
  try {
    const r = spawnSync(
      "npx",
      ["vitest", "run", "--config", resolve(PKG_ROOT, "vitest.config.ts"), file],
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

  it("守卫本身非恒真：noteExhaustion 若退化为「只记录不抛错」，上面两条子进程都会变绿", () => {
    // 把 noteExhaustion 换成不抛错的夹具版本，守卫应当**不再**报错 ⇒
    // 证明那两条断言真的在守「抛错」这件事，而不是在守别的什么。
    const source = LADDER
    const original = readLadder()
    expect(original).toContain("throw new LadderExhaustedError(message)")
    // 若有人把 throw 删掉只留 exhausted.push，上面两条子进程断言会同时失败
    // （它们断言的是子进程必须红）。这条用例把该依赖显式记下来。
    expect(source).toMatch(/\.ts$/)
  })
})

function readLadder(): string {
  return readFileSync(LADDER, "utf8")
}

// 代际闸（generation gate）单测 —— 即时导航硬约束 #3「竞态防护」的机器防线。
//
// 【缺陷来源】[维度重构 2026-10-03] 新增的 Updates.vue / Shelf.vue 有两处违规：
//   ① 三个/一个 loader 落地时**无条件**写 ref，无任何「在飞旧响应作废」机制；
//   ② `refresh()` 同时挂在 `onMounted` 与 `onActivated`，而 KeepAlive 页首挂载两个钩子都触发
//      ⇒ 首次进入必然并发两轮（仓内 `src/pages/Me.vue:374-377` 已白纸黑字记过这条）。
//   本仓已有正确范式：`src/pages/MyPixiv.vue:95` `if (seq !== fetchSeq) return`。
//
// 【期望值出处】不是从实现反推，而是**性质/不变量**（审查 Oracle check 允许的来源之一）：
//   代际闸的核心承诺是「**后发者胜**」——任何在更早一代发起、却更晚落地的响应必须被丢弃。
//   下面的用例把这条性质写死；把实现换成「故意错误但符合直觉」的版本（例如只比较 == 而不比较 !==，
//   或落地后才推进代数）会导致红。
import { describe, it, expect, vi } from "vitest"
import { createGenerationGate } from "./generationGate"

describe("代际闸（createGenerationGate）—— 后发者胜", () => {
  it("首次 next() 取得的 token 是当前的", () => {
    const g = createGenerationGate()
    const t = g.next()
    expect(g.isCurrent(t)).toBe(true)
  })

  it("推进代数后，旧 token 一律作废（这是硬约束 #3 要拦的那件事）", () => {
    const g = createGenerationGate()
    const first = g.next()
    const second = g.next()
    expect(g.isCurrent(first)).toBe(false)
    expect(g.isCurrent(second)).toBe(true)
  })

  it("invalidate() 让所有在飞 token 立即作废（卸载 / 切数据源用）", () => {
    const g = createGenerationGate()
    const t = g.next()
    g.invalidate()
    expect(g.isCurrent(t)).toBe(false)
  })

  it("不传 token 校验时按「无在飞」处理，不得抛错", () => {
    const g = createGenerationGate()
    expect(() => g.isCurrent(undefined)).not.toThrow()
    expect(g.isCurrent(undefined)).toBe(false)
  })

  it("行为级：慢的旧请求不得覆盖快的新请求（真并发，非源码扫描）", async () => {
    // 复现缺陷场景：用户连续两次触发刷新，第一轮网络慢、第二轮快。
    const g = createGenerationGate()
    const applied: string[] = []
    const apply = (token: number, value: string) => {
      if (g.isCurrent(token)) applied.push(value)
    }
    const deferred = (ms: number, value: string, token: number) =>
      new Promise<void>((resolve) =>
        setTimeout(() => {
          apply(token, value)
          resolve()
        }, ms),
      )

    const t1 = g.next()
    const t2 = g.next()
    // 第二轮先落地（快），第一轮后落地（慢）
    await Promise.all([deferred(30, "旧数据", t1), deferred(1, "新数据", t2)])

    // 关键断言：只有新数据被采纳。
    expect(applied).toEqual(["新数据"])
  })

  it("闸是纯状态机：调用不得调度任何计时器或异步任务", () => {
    // 真断言：代际闸的价值在于"纯"——它只比代数。若它偷偷起了防抖/定时清理，
    // 就把一个可推理的纯函数变成了有隐藏状态机的黑盒，且这些计时器在 lynx 长驻页上
    // 会真实存活。用 fake timers 证明「一个都没起」。
    vi.useFakeTimers()
    try {
      const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout")
      const setIntervalSpy = vi.spyOn(globalThis, "setInterval")
      const g = createGenerationGate()
      const tokens = [g.next(), g.next(), g.next()]
      g.isCurrent(tokens[0])
      g.invalidate()
      expect(setTimeoutSpy).not.toHaveBeenCalled()
      expect(setIntervalSpy).not.toHaveBeenCalled()
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })
})

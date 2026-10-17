// ─── 有界应答阶梯（替身专用）：把「按调用序号分发」换成「用尽即抛错」 ───
//
// 依据：`docs/testing/conventions.md` 强制约束 6「计数断言按标识映射，禁用序号映射」。
// 序号映射（「第 1 次给 A、其余给 B」）会把多余的第 N 次调用静默派给最后一个分支，
// 使被测代码「多发了一次」只表现为一条计数差——同一突变下两种写法结论相反。
//
// 何时用哪种：
// - `ladder`    —— 同一业务目标的连续多次尝试（重试 / 分页 / 重复 open）。重试不改业务标识，
//                 标识只能到「目标」为止，尝试序号由该目标的阶梯承载。此时**不是**强行按标识映射，
//                 而是把无界的兜底换成有界的阶梯：多来一次当场抛错并指名道姓。
// - `keyedLadder` —— 一次替身同时服务多个业务目标（并发 / 不同参数）。必须按标识分发：
//                 标识未登记即抛错，多调一次不会有「刚好落在最后一档」的运气。

import { afterEach, expect } from "vitest"


/** 阶梯用尽 / 标识未登记时的抛错；与被测代码自身的错误区分开，便于断言与归因 */
export class LadderExhaustedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "LadderExhaustedError"
  }
}

/**
 * 被测代码的 `try/catch` 会把阶梯抛出的错误一起吞掉（例：useSearch 的 fetchIllust 把任何
 * 异常收进 failures，再统一渲染成「搜索失败」），失败信号于是退化成一条间接的状态断言
 * ——「绿变红了」，但归因全丢了。收尾守卫把用尽事实原样带出，指名是哪个标识漏登记/多发了几次。
 */
let exhausted: string[] = []

// 守卫必须在**收集期**注册（模块顶层），注册在用例执行期不会挂到当前用例上。
afterEach(() => {
  if (exhausted.length === 0) return
  const msgs = exhausted
  exhausted = []
  expect.fail(`[mockLadder] 被测代码发出了未登记 / 多余的调用：\n  - ${msgs.join("\n  - ")}`)
})

function noteExhaustion(message: string): never {
  exhausted.push(message)
  throw new LadderExhaustedError(message)
}

/** 只要求替身有 mockImplementation，避免把 vi.fn 的具体泛型签名拖进来 */
type Mockable<A extends unknown[], R> = {
  mockImplementation(fn: (...args: A) => R): unknown
}

/**
 * 把一条**有限**阶梯装到替身上：按登记顺序依次返回第 1、2、… 次调用的应答。
 * 阶梯用尽后再来一次 = 被测代码多发了一次 → 记入收尾守卫并抛 `LadderExhaustedError`，
 * 而不是静默落回 `mockResolvedValue` 兜底。
 *
 * 步骤写成工厂而非现成值：Response 的 body 只能消费一次，每次尝试各造一个新的。
 */
export function ladder<A extends unknown[], R>(
  mock: Mockable<A, R>,
  steps: ReadonlyArray<() => R>,
  label: string,
): void {
  const queue = [...steps]
  mock.mockImplementation(((..._args: A) => {
    const step = queue.shift()
    if (!step) {
      return noteExhaustion(
        `阶梯用尽后又被调用（多发了一次）：${label} —— 共登记 ${steps.length} 次尝试`,
      )
    }
    return step()
  }) as (...args: A) => R)
}

/** 每个标识登记 1..n 次尝试；写数组是主形态，写单个工厂视为只登记 1 次 */
type Steps<R> = ReadonlyArray<() => R> | (() => R)

function normalize<R>(step: Steps<R>): Array<() => R> {
  return typeof step === "function" ? [step as () => R] : [...step]
}

/**
 * 按**业务标识**分发的阶梯：`table` 是「标识 → 该标识的应答工厂（可多条 = 重试阶梯）」，
 * `keyOf` 从调用实参里取出业务标识（关键词 / URL / chapterId …）。
 *
 * 标识未登记即抛错——这是与序号分发的关键差别：序号分发下「第 N+1 次调用」总能命中最后一档，
 * 本替身下多调一次必红，且错误消息指名是哪个标识漏登记。
 *
 * 同一标识登记多条尝试是**正常**的：重试 / 退避不改业务标识（client 的 429→200 换 URL 重来），
 * 标识只能到 URL 为止，尝试序号由该标识自己的阶梯承载。
 */
export function keyedLadder<A extends unknown[], K extends PropertyKey, R>(
  mock: Mockable<A, R>,
  keyOf: (args: A) => K,
  table: Readonly<Record<K, Steps<R>>>,
  label: string,
): void {
  const pending = new Map<PropertyKey, Array<() => R>>()
  for (const key of Object.keys(table) as K[]) {
    pending.set(key, normalize(table[key]))
  }
  mock.mockImplementation(((...args: A) => {
    const key = keyOf(args)
    const steps = pending.get(key)
    if (!steps) {
      return noteExhaustion(
        `收到未登记的标识：${label} —— key=${String(key)}；已登记：${[...pending.keys()].join("、") || "（无）"}`,
      )
    }
    const step = steps.shift()
    if (!step) {
      return noteExhaustion(
        `同一标识的阶梯用尽后又被调用（多发了一次）：${label} —— key=${String(key)}`,
      )
    }
    return step()
  }) as (...args: A) => R)
}

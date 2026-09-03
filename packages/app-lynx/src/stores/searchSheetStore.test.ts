// searchSheetStore 单测（issue #293 T3）：open/close 幂等 + modalStack 注册/注销联动。
// 期望值溯源：
// - 开合语义（全局单例、registerModal(closeSearch)、注销函数保存并调用、幂等）
//   → spec `docs/specs/app-lynx-global-search.md` D4 + glossary「弹层全局单例」
// - 返回键弹层优先关闭 → 先例 `components/CommentOverlay.vue`（onMounted 注册 /
//   onBeforeUnmount 注销）+ `stores/modalStack.ts`（closeTopModal 后进先出）
// - spy 而非 mock：保留真实 modalStack store，用 hasOpenModal() 观测「注册/注销函数
//   是否被正确调用」（栈内是否存在回调），避免只断言调用次数而漏掉注销行为。
// Pinia 化（ADR-0139/T2）：setActivePinia(createPinia()) 每用例隔离（替代 resetXxxForTest）；
// store 属性访问（store.isOpen / store.openSearch 等）替代模块顶层具名导出。
// 回调引用断言：Pinia 化后 closeSearch 是 store action 引用，每次 useStore 调用
// 返回同一实例，引用稳定——直接 expect(registerSpy.mock.calls[0][0]).toBe(store.closeSearch)。
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest"
import type { MockInstance } from "vitest"
import { setActivePinia, createPinia } from "pinia"
import { useModalStack } from "./modalStack"
import { useSearchSheetStore } from "./searchSheetStore"

let registerSpy: MockInstance<(close: () => void) => () => void>
let sheet: ReturnType<typeof useSearchSheetStore>
let stack: ReturnType<typeof useModalStack>

beforeEach(() => {
  setActivePinia(createPinia())
  sheet = useSearchSheetStore()
  stack = useModalStack()
  // 清理上一用例残留（幂等：未打开时 closeSearch 为 no-op）
  sheet.closeSearch()
  // spy Pinia 实例方法（store 已就位，方法挂在实例原型链上可被 spy 替换）
  registerSpy = vi.spyOn(stack, "registerModal")
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe("searchSheetStore — 开合语义（spec D4）", () => {
  it("初始 isOpen=false 且未注册 modal", () => {
    expect(sheet.isOpen).toBe(false)
    expect(stack.hasOpenModal()).toBe(false)
    expect(registerSpy).not.toHaveBeenCalled()
  })

  it("openSearch 打开弹层并注册关闭回调（参数为 closeSearch）", () => {
    sheet.openSearch()
    expect(sheet.isOpen).toBe(true)
    expect(registerSpy).toHaveBeenCalledTimes(1)
    // Pinia setup store 的 action 在 store 实例上会被包装（wrappedAction），
    // 但注册到 modalStack 的是 setup 内定义的原始 closeSearch 闭包。
    // 行为等价断言：调用注册回调 → 弹层关闭（说明注册的就是 closeSearch 本体）。
    expect(stack.hasOpenModal()).toBe(true)
    const registered = registerSpy.mock.calls[0][0]
    expect(typeof registered).toBe("function")
    expect(sheet.isOpen).toBe(true)
    registered()
    expect(sheet.isOpen).toBe(false)
  })

  it("openSearch 幂等：重复打开不重复注册（堆栈仅一份）", () => {
    sheet.openSearch()
    sheet.openSearch()
    expect(sheet.isOpen).toBe(true)
    expect(registerSpy).toHaveBeenCalledTimes(1)
    expect(stack.hasOpenModal()).toBe(true)
  })

  it("closeSearch 关闭弹层并注销注册（返回键栈随之清空）", () => {
    sheet.openSearch()
    expect(stack.hasOpenModal()).toBe(true)
    sheet.closeSearch()
    expect(sheet.isOpen).toBe(false)
    expect(stack.hasOpenModal()).toBe(false)
  })

  it("closeSearch 幂等：重复关闭为 no-op（不重复注销、不抛错）", () => {
    sheet.openSearch()
    sheet.closeSearch()
    sheet.closeSearch()
    expect(sheet.isOpen).toBe(false)
    expect(stack.hasOpenModal()).toBe(false)
  })

  it("返回键（closeTopModal）优先关闭弹层：isOpen=false 且栈清空", () => {
    sheet.openSearch()
    stack.closeTopModal()
    expect(sheet.isOpen).toBe(false)
    expect(stack.hasOpenModal()).toBe(false)
  })

  it("关闭后再开：重新注册（开合循环）", () => {
    sheet.openSearch()
    sheet.closeSearch()
    sheet.openSearch()
    expect(registerSpy).toHaveBeenCalledTimes(2)
    expect(sheet.isOpen).toBe(true)
    expect(stack.hasOpenModal()).toBe(true)
  })
})

describe("searchSheetStore — 预填词（ADR-0133 决策 2）", () => {
  it("openSearch 带词：prefillKeyword 可读（组件 onMounted 消费入口）", () => {
    sheet.openSearch("初音ミク")
    expect(sheet.prefillKeyword).toBe("初音ミク")
  })

  it("openSearch 无参：prefillKeyword 为空（FAB 入口不带词，行为不变）", () => {
    sheet.openSearch()
    expect(sheet.prefillKeyword).toBe("")
  })

  it("consumePrefillKeyword 读取并清空（一次性消费：防弹层卸载重挂后残留旧词）", () => {
    sheet.openSearch("風景")
    expect(sheet.consumePrefillKeyword()).toBe("風景")
    expect(sheet.prefillKeyword).toBe("")
    // 再消费 → 空串（幂等）
    expect(sheet.consumePrefillKeyword()).toBe("")
  })

  it("closeSearch 清空预填词（双保险：未消费即关闭不留残渣）", () => {
    sheet.openSearch("うみ")
    sheet.closeSearch()
    expect(sheet.prefillKeyword).toBe("")
  })

  it("closeSearch 时不调用 consumePrefillKeyword 也不会残留（关闭即清）", () => {
    sheet.openSearch("星")
    sheet.closeSearch()
    sheet.openSearch()
    expect(sheet.prefillKeyword).toBe("")
    expect(sheet.consumePrefillKeyword()).toBe("")
  })

  it("幂等开合下预填词不串：close → 再 open 带新词 → 消费为新词", () => {
    sheet.openSearch("旧词")
    sheet.closeSearch()
    sheet.openSearch("新词")
    expect(sheet.consumePrefillKeyword()).toBe("新词")
  })
})

// searchSheetStore 单测（issue #293 T3）：open/close 幂等 + modalStack 注册/注销联动。
// 期望值溯源：
// - 开合语义（全局单例、registerModal(closeSearch)、注销函数保存并调用、幂等）
//   → spec `docs/specs/app-lynx-global-search.md` D4 + glossary「弹层全局单例」
// - 返回键弹层优先关闭 → 先例 `components/CommentOverlay.vue`（onMounted 注册 /
//   onBeforeUnmount 注销）+ `stores/modalStack.ts`（closeTopModal 后进先出）
// - spy 而非 mock：保留真实 modalStack，用 hasOpenModal() 观测「注册/注销函数
//   是否被正确调用」（栈内是否存在回调），避免只断言调用次数而漏掉注销行为。
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest"
import type { MockInstance } from "vitest"
import * as modalStack from "./modalStack"
import { closeSearch, consumePrefillKeyword, isOpen, openSearch, prefillKeyword } from "./searchSheetStore"

let registerSpy: MockInstance<typeof modalStack.registerModal>

beforeEach(() => {
  // 清理上一用例残留（幂等：未打开时 closeSearch 为 no-op）
  closeSearch()
  registerSpy = vi.spyOn(modalStack, "registerModal")
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe("searchSheetStore — 开合语义（spec D4）", () => {
  it("初始 isOpen=false 且未注册 modal", () => {
    expect(isOpen.value).toBe(false)
    expect(modalStack.hasOpenModal()).toBe(false)
    expect(registerSpy).not.toHaveBeenCalled()
  })

  it("openSearch 打开弹层并注册关闭回调（参数为 closeSearch）", () => {
    openSearch()
    expect(isOpen.value).toBe(true)
    expect(registerSpy).toHaveBeenCalledTimes(1)
    expect(registerSpy).toHaveBeenCalledWith(closeSearch)
    expect(modalStack.hasOpenModal()).toBe(true)
  })

  it("openSearch 幂等：重复打开不重复注册（堆栈仅一份）", () => {
    openSearch()
    openSearch()
    expect(isOpen.value).toBe(true)
    expect(registerSpy).toHaveBeenCalledTimes(1)
    expect(modalStack.hasOpenModal()).toBe(true)
  })

  it("closeSearch 关闭弹层并注销注册（返回键栈随之清空）", () => {
    openSearch()
    expect(modalStack.hasOpenModal()).toBe(true)
    closeSearch()
    expect(isOpen.value).toBe(false)
    expect(modalStack.hasOpenModal()).toBe(false)
  })

  it("closeSearch 幂等：重复关闭为 no-op（不重复注销、不抛错）", () => {
    openSearch()
    closeSearch()
    closeSearch()
    expect(isOpen.value).toBe(false)
    expect(modalStack.hasOpenModal()).toBe(false)
  })

  it("返回键（closeTopModal）优先关闭弹层：isOpen=false 且栈清空", () => {
    openSearch()
    modalStack.closeTopModal()
    expect(isOpen.value).toBe(false)
    expect(modalStack.hasOpenModal()).toBe(false)
  })

  it("关闭后再开：重新注册（开合循环）", () => {
    openSearch()
    closeSearch()
    openSearch()
    expect(registerSpy).toHaveBeenCalledTimes(2)
    expect(isOpen.value).toBe(true)
    expect(modalStack.hasOpenModal()).toBe(true)
  })
})

describe("searchSheetStore — 预填词（ADR-0133 决策 2）", () => {
  it("openSearch 带词：prefillKeyword 可读（组件 onMounted 消费入口）", () => {
    openSearch("初音ミク")
    expect(prefillKeyword.value).toBe("初音ミク")
  })

  it("openSearch 无参：prefillKeyword 为空（FAB 入口不带词，行为不变）", () => {
    openSearch()
    expect(prefillKeyword.value).toBe("")
  })

  it("consumePrefillKeyword 读取并清空（一次性消费：防弹层卸载重挂后残留旧词）", () => {
    openSearch("風景")
    expect(consumePrefillKeyword()).toBe("風景")
    expect(prefillKeyword.value).toBe("")
    // 再消费 → 空串（幂等）
    expect(consumePrefillKeyword()).toBe("")
  })

  it("closeSearch 清空预填词（双保险：未消费即关闭不留残渣）", () => {
    openSearch("うみ")
    closeSearch()
    expect(prefillKeyword.value).toBe("")
  })

  it("closeSearch 时不调用 consumePrefillKeyword 也不会残留（关闭即清）", () => {
    openSearch("星")
    closeSearch()
    openSearch()
    expect(prefillKeyword.value).toBe("")
    expect(consumePrefillKeyword()).toBe("")
  })

  it("幂等开合下预填词不串：close → 再 open 带新词 → 消费为新词", () => {
    openSearch("旧词")
    closeSearch()
    openSearch("新词")
    expect(consumePrefillKeyword()).toBe("新词")
  })
})

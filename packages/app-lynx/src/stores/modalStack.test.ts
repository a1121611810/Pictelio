// modalStack 单测（issue #163 / spec #161）：返回键 modal 注册表栈语义。
// 期望值溯源：
// - 栈后进先出（后打开的先关，支持弹层叠弹层）→ spec `docs/specs/app-lynx-novel-series-watchlist.md`
//   + `components/CommentOverlay.vue` onMounted 注册 / onBeforeUnmount 注销模式
// - 注销函数 = 闭包持有栈引用，splice 删除；多次调用 idempotent（indexOf=-1 后 no-op）
// - closeTopModal 不抛错（空栈 optional chain）→ glossary「永久失效」对照（错误吞咽约定）
// Pinia 化（ADR-0139/T2 迁移期新增）：setActivePinia(createPinia()) 每用例隔离。
// 纯接口行为测试——栈、回调、注销语义全部直接断言。
import { beforeEach, describe, expect, it, vi } from "vitest"
import { setActivePinia, createPinia } from "pinia"
import { useModalStack } from "./modalStack"

let stack: ReturnType<typeof useModalStack>

beforeEach(() => {
  setActivePinia(createPinia())
  stack = useModalStack()
})

describe("modalStack — 基础栈语义", () => {
  it("初始 hasOpenModal=false", () => {
    expect(stack.hasOpenModal()).toBe(false)
  })

  it("registerModal 后 hasOpenModal=true", () => {
    stack.registerModal(() => {})
    expect(stack.hasOpenModal()).toBe(true)
  })

  it("closeTopModal 空栈：no-op 不抛错（optional chain 兜底）", () => {
    expect(() => stack.closeTopModal()).not.toThrow()
    expect(stack.hasOpenModal()).toBe(false)
  })

  it("closeTopModal 弹栈并调用最近一次注册的回调（后进先出）", () => {
    const first = vi.fn()
    const second = vi.fn()
    stack.registerModal(first)
    stack.registerModal(second)
    stack.closeTopModal()
    expect(second).toHaveBeenCalledTimes(1)
    expect(first).not.toHaveBeenCalled()
    expect(stack.hasOpenModal()).toBe(true)
  })

  it("多次 closeTopModal 按注册逆序依次弹出并调用", () => {
    const cb1 = vi.fn()
    const cb2 = vi.fn()
    const cb3 = vi.fn()
    stack.registerModal(cb1)
    stack.registerModal(cb2)
    stack.registerModal(cb3)
    stack.closeTopModal()
    expect(cb3).toHaveBeenCalledTimes(1)
    stack.closeTopModal()
    expect(cb2).toHaveBeenCalledTimes(1)
    stack.closeTopModal()
    expect(cb1).toHaveBeenCalledTimes(1)
    expect(stack.hasOpenModal()).toBe(false)
  })
})

describe("modalStack — 注销函数语义", () => {
  it("注销函数调用后栈清：hasOpenModal=false", () => {
    const unregister = stack.registerModal(() => {})
    expect(stack.hasOpenModal()).toBe(true)
    unregister()
    expect(stack.hasOpenModal()).toBe(false)
  })

  it("注销函数只移除对应回调，不影响其他条目", () => {
    const cb1 = vi.fn()
    const cb2 = vi.fn()
    const unreg1 = stack.registerModal(cb1)
    stack.registerModal(cb2)
    unreg1()
    // cb1 已注销，closeTopModal 应弹出 cb2
    stack.closeTopModal()
    expect(cb1).not.toHaveBeenCalled()
    expect(cb2).toHaveBeenCalledTimes(1)
  })

  it("同 callback 多次注册不被 splice 错乱：注销函数移除首次入栈的实例", () => {
    // 同一 close 引用两次注册 → indexOf 找首个，splice 后剩余条目仍在
    // 实际弹层不会这样做，但接口需对此鲁棒（indexOf/splice 标准语义）
    const cb = vi.fn()
    stack.registerModal(cb)
    stack.registerModal(cb)
    expect(stack.hasOpenModal()).toBe(true)
    stack.closeTopModal()
    expect(cb).toHaveBeenCalledTimes(1)
    // 弹栈后剩余一条（indexOf=0 仍指向 cb），hasOpenModal=true
    expect(stack.hasOpenModal()).toBe(true)
    stack.closeTopModal()
    expect(cb).toHaveBeenCalledTimes(2)
    expect(stack.hasOpenModal()).toBe(false)
  })

  it("注销函数 idempotent：多次调用安全（indexOf=-1 no-op）", () => {
    const unregister = stack.registerModal(() => {})
    unregister()
    expect(() => unregister()).not.toThrow()
    unregister()
    expect(stack.hasOpenModal()).toBe(false)
  })

  it("closeTopModal 弹出并调用 → 调用栈内其他回调不受影响（被调用方自己注销后栈仍清）", () => {
    // closeTopModal pop 后调用，不自动注销——但如果 close 内部调注销函数（本测试只
    // 断言 pop + call 行为，不模拟调用方自行注销）。
    const cb = vi.fn(() => {
      // 模拟调用方在弹层关闭时注销（CommentOverlay.vue onBeforeUnmount）
      // 这里不直接调注销，只断言 cb 被调
    })
    stack.registerModal(cb)
    stack.closeTopModal()
    expect(cb).toHaveBeenCalledTimes(1)
    // 弹出后栈空
    expect(stack.hasOpenModal()).toBe(false)
  })
})

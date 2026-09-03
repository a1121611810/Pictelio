// ─── vue-router 迁移锚点测试（ADR-0138 / spec #329 / tickets #330-335） ───
// 期望值出处：官方 API 文档语义（RouterHistory.go triggerListeners/location）+
// prototype/lynx-vue-router 分支双端探针实证（docs/research/vue-router-migration-feasibility.md 第 16-22 行）。
// oracle 非实现反推：hasBackEntryIn 行为以 vue-router memory history 官方语义为准。
import { describe, it, expect, vi } from 'vitest'
import { createMemoryHistory } from 'vue-router'
import { hasBackEntryIn, decideRequiresAuth } from '../src/routerCore'

describe('hasBackEntryIn（官方 API 探测，ADR-0138 决策 3）', () => {
  // 锚定语义：生产用 router.replace 定起点（memory history 初始 nowhere 被替换掉，
  // 队列无 START 残留——push 定起点则会保留 START（nowhere 条目）作为"上一页"，本探测会判 true，
  // 故根路由锚定必须用 replace（探针/ADR-0138 决策 7 已定义）。
  it('初始（replace 定起点）无上一页', () => {
    const h = createMemoryHistory()
    h.replace('/recommended', {})
    expect(hasBackEntryIn(h)).toBe(false)
  })

  it('push 一次后存在上一页；再 push 仍存在（replace 锚定）', () => {
    const h = createMemoryHistory()
    h.replace('/', {})
    expect(hasBackEntryIn(h)).toBe(false)
    h.push('/detail/42', {})
    expect(hasBackEntryIn(h)).toBe(true)
    h.push('/detail/7', {})
    expect(hasBackEntryIn(h)).toBe(true)
  })

  it('back 回根后无上一页；replace 当前条目不影响判定', () => {
    const h = createMemoryHistory()
    h.replace('/recommended', {})
    h.push('/detail/42', {})
    h.go(-1)
    expect(hasBackEntryIn(h)).toBe(false)
    // replace（如登录替换）不新增条目
    h.push('/bookmarks', {})
    expect(hasBackEntryIn(h)).toBe(true)
    h.replace('/me', {})
    expect(hasBackEntryIn(h)).toBe(true)
  })

  it('探测无副作用：location 还原、不触发监听', () => {
    const h = createMemoryHistory()
    h.push('/recommended', {})
    h.push('/detail/42', {})
    const listener = vi.fn()
    h.listen(listener)
    const before = h.location
    const canBack = hasBackEntryIn(h)
    expect(canBack).toBe(true)
    expect(h.location).toBe(before)
    expect(listener).not.toHaveBeenCalled()
  })

  it('根路由（replace 定起点后队列重新锚定）探测 false', () => {
    const h = createMemoryHistory()
    // replace 起点在队列中的条目的 state 停留于 { }；锚定后无 START 条目
    h.replace('/recommended', {})
    expect(hasBackEntryIn(h)).toBe(false)
    h.push('/illusts', {})
    expect(hasBackEntryIn(h)).toBe(true)
  })
})

describe('decideRequiresAuth（全局守卫三态，Q3 探针实证规则）', () => {
  it('非业务页（无 requiresAuth）恒放行', () => {
    expect(decideRequiresAuth(false, false, false, false)).toBe(true)
    expect(decideRequiresAuth(false, true, true, true)).toBe(true)
  })

  it('bootstrap 期放行（首帧先渲染；守卫不 await 网络）', () => {
    expect(decideRequiresAuth(true, true, false, false)).toBe(true)
    expect(decideRequiresAuth(true, true, true, false)).toBe(true)
  })

  it('bootstrap 后未登录 → 重定向 /login（replace 语义）', () => {
    expect(decideRequiresAuth(true, false, false, false)).toEqual({ path: '/login', replace: true })
  })

  it('bootstrap 后会话清除（登出）→ 重定向 /login，即使 isLoggedIn 仍在', () => {
    expect(decideRequiresAuth(true, false, true, true)).toEqual({ path: '/login', replace: true })
  })

  it('bootstrap 后已登录 + 会话有效 → 放行', () => {
    expect(decideRequiresAuth(true, false, false, true)).toBe(true)
  })
})

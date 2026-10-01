// ─── GlobalFab 在沉浸态下必须让位（#887 真机验证发现的缺口）───
//
// 缺口来源：真机（emulator-5554）进入沉浸态后，**全局搜索 FAB 仍悬浮在画上**。
// 根因：`GlobalFab` 挂在 `App.vue` 的 KeepAlive 之外，拿不到详情页本地的 `chromeHidden`。
// 违反 ADR-0213 决策 3「隐藏态不留任何可见 chrome」。
//
// 判据形态：源级模板断言（与本仓既有 `*.template.test.ts` 同款）——
// Lynx 的组件树无法在 vitest 里挂载，源级断言是本仓既有的既定做法。
//
// 期望值出处（Oracle 溯源，禁从实现反推）：
// - 「沉浸态 ⇒ FAB 不渲染」= ADR-0213 决策 3「隐藏态不留任何可见 chrome」；
// - 「FAB 仍须消费它自己的 store 可见性」= `GlobalFab` 既有契约
//   （文件头注：「`view.visible` 决定显隐」），本票**不得**把这条替换掉。
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const SRC = readFileSync(fileURLToPath(new URL('./GlobalFab.vue', import.meta.url)), 'utf8')

/** 取 `v-if="…"` 的表达式文本（模板里第一个带 v-if 的元素） */
function rootVIf(): string {
  const m = SRC.match(/<view[^>]*v-if="([^"]+)"/s)
  if (!m?.[1]) throw new Error('未在 GlobalFab 根元素上找到 v-if 绑定')
  return m[1]
}

describe('GlobalFab · 沉浸态让位', () => {
  it('根元素的渲染条件同时受「自身可见性」与「全局沉浸抑制」约束', () => {
    const cond = rootVIf()
    // 不得丢掉既有的自身可见性判据（否则 FAB 会在不该出现的路由上常驻）
    expect(cond).toMatch(/view\.visible/)
    // 必须叠加全局沉浸抑制
    expect(cond).toMatch(/chromeSuppressed/)
  })

  it('组件消费全局沉浸标志，而不是页面本地的 chromeHidden', () => {
    // 页面本地 ref 在此不可达（KeepAlive 之外），用它会永远是 undefined ⇒ 恒不生效
    expect(SRC).not.toMatch(/useImmersiveChrome\(\)\s*\.?\s*chromeHidden/)
    expect(SRC).toMatch(/import\s*\{[^}]*chromeSuppressed[^}]*\}\s*from\s*'\.\.\/composables\/useImmersiveChrome'/)
  })
})

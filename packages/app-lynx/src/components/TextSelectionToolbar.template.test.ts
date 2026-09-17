// 选中操作菜单视图的源级守卫（spec docs/specs/app-lynx-novel-text-selection.md §ID 4 / §Testing Decisions）。
// oracle：① 视觉选定 = 原型方案 E + 图标 I1（浅色 M3 浮层 + **view 绘制的线性图标**，禁回退 emoji/字形）；
// ② 尺寸来自 selectionToolbarGeometry 常量（「量=画」同源，避免定位与渲染漂移）；
// ③ 可见性由 `view.visible && view.style` 双条件守卫（页面忘写 v-if 也不出幽灵层）；
// ④ 不铺全屏层（ADR-0123 命中测试）；a11y label/element 成对（ADR-0061）。
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const src = readFileSync(fileURLToPath(new URL('./TextSelectionToolbar.vue', import.meta.url)), 'utf8')
const code = src.replace(/<!--[\s\S]*?-->/g, '').replace(/^\s*\/\/.*$/gm, '')

describe('TextSelectionToolbar · 视觉与契约', () => {
  it('可见性双条件守卫（visible + style）', () => {
    expect(code).toContain('v-if="view.visible && view.style"')
  })

  it('尺寸取自几何常量（量=画同源），不硬编码条目宽高', () => {
    expect(code).toContain('TOOLBAR_ITEM_VW')
    expect(code).toContain('TOOLBAR_PADDING_H_VW')
    expect(code).not.toMatch(/width:\s*'1[0-9.]+vw'/u)
  })

  it('视觉令牌锁定（选定方案 E：浅色浮层 + elevation-3 + 绝对定位胶囊）', () => {
    expect(code).toContain('bg-surface-container-high')
    expect(code).toContain('shadow-[var(--md-elevation-3)]')
    expect(code).toContain('absolute')
    expect(code).toContain('rounded-[var(--md-shape-medium)]')
  })

  it('条目不冒泡（@tap.stop：否则胶囊内点击会触发页面根的 tap-away 收起）', () => {
    expect(code).toContain('@tap.stop')
    expect(code).toContain('@tap.stop\n') // 胶囊级
  })

  it('图标用 view 绘制（border/rotate），禁 emoji 或字形回退', () => {
    expect(code).toContain('border-solid border-on-surface')
    expect(code).toContain('rotate-45')
    expect(src).not.toMatch(/[📋🔍✂↗]/u)
  })

  it('不铺全屏层（ADR-0123：原生 hit-testing 不认 pointer-events）', () => {
    expect(code).not.toContain('inset-0')
    expect(code).not.toContain('pointer-events')
    expect(code).not.toContain('<style')
  })

  it('a11y：label 与 element 成对出现', () => {
    const labels = (code.match(/accessibility-label=/g) ?? []).length
    const elements = (code.match(/accessibility-element=/g) ?? []).length
    expect(labels).toBeGreaterThanOrEqual(1)
    expect(elements).toBe(labels)
  })

  it('动作只报 key（语义留在会话，组件零决策）', () => {
    expect(code).toContain("emit('action'")
  })
})

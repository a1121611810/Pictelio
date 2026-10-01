// 选中操作菜单视图的源级守卫（spec docs/specs/app-lynx-novel-text-selection.md §ID 4 / §Testing Decisions）。
// oracle：① 视觉选定 = 原型方案 E + 图标 I1（浅色 M3 浮层 + 图标在上文字在下，禁回退 emoji/字形）；
// ② 尺寸来自 selectionToolbarGeometry 常量（「量=画」同源，避免定位与渲染漂移）；
// ③ 可见性由 `view.visible && view.style` 双条件守卫（页面忘写 v-if 也不出幽灵层）；
// ④ 不铺全屏层（ADR-0123 命中测试）；a11y label/element 成对（ADR-0061）；
// ⑤ 「复制」图标位必须经 <AppIcon name="content_copy">（ADR-0208 决策 5：手绘矩形已删）。
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

  it('条目不冒泡（@tap.stop：胶囊与条目两级都要，否则会触发页面根的 tap-away）', () => {
    const stops = code.match(/@tap\.stop/g) ?? []
    expect(stops.length).toBeGreaterThanOrEqual(2)
    expect(code).toMatch(/@tap\.stop[\s>]/u) // 胶囊级（无值形式）
    expect(code).toContain("@tap.stop=\"emit('action'") // 条目级
  })

  it('「复制」图标走 <AppIcon name="content_copy">，手绘矩形已删（ADR-0208 决策 5）', () => {
    // 逐字锁死整个标签：name（码点查表的键）、:size（16sp=4.2667vw，与手绘版
    // 4.9vw 盒内 ≈3.2vw 墨迹视觉等价）、class（承接原 border-on-surface 描边色）、
    // v-if（仍按 item.key 分派，两分支相邻 ⇒ v-else 保持"非 copy 即搜索"）。
    // 任一项被改写（例如尺寸漂成默认 6.4vw、或回退成手绘 <view>）都会转红。
    expect(
      code.match(/<AppIcon\s+v-if="item\.key === 'copy'"[^>]*>/)?.[0],
      "copy 分支必须是 <AppIcon name=\"content_copy\">；ADR-0208 决策 5 要求「有对应字形 ⇒ 直接替换，删掉手绘代码」",
    ).toBe(`<AppIcon v-if="item.key === 'copy'" name="content_copy" :size="4.2667" class="text-on-surface" />`)
    expect(code).toContain("import AppIcon from './AppIcon.vue'")
    // 反向：手绘「复制」的两个绝对定位矩形（ADR 决策 5 点名的缺陷形态）不得复建。
    // 逐字比对偏移量而非「不匹配某个类名」——类名可换写法，缺陷形态（copy 分支是
    // 绝对定位描边矩形）换不掉。
    expect(code, 'copy 分支仍是手绘描边矩形 ⇒ ADR-0208 决策 5 未落地').not.toContain(
      `v-if="item.key === 'copy'" class="relative`,
    )
    expect(code).not.toContain('left-[1.5vw]')
    expect(code).not.toContain('top-[1.5vw]')
  })

  it('「搜索」图标仍是 view 绘制（border/rotate），禁 emoji 或字形回退', () => {
    // ADR-0208 决策 5 的手绘替换范围只写了「复制」，搜索项本轮不动：它没有登记字形，
    // 替换要连带登记 iconMap + 重跑子集字体。禁 emoji/字形回退的纪律对两个分支都成立。
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

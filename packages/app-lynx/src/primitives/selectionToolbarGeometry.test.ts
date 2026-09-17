// 选中菜单定位纯函数单测（spec docs/specs/app-lynx-novel-text-selection.md §ID 5）。
// oracle：① spec 定位规则（水平居中 → 夹取；上方优先 → 顶部越界翻转到下方）；
// ② 设备实证的 vw 口径（1 = 1% 内容宽；dp→vw 在适配器层，本层不接触 dp——坑 5 复盘）。
import { describe, expect, it } from 'vitest'
import {
  selectionToolbarGeometry,
  TOOLBAR_HEIGHT_VW,
  TOOLBAR_ITEM_VW,
  TOOLBAR_OFFSET_GAP_VW,
  TOOLBAR_WIDTH_VW,
} from './selectionToolbarGeometry'

describe('selectionToolbarGeometry', () => {
  it('浮层尺寸常量自洽：宽 = 两条目 + 间距 + 内边距；高 = 条目 + 上下内边距', () => {
    // 手写字面量交叉核对（改常量必须同时改这里，防静默漂移）
    expect(TOOLBAR_ITEM_VW).toBe(12.2)
    expect(TOOLBAR_WIDTH_VW).toBeCloseTo(27.8, 5)
    expect(TOOLBAR_HEIGHT_VW).toBeCloseTo(14.8, 5)
  })

  it('选区在屏幕中部 → 置于上方，水平居中于选区，translate 上移自身高度', () => {
    const g = selectionToolbarGeometry({ rectVw: { left: 40, top: 50, width: 20, height: 3 } })
    expect(g.placement).toBe('above')
    // 中心 50 → 左缘 50 - 13.9 = 36.1
    expect(g.leftVw).toBeCloseTo(36.1, 5)
    expect(g.topVw).toBeCloseTo(50 - TOOLBAR_OFFSET_GAP_VW, 5)
    expect(g.style.transform).toBe('translate(0, -100%)')
  })

  it('选区贴近顶部 → 翻转到下方（top = 选区下沿 + 间隙，无上移）', () => {
    const g = selectionToolbarGeometry({ rectVw: { left: 10, top: 5, width: 10, height: 3 } })
    expect(g.placement).toBe('below')
    expect(g.topVw).toBeCloseTo(5 + 3 + TOOLBAR_OFFSET_GAP_VW, 5)
    expect(g.style.transform).toBe('translate(0, 0)')
  })

  it('左贴边 / 右贴边 → 夹取到内容区内（不越界）', () => {
    const left = selectionToolbarGeometry({ rectVw: { left: 0, top: 40, width: 2, height: 3 } })
    expect(left.leftVw).toBe(0)
    const right = selectionToolbarGeometry({ rectVw: { left: 98, top: 40, width: 2, height: 3 } })
    expect(right.leftVw).toBeCloseTo(100 - TOOLBAR_WIDTH_VW, 5)
  })

  it('嵌套容器（内容宽不足 100 的场景由输入 vw 体现）：间隙参数可覆盖', () => {
    const g = selectionToolbarGeometry({
      rectVw: { left: 40, top: 50, width: 20, height: 3 },
      gapVw: 4,
    })
    expect(g.topVw).toBeCloseTo(46, 5)
  })
})

import { describe, it, expect } from 'vitest'
import { calcNearestPage, clampOffset } from '../primitives/swiperMath'

// oracle = vue-lynx 教程《商品详情页图片轮播》语义（吸附最近页 / 边界钳制）。
// 纯函数，node 可测；与 mergeByTime.test.ts 同「深模块纯逻辑就近测试」惯例。

describe('calcNearestPage', () => {
  it('吸附到最近页：round(offset / itemWidth) * itemWidth', () => {
    expect(calcNearestPage(-150, 100)).toBe(-100) // -1.5 → JS Math.round 向 +∞ → -1 页（教程语义）
    expect(calcNearestPage(-140, 100)).toBe(-100) // -1.4 → -1 页
    expect(calcNearestPage(0, 100)).toBe(0)
    expect(calcNearestPage(-260, 100)).toBe(-300) // -2.6 距 -3 页更近
    expect(calcNearestPage(-250, 100)).toBe(-200) // -2.5 四舍五入到 -3？→ Math.round(-2.5) = -2（JS 向零取整）
  })

  it('非法输入返回 0（避免 NaN 污染 transform）', () => {
    expect(calcNearestPage(NaN, 100)).toBe(0)
    expect(calcNearestPage(-100, 0)).toBe(0)
    expect(calcNearestPage(-100, -1)).toBe(0)
    expect(calcNearestPage(Infinity, 100)).toBe(0)
  })
})

describe('clampOffset', () => {
  it('上界 0、下界 -(dataLength-1)*itemWidth，越界钳制', () => {
    // 5 条、宽 100：可滑范围 [-400, 0]
    expect(clampOffset(50, 5, 100)).toBe(0) // 正越界 → 0
    expect(clampOffset(-300, 5, 100)).toBe(-300) // 界内
    expect(clampOffset(-500, 5, 100)).toBe(-400) // 负越界 → 下界
    expect(clampOffset(0, 5, 100)).toBe(0)
  })

  it('单条/空数据：边界收敛到 0（无滑动空间）', () => {
    expect(clampOffset(-100, 1, 100)).toBe(0)
    expect(clampOffset(100, 1, 100)).toBe(0)
    expect(clampOffset(-100, 0, 100)).toBe(0)
  })

  it('非法输入返回 0', () => {
    expect(clampOffset(NaN, 5, 100)).toBe(0)
    expect(clampOffset(-100, 5, 0)).toBe(0)
    expect(clampOffset(-100, -1, 100)).toBe(0)
  })
})

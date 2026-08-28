import { describe, it, expect } from 'vitest'
import { calcNearestPage, calcSnapTarget, clampOffset } from '../primitives/swiperMath'

// oracle = vue-lynx 教程《商品详情页图片轮播》语义（吸附最近页 / 边界钳制）；
// calcSnapTarget 的 oracle = spec: app-lynx-recommended-carousel-polish-r2 §2.2/§3.1 + ADR-0118 决策 2
// （1/3 屏宽阈值 + fling 甩动，双向对称；未过阈值且低速回弹；fling 方向 = 速度方向）。
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

describe('calcSnapTarget（1/3 阈值 + fling，ADR-0118 决策 2）', () => {
  const W = 100

  it('阈值：拖过 1/3 屏宽松手翻页（-0.34×W → -W），未过回弹（-0.32×W → 0）', () => {
    expect(calcSnapTarget(-34, W)).toBe(-100)
    expect(calcSnapTarget(-32, W)).toBe(0)
  })

  it('双向对称：右滑过阈值 → 上一张（0.34×W → +W）；未过 → 回弹（0.32×W → 0）', () => {
    expect(calcSnapTarget(34, W)).toBe(100)
    expect(calcSnapTarget(32, W)).toBe(0)
  })

  it('fling：快甩短距离（位移 -0.2×W 但速度 -0.8 px/ms）→ 沿速度方向翻页 -W', () => {
    expect(calcSnapTarget(-20, W, { velocityPxPerMs: -0.8 })).toBe(-100)
  })

  it('慢拖未过阈值 + 低速 → 回弹（位移 -0.2×W、速度 -0.2）', () => {
    expect(calcSnapTarget(-20, W, { velocityPxPerMs: -0.2 })).toBe(0)
  })

  it('停稳页上快甩（offset 0 + 速度 -0.8）→ -W（fling 独立于位置）', () => {
    expect(calcSnapTarget(0, W, { velocityPxPerMs: -0.8 })).toBe(-100)
  })

  it('fling 方向 = 速度方向：右甩 +0.8 → +W（上一张）', () => {
    expect(calcSnapTarget(20, W, { velocityPxPerMs: 0.8 })).toBe(100)
  })

  it('过阈值时以位置方向为准（不叠加速度方向）：-0.34×W 且速度 +0.8 → 仍 -W', () => {
    // 位置已过 1/3（左滑），速度却向右——翻页方向跟随位置（拖到哪算哪）
    expect(calcSnapTarget(-34, W, { velocityPxPerMs: 0.8 })).toBe(-100)
  })

  it('非法输入返回 0（防 NaN 污染 transform，沿用 calcNearestPage 惯例）', () => {
    expect(calcSnapTarget(NaN, W)).toBe(0)
    expect(calcSnapTarget(-100, 0)).toBe(0)
    expect(calcSnapTarget(-100, -1)).toBe(0)
    expect(calcSnapTarget(Infinity, W)).toBe(0)
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

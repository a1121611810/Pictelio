// createLiquidElastic 单测（issue #97：liquid-glass-react 算法移植）
// 算法源：liquid-glass-react/src/index.tsx L360-428（activation zone / fadeIn / stretch / translate）
import { describe, expect, it } from "vitest"
import {
  createLiquidElastic,
  type ElasticRect,
  type ElasticPoint,
} from "./createLiquidElastic"

const rect: ElasticRect = { left: 100, top: 100, width: 200, height: 100 }
// 元素中心 (200, 150)

function touch(x: number, y: number): ElasticPoint {
  return { x, y }
}

describe("createLiquidElastic", () => {
  it("激活区外（距边缘 > 200px）返回 scale(1)", () => {
    const elastic = createLiquidElastic({ elasticity: 0.15 })
    // 中心正右方 400px：边缘距离 400-100=300 > 200
    expect(elastic.transform(touch(500, 150), rect)).toBe("scale(1)")
  })

  it("元素内部触点（边缘距离=0）fadeInFactor=1，产生最大拉伸", () => {
    const elastic = createLiquidElastic({ elasticity: 0.15 })
    const result = elastic.transform(touch(200, 150), rect) // 中心点
    // 中心点 centerDistance=0 → scale(1)（方向无定义）
    expect(result).toBe("scale(1)")
    // 元素内偏右：有方向有拉伸
    const right = elastic.transform(touch(280, 150), rect)
    expect(right).not.toBe("scale(1)")
    expect(right).toContain("scaleX(")
  })

  it("200px 激活区边界 fadeInFactor=0 → scale(1)", () => {
    const elastic = createLiquidElastic({ elasticity: 0.15 })
    // 右边缘 x=300，触点 x=500 → 边缘距离恰 200
    expect(elastic.transform(touch(500, 150), rect)).toBe("scale(1)")
    // 199px：生效
    expect(elastic.transform(touch(499, 150), rect)).not.toBe("scale(1)")
  })

  it("scaleX 下限 clamp 0.8", () => {
    // 超大 elasticity 制造极端拉伸
    const elastic = createLiquidElastic({ elasticity: 10 })
    const result = elastic.transform(touch(200, 250), rect) // 正下方边缘
    const m = /scaleX\(([\d.]+)\) scaleY\(([\d.]+)\)/.exec(result)
    expect(m).not.toBeNull()
    expect(Number(m![1])).toBeGreaterThanOrEqual(0.8)
    expect(Number(m![2])).toBeGreaterThanOrEqual(0.8)
  })

  it("elasticity=0 时任何触点都无效果", () => {
    const elastic = createLiquidElastic({ elasticity: 0 })
    expect(elastic.transform(touch(280, 150), rect)).toBe("scale(1)")
    expect(elastic.translate(touch(280, 150), rect)).toEqual({ x: 0, y: 0 })
  })

  it("translate 方向指向触点，量级 = 偏移 × elasticity × 0.1 × fadeIn", () => {
    const elastic = createLiquidElastic({ elasticity: 0.15 })
    // 触点 (280,150)：元素内，edgeDistance=0，fadeIn=1；中心 (200,150)
    const t = elastic.translate(touch(280, 150), rect)
    expect(t.x).toBeCloseTo(80 * 0.15 * 0.1 * 1, 5)
    expect(t.y).toBeCloseTo(0, 5)
  })

  it("水平触点拉伸 X 压缩 Y，垂直触点相反（方向性）", () => {
    const elastic = createLiquidElastic({ elasticity: 0.15 })
    const horizontal = /scaleX\(([\d.]+)\) scaleY\(([\d.]+)\)/.exec(
      elastic.transform(touch(280, 150), rect),
    )!
    expect(Number(horizontal[1])).toBeGreaterThan(1) // X 拉伸
    expect(Number(horizontal[2])).toBeLessThan(1) // Y 压缩

    const vertical = /scaleX\(([\d.]+)\) scaleY\(([\d.]+)\)/.exec(
      elastic.transform(touch(200, 230), rect),
    )!
    expect(Number(vertical[1])).toBeLessThan(1) // X 压缩
    expect(Number(vertical[2])).toBeGreaterThan(1) // Y 拉伸
  })
})

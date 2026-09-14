// computeAdaptiveTagFit 单测（ADR-0149 / spec docs/specs/app-lynx-adaptive-list-tags.md「测试决策」）。
// 期望值出处（oracle 溯源）：
// - 布局语义 = ADR-0149 决策 1（装得下全显 / 预留 +N 贪心 / 剩余宽 >= minPartial 放截断 chip / 其余 +N）；
// - 尺寸样例取自 ADR-0149 spike 真机实测（#R-18 w=46.33、#性别转换 w=67.67、plus w=34.33、container=330/350）；
// - gap 修正点 = ADR-0149 决策 6（webview 版漏算末位 gap），断言独立于实现（手算）。
import { describe, expect, it } from 'vitest'
import { computeAdaptiveTagFit, MIN_PARTIAL_WIDTH } from './adaptiveTagFit'

describe('computeAdaptiveTagFit', () => {
  it('空数组 → visible 0 / remaining 0 / partialWidth null', () => {
    expect(computeAdaptiveTagFit([], 34, 330, 4)).toEqual({ visible: 0, remaining: 0, partialWidth: null })
  })

  it('容器宽为 0 → 全部折叠、无截断 chip', () => {
    expect(computeAdaptiveTagFit([46, 67], 34, 0, 4)).toEqual({ visible: 0, remaining: 2, partialWidth: null })
  })

  it('全部装得下 → 全显示且无 +N（47+67+4=118 <= 200）', () => {
    expect(computeAdaptiveTagFit([46, 67], 34, 200, 4)).toEqual({ visible: 2, remaining: 0, partialWidth: null })
  })

  it('恰好装得下（边界相等）→ 全显示（46 + 4 + 67 = 117 <= 117）', () => {
    expect(computeAdaptiveTagFit([46, 67], 34, 117, 4)).toEqual({ visible: 2, remaining: 0, partialWidth: null })
  })

  it('真机样例 container=330 / plus=34 / gap=4：贪心放 5 个完整 chip，剩余宽不足以放截断 chip', () => {
    // 真机实测宽度（ADR-0149）：46.33 67.67 45 45 56.33 45 ...
    const widths = [46.33, 67.67, 45, 45, 56.33, 45, 42.67, 45, 79, 45]
    // 前 5 个累计 = 46.33+67.67+45+45+56.33 + 4*4(gaps) = 276.33；再放第 6 个需 276.33+4+45+4+34.33=363.66 > 330
    // 放弃第 6 个后剩余 = 330 - 276.33 - 4 - (4+34.33) = 11.34 < 16 → 不放截断 chip
    const fit = computeAdaptiveTagFit(widths, 34.33, 330, 4)
    expect(fit.visible).toBe(5)
    expect(fit.remaining).toBe(5)
    expect(fit.partialWidth).toBe(null)
  })

  it('真机样例 container=350：同样 5 个完整 chip，剩余宽 31.34 >= 16 → 放一个截断 chip 且 remaining 再减一', () => {
    const widths = [46.33, 67.67, 45, 45, 56.33, 45, 42.67, 45, 79, 45]
    const fit = computeAdaptiveTagFit(widths, 34.33, 350, 4)
    expect(fit.visible).toBe(5)
    expect(fit.remaining).toBe(4)
    expect(fit.partialWidth).toBeCloseTo(31.34, 2)
  })

  it('末位 gap 必须计入：漏算会多放一个导致溢出（本仓库对 webview 的修正点）', () => {
    // 单 chip 46，plus 34，gap 4：装下 1 个完整 chip 需要 46 + 4(末位 gap) + 34 = 84。
    // container=84 → 恰好放 1 个；container=83 → 一个完整 chip 都放不下（若漏算末位 gap 会误判为能放 1 个 → 溢出 4px）。
    expect(computeAdaptiveTagFit([46, 46], 34, 84, 4)).toMatchObject({ visible: 1, partialWidth: null })
    const tight = computeAdaptiveTagFit([46, 46], 34, 83, 4)
    expect(tight.visible).toBe(0)
    // 83 - (4 + 34) = 45 剩余 → 给一个 45px 的截断 chip，其余 1 个进 +N
    expect(tight.partialWidth).toBe(45)
    expect(tight.remaining).toBe(1)
  })

  it('单个标签超宽 → 不留完整 chip，但剩余宽够则给截断 chip', () => {
    const fit = computeAdaptiveTagFit([400, 100], 34, 120, 4, MIN_PARTIAL_WIDTH)
    expect(fit.visible).toBe(0)
    // 剩余 = 120 - 0 - 0 - (4 + 34) = 82 >= 16 → 截断 chip + remaining 1
    expect(fit.partialWidth).toBe(82)
    expect(fit.remaining).toBe(1)
  })

  it('容器过窄（连 +N 都放不下）→ visible 0 且无截断 chip', () => {
    expect(computeAdaptiveTagFit([50, 50], 34, 10, 4)).toEqual({ visible: 0, remaining: 2, partialWidth: null })
  })

  it('minPartialWidth 可调：低于自定义阈值则放弃截断 chip', () => {
    const widths = [46.33, 67.67, 45, 45, 56.33, 45, 42.67, 45, 79, 45]
    // container=350 时剩余 31.34；阈值抬到 40 → 放弃
    expect(computeAdaptiveTagFit(widths, 34.33, 350, 4, 40).partialWidth).toBe(null)
  })
})

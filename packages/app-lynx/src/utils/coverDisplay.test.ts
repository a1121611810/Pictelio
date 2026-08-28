import { describe, it, expect } from 'vitest'
import { deriveCoverDisplay, ratioToHeightVw } from './coverDisplay'

// oracle = spec: app-lynx-recommended-carousel-polish-r2 §2.1 / §3.2 + ADR-0118 决策 1（封面比例显示）。
// 期望值来源（逐条可追溯）：
// - 宽高比最简整数比（最大公约数化简，spec §3.2）：600×750 → "4 / 5"、600×600 → "1 / 1"、1280×720 → "16 / 9"；
// - heightVw = 100 × imgHeight / imgWidth（容器宽 = 100vw，spec §3.2）：600×750 → 125、1280×720 → 56.25；
// - 超高图回退：按比例高 ≥ 可视区可用高度（100 × viewportHeight / viewportWidth）→ fit 'cover'（spec §2.1 / ADR-0118 决策 1，等值也回退）；
//   视口 375×812 → 可用 ≈216.53vw，400×1200 → heightVw 300 ≥ 216.53 → cover；
// - 尺寸缺失（小说，无 width/height 字段）→ 方形封面契约：width-fill、"1 / 1"、heightVw 100（spec §2.1 / §3.2）。
// 纯函数、无 DOM；渲染行为归 web-core/真机验证闭环（spec §4）——此处只锁纯逻辑，避免 oracle gap。

describe('deriveCoverDisplay（封面显示推导，spec §2.1 / ADR-0118 决策 1）', () => {
  it('方形 600×600 → width-fill、"1 / 1"、heightVw 100', () => {
    expect(
      deriveCoverDisplay({ imgWidth: 600, imgHeight: 600, viewportWidth: 375, viewportHeight: 812 }),
    ).toEqual({ fit: 'width-fill', ratio: '1 / 1', heightVw: 100 })
  })

  it('竖长 600×750 → ratio "4 / 5"（GCD 化简）、heightVw 125 → width-fill', () => {
    expect(
      deriveCoverDisplay({ imgWidth: 600, imgHeight: 750, viewportWidth: 375, viewportHeight: 812 }),
    ).toEqual({ fit: 'width-fill', ratio: '4 / 5', heightVw: 125 })
  })

  it('横长 1280×720 → ratio "16 / 9"、heightVw 56.25 → width-fill', () => {
    expect(
      deriveCoverDisplay({ imgWidth: 1280, imgHeight: 720, viewportWidth: 375, viewportHeight: 812 }),
    ).toEqual({ fit: 'width-fill', ratio: '16 / 9', heightVw: 56.25 })
  })

  it('超高图 400×1200（heightVw 300 ≥ 可用 ≈216.53vw）→ fit cover 回退裁切', () => {
    // 视口 375×812：可用高度 = 100×812/375 ≈ 216.53vw；300 ≥ 216.53 → cover（spec §2.1「≥ 回退 aspectFill」）
    expect(
      deriveCoverDisplay({ imgWidth: 400, imgHeight: 1200, viewportWidth: 375, viewportHeight: 812 }),
    ).toEqual({ fit: 'cover', ratio: '1 / 3', heightVw: 300 })
  })

  it('边界：按比例高 == 可视区可用高度 → cover（spec 用 ≥，等值也回退裁切）', () => {
    // 视口 300×600 → 可用 = 100×600/300 = 200vw；图 400×800 → heightVw = 200 → 200 ≥ 200 → cover
    expect(
      deriveCoverDisplay({ imgWidth: 400, imgHeight: 800, viewportWidth: 300, viewportHeight: 600 }),
    ).toEqual({ fit: 'cover', ratio: '1 / 2', heightVw: 200 })
  })

  it('边界：按比例高略小于可视区可用高度 → width-fill（不裁切）', () => {
    // 视口 300×600 → 可用 200vw；图 500×999 → heightVw = 199.8 < 200 → width-fill
    expect(
      deriveCoverDisplay({ imgWidth: 500, imgHeight: 999, viewportWidth: 300, viewportHeight: 600 }),
    ).toEqual({ fit: 'width-fill', ratio: '500 / 999', heightVw: 199.8 })
  })

  it('尺寸缺失（小说，无 width/height 字段）→ width-fill、"1 / 1"、heightVw 100（方形封面契约）', () => {
    expect(
      deriveCoverDisplay({ imgWidth: undefined, imgHeight: undefined, viewportWidth: 375, viewportHeight: 812 }),
    ).toEqual({ fit: 'width-fill', ratio: '1 / 1', heightVw: 100 })
  })

  it('尺寸非法（0 / 负数 / NaN）→ 同尺寸缺失：1:1 width-fill（防御，不进入除法）', () => {
    for (const bad of [0, -1, Number.NaN]) {
      expect(
        deriveCoverDisplay({ imgWidth: bad, imgHeight: 600, viewportWidth: 375, viewportHeight: 812 }),
      ).toEqual({ fit: 'width-fill', ratio: '1 / 1', heightVw: 100 })
      expect(
        deriveCoverDisplay({ imgWidth: 600, imgHeight: bad, viewportWidth: 375, viewportHeight: 812 }),
      ).toEqual({ fit: 'width-fill', ratio: '1 / 1', heightVw: 100 })
    }
  })

  it('viewport 非法（<=0）→ 可用高度 +∞：超高图也不回退 cover（永不裁切）', () => {
    for (const badVw of [0, -1]) {
      expect(
        deriveCoverDisplay({ imgWidth: 400, imgHeight: 1200, viewportWidth: badVw, viewportHeight: 812 }),
      ).toEqual({ fit: 'width-fill', ratio: '1 / 3', heightVw: 300 })
    }
  })

  it('ratio 化简（GCD）：900×600 → "3 / 2"', () => {
    expect(
      deriveCoverDisplay({ imgWidth: 900, imgHeight: 600, viewportWidth: 375, viewportHeight: 812 }),
    ).toMatchObject({ ratio: '3 / 2' })
  })
})

describe('ratioToHeightVw（最简比字符串 → 按比例高度 vw = 100 × 高 / 宽；CoverImage width-fill 容器高度用）', () => {
  it('"4 / 5" → 125；"1 / 1" → 100；"16 / 9" → 56.25', () => {
    expect(ratioToHeightVw('4 / 5')).toBe(125)
    expect(ratioToHeightVw('1 / 1')).toBe(100)
    expect(ratioToHeightVw('16 / 9')).toBe(56.25)
  })

  it('容忍空格差异（"4/5" 无空格）', () => {
    expect(ratioToHeightVw('4/5')).toBe(125)
  })

  it('非法输入 → NaN（调用方据此防御性回退 cover 渲染）', () => {
    for (const bad of ['', 'abc', '4 / 0', '0 / 5', '1.5 / 2', '-4 / 5', '4 / 5 / 6']) {
      expect(Number.isNaN(ratioToHeightVw(bad))).toBe(true)
    }
  })
})

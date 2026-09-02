// calcScrollIndicator 单测（滚动指示条几何计算，spec #319 / ticket #320 T1）。
// oracle = 官方 GalleryScrollbar 公式（Huxpro/vue-lynx
// examples/gallery/src/GalleryScrollbar/NiceScrollbar.vue）：
//   scrollbarHeight = listHeight * (listHeight / scrollHeight)
//   scrollbarTop    = listHeight * (scrollTop / scrollHeight)
// 差异点（相对官方公式，本测试必须覆盖）：
//   D1: height 下限 max(24, ...)（内容极长时缩略条不消失）
//   D2: top 钳制到 [0, max(0, listHeight - height)]（滚动到底不越界）
//   D3: scrollHeight 非法（<=0 / NaN / 缺失）→ null（保持隐藏）
//   D4: listHeight 缺失 → DEFAULT_LIST_HEIGHT（580）
//
// deviation 说明（ticket 用例 4 字面示例）：
// ticket 写的示例「scrollHeight=100 与 listHeight 580」按官方公式 raw = 580 * 580 / 100 = 3364，
// 不小于 24，无法演示 D1 下限；故 D1 用例改用「raw 计算值 < 24」的场景
// （scrollHeight=20000 → raw=16.82；listHeight=100/scrollHeight=580 → raw=17.24），
// 断言结果均为 24。公式本体严格按 spec 实现。
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_LIST_HEIGHT,
  calcScrollIndicator,
  type ScrollPayload,
} from './calcScrollIndicator'

// ─── 真机捕获形状 ───
// mock payload 字段来自真机捕获形状：scrollTop / scrollHeight / listHeight 三字段（ScrollPayload）。
// 值为真机量级（feed 列表：可视区 ~580px，长内容 ~5000px）。
const REAL_DEVICE_PAYLOAD: ScrollPayload = {
  scrollTop: 100,
  scrollHeight: 5000,
  listHeight: 580,
}

/** 官方公式期望值（独立实现自 oracle，非从被测实现反推） */
function oracleHeight(p: { listHeight: number; scrollHeight: number }): number {
  return p.listHeight * (p.listHeight / p.scrollHeight)
}
function oracleTop(p: { listHeight: number; scrollTop: number; scrollHeight: number }): number {
  return p.listHeight * (p.scrollTop / p.scrollHeight)
}

describe('calcScrollIndicator', () => {
  it('正常 payload：与官方 GalleryScrollbar 公式一致', () => {
    const geo = calcScrollIndicator(REAL_DEVICE_PAYLOAD)
    expect(geo).not.toBeNull()
    // height = 580 * (580/5000) = 67.28；top = 580 * (100/5000) = 11.6
    expect(geo!.height).toBeCloseTo(67.28, 5)
    expect(geo!.top).toBeCloseTo(11.6, 5)
    expect(geo!.height).toBeCloseTo(oracleHeight(REAL_DEVICE_PAYLOAD), 5)
    expect(geo!.top).toBeCloseTo(oracleTop(REAL_DEVICE_PAYLOAD), 5)
  })

  it('D3：scrollHeight 缺失/非法（undefined/0/负数/NaN）→ null（无有效信号保持隐藏）', () => {
    expect(calcScrollIndicator({ scrollTop: 100, listHeight: 580 })).toBeNull()
    expect(calcScrollIndicator({ scrollTop: 100, scrollHeight: 0, listHeight: 580 })).toBeNull()
    expect(calcScrollIndicator({ scrollTop: 100, scrollHeight: -5, listHeight: 580 })).toBeNull()
    expect(
      calcScrollIndicator({ scrollTop: 100, scrollHeight: Number.NaN, listHeight: 580 }),
    ).toBeNull()
  })

  it('D4：listHeight 缺失（undefined）→ 使用 DEFAULT_LIST_HEIGHT（580）', () => {
    const geo = calcScrollIndicator({ scrollTop: 100, scrollHeight: 5000 })
    expect(geo).not.toBeNull()
    expect(DEFAULT_LIST_HEIGHT).toBe(580)
    expect(geo!.height).toBeCloseTo(DEFAULT_LIST_HEIGHT * (DEFAULT_LIST_HEIGHT / 5000), 5)
    expect(geo!.top).toBeCloseTo(DEFAULT_LIST_HEIGHT * (100 / 5000), 5)
    // 与显式传 listHeight=580 完全一致
    expect(geo).toEqual(calcScrollIndicator({ scrollTop: 100, scrollHeight: 5000, listHeight: 580 }))
  })

  it('D4：listHeight 为 NaN 视同缺失 → 回退 580', () => {
    const geo = calcScrollIndicator({ scrollTop: 100, scrollHeight: 5000, listHeight: Number.NaN })
    expect(geo).not.toBeNull()
    expect(geo).toEqual(calcScrollIndicator({ scrollTop: 100, scrollHeight: 5000 }))
  })

  it('D1 下限：内容极长（raw < 24）→ height 抬升到 24（缩略条不消失）', () => {
    // 官方公式 raw = 580 * (580/20000) = 16.82 < 24 → D1 生效
    const geo = calcScrollIndicator({ scrollTop: 0, scrollHeight: 20000, listHeight: 580 })
    expect(geo).not.toBeNull()
    expect(oracleHeight({ listHeight: 580, scrollHeight: 20000 })).toBeCloseTo(16.82, 2)
    expect(geo!.height).toBe(24)
  })

  it('D1 下限（小可视区同量级）：listHeight=100, scrollHeight=580 → 24', () => {
    // 官方公式 raw = 100 * (100/580) = 17.24 < 24 → D1 生效
    const geo = calcScrollIndicator({ scrollTop: 0, scrollHeight: 580, listHeight: 100 })
    expect(geo).not.toBeNull()
    expect(oracleHeight({ listHeight: 100, scrollHeight: 580 })).toBeCloseTo(17.24, 2)
    expect(geo!.height).toBe(24)
  })

  it('D2 钳制：滚动到底（scrollTop == scrollHeight）→ top 不越界（top == listHeight - height）', () => {
    const geo = calcScrollIndicator({ scrollTop: 5000, scrollHeight: 5000, listHeight: 580 })
    expect(geo).not.toBeNull()
    // 官方公式原值 = 580（越出轨道），钳制到 listHeight - height = 512.72
    expect(geo!.height).toBeCloseTo(67.28, 5)
    expect(geo!.top).toBeCloseTo(580 - geo!.height, 5)
    expect(geo!.top).toBeLessThanOrEqual(580 - geo!.height + 1e-9)
  })

  it('D2 钳制：过度滚动（scrollTop > scrollHeight）与负值均不越界', () => {
    const over = calcScrollIndicator({ scrollTop: 5200, scrollHeight: 5000, listHeight: 580 })
    const atBottom = calcScrollIndicator({ scrollTop: 5000, scrollHeight: 5000, listHeight: 580 })
    expect(over).not.toBeNull()
    expect(over!.top).toBe(atBottom!.top) // 超出后与到底同值（钳制上限）
    expect(over!.top).toBeGreaterThanOrEqual(0)

    const under = calcScrollIndicator({ scrollTop: -50, scrollHeight: 5000, listHeight: 580 })
    expect(under).not.toBeNull()
    expect(under!.top).toBe(0) // 负 scrollTop → 钳制到 0
  })

  it('scrollTop 缺失/NaN 视作 0：top = 0，指示条在轨道顶部', () => {
    const geo = calcScrollIndicator({ scrollHeight: 5000, listHeight: 580 })
    expect(geo).not.toBeNull()
    expect(geo!.top).toBe(0)
    expect(geo!.height).toBeCloseTo(67.28, 2)

    const nan = calcScrollIndicator({ scrollTop: Number.NaN, scrollHeight: 5000, listHeight: 580 })
    expect(nan).not.toBeNull()
    expect(nan!.top).toBe(0)
  })

  it('payload 形状：真机捕获三字段（scrollTop/scrollHeight/listHeight）', () => {
    // 字段名/形状来自真机捕获（ScrollPayload 三字段），值为真机量级
    const captured: ScrollPayload = { scrollTop: 512, scrollHeight: 5000, listHeight: 580 }
    const geo = calcScrollIndicator(captured)
    expect(geo).not.toBeNull()
    expect(geo!.height).toBeCloseTo(580 * (580 / 5000), 5)
    expect(geo!.top).toBeCloseTo(580 * (512 / 5000), 5)
  })
})

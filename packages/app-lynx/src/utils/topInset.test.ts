// ─── 顶部让位几何单测（#900 T1 / #901 · 测点 1：主门，测**幅值**）───
//
// ## oracle（期望值出处，可追溯 —— 测试硬约束 #6）
//
// 本文件的期望值**不从被测模块反推**，而是从**平台真值**独立推出：
//   真机 emulator-5554 / 1080×2160 / density 480 ⇒ scale 3.0；
//   `dumpsys` 状态栏 inset = 72 **物理** px；
//   72 ÷ 3.0 = **24 逻辑 px** ⇒ 本文件以 safeTop = 24 作为原生路径的标称输入。
// 依据见 utils/safeArea.ts 文件头「单位边界」段（同一条真机实证）。
//
// ## 本测点能抓什么 / 抓不到什么
//
// ✅ 抓：幅值错误（放大/缩小 N 倍）、模式弄反、非有限值未归零、未知模式未回落。
// ❌ 抓不到：spacer 在页面上**放错位置**（纯函数不关心 DOM）、页面忘了消费它。
//    后者由测点 2（按页覆盖面契约）与测点 3（真机幅值对拍）负责。
// 本测点是三者中唯一能在无设备条件下抓幅值的，故称主门。
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { resolveTopInsetOwnership, TOP_INSET_MODES, type TopInsetMode } from './topInset'

/** 平台真值推出的标称安全高度（逻辑 px）：dumpsys 72 物理 px ÷ density 3.0 */
const NATIVE_INSET = 24
/** web-core 预览 / 无原生环境的取值（safeArea.ts：无 native ⇒ 恒 0） */
const NO_NATIVE_INSET = 0

describe('顶部让位几何 · 两模式结果（幅值断言）', () => {
  it('self：页面自带 spacer 全额让位', () => {
    const o = resolveTopInsetOwnership('self', NATIVE_INSET)
    expect(o.mode).toBe('self')
    expect(o.barSpacerHeight).toBe(24)
  })

  it('bleed：完全不让位（内容铺到状态栏底下）', () => {
    const o = resolveTopInsetOwnership('bleed', NATIVE_INSET)
    expect(o.mode).toBe('bleed')
    expect(o.barSpacerHeight).toBe(0)
  })
})

describe('顶部让位几何 · 「不让位」必须显式（#907 收口后的核心不变量）', () => {
  // 收口前存在第三个模式 'root'（根容器补偿）。根容器补偿删除后，它退化成
  // 「完全不让位」——与 'bleed' 逐字节同义却长得完全不像，是静默破版的脚枪。
  // ⇒ 词汇表被砍到两个，且必须由下面这条把它锁住。
  it('词汇表恰为 self / bleed 两值（不存在「我不特意做什么」这个选项）', () => {
    expect(TOP_INSET_MODES).toEqual(['self', 'bleed'])
  })

  it('未知模式回落到 self（绝大多数页面的正常行为），而非「不让位」', async () => {
    // 失效方向选择很重要：回落成 'bleed' 会让**所有**页面顶到状态栏底下。
    vi.resetModules()
    const fresh = await import('./topInset')
    const o = fresh.resolveTopInsetOwnership('root' as never, NATIVE_INSET)
    expect(o.mode).toBe('self')
    expect(o.barSpacerHeight).toBe(NATIVE_INSET)
  })

  it('bleed 与 self 确实不同（否则两模式就退化成一个）', () => {
    const self = resolveTopInsetOwnership('self', NATIVE_INSET)
    const bleed = resolveTopInsetOwnership('bleed', NATIVE_INSET)
    expect(self.barSpacerHeight).not.toBe(bleed.barSpacerHeight)
  })
})

describe('顶部让位几何 · 双路径（测试硬约束 #1：成功 + 降级都要有覆盖）', () => {
  it('原生路径（safeTop = 24）：两模式各自全额生效', () => {
    expect(resolveTopInsetOwnership('self', NATIVE_INSET).barSpacerHeight).toBe(24)
    expect(resolveTopInsetOwnership('bleed', NATIVE_INSET).barSpacerHeight).toBe(0)
  })

  it('降级路径（safeTop = 0，web-core 预览 / 无原生）：两模式全部归零且**互不可区分**', () => {
    // 降级路径下模式差异不可观测是**预期**的：没有状态栏就没有让位可分。
    // 断言"结果相同"而不是"模式仍不同"，避免把不可观测的差异写进契约。
    const self = resolveTopInsetOwnership('self', NO_NATIVE_INSET)
    const bleed = resolveTopInsetOwnership('bleed', NO_NATIVE_INSET)
    for (const o of [self, bleed]) {
      expect(o.barSpacerHeight).toBe(0)
    }
    // mode 字段仍如实回传（供 debug / 契约测试判读，不影响几何）
    expect([self.mode, bleed.mode]).toEqual(['self', 'bleed'])
  })
})

describe('顶部让位几何 · 输入归一（禁静默降级，测试硬约束 #3）', () => {
  it('安全高度非法（非有限 / 负数）归零', () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, -1, -0.5]) {
      const o = resolveTopInsetOwnership('self', bad)
      expect(o.barSpacerHeight, `safeTop=${bad} 应归零`).toBe(0)
    }
  })

  it('未知模式回落到 self 并告警，不静默产生破版布局', async () => {
    // 告警是「只发一次」的设计（insets 在旋转/全屏切换时会重复回调），
    // 故用 resetModules + 动态导入取干净的模块态。
    vi.resetModules()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const fresh = await import('./topInset')

    const bogus = 'nope' as unknown as TopInsetMode
    const o = fresh.resolveTopInsetOwnership(bogus, NATIVE_INSET)

    expect(o.mode).toBe('self')
    expect(o.barSpacerHeight).toBe(NATIVE_INSET)
    expect(warn, '未知模式必须告警（禁静默降级）').toHaveBeenCalled()
    expect(String(warn.mock.calls[0]?.[0])).toContain('[topInset]')
    warn.mockRestore()
  })

  it('告警只发一次（重复调用不刷屏）', async () => {
    vi.resetModules()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const fresh = await import('./topInset')
    const bogus = 'nope' as unknown as TopInsetMode
    fresh.resolveTopInsetOwnership(bogus, NATIVE_INSET)
    fresh.resolveTopInsetOwnership(bogus, NATIVE_INSET)
    fresh.resolveTopInsetOwnership('alsobogus' as unknown as TopInsetMode, NATIVE_INSET)
    expect(warn).toHaveBeenCalledTimes(1)
    warn.mockRestore()
  })
})

describe('顶部让位几何 · 阴性对照', () => {
  it('两个模式在原生路径下可区分（防「全返回同一个值」的实现）', () => {
    const sig = TOP_INSET_MODES.map((m) => String(resolveTopInsetOwnership(m, NATIVE_INSET).barSpacerHeight))
    expect(new Set(sig).size, `两模式签名应不同，实际：${sig.join(' ')}`).toBe(2)
  })
})

beforeEach(() => {
  // 每个用例从干净模块态开始：topInset 的告警抑制是模块级的。
  vi.resetModules()
})

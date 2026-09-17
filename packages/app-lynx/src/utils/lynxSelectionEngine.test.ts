// 选中引擎适配器单测（spec docs/specs/app-lynx-novel-text-selection.md §ID 5 / 不变式 4）。
// oracle：① 单位换算 = 设备实证「rect 单位 = 内容区 dp，与 boundingClientRect 同源」
// （node w=329dp ↔ 987px；docs/research/lynx-text-selection-device-probe.md ④）；
// ② vw = dp / 内容宽(dp) × 100（1 = 1% 内容宽；坑 5 复盘：用 px 宽换算菜单会落在屏幕上部）。
import { describe, expect, it, vi } from 'vitest'
import type { SelectorQuery, SelectorQueryFactory } from '../primitives/measureRects'
import { createLynxSelectionEngine } from './lynxSelectionEngine'

const PROBE_ID = 'novel-selection-root'

interface FakeOptions {
  probeWidth?: number
  textRect?: { left: number; top: number; width: number; height: number } | null
  textFails?: boolean
  clearOk?: boolean
  silent?: boolean
}

function fakeFactory(options: FakeOptions) {
  const calls: Array<{ selector: string; method: string; params: Record<string, unknown> }> = []
  const query: SelectorQuery = {
    select(selector: string) {
      return {
        invoke(opts) {
          calls.push({ selector, method: opts.method, params: opts.params ?? {} })
          if (options.silent) return query
          if (opts.method === 'boundingClientRect') {
            opts.success?.({ left: 0, top: 0, width: options.probeWidth ?? 0, height: 600 })
          } else if (opts.method === 'getTextBoundingRect') {
            if (options.textFails) opts.fail?.({ code: 1, data: 'Can not find text bounding rect.' })
            else opts.success?.({ boundingRect: options.textRect ?? { left: 40, top: 50, width: 20, height: 3 } })
          } else if (opts.method === 'setTextSelection') {
            if (options.clearOk === false) opts.fail?.({ code: 2 })
            else opts.success?.({})
          }
          return query
        },
      }
    },
    exec() {},
  }
  const factory: SelectorQueryFactory = () => query
  return { factory, calls }
}

describe('createLynxSelectionEngine · 测矩与校准', () => {
  it('dp → vw：除以实测内容宽（400dp 基准 → ×100/400）', async () => {
    const { factory } = fakeFactory({ probeWidth: 400 })
    const engine = createLynxSelectionEngine({ probeId: PROBE_ID, createQuery: factory })
    const result = await engine.measureRange('p-0', { start: 4, end: 6 })
    expect(result).toEqual({
      ok: true,
      rectVw: { left: 10, top: 12.5, width: 5, height: 0.75 },
    })
  })

  it('校准缓存：多次测矩只探一次内容宽', async () => {
    const { factory, calls } = fakeFactory({ probeWidth: 400 })
    const engine = createLynxSelectionEngine({ probeId: PROBE_ID, createQuery: factory })
    await engine.measureRange('p-0', { start: 0, end: 1 })
    await engine.measureRange('p-1', { start: 0, end: 1 })
    const probeCalls = calls.filter((c) => c.method === 'boundingClientRect')
    expect(probeCalls).toHaveLength(1)
    expect(probeCalls[0].selector).toBe('#' + PROBE_ID)
  })

  it('内容宽探不到（0）→ bad-calibration（不猜位置）', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { factory } = fakeFactory({ probeWidth: 0 })
    const engine = createLynxSelectionEngine({ probeId: PROBE_ID, createQuery: factory })
    expect(await engine.measureRange('p-0', { start: 0, end: 1 })).toEqual({ ok: false, reason: 'bad-calibration' })
    warn.mockRestore()
  })

  it('范围测量失败 → bad-range（透传原语分类）', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { factory } = fakeFactory({ probeWidth: 400, textFails: true })
    const engine = createLynxSelectionEngine({ probeId: PROBE_ID, createQuery: factory })
    expect(await engine.measureRange('p-0', { start: 0, end: 9999 })).toEqual({ ok: false, reason: 'bad-range' })
    warn.mockRestore()
  })

  it('无 createSelectorQuery（web-core）→ no-engine', async () => {
    const engine = createLynxSelectionEngine({ probeId: PROBE_ID, createQuery: () => undefined })
    expect(await engine.measureRange('p-0', { start: 0, end: 1 })).toEqual({ ok: false, reason: 'no-engine' })
  })
})

describe('createLynxSelectionEngine · 尽力清选', () => {
  it('清选成功 → true（退化为负坐标 + 不显示手柄）', async () => {
    const { factory, calls } = fakeFactory({ probeWidth: 400, clearOk: true })
    const engine = createLynxSelectionEngine({ probeId: PROBE_ID, createQuery: factory })
    expect(await engine.clearRange('p-0')).toBe(true)
    const clear = calls.find((c) => c.method === 'setTextSelection')
    expect(clear?.params).toMatchObject({ startX: -1, endX: -1, showStartHandle: false, showEndHandle: false })
  })

  it('清选失败 → false 且只 warn 一次（滚动会反复调）', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { factory } = fakeFactory({ probeWidth: 400, clearOk: false })
    const engine = createLynxSelectionEngine({ probeId: PROBE_ID, createQuery: factory })
    expect(await engine.clearRange('p-0')).toBe(false)
    expect(await engine.clearRange('p-0')).toBe(false)
    expect(warn).toHaveBeenCalledTimes(1)
    warn.mockRestore()
  })
})

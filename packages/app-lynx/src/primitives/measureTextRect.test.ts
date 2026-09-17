// measureTextRect IO 边界单测（AGENTS.md 测试硬约束 1：外部数据源必须成功 + 失败双路径）。
// oracle：① 平台约束来自 measureRects/ADR-0149（逐 id select、exec 链式、超时 warn）；
// ② 失败码 code:1 与「全量 range 必失败」来自设备实证（docs/research/lynx-text-selection-device-probe.md ③）。
import { describe, expect, it, vi } from 'vitest'
import type { SelectorQuery, SelectorQueryFactory } from './measureRects'
import { measureTextRect } from './measureTextRect'

interface Behavior {
  ok?: unknown
  fail?: unknown
  silent?: boolean
}

function fakeQuery(behavior: Behavior) {
  const calls: Array<{ selector: string; method: string; params: Record<string, unknown> }> = []
  const query: SelectorQuery = {
    select(selector: string) {
      return {
        invoke(options) {
          calls.push({ selector, method: options.method, params: options.params ?? {} })
          if (!behavior.silent) {
            if (behavior.ok !== undefined) options.success?.(behavior.ok)
            if (behavior.fail !== undefined) options.fail?.(behavior.fail)
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

describe('measureTextRect', () => {
  it('成功：按 id + range 发出 getTextBoundingRect，返回 boundingRect', async () => {
    const { factory, calls } = fakeQuery({ ok: { boundingRect: { left: 15.3, top: 304, width: 15.3, height: 21 } } })
    const result = await measureTextRect('p-0', 10, 11, factory)
    expect(result).toEqual({ ok: true, rect: { left: 15.3, top: 304, width: 15.3, height: 21 } })
    expect(calls).toEqual([{ selector: '#p-0', method: 'getTextBoundingRect', params: { start: 10, end: 11 } }])
  })

  it('成功载荷缺 boundingRect → bad-range + warn（不静默当成功）', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { factory } = fakeQuery({ ok: {} })
    const result = await measureTextRect('p-0', 0, 9999, factory)
    expect(result).toEqual({ ok: false, reason: 'bad-range' })
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it('fail 回调（code:1 无效 range）→ bad-range + warn', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { factory } = fakeQuery({ fail: { code: 1, data: 'Can not find text bounding rect.' } })
    const result = await measureTextRect('p-0', 0, 9999, factory)
    expect(result).toEqual({ ok: false, reason: 'bad-range' })
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it('无 createSelectorQuery（web-core）→ no-selector-query + warn', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const result = await measureTextRect('p-0', 0, 1, () => undefined)
    expect(result).toEqual({ ok: false, reason: 'no-selector-query' })
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it('回调永不到达 → 超时失败 + warn（跨线程测量的兜底）', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { factory } = fakeQuery({ silent: true })
    const result = await measureTextRect('p-0', 0, 1, factory, 20)
    expect(result).toEqual({ ok: false, reason: 'timeout' })
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })
})

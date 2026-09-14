// measureRects 单测（ADR-0149「测试决策」：IO 边界成功 + 降级全路径）。
// 期望值出处（oracle 溯源）：ADR-0149 spike 双端实测的 SelectorQuery 行为——
// 成功回调携 {left,top,width,height}；无 createSelectorQuery 需降级；超时需降级；
// 缺失/失败必须显式 warn（AGENTS.md 测试硬约束 #3）。假 query 复刻「链式 select().invoke() 返回同一队列」的形状。
import { describe, expect, it, vi, afterEach } from 'vitest'
import { measureRects, type BoundingRect, type NodesRef, type SelectorQuery } from './measureRects'

type Handler = BoundingRect | 'fail' | 'never'

function fakeQuery(handlers: Record<string, Handler>): SelectorQuery {
  const chain: SelectorQuery = {
    select(selector: string): NodesRef {
      const id = selector.startsWith('#') ? selector.slice(1) : selector
      return {
        invoke(options) {
          const h = handlers[id]
          if (h === 'fail') options.fail?.({ code: 1 })
          else if (h && h !== 'never') options.success?.(h)
          return chain
        },
      }
    },
    exec() {
      /* 假实现：invoke 内同步回调，无需 exec 触发 */
    },
  }
  return chain
}

const R = (left: number, width: number): BoundingRect => ({ left, top: 0, width, height: 20 })

afterEach(() => {
  vi.restoreAllMocks()
})

describe('measureRects', () => {
  it('全部命中 → ok、rects 齐全、不 warn', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const res = await measureRects(['a', 'b'], () => fakeQuery({ a: R(0, 40), b: R(44, 60) }))
    expect(res.ok).toBe(true)
    expect(res.missing).toEqual([])
    expect(res.rects.a).toEqual(R(0, 40))
    expect(res.rects.b).toEqual(R(44, 60))
    expect(warn).not.toHaveBeenCalled()
  })

  it('空 ids → ok 且不触碰查询工厂', async () => {
    const factory = vi.fn()
    const res = await measureRects([], factory as unknown as () => SelectorQuery)
    expect(res).toEqual({ rects: {}, missing: [], ok: true })
    expect(factory).not.toHaveBeenCalled()
  })

  it('无 createSelectorQuery → ok false / reason no-selector-query / warn', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const res = await measureRects(['a'], () => undefined)
    expect(res.ok).toBe(false)
    expect(res.reason).toBe('no-selector-query')
    expect(res.missing).toEqual(['a'])
    expect(warn).toHaveBeenCalledTimes(1)
  })

  it('部分 fail → ok false、missing 精确、warn 一次', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const res = await measureRects(['a', 'b'], () => fakeQuery({ a: R(0, 40), b: 'fail' }))
    expect(res.ok).toBe(false)
    expect(res.missing).toEqual(['b'])
    expect(res.reason).toBeUndefined()
    expect(warn).toHaveBeenCalledTimes(1)
  })

  it('回调永不返回 → 超时降级、reason timeout、warn', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const res = await measureRects(['a'], () => fakeQuery({ a: 'never' }), 5)
    expect(res.ok).toBe(false)
    expect(res.reason).toBe('timeout')
    expect(res.missing).toEqual(['a'])
    expect(warn).toHaveBeenCalledTimes(1)
  })

  it('超时前的部分结果会被保留（不丢弃已测到的矩形）', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const res = await measureRects(['a', 'b'], () => fakeQuery({ a: R(0, 40), b: 'never' }), 5)
    expect(res.rects.a).toEqual(R(0, 40))
    expect(res.missing).toEqual(['b'])
    expect(res.ok).toBe(false)
  })

  // oracle：spec「Implementation Decisions」——原语只对「无 query / 超时 / 矩形缺失」降级并 warn；
  // query 工厂自身抛错属编程错误，不得吞掉，必须向上暴露（失败路径显式可见）。
  it('query 抛出 → 向调用方暴露（不静默吞掉）', async () => {
    await expect(
      measureRects(['a'], () => {
        throw new Error('boom')
      }),
    ).rejects.toThrow('boom')
  })
})

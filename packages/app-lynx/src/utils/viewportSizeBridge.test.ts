import { describe, it, expect } from 'vitest'
import { subscribeViewportSize } from './viewportSizeBridge'

// 期望值来源(可回溯):ADR-0131 契约语义——
// ① cb(w,h) 物理 px;未布局/异常 cb(-1,-1) 哨兵 → JS 回退 SystemInfo(apply(null));
// ② 无 NativeModules(web-core)→ 不调用契约、不应用;
// ③ 有效尺寸 → apply({w,h}) 且数值原样传递(720×1184 为 ADR-0131 模拟器实测内容区值)。
// 测试对象是「契约裁决 + 分发」IO 边界(AGENTS.md 测试硬约束 #1:原生桥成功/降级路径必须覆盖)。

type ApplyLog = Array<{ w: number; h: number } | null>

function withBridge(): {
  push: (w: number, h: number) => void
  log: ApplyLog
  called: () => boolean
} {
  let cb: ((w: number, h: number) => void) | null = null
  const log: ApplyLog = []
  subscribeViewportSize(
    () => ({
      PictelioApp: {
        getViewportSize(c: (w: number, h: number) => void) {
          cb = c
        },
      },
    }),
    (s) => log.push(s),
  )
  return {
    push: (w, h) => cb?.(w, h),
    log,
    called: () => cb !== null,
  }
}

describe('subscribeViewportSize(原生内容区契约接线)', () => {
  it('无 NativeModules(web-core)→ 不调用契约、不应用', () => {
    const log: ApplyLog = []
    subscribeViewportSize(() => undefined, (s) => log.push(s))
    expect(log).toEqual([])
  })

  it('有契约但接口缺失(getViewportSize undefined)→ no-op', () => {
    const log: ApplyLog = []
    subscribeViewportSize(() => ({ PictelioApp: {} }), (s) => log.push(s))
    expect(log).toEqual([])
  })

  it('有效尺寸 720×1184 → apply({ w: 720, h: 1184 })', () => {
    const b = withBridge()
    expect(b.called()).toBe(true)
    b.push(720, 1184)
    expect(b.log).toEqual([{ w: 720, h: 1184 }])
  })

  it('哨兵 cb(-1,-1)(未布局)→ apply(null) 回退 SystemInfo', () => {
    const b = withBridge()
    b.push(-1, -1)
    expect(b.log).toEqual([null])
  })

  it('哨兵之后再次回传有效尺寸 → 覆盖为有效', () => {
    const b = withBridge()
    b.push(-1, -1)
    b.push(720, 1184)
    expect(b.log).toEqual([null, { w: 720, h: 1184 }])
  })
})

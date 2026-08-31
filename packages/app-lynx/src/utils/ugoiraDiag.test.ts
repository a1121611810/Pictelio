// ─── ugoiraDiag 单测（环形缓冲/文本格式/重置/模式门控） ───
// 期望值来源标注（测试硬约束 #6 Oracle 溯源）：
// - 头部格式串 / 行格式 / 无 detail 规则 = characterization（锁定模块输出格式防回归；
//   格式本身是模块契约，Java 侧 exportDiagLog 只透传文本，不解析结构，故无外部 oracle）
// - 环形上限 / FIFO 丢最旧 / 重置语义 = 性质不变量（独立于实现成立；容量常量 300 来自模块契约）
// - web 模式不记录 = 行为规格（诊断目标 = 原生渲染，来自本次需求边界）
import { describe, it, expect, beforeEach } from 'vitest'
import { diagInit, diagLog, diagText, UGOIRA_DIAG_MAX_LINES } from './ugoiraDiag'

describe('ugoiraDiag', () => {
  beforeEach(() => {
    diagInit({
      illustId: 148861562,
      mode: 'native',
      totalFrames: null,
      deferSrcInvalidation: true,
      ugoiraMode: 'fflate',
    })
  })

  it('diagText 含头部信息（illustId/mode/defer 绑定值）', () => {
    const text = diagText()
    expect(text).toContain('## ugoira diag')
    expect(text).toContain('illustId=148861562')
    expect(text).toContain('mode=native')
    expect(text).toContain('defer-src-invalidation=true')
    expect(text).toContain('totalFrames=pending')
  })

  it('diagLog 记录时间戳 + 事件名 + JSON detail 单行', () => {
    diagLog('frame-set', { i: 3, delay: 40 })
    const text = diagText()
    const line = text.split('\n').find((l) => l.includes('frame-set'))
    expect(line).toMatch(/^\[\d+\] frame-set \{"i":3,"delay":40\}$/)
  })

  it('无 detail 的事件不含 JSON 尾缀', () => {
    diagLog('stream-done')
    expect(diagText().split('\n')).toContainEqual(expect.stringMatching(/^\[\d+\] stream-done$/))
  })

  it('环形缓冲超限丢最旧（保留最近 UGOIRA_DIAG_MAX_LINES 条）', () => {
    for (let i = 0; i < UGOIRA_DIAG_MAX_LINES + 20; i++) {
      diagLog('tick', { i })
    }
    const lines = diagText().split('\n')
    const events = lines.filter((l) => l.includes('] tick'))
    expect(events).toHaveLength(UGOIRA_DIAG_MAX_LINES)
    // 头部行仍在（截断只作用于事件缓冲）
    expect(lines[0]).toBe('## ugoira diag')
    // 最旧事件已丢，最新事件保留
    expect(events[0]).not.toContain('"i":0')
    expect(events[events.length - 1]).toContain(`"i":${UGOIRA_DIAG_MAX_LINES + 19}`)
  })

  it('web 模式不记录事件（诊断目标 = 原生渲染；热路径门控）', () => {
    diagInit({
      illustId: 2,
      mode: 'web',
      totalFrames: 1,
      deferSrcInvalidation: true,
      ugoiraMode: 'fflate',
    })
    diagLog('frame-set', { i: 0, delay: 40 })
    expect(diagText()).not.toContain('frame-set')
    // 头部仍记录（头部信息与事件不同：头部总是要的）
    expect(diagText()).toContain('mode=web')
  })

  it('diagInit 重置缓冲（旧事件清空）', () => {
    diagLog('frame-set', { i: 99 })
    diagInit({
      illustId: 1,
      mode: 'web',
      totalFrames: 5,
      deferSrcInvalidation: true,
      ugoiraMode: 'range',
    })
    const text = diagText()
    expect(text).not.toContain('frame-set')
    expect(text).toContain('illustId=1')
    expect(text).toContain('totalFrames=5')
  })
})

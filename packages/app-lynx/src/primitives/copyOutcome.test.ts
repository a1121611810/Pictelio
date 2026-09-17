// 复制结果归一单测（issue #568：失败不得冒充成功）。
// oracle：① 成功 = 写通道 resolve → 'copied'；② 失败 = 写通道 reject → 'failed' 且 warn（禁静默降级）；
// ③ 回归锁：不存在「写失败却得到 copied」的路径（原缺陷即此类）。
import { describe, expect, it, vi } from 'vitest'
import { copyOutcome } from './copyOutcome'

describe('copyOutcome', () => {
  it('写入成功 → copied', async () => {
    const write = vi.fn(() => Promise.resolve())
    await expect(copyOutcome(write, '报告正文')).resolves.toBe('copied')
    expect(write).toHaveBeenCalledWith('报告正文')
  })

  it('写入失败（通道缺失/原生拒绝）→ failed 且 warn（设备实测：Lynx 运行时无 navigator）', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const write = vi.fn(() => Promise.reject(new Error('clipboard unavailable in this environment')))
    await expect(copyOutcome(write, 'x')).resolves.toBe('failed')
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it('空文本交给通道判定（不在本层短路）', async () => {
    const write = vi.fn(() => Promise.reject(new Error('文本为空')))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await expect(copyOutcome(write, '')).resolves.toBe('failed')
    expect(write).toHaveBeenCalledWith('')
    warn.mockRestore()
  })
})

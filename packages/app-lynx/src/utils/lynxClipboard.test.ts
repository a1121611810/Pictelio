// 剪贴板桥单测（spec docs/specs/app-lynx-novel-text-selection.md §ID 6）。
// oracle：① 原生回调契约 = PictelioClipboardModule.java 的 cb("1","") / cb("", errMsg)（真机禁 null）；
// ② 失败可见 = 仓库硬约束「禁止静默降级」（#568 假成功教训）；③ 字符串去引号 = tokenStorage.unquoteNativeString。
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createLynxClipboard, nativeClipboard, writeClipboardText } from './lynxClipboard'

describe('createLynxClipboard（注入工厂）', () => {
  it('原生成功回调（"1",""）→ resolve', async () => {
    const setText = vi.fn((_text: string, cb: (ok: string, err: string) => void) => cb('1', ''))
    await expect(createLynxClipboard({ setText })('选中文字')).resolves.toBeUndefined()
    expect(setText).toHaveBeenCalledWith('选中文字', expect.any(Function))
  })

  it('原生失败回调带 JSON 引号 → reject 且错误串已去引号（warn 可见）', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const setText = vi.fn((_text: string, cb: (ok: string, err: string) => void) => cb('', '"剪贴板服务不可用"'))
    await expect(createLynxClipboard({ setText })('x')).rejects.toThrow('剪贴板服务不可用')
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it('原生失败且错误串为空 → 仍 resolve（不把空错误当失败）', async () => {
    const setText = vi.fn((_text: string, cb: (ok: string, err: string) => void) => cb('', ''))
    await expect(createLynxClipboard({ setText })('x')).resolves.toBeUndefined()
  })
})

describe('nativeClipboard / writeClipboardText（环境探测降级路径）', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('无原生模块（web-core 预览）→ 失败回调可见（warn + reject），不假成功', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    // node 环境下无 NativeModules 全局 → nativeClipboard 走降级适配器
    expect(typeof (globalThis as { NativeModules?: unknown }).NativeModules).toBe('undefined')
    await expect(writeClipboardText('x')).rejects.toThrow('clipboard unavailable in this environment')
    expect(warn).toHaveBeenCalled()
  })

  it('降级适配器与原生同形：双参回调均非空（ok="", err=非空）', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const seen: Array<[string, string]> = []
    nativeClipboard().setText('x', (ok, err) => seen.push([ok, err]))
    expect(seen).toHaveLength(1)
    expect(seen[0][0]).toBe('')
    expect(seen[0][1].length).toBeGreaterThan(0)
    warn.mockRestore()
  })
})

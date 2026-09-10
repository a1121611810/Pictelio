// lynxShare 单测（spec docs/specs/download-manager.md §4.1）。
import { describe, it, expect, vi } from 'vitest'
import { createLynxSharer, type LynxShareNative } from './lynxShare'

describe('createLynxSharer（spec §4.1）', () => {
  it('把 uris JSON 序列化后交给原生，成功 resolve', async () => {
    const share = vi.fn(
      (_json: string, _mime: string, cb: (ok: string, err: string) => void) => cb('1', ''),
    )
    const sharer = createLynxSharer({ share } as unknown as LynxShareNative)
    await sharer(['content://a'])
    expect(share.mock.calls[0]![0]).toBe('["content://a"]')
  })

  it('err 非空 → reject', async () => {
    const share = vi.fn(
      (_json: string, _mime: string, cb: (ok: string, err: string) => void) => cb('', '分享失败'),
    )
    const sharer = createLynxSharer({ share } as unknown as LynxShareNative)
    await expect(sharer(['content://a'])).rejects.toThrow('分享失败')
  })

  it('空列表显式失败（不调用原生）', async () => {
    const share = vi.fn()
    const sharer = createLynxSharer({ share } as unknown as LynxShareNative)
    await expect(sharer([])).rejects.toThrow('没有可分享的文件')
    expect(share).not.toHaveBeenCalled()
  })
})

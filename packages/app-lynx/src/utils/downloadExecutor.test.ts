// 下载执行器接线惰性解析单测（模拟器验证暴露的存量时序缺陷回归防线）。
// 缺陷：接线在模块求值期一次性判定 NativeModules.PictelioDownloader——原生注入晚于
// bundle 求值 → 永久判空 → 下载队列整会话失效（2026-09-27 pictelio_ui 首跑暴露）。
// 修复：首个任务使用时再解析；缺席一次性 warn（禁静默降级，与既有口径一致）。
// oracle = getNativeModules 裸 global 双通道实证（api/client.ts），非手写自洽。
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createLazyLynxDownloadExecutor } from './downloadExecutor'
import type { LynxDownloaderNative } from './lynxDownloadExecutor'

type NativeModulesShape = { PictelioDownloader?: LynxDownloaderNative }

function setNativeModules(mod: NativeModulesShape | undefined): void {
  ;(globalThis as { NativeModules?: NativeModulesShape }).NativeModules = mod
}

function makeNativeModule(): LynxDownloaderNative & {
  startMock: ReturnType<typeof vi.fn>
  cancelMock: ReturnType<typeof vi.fn>
} {
  const startMock = vi.fn()
  const cancelMock = vi.fn((_id: string, cb: (hit: string, err: string) => void) => cb('true', ''))
  return {
    startMock,
    cancelMock,
    start: startMock,
    pollProgress: (_id, cb) => cb('', ''),
    cancel: cancelMock,
    deleteFile: (_uri, cb) => cb('true', ''),
  }
}

function makeCallbacks() {
  return {
    onProgress: vi.fn(),
    onComplete: vi.fn(),
    onFail: vi.fn(),
  }
}

const task = {
  id: 't1',
  kind: 'image' as const,
  sourceUrl: 'https://i.pximg.net/1.jpg',
  fileName: 'Pictelio_1.jpg',
  dir: '',
  status: 'queued' as const,
}

afterEach(() => {
  setNativeModules(undefined)
  vi.restoreAllMocks()
})

describe('createLazyLynxDownloadExecutor（惰性解析）', () => {
  it('求值期模块缺席 → 首调显式失败；注入后下一任务透传 start（晚注入可达）', () => {
    setNativeModules(undefined)
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const exec = createLazyLynxDownloadExecutor()
    const native = makeNativeModule()
    const cb = makeCallbacks()
    exec.start(task as never, 1, cb)
    expect(cb.onFail).toHaveBeenCalledTimes(1)

    setNativeModules({ PictelioDownloader: native })
    exec.start(task as never, 2, cb)
    expect(native.startMock).toHaveBeenCalledTimes(1)
    expect(native.startMock.mock.calls[0]?.[0]).toBe('t1')
  })

  it('模块始终缺席 → onFail 显式失败 + warn 恰一次（禁静默降级）', () => {
    setNativeModules(undefined)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const exec = createLazyLynxDownloadExecutor()
    const cb = makeCallbacks()
    exec.start(task as never, 1, cb)
    exec.start(task as never, 2, cb)
    expect(cb.onFail).toHaveBeenCalledTimes(2)
    expect(warn).toHaveBeenCalledTimes(1)
    expect(String(warn.mock.calls[0]?.[0])).toContain('[downloadExecutor]')
  })

  it('缺席时 pause/cancel 为 no-op；deleteFile 显式 reject', async () => {
    setNativeModules(undefined)
    const exec = createLazyLynxDownloadExecutor()
    expect(() => exec.pause('t1')).not.toThrow()
    expect(() => exec.cancel('t1')).not.toThrow()
    await expect(exec.deleteFile('file://x')).rejects.toThrow()
  })

  it('解析成功后 pause/cancel/deleteFile 透传原生模块', async () => {
    setNativeModules(undefined)
    const exec = createLazyLynxDownloadExecutor()
    const native = makeNativeModule()
    setNativeModules({ PictelioDownloader: native })
    exec.pause('t1')
    exec.cancel('t2')
    await expect(exec.deleteFile('file://x')).resolves.toBeUndefined()
    // pause 等同 cancel（原生无挂起能力，spec download-manager §2 申报），故 cancel 触底 2 次
    expect(native.cancelMock).toHaveBeenCalledTimes(2)
  })
})

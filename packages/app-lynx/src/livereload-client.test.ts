// livereload-client 单测（spec: docs/specs/app-lynx-dev-livereload.md）
//
// 覆盖：
// 1. 收到 { type: 'hash' } 后 500ms 内调用 window.location.reload()
// 2. 收到 { type: 'ok' } 后 500ms 内调用 window.location.reload()
// 3. 500ms 内收到多个消息只 reload 一次（去抖）
// 4. ws 断开后 2s 重连
// 5. 非 JSON 消息忽略
// 6. { type: 'warnings' } / { type: 'errors' } 不触发 reload

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'

// mock WebSocket
class MockWebSocket {
  static instances: MockWebSocket[] = []
  url: string
  onmessage: ((event: { data: string }) => void) | null = null
  onclose: (() => void) | null = null
  onerror: (() => void) | null = null
  readyState = 0

  constructor(url: string) {
    this.url = url
    MockWebSocket.instances.push(this)
  }

  close() {
    this.readyState = 3
    this.onclose?.()
  }

  // test helper
  simulateMessage(data: string) {
    this.onmessage?.({ data })
  }

  simulateClose() {
    this.onclose?.()
  }
}

// mock window.location.reload
const mockReload = vi.fn()

describe('livereload-client', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    MockWebSocket.instances = []
    mockReload.mockClear()

    // setup globals
    ;(globalThis as Record<string, unknown>).WebSocket = MockWebSocket
    // mock window.location with full URL
    const g = globalThis as Record<string, unknown>
    if (!g.window) g.window = {}
    const win = g.window as Record<string, unknown>
    win.location = {
      protocol: 'http:',
      hostname: '127.0.0.1',
      port: '3001',
      reload: mockReload,
    }

    // re-import to get fresh module with new mocks
    vi.resetModules()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('should connect to rsbuild-hmr ws endpoint', async () => {
    const { init } = await import('./livereload-client')
    init()
    expect(MockWebSocket.instances.length).toBe(1)
    expect(MockWebSocket.instances[0].url).toBe('ws://127.0.0.1:3001/rsbuild-hmr')
  })

  it('should reload on { type: "hash" } message', async () => {
    const { init } = await import('./livereload-client')
    init()
    const ws = MockWebSocket.instances[0]

    ws.simulateMessage(JSON.stringify({ type: 'hash' }))
    expect(mockReload).not.toHaveBeenCalled() // 去抖：500ms 内不立即调用

    vi.advanceTimersByTime(500)
    expect(mockReload).toHaveBeenCalledTimes(1)
  })

  it('should reload on { type: "ok" } message', async () => {
    const { init } = await import('./livereload-client')
    init()
    const ws = MockWebSocket.instances[0]

    ws.simulateMessage(JSON.stringify({ type: 'ok' }))
    vi.advanceTimersByTime(500)
    expect(mockReload).toHaveBeenCalledTimes(1)
  })

  it('should debounce multiple messages within 500ms', async () => {
    const { init } = await import('./livereload-client')
    init()
    const ws = MockWebSocket.instances[0]

    ws.simulateMessage(JSON.stringify({ type: 'hash' }))
    vi.advanceTimersByTime(100)
    ws.simulateMessage(JSON.stringify({ type: 'ok' }))
    vi.advanceTimersByTime(100)
    ws.simulateMessage(JSON.stringify({ type: 'hash' }))
    vi.advanceTimersByTime(300) // total 500ms from first

    expect(mockReload).toHaveBeenCalledTimes(1)
  })

  it('should reconnect after 2s on ws close', async () => {
    const { init } = await import('./livereload-client')
    init()
    const ws1 = MockWebSocket.instances[0]

    ws1.simulateClose()
    expect(MockWebSocket.instances.length).toBe(1) // 尚未重连

    vi.advanceTimersByTime(2000)
    expect(MockWebSocket.instances.length).toBe(2) // 已重连
  })

  it('should ignore non-JSON messages', async () => {
    const { init } = await import('./livereload-client')
    init()
    const ws = MockWebSocket.instances[0]

    ws.simulateMessage('not json')
    vi.advanceTimersByTime(500)
    expect(mockReload).not.toHaveBeenCalled()
  })

  it('should not reload on { type: "warnings" } or { type: "errors" }', async () => {
    const { init } = await import('./livereload-client')
    init()
    const ws = MockWebSocket.instances[0]

    ws.simulateMessage(JSON.stringify({ type: 'warnings' }))
    vi.advanceTimersByTime(500)
    expect(mockReload).not.toHaveBeenCalled()

    ws.simulateMessage(JSON.stringify({ type: 'errors' }))
    vi.advanceTimersByTime(500)
    expect(mockReload).not.toHaveBeenCalled()
  })
})

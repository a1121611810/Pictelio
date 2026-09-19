// ─── native 路径集成：传输回调 → 真实适配器 → chunked pipeline → store 渲染源 ───
//
// 为什么需要它：模拟器无法验证「流式正文送达」（adb reverse 隧道在 HTTP 200 后不投递
// body，见 packages/app/tests/android-e2e/tools/README.md），因此把该链路的**应用侧**
// 用真实实现串起来：只 mock 传输（nativeTranslate.translateStream），适配器
// （nativeTranslateProvider）、pipeline（createNovelTranslator）、store、i18n 全为真实实现。
//
// Oracle 溯源：断言的是「用户看得见译文」这一需求本身（spec §5 数据流 / §6.3 整段切换），
// 与实现返回的内部值无关 —— 删掉 displayParagraphs 的写入会让本测试红。
// idbKV 兜底路径需要真实 IDB 接口（原生模式未命中时 endpointPrefs 回落 idbKV）——
// 注入 fake-indexeddb，与 tests/unit/stores/novelTranslateStore.test.ts 同模式
import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

const mocks = vi.hoisted(() => ({
  // 只 mock 传输层：原生桥回调
  translateStream: vi.fn(),
  translatePoll: vi.fn(),
  abortStream: vi.fn(),
  getEndpoint: vi.fn(),
  probeEndpoint: vi.fn(),
  setApiKey: vi.fn(),
  clearEndpoint: vi.fn(),
  // 设置侧依赖（store 会用到）
  prefsGet: vi.fn(),
  prefsSet: vi.fn(),
  prefsRemove: vi.fn(),
}))

vi.mock('../../../src/api/nativeTranslate', async (importOriginal) => {
  const orig = await importOriginal<typeof import('../../../src/api/nativeTranslate')>()
  return {
    ...orig, // 保留真实 nativeTranslateProvider（集成点）
    translateStream: mocks.translateStream,
    abortStream: mocks.abortStream,
    getEndpoint: mocks.getEndpoint,
    probeEndpoint: mocks.probeEndpoint,
    setApiKey: mocks.setApiKey,
    clearEndpoint: mocks.clearEndpoint,
  }
})

vi.mock('../../../src/stores/settingsStore', () => ({
  useSettingsStore: () => ({
    language: 'zh-CN',
    isTranslationRestricted: () => false,
    isRestricted: () => false,
  }),
}))


import { useNovelTranslateStore } from '../../../src/stores/novelTranslateStore'

describe('native 路径集成（真实适配器 + 真实 pipeline）', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    setActivePinia(createPinia())
    // 原生桥存在（走 native 路径）
    ;(globalThis as Record<string, unknown>).NativeModules = {
      // 原生模块**形状**必须完整：适配器直接调 mod.translateStream/getEndpoint
      // isNativeMode() 认这四个模块之一；缺了会让 endpointPrefs 回落 idbKV（本测试未注入 IDB → 挂起）
      PictelioAuth: {},
      PictelioTranslate: {
        translateStream: mocks.translateStream,
        translatePoll: mocks.translatePoll,
        abortStream: mocks.abortStream,
        // 原生契约：cb(endpointJson, "") —— 回调载荷是 **JSON 字符串**
        getEndpoint: (cb: (v: string | null, e: string | null) => void) => {
          void (mocks.getEndpoint() as Promise<Record<string, unknown>>).then((v) =>
            cb(JSON.stringify(v), ''),
          )
        },
        probeEndpoint: mocks.probeEndpoint,
        setApiKey: mocks.setApiKey,
        clearEndpoint: mocks.clearEndpoint,
      },
      PictelioPrefs: {
        prefsGet: (k: string, cb: (v: string | null) => void) => cb(mocks.prefsGet(k) ?? ''),
        prefsSet: (k: string, v: string, cb: () => void) => {
          mocks.prefsSet(k, v)
          cb()
        },
        prefsRemove: (k: string, cb: () => void) => {
          mocks.prefsRemove(k)
          cb()
        },
      },
    }
    mocks.prefsGet.mockReturnValue(null)
    mocks.getEndpoint.mockResolvedValue({
      baseURL: 'https://api.deepseek.com',
      model: 'deepseek-flash',
      targetLang: 'zh-CN',
      sourceLang: 'ja',
      hasKey: true,
      updatedAt: 1,
    })
  })

  it('错误终态（HTTP 502 等）→ 状态收敛 failed 且带可读消息，不得停在 translating', async () => {
    // 真机回归：失败终态若不经交付通道，UI 永久停在「n% 翻译中」（ADR-0170 交付通道实测
    // 记录轮询回调 0/158，故失败态也必须走事件总线）。本用例钉住「用户能看到错误」。
    mocks.translateStream.mockImplementation(() => Promise.resolve({ abort: vi.fn() }))
    mocks.translatePoll.mockImplementation(
      (_id: string, cb: (v: string | null, e: string | null) => void) =>
        cb(JSON.stringify({ type: 'error', message: 'HTTP 502: ' }), ''),
    )

    const store = useNovelTranslateStore()
    await store.translateChapter(300, 300, ['第一段'], 0)

    expect(store.status).toBe('failed')
    expect(store.error?.message ?? '').toContain('502')
    // 失败不得留下半截译文
    expect(store.displayParagraphs.join('|')).not.toContain('·译')
  })

  it('原生逐帧回调 → 译文进入渲染源（displayParagraphs）', async () => {
    // 拉模式契约：translateStream 只负责发起；帧由 translatePoll 逐次取回
    mocks.translateStream.mockImplementation(() => Promise.resolve({ abort: vi.fn() }))
    const frames = [
      JSON.stringify({
        type: 'delta_all',
        paragraphs: [
          { index: 0, text: '第一段·译' },
          { index: 1, text: '第二段·译' },
        ],
      }),
      JSON.stringify({ type: 'done' }),
    ]
    mocks.translatePoll.mockImplementation(
      (_id: string, cb: (v: string | null, e: string | null) => void) =>
        cb(frames.shift() ?? JSON.stringify({ type: 'pending' }), ''),
    )

    const store = useNovelTranslateStore()
    const running = store.translateChapter(200, 200, ['第一段', '第二段'], 0)
    await running

    expect(store.status).toBe('completed')
    // 需求本身：用户能看到译文（不是「store 返回了某个值」）
    expect(store.displayParagraphs.join('|')).toContain('第一段·译')
    expect(store.displayParagraphs.join('|')).toContain('第二段·译')
    // 适配器确实把原生载荷按 Java 契约发出
    const sent = JSON.parse(mocks.translateStream.mock.calls[0][0] as string) as Record<string, unknown>
    expect(sent.baseURL).toBe('https://api.deepseek.com')
    expect(sent.input).toEqual(['第一段', '第二段'])
  })

})

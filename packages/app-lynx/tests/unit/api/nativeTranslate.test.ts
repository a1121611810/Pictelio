// ─── app-lynx LLM 翻译 Native Module 包装单测（ADR-0170 + spec #618） ───
//
// oracle / 覆盖：
//   ① 双通道探测：裸 NativeModules（lynx 真机）与 globalThis.NativeModules（备用）
//   ② 回调契约：cb("", "") 成功 / cb("", errMsg) 失败 / cb(chunkJson, "") 多帧 chunk
//   ③ Promise 包装：成功 resolve / 失败 reject（首参空串=成功，非空=错误）
//   ④ abort 语义：streamId 透传到 abortStream；幂等
//   ⑤ web-core / node 降级：缺模块 → reject（PictelioTranslate 不可用），禁假成功
//   ⑥ chunk JSON 解析：原 chunkJson 字符串 / JSON 序列化包裹串都能正确解析
//
// 不测 Java 侧（Java 编译超出 implement 阶段范围；Java 单测留待后续 ticket / Robolectric 阶段）。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  abortStream,
  classifyNativeError,
  clearEndpoint,
  getEndpoint,
  nativeTranslateModule,
  nativeTranslateProvider,
  probeEndpoint,
  setApiKey,
  translateStream,
} from "../../../src/api/nativeTranslate"
import type { NativeTranslateModule } from "../../../src/api/nativeTranslate"

// 测试用 fake 原生模块（callback 暴露，便于 vi.fn() 断言调用形态）
function createFakeModule(): NativeTranslateModule & {
  setApiKey: ReturnType<typeof vi.fn>
  getEndpoint: ReturnType<typeof vi.fn>
  clearEndpoint: ReturnType<typeof vi.fn>
  translateStream: ReturnType<typeof vi.fn>
  probeEndpoint: ReturnType<typeof vi.fn>
  abortStream: ReturnType<typeof vi.fn>
} {
  return {
    setApiKey: vi.fn(),
    getEndpoint: vi.fn(),
    clearEndpoint: vi.fn(),
    translateStream: vi.fn(),
    probeEndpoint: vi.fn(),
    abortStream: vi.fn(),
    translatePoll: vi.fn(),
  }
}

// 注入 helper：把 fake 模块挂到 NativeModules 全局。
// 双通道语义（lynx 裸 NativeModules + globalThis.NativeModules）：Node 测试无裸全局，
// 探测顺序自动落到 globalThis.NativeModules（与 ADR-0053 §1 / tokenStorage.ts:19-26 一致）。
function installNativeModule(mod: NativeTranslateModule | null) {
  const g = globalThis as Record<string, unknown>
  if (mod) {
    g.NativeModules = { PictelioTranslate: mod }
  } else {
    delete g.NativeModules
  }
}

describe("nativeTranslateModule / 双通道探测", () => {
  afterEach(() => {
    delete (globalThis as Record<string, unknown>).NativeModules
    vi.restoreAllMocks()
  })

  it("无原生模块（web-core 预览 / node 测试）→ null", () => {
    expect(nativeTranslateModule()).toBeNull()
  })

  it("globalThis.NativeModules.PictelioTranslate 存在 → 返回该模块", () => {
    const mod = createFakeModule()
    installNativeModule(mod)
    expect(nativeTranslateModule()).toBe(mod)
  })

  it("NativeModules 含其他键但缺 PictelioTranslate → null", () => {
    ;(globalThis as Record<string, unknown>).NativeModules = { Other: {} }
    expect(nativeTranslateModule()).toBeNull()
  })
})

describe("setApiKey Promise 包装", () => {
  let mod: ReturnType<typeof createFakeModule>

  beforeEach(() => {
    mod = createFakeModule()
    installNativeModule(mod)
  })
  afterEach(() => {
    delete (globalThis as Record<string, unknown>).NativeModules
    vi.restoreAllMocks()
  })

  it("原生 cb('', '') → resolve（首参空串=无错误，契约对齐 ADR-0053）", async () => {
    mod.setApiKey.mockImplementation((_apiKey: string, cb: (err: string | null) => void) => cb(""))
    await expect(setApiKey("sk-test-1234567890123456")).resolves.toBeUndefined()
    expect(mod.setApiKey).toHaveBeenCalledWith("sk-test-1234567890123456", expect.any(Function))
  })

  it("原生 cb('', 'Keystore 写入失败') → reject 且错误串已去引号（review N2 假成功防御）", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    mod.setApiKey.mockImplementation((_apiKey: string, cb: (err: string | null) => void) =>
      cb('"Keystore 写入失败：密钥失效"'),
    )
    await expect(setApiKey("sk-test-1234567890123456")).rejects.toThrow("Keystore 写入失败：密钥失效")
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it("无原生模块 → reject（不静默降级，禁假成功）", async () => {
    delete (globalThis as Record<string, unknown>).NativeModules
    await expect(setApiKey("sk-test-1234567890123456")).rejects.toThrow("PictelioTranslate 不可用")
  })
})

describe("getEndpoint Promise 包装", () => {
  let mod: ReturnType<typeof createFakeModule>

  beforeEach(() => {
    mod = createFakeModule()
    installNativeModule(mod)
  })
  afterEach(() => {
    delete (globalThis as Record<string, unknown>).NativeModules
    vi.restoreAllMocks()
  })

  it("原生 cb(endpointJson, '') → resolve 解析后的对象（hasKey=true）", async () => {
    const endpoint = {
      baseURL: "https://api.openai.com/v1",
      model: "gpt-5",
      targetLang: "zh-CN",
      sourceLang: "ja",
      hasKey: true,
      updatedAt: 1726000000000,
    }
    mod.getEndpoint.mockImplementation((cb: (v: string | null, e: string | null) => void) =>
      cb(JSON.stringify(endpoint), ""),
    )
    await expect(getEndpoint()).resolves.toEqual(endpoint)
  })

  it("原生 cb(endpointJson, '') 含 JSON 序列化引号（lynx Callback 实测形态）→ 去引号正确解析", async () => {
    const endpoint = { baseURL: "x", model: "y", hasKey: true, updatedAt: 1 }
    mod.getEndpoint.mockImplementation((cb: (v: string | null, e: string | null) => void) =>
      cb(JSON.stringify(JSON.stringify(endpoint)), ""),
    )
    await expect(getEndpoint()).resolves.toEqual(endpoint)
  })

  it("原生 cb(endpointJson, '') hasKey=false → resolve null（UI 未配置态）", async () => {
    const endpoint = { hasKey: false, updatedAt: 0 }
    mod.getEndpoint.mockImplementation((cb: (v: string | null, e: string | null) => void) =>
      cb(JSON.stringify(endpoint), ""),
    )
    await expect(getEndpoint()).resolves.toBeNull()
  })

  it("原生 cb('', '解密失败') → reject", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    mod.getEndpoint.mockImplementation((cb: (v: string | null, e: string | null) => void) =>
      cb("", "解密失败"),
    )
    await expect(getEndpoint()).rejects.toThrow("解密失败")
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })
})

describe("clearEndpoint Promise 包装", () => {
  let mod: ReturnType<typeof createFakeModule>

  beforeEach(() => {
    mod = createFakeModule()
    installNativeModule(mod)
  })
  afterEach(() => {
    delete (globalThis as Record<string, unknown>).NativeModules
    vi.restoreAllMocks()
  })

  it("原生 cb('', '') → resolve", async () => {
    mod.clearEndpoint.mockImplementation((cb: (err: string | null) => void) => cb(""))
    await expect(clearEndpoint()).resolves.toBeUndefined()
  })

  it("原生 cb('', errMsg) → reject", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    mod.clearEndpoint.mockImplementation((cb: (err: string | null) => void) =>
      cb("删除失败"),
    )
    await expect(clearEndpoint()).rejects.toThrow("删除失败")
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })
})

describe("translateStream 流式契约", () => {
  let mod: ReturnType<typeof createFakeModule>

  beforeEach(() => {
    mod = createFakeModule()
    installNativeModule(mod)
  })
  afterEach(() => {
    delete (globalThis as Record<string, unknown>).NativeModules
    vi.restoreAllMocks()
  })

  it("crypto 全局不可用（真机 PrimJS 实测 typeof crypto === 'undefined'）→ 仍生成 streamId 且透传 _abortToken", async () => {
    // 真机实测 2026-09-19：PrimJS 无 crypto / crypto.randomUUID → 曾在此同步抛
    // ReferenceError，翻译链路整体不可用。期望：降级到纯 JS 生成，streamId 非空、
    // 且注入到 requestJson._abortToken（Java 侧注册表 key 与 abort 必须一致）。
    const originalCrypto = (globalThis as { crypto?: unknown }).crypto
    delete (globalThis as { crypto?: unknown }).crypto
    try {
      let capturedReqJson = ""
      let capturedCb: ((c: string | null, e: string | null) => void) | null = null
      mod.translateStream.mockImplementation(
        (reqJson: string, cb: (c: string | null, e: string | null) => void) => {
          capturedReqJson = reqJson
          capturedCb = cb
        },
      )

      const p = translateStream(JSON.stringify({ paragraphs: ["x"] }), () => {})
      await new Promise((r) => setTimeout(r, 0))
      expect(capturedCb).not.toBeNull()
      capturedCb!(JSON.stringify({ type: "done" }), "")

      const { streamId } = await p
      expect(typeof streamId).toBe("string")
      expect(streamId.length).toBeGreaterThan(0)
      const sent = JSON.parse(capturedReqJson) as { _abortToken?: string }
      expect(sent._abortToken).toBe(streamId)
    } finally {
      if (originalCrypto !== undefined) {
        ;(globalThis as { crypto?: unknown }).crypto = originalCrypto
      }
    }
  })

  it("delta → reasoning_delta → done 序列：onChunk 收到中间帧，done 触发 abort handle resolve", async () => {
    const chunks: unknown[] = []
    let capturedCb: ((c: string | null, e: string | null) => void) | null = null
    mod.translateStream.mockImplementation(
      (_reqJson: string, cb: (c: string | null, e: string | null) => void) => {
        capturedCb = cb
      },
    )

    const p = translateStream(
      JSON.stringify({
        baseURL: "https://api.openai.com/v1",
        model: "gpt-5",
        input: ["hello"],
        stream: true,
      }),
      (chunk) => chunks.push(chunk),
    )

    // 等 microtask（cb 已被捕获）
    await new Promise((r) => setTimeout(r, 0))
    expect(capturedCb).not.toBeNull()

    // 推一帧 delta
    capturedCb!(JSON.stringify({ type: "delta", paragraphIndex: 0, text: "你" }), "")
    expect(chunks).toHaveLength(1)
    expect(chunks[0]).toEqual({ type: "delta", paragraphIndex: 0, text: "你" })

    // 推一帧 reasoning_delta
    capturedCb!(JSON.stringify({ type: "reasoning_delta", text: "thinking..." }), "")
    expect(chunks).toHaveLength(2)
    expect(chunks[1]).toEqual({ type: "reasoning_delta", text: "thinking..." })

    // 推一帧 done → resolve
    capturedCb!(
      JSON.stringify({ type: "done", usage: { inputTokens: 5, outputTokens: 10 } }),
      "",
    )

    const { abort, streamId } = await p
    expect(typeof abort).toBe("function")
    expect(typeof streamId).toBe("string")
    expect(streamId.length).toBeGreaterThan(0)
    // done 帧不被 onChunk 收到（仅中间 chunk 进入 onChunk；done 触发 resolve）
    expect(chunks).toHaveLength(2)
  })

  it("abort 后 Java 端回 err（'Canceled'）→ JS 侧静默忽略（aborted 标记）", async () => {
    let capturedCb: ((c: string | null, e: string | null) => void) | null = null
    let capturedReqJson = ""
    mod.translateStream.mockImplementation(
      (_reqJson: string, cb: (c: string | null, e: string | null) => void) => {
        capturedReqJson = _reqJson
        capturedCb = cb
      },
    )
    mod.abortStream.mockImplementation((_id: string, cb: (e: string | null) => void) => cb(""))

    const p = translateStream(
      JSON.stringify({ baseURL: "https://api.openai.com/v1", model: "gpt-5", input: ["x"] }),
      () => {},
    )
    await new Promise((r) => setTimeout(r, 0))

    // 模拟 done 帧 → resolve abort handle
    capturedCb!(JSON.stringify({ type: "done" }), "")
    const { abort, streamId } = await p

    // 触发 abort
    await abort()
    expect(mod.abortStream).toHaveBeenCalledWith(streamId, expect.any(Function))

    // 模拟 Java abort 后再次给 err 回调（OkHttp 中断后 Java 侧 catch → cb('', 'Canceled')）
    // 因 aborted=true 应被忽略（不抛 unhandled rejection；aborted 与 failed 语义分离）
    let unhandled = false
    const handler = () => {
      unhandled = true
    }
    process.on("unhandledRejection", handler)
    capturedCb!(null, "网络错误：Canceled")
    await new Promise((r) => setTimeout(r, 5))
    process.off("unhandledRejection", handler)
    expect(unhandled).toBe(false)

    // 验证 _abortToken 已注入（与 abortStream 的 streamId 对齐）
    const body = JSON.parse(capturedReqJson) as Record<string, unknown>
    expect(body._abortToken).toBe(streamId)
  })

  it("原生契约破坏：cb(null, null) → reject（无 err 即不假成功）", async () => {
    mod.translateStream.mockImplementation(
      (_req: string, cb: (c: string | null, e: string | null) => void) => cb(null, null),
    )
    await expect(
      translateStream(
        JSON.stringify({ baseURL: "https://api.openai.com/v1", model: "gpt-5", input: ["x"] }),
        () => {},
      ),
    ).rejects.toThrow()
  })

  it("原生 cb('', '尚未配置 API key') → reject", async () => {
    mod.translateStream.mockImplementation(
      (_req: string, cb: (c: string | null, e: string | null) => void) =>
        cb("", "尚未配置 API key"),
    )
    await expect(
      translateStream(
        JSON.stringify({ baseURL: "https://api.openai.com/v1", model: "gpt-5", input: ["x"] }),
        () => {},
      ),
    ).rejects.toThrow("尚未配置 API key")
  })

  it("无原生模块 → reject", async () => {
    delete (globalThis as Record<string, unknown>).NativeModules
    await expect(
      translateStream(
        JSON.stringify({ baseURL: "https://api.openai.com/v1", model: "gpt-5", input: ["x"] }),
        () => {},
      ),
    ).rejects.toThrow("PictelioTranslate 不可用")
  })

  it("requestJson 不是合法 JSON → reject", async () => {
    await expect(translateStream("{not json", () => {})).rejects.toThrow("不是合法 JSON")
  })
})

describe("probeEndpoint Promise 包装", () => {
  let mod: ReturnType<typeof createFakeModule>

  beforeEach(() => {
    mod = createFakeModule()
    installNativeModule(mod)
  })
  afterEach(() => {
    delete (globalThis as Record<string, unknown>).NativeModules
    vi.restoreAllMocks()
  })

  it("原生 cb(probeJson, '') status=ok → resolve 解析对象", async () => {
    const probe = { status: "ok", detail: "endpoint 存在", httpStatus: 200 }
    mod.probeEndpoint.mockImplementation(
      (
        _base: string,
        _key: string,
        _model: string,
        cb: (o: string | null, e: string | null) => void,
      ) => cb(JSON.stringify(probe), ""),
    )
    await expect(probeEndpoint("https://api.openai.com/v1", "sk-test", "gpt-5")).resolves.toEqual(
      probe,
    )
    expect(mod.probeEndpoint).toHaveBeenCalledWith(
      "https://api.openai.com/v1",
      "sk-test",
      "gpt-5",
      expect.any(Function),
    )
  })

  it("原生 cb('', '探测失败：SSL') → reject", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    mod.probeEndpoint.mockImplementation(
      (
        _base: string,
        _key: string,
        _model: string,
        cb: (o: string | null, e: string | null) => void,
      ) => cb("", "探测失败：SSL handshake"),
    )
    await expect(probeEndpoint("https://x", "sk", "m")).rejects.toThrow("探测失败：SSL handshake")
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it("原生返回非预期格式（无 status 字段） → reject", async () => {
    mod.probeEndpoint.mockImplementation(
      (
        _base: string,
        _key: string,
        _model: string,
        cb: (o: string | null, e: string | null) => void,
      ) => cb(JSON.stringify({ foo: "bar" }), ""),
    )
    await expect(probeEndpoint("https://x", "sk", "m")).rejects.toThrow("非预期格式")
  })

  it("无原生模块 → reject", async () => {
    delete (globalThis as Record<string, unknown>).NativeModules
    await expect(probeEndpoint("https://x", "sk", "m")).rejects.toThrow(
      "PictelioTranslate 不可用",
    )
  })
})

describe("abortStream Promise 包装", () => {
  let mod: ReturnType<typeof createFakeModule>

  beforeEach(() => {
    mod = createFakeModule()
    installNativeModule(mod)
  })
  afterEach(() => {
    delete (globalThis as Record<string, unknown>).NativeModules
    vi.restoreAllMocks()
  })

  it("原生 cb('', '') → resolve", async () => {
    mod.abortStream.mockImplementation((_id: string, cb: (e: string | null) => void) => cb(""))
    await expect(abortStream("stream-uuid-123")).resolves.toBeUndefined()
    expect(mod.abortStream).toHaveBeenCalledWith("stream-uuid-123", expect.any(Function))
  })

  it("原生 cb('', errMsg) → reject", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    mod.abortStream.mockImplementation((_id: string, cb: (e: string | null) => void) =>
      cb("取消失败"),
    )
    await expect(abortStream("x")).rejects.toThrow("取消失败")
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it("无原生模块 → resolve（幂等：abort 在 web-core 无意义，不算错）", async () => {
    delete (globalThis as Record<string, unknown>).NativeModules
    await expect(abortStream("x")).resolves.toBeUndefined()
  })
})

// ─────────────── native provider 适配器：Java 侧逐字字段契约 ───────────────
//
// 真机缺陷（2026-09-19 实测）：JS 曾下发 { novelId, chapterId, paragraphs, xRestrict }，
// 而 PictelioTranslateModule.translateStream 逐字解析 { baseURL, model, input, instructions }——
// 字段名不符 → cb("", "baseURL 不能为空") → 翻译永远发不出去。本组测试把该契约钉在
// 适配器（真正构造载荷的唯一位置）上。

describe("nativeTranslateProvider 载荷契约（与 Java 逐字字段对齐）", () => {
  let mod: ReturnType<typeof createFakeModule>

  beforeEach(() => {
    mod = createFakeModule()
    installNativeModule(mod)
  })
  afterEach(() => {
    delete (globalThis as Record<string, unknown>).NativeModules
    vi.restoreAllMocks()
  })

  it("translate() → 载荷含 baseURL / model / input / instructions，且不含 apiKey", async () => {
    let capturedReqJson = ""
    mod.translateStream.mockImplementation(
      (reqJson: string, _cb: (c: string | null, e: string | null) => void) => {
        capturedReqJson = reqJson
        return undefined
      },
    )
    // 拉模式：一帧整章译文 + 一帧 done
    const frames = [
      JSON.stringify({
        type: "delta_all",
        paragraphs: [
          { index: 0, text: "译文一" },
          { index: 1, text: "译文二" },
        ],
      }),
      JSON.stringify({ type: "done" }),
    ]
    mod.translatePoll.mockImplementation((_id: string, cb: (v: string | null, e: string | null) => void) =>
      cb(frames.shift() ?? JSON.stringify({ type: "pending" }), ""),
    )

    const provider = nativeTranslateProvider()
    const iter = provider.translate(
      {
        novelId: 1,
        chapterId: "1",
        paragraphs: ["第一段", "第二段"],
        options: { xRestrict: 0 },
      },
      {
        baseURL: "https://api.deepseek.com",
        apiKey: "", // native：key 在 Java 堆，JS 侧恒为空
        model: "deepseek-flash",
        targetLang: "zh-CN",
        sourceLang: "ja",
      },
      new AbortController().signal,
    )

    // 等适配器发起原生调用 + 首轮轮询
    await new Promise((r) => setTimeout(r, 50))

    const payload = JSON.parse(capturedReqJson) as Record<string, unknown>
    expect(payload.baseURL).toBe("https://api.deepseek.com")
    expect(payload.model).toBe("deepseek-flash")
    expect(payload.input).toEqual(["第一段", "第二段"])
    // instructions 与 web 路径同一构造函数（prompt 单一事实源）
    expect(String(payload.instructions)).toContain("professional novel translator")
    // apiKey 字节零进 JS 堆（ADR-0037）
    expect(capturedReqJson).not.toContain("apiKey")

    // 拉模式：done 帧由 translatePoll 返回（见上面的 mock 序列）
    const chunks: unknown[] = []
    while (true) {
      const { value, done } = await iter.next()
      if (done) break
      chunks.push(value)
    }
    expect(chunks).toContainEqual({ type: "done" })
  })

  it("translate(stream=false) → 载荷 stream=false（ADR-0178 D1 整批回退；code-review P1）", async () => {
    let capturedReqJson = ""
    mod.translateStream.mockImplementation(
      (reqJson: string, _cb: (c: string | null, e: string | null) => void) => {
        capturedReqJson = reqJson
        return undefined
      },
    )
    mod.translatePoll.mockImplementation((_id: string, cb: (v: string | null, e: string | null) => void) =>
      cb(JSON.stringify({ type: "done" }), ""),
    )
    const provider = nativeTranslateProvider()
    const iter = provider.translate(
      {
        novelId: 1,
        chapterId: "1",
        paragraphs: ["a"],
        stream: false, // 整批回退
        options: { xRestrict: 0 },
      },
      { baseURL: "https://x", apiKey: "", model: "m" },
      new AbortController().signal,
    )
    await new Promise((r) => setTimeout(r, 50))
    const payload = JSON.parse(capturedReqJson) as Record<string, unknown>
    // 此前该字段未下发 → Java 硬编码 stream=true → 真机整批回退退化为整章重发 SSE
    expect(payload.stream).toBe(false)
    while (!(await iter.next()).done) {
      // drain
    }
  })

  it("translate(默认) → 载荷 stream=true（保持流式默认）", async () => {
    let capturedReqJson = ""
    mod.translateStream.mockImplementation(
      (reqJson: string, _cb: (c: string | null, e: string | null) => void) => {
        capturedReqJson = reqJson
        return undefined
      },
    )
    mod.translatePoll.mockImplementation((_id: string, cb: (v: string | null, e: string | null) => void) =>
      cb(JSON.stringify({ type: "done" }), ""),
    )
    const provider = nativeTranslateProvider()
    const iter = provider.translate(
      { novelId: 1, chapterId: "1", paragraphs: ["a"], options: { xRestrict: 0 } },
      { baseURL: "https://x", apiKey: "", model: "m" },
      new AbortController().signal,
    )
    await new Promise((r) => setTimeout(r, 50))
    const payload = JSON.parse(capturedReqJson) as Record<string, unknown>
    expect(payload.stream).toBe(true)
    while (!(await iter.next()).done) {
      // drain
    }
  })

  // ─── ADR-0178 D2 触发子集矩阵（code-review P3 阻塞项） ───
  // 此前 native 路径 4 处硬编码 retryable: true（与错误码无关）→ 429/401/402/content_filter
  // 全部会多打一次整章请求，在主力平台上抹平了 web 路径已修好的语义。
  // oracle：ADR-0178 D2 子集表（触发 = server/network/incomplete）。

  it("error frame HTTP 429 → code=rate_limit + retryable=false（不触发整批回退）", async () => {
    mod.translateStream.mockImplementation(() => undefined)
    mod.translatePoll.mockImplementation((_id: string, cb: (v: string | null, e: string | null) => void) =>
      cb(JSON.stringify({ type: "error", message: "HTTP 429: rate limit exceeded" }), ""),
    )
    const provider = nativeTranslateProvider()
    const iter = provider.translate(
      { novelId: 1, chapterId: "1", paragraphs: ["a"], options: { xRestrict: 0 } },
      { baseURL: "https://x", apiKey: "", model: "m" },
      new AbortController().signal,
    )
    const first = await iter.next()
    expect(first.value?.type).toBe("error")
    if (first.value?.type === "error") {
      expect(first.value.code).toBe("rate_limit")
      expect(first.value.retryable).toBe(false)
    }
  })

  it("error frame HTTP 401 → code=unauthorized + retryable=false", async () => {
    mod.translateStream.mockImplementation(() => undefined)
    mod.translatePoll.mockImplementation((_id: string, cb: (v: string | null, e: string | null) => void) =>
      cb(JSON.stringify({ type: "error", message: "HTTP 401: unauthorized" }), ""),
    )
    const provider = nativeTranslateProvider()
    const iter = provider.translate(
      { novelId: 1, chapterId: "1", paragraphs: ["a"], options: { xRestrict: 0 } },
      { baseURL: "https://x", apiKey: "", model: "m" },
      new AbortController().signal,
    )
    const first = await iter.next()
    if (first.value?.type === "error") {
      expect(first.value.code).toBe("unauthorized")
      expect(first.value.retryable).toBe(false)
    } else {
      throw new Error("期望 error chunk")
    }
  })

  it("error frame HTTP 500 → code=server + retryable=true（触发整批回退）", async () => {
    mod.translateStream.mockImplementation(() => undefined)
    mod.translatePoll.mockImplementation((_id: string, cb: (v: string | null, e: string | null) => void) =>
      cb(JSON.stringify({ type: "error", message: "HTTP 500: internal error" }), ""),
    )
    const provider = nativeTranslateProvider()
    const iter = provider.translate(
      { novelId: 1, chapterId: "1", paragraphs: ["a"], options: { xRestrict: 0 } },
      { baseURL: "https://x", apiKey: "", model: "m" },
      new AbortController().signal,
    )
    const first = await iter.next()
    if (first.value?.type === "error") {
      expect(first.value.code).toBe("server")
      expect(first.value.retryable).toBe(true)
    } else {
      throw new Error("期望 error chunk")
    }
  })

  it("error frame 空流消息 → code=content_filter + retryable=false（#654 联动）", async () => {
    mod.translateStream.mockImplementation(() => undefined)
    mod.translatePoll.mockImplementation((_id: string, cb: (v: string | null, e: string | null) => void) =>
      cb(
        JSON.stringify({
          type: "error",
          message: "LLM 未返回任何译文（可能被服务端内容策略拦截）",
        }),
        "",
      ),
    )
    const provider = nativeTranslateProvider()
    const iter = provider.translate(
      { novelId: 1, chapterId: "1", paragraphs: ["a"], options: { xRestrict: 0 } },
      { baseURL: "https://x", apiKey: "", model: "m" },
      new AbortController().signal,
    )
    const first = await iter.next()
    if (first.value?.type === "error") {
      expect(first.value.code).toBe("content_filter")
      // content_filter 不在 D2 触发子集内 → 不得再自动整章重试
      expect(first.value.retryable).toBe(false)
    } else {
      throw new Error("期望 error chunk")
    }
  })

  it("delta chunk 透传 paragraphIndex / text（Java 侧已完成 [N] 锚定）", async () => {
    const frames = [
      JSON.stringify({ type: "delta_all", paragraphs: [{ index: 1, text: "译文" }] }),
      JSON.stringify({ type: "done" }),
    ]
    mod.translateStream.mockImplementation(() => undefined)
    mod.translatePoll.mockImplementation((_id: string, cb: (v: string | null, e: string | null) => void) =>
      cb(frames.shift() ?? JSON.stringify({ type: "pending" }), ""),
    )
    const provider = nativeTranslateProvider()
    const iter = provider.translate(
      { novelId: 1, chapterId: "1", paragraphs: ["a", "b"], options: { xRestrict: 0 } },
      { baseURL: "https://x", apiKey: "", model: "m" },
      new AbortController().signal,
    )
    await new Promise((r) => setTimeout(r, 300))

    const first = await iter.next()
    expect(first.done).toBe(false)
    expect(first.value).toEqual({ type: "delta", paragraphIndex: 1, text: "译文" })
  })
})

/**
 * 空流契约（issue #654 + spec §7.2 新增转移行）。
 *
 * <p>Java 侧空流终态消息字面量 = {@code "LLM 未返回任何译文（可能被服务端内容策略拦截）"}，
 * 必须在 JS 端 {@code classifyNativeError} 命中 {@code content_filter} 分支（与
 * {@code content policy} / {@code content_filter} 同列，{@code nativeTranslate.ts:253}）。
 *
 * <p>这条契约两端守：Java Robolectric 在
 * {@code PictelioTranslateModuleEmptyStreamTest}，JS Vitest 在本文件。任一端字面量
 * 漂移会立刻在 CI 内变红。
 */
describe("classifyNativeError 空流识别（issue #654 跨端契约）", () => {
  it("Java 侧空流错误消息字面量被分类为 content_filter", () => {
    expect(
      classifyNativeError("LLM 未返回任何译文（可能被服务端内容策略拦截）"),
    ).toBe("content_filter")
  })

  it("裸 content_filter 字符串命中", () => {
    expect(classifyNativeError("content_filter")).toBe("content_filter")
  })

  it("content policy 字符串命中", () => {
    expect(classifyNativeError("blocked by content policy")).toBe("content_filter")
  })
})
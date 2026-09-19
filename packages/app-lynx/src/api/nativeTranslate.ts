// ─── app-lynx LLM 翻译 Native Module 包装（ADR-0170 / spec #618） ───
//
// 原生契约（PictelioTranslateModule.java）：
//   setApiKey(apiKey, cb)             → cb("", "") 成功 / cb("", errMsg) 失败
//   getEndpoint(cb)                   → cb(endpointJson, "") 成功 / cb("", errMsg) 失败
//   clearEndpoint(cb)                 → cb("", "") 成功 / cb("", errMsg) 失败
//   translateStream(requestJson, cb)  → 多帧 cb(chunkJson, "") / 终态 cb(doneJson, "") / 错误 cb("", errMsg)
//                                       （aborted 由 abortStream 自身 cb 表达，translateStream 不回调）
//   probeEndpoint(baseURL, apiKey, model, cb) → cb(probeJson, "") / cb("", errMsg)
//   abortStream(streamId, cb)        → cb("", "")（幂等，无活动流也算成功）
//
// API key 全程不出 Java 堆（ADR-0037 字节零进 JS 堆）；JS 侧永不持有明文 key（ADR-0170 §D5.1）。
// web-core 预览 / node 测试无 NativeModules → 走降级适配器（明示失败，禁假成功 #568）。
import { unquoteNativeString } from "../utils/tokenStorage"
import { buildSystemInstructions } from "./translate"
import type { TranslationChunk, TranslationProvider } from "./translate"

/** 原生 PictelioTranslate Module 接口（Lynx Native Module；回调契约见 PictelioTranslateModule.java） */
export interface NativeTranslateModule {
  setApiKey(apiKey: string, cb: (err: string | null) => void): void
  getEndpoint(cb: (value: string | null, err: string | null) => void): void
  clearEndpoint(cb: (err: string | null) => void): void
  translateStream(requestJson: string, cb: (chunk: string | null, err: string | null) => void): void
  probeEndpoint(baseURL: string, apiKey: string, model: string, cb: (ok: string | null, err: string | null) => void): void
  abortStream(streamId: string, cb: (err: string | null) => void): void
}

/** 会话内单调递增序号：streamId 只需在「同一 JS 会话 + Java ACTIVE_CALLS 注册表」内唯一
 *  （JS / Java 两侧用同一个字符串即可对齐 abort），不要求 UUID 形态。 */
let streamSeq = 0

/**
 * 生成流 ID。
 *
 * - 有 crypto.randomUUID（web-core 预览 / node 测试）→ 用标准 UUID；
 * - 无 crypto（真机 Lynx PrimJS 实测 typeof crypto === "undefined"）→ 纯 JS 降级：
 *   时间戳 + 单调序号，同会话内唯一，跨会话时间戳不同。
 */
function newStreamId(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto
  if (typeof c?.randomUUID === "function") {
    return c.randomUUID()
  }
  streamSeq = (streamSeq + 1) >>> 0
  return `s${Date.now().toString(36)}-${streamSeq.toString(36)}`
}

/** 探测原生模块（双通道：lynx 全局 NativeModules + globalThis.NativeModules；同 tokenStorage / lynxClipboard） */
function nativeModule(): NativeTranslateModule | null {
  // 同时检查裸 NativeModules（lynx runtime 全局对象，真机实测不在 globalThis 上）
  const nm = (typeof NativeModules !== "undefined" ? NativeModules : undefined) ??
    (globalThis as {
      NativeModules?: { PictelioTranslate?: NativeTranslateModule }
    }).NativeModules
  return nm?.PictelioTranslate ?? null
}

/** 双通道探测（与 ADR-0053 §1 一致；空模块 = null 给调用方降级用） */
export function nativeTranslateModule(): NativeTranslateModule | null {
  return nativeModule()
}

// ── Promise 包装：成功路径空 err，错误路径抛 Error（web-core 缺模块 → reject 永不假成功） ──

/** 安全解析 chunk JSON；原生可能给首尾带引号的字符串（lynx Callback JSON 序列化，实测见 tokenStorage.ts）。 */
function parseChunk(raw: string | null): unknown {
  if (raw == null) {
    return null
  }
  const unquoted = unquoteNativeString(raw)
  if (unquoted == null) {
    return null
  }
  try {
    return JSON.parse(unquoted)
  } catch {
    return unquoted
  }
}

/** 写 API key 到 Keystore（端到端加密）；失败 reject（warn 可见）。 */
export async function setApiKey(apiKey: string): Promise<void> {
  const mod = nativeModule()
  if (mod) {
    return new Promise((resolve, reject) => {
      mod.setApiKey(apiKey, (err) => {
        const message = unquoteNativeString(err)
        if (message != null && message.length > 0) {
          console.warn("[nativeTranslate] setApiKey 失败", message)
          reject(new Error(message))
          return
        }
        resolve()
      })
    })
  }
  // web-core / node 测试：无原生模块 → 明示失败（禁静默降级；web-core 不支持 LLM 翻译）
  return Promise.reject(new Error("PictelioTranslate 不可用（仅 Android 原生）"))
}

/** 读 endpoint 脱敏镜像：baseURL/model/targetLang/sourceLang/hasKey/updatedAt；
 * 未配置（Keystore 无 apiKey）→ 返回 null；解析失败 reject。 */
export async function getEndpoint(): Promise<unknown | null> {
  const mod = nativeModule()
  if (mod) {
    return new Promise((resolve, reject) => {
      mod.getEndpoint((value, err) => {
        const errMsg = unquoteNativeString(err)
        if (errMsg != null && errMsg.length > 0) {
          console.warn("[nativeTranslate] getEndpoint 失败", errMsg)
          reject(new Error(errMsg))
          return
        }
        const parsed = parseChunk(value)
        // hasKey=false 时返回 null（UI 显示「未配置」分支）
        if (parsed && typeof parsed === "object" && "hasKey" in parsed && parsed.hasKey === false) {
          resolve(null)
          return
        }
        resolve(parsed)
      })
    })
  }
  return Promise.reject(new Error("PictelioTranslate 不可用（仅 Android 原生）"))
}

/** 清空 endpoint（移 Keystore apiKey 密文 + 密钥条目）。 */
export async function clearEndpoint(): Promise<void> {
  const mod = nativeModule()
  if (mod) {
    return new Promise((resolve, reject) => {
      mod.clearEndpoint((err) => {
        const errMsg = unquoteNativeString(err)
        if (errMsg != null && errMsg.length > 0) {
          console.warn("[nativeTranslate] clearEndpoint 失败", errMsg)
          reject(new Error(errMsg))
          return
        }
        resolve()
      })
    })
  }
  return Promise.reject(new Error("PictelioTranslate 不可用（仅 Android 原生）"))
}

/** 流式 chunk 类型（ADR-0170 §D6 决策规约：Responses API 多事件 → 5 种 chunk） */
export type TranslateChunk =
  | { type: "delta"; paragraphIndex: number; text: string }
  | { type: "reasoning_delta"; text: string }
  | { type: "done"; usage?: Record<string, unknown> }
  | { type: "error"; code: string; message: string; retryable: boolean }
  | unknown

/** 流式翻译：监听 chunk → 回调 onChunk；终止 onDone（done chunk 触发）或 onError（error chunk / 网络错）；
 * 用户主动中断由 abortStream() 表达，translateStream 不回调（避免 abort 被当失败）。
 *
 * 返回 Promise<() => void>：resolve 时返回 abort 函数；reject 时翻译未开始或立即失败。
 * 调用方通过 streamId 在外部持有；abort() 触发 abortStream 取消 OkHttp Call。
 *
 * 终止契约（ADR-0170 §D6；真机 DeepSeek 实测后补齐）：原生侧**保证**以 done chunk 或
 * errMsg 终结 —— 服务端未发 {@code response.completed} 而直接断流时，Java 在流末尾合成
 * done。本函数只把 errMsg 非空视为失败、{@code {type:"done"}} 视为成功；两者都没有
 * （契约破坏）时拒绝 promise，绝不静默挂起。 */
export async function translateStream(
  requestJson: string,
  onChunk: (chunk: TranslateChunk) => void,
): Promise<{ abort: () => Promise<void>; streamId: string }> {
  const mod = nativeModule()
  if (!mod) {
    return Promise.reject(new Error("PictelioTranslate 不可用（仅 Android 原生）"))
  }
  // streamId 由 JS 端生成（与 abortStream 对齐；不依赖 _abortToken 字段也能工作）。
  // 禁用 crypto.randomUUID：Lynx PrimJS（真机）无 crypto 全局（2026-09-19 实测 undefined）
  // → 此前在此同步抛 ReferenceError，翻译流根本发不出去。
  const streamId = newStreamId()
  // 把 streamId 注入 requestJson._abortToken（Java 侧 translateStream 优先用此值作注册表 key，
  // 缺省时 Java 侧自生 UUID；保持 JS / Java streamId 一致便于 abort）
  let body: Record<string, unknown>
  try {
    body = JSON.parse(requestJson)
  } catch {
    return Promise.reject(new Error("requestJson 不是合法 JSON"))
  }
  body._abortToken = streamId
  const finalJson = JSON.stringify(body)

  return new Promise((resolve, reject) => {
    let settled = false
    let aborted = false
    mod.translateStream(finalJson, (chunk, err) => {
      // err 非空 = 终态失败（原生契约：cb("", errMsg)）
      const errMsg = unquoteNativeString(err)
      if (errMsg != null && errMsg.length > 0) {
        if (aborted) {
          // abortStream 已回调 → 此处静默忽略（避免 abort 被当成失败上报）
          return
        }
        if (!settled) {
          settled = true
          reject(new Error(errMsg))
        }
        return
      }
      if (chunk == null) {
        // chunk 为 null = 原生契约破坏（应给 ""），禁静默成功
        if (!settled) {
          settled = true
          reject(new Error("translateStream 原生回调契约破坏（chunk=null 无 err）"))
        }
        return
      }
      const parsed = parseChunk(chunk)
      if (parsed && typeof parsed === "object" && "type" in parsed) {
        const type = (parsed as { type: string }).type
        if (type === "done") {
          // 终态成功 → resolve abort handle
          if (!settled) {
            settled = true
            resolve({
              abort: async () => {
                aborted = true
                await abortStream(streamId)
              },
              streamId,
            })
          }
          return
        }
        if (type === "error") {
          if (!settled) {
            settled = true
            const e = parsed as { code?: string; message?: string; retryable?: boolean }
            reject(new Error(`[${e.code ?? "unknown"}] ${e.message ?? "流错误"}`))
          }
          return
        }
      }
      // delta / reasoning_delta 等中间 chunk → 转给 onChunk
      onChunk(parsed as TranslateChunk)
    })
  })
}

/** 探测 endpoint 是否兼容 /v1/responses（spec §6.1 inline probe）。
 * 成功返回 {@code {status, detail, httpStatus, keyInvalid?}}（status ∈ ok|partial|incompatible|unknown，
 * keyInvalid = HTTP 400 且 body 指明密钥无效）；
 * 失败 reject。 */
export async function probeEndpoint(
  baseURL: string,
  apiKey: string,
  model: string,
): Promise<{ status: string; detail: string; httpStatus: number; keyInvalid?: boolean }> {
  const mod = nativeModule()
  if (!mod) {
    return Promise.reject(new Error("PictelioTranslate 不可用（仅 Android 原生）"))
  }
  return new Promise((resolve, reject) => {
    mod.probeEndpoint(baseURL, apiKey, model, (ok, err) => {
      const errMsg = unquoteNativeString(err)
      if (errMsg != null && errMsg.length > 0) {
        console.warn("[nativeTranslate] probeEndpoint 失败", errMsg)
        reject(new Error(errMsg))
        return
      }
      const parsed = parseChunk(ok)
      if (parsed && typeof parsed === "object" && "status" in parsed) {
        resolve(
          parsed as { status: string; detail: string; httpStatus: number; keyInvalid?: boolean },
        )
        return
      }
      reject(new Error("probeEndpoint 返回非预期格式"))
    })
  })
}

/** 取消 in-flight 流（幂等；无活动流也算成功）。streamId 来自 translateStream 返回值。 */
export async function abortStream(streamId: string): Promise<void> {
  const mod = nativeModule()
  if (mod) {
    return new Promise((resolve, reject) => {
      mod.abortStream(streamId, (err) => {
        const errMsg = unquoteNativeString(err)
        if (errMsg != null && errMsg.length > 0) {
          console.warn("[nativeTranslate] abortStream 失败", errMsg)
          reject(new Error(errMsg))
          return
        }
        resolve()
      })
    })
  }
  // web-core 无模块：abort 无意义；resolve（与原生「幂等」语义对齐——非错误路径）
  return Promise.resolve()
}

// ─────────────────── Native provider 适配器（ADR-0169 D5 + ADR-0170） ───────────────────
//
// 为什么需要它：native 路径曾把整章段落一次性塞进单个请求（真机实测 input 达 200-350 段 /
// 上万字），DeepSeek 在 OkHttp read timeout 处断流且不发 response.completed → 翻译永不收敛。
// 现复用 web 路径同款 chunked pipeline（createNovelTranslator：≤2000 字/块 + 并发 3 + 段落
// 对齐 + 整批回退），native 只承担「一块 = 一次流式调用」。
//
// 实例态：每次 translate() 返回一个新的迭代器（各自持有 abort 句柄），因此并发 3 块时
// 互不干扰；chunk.paragraphIndex 是该次请求内的段落序号，与 sub-request 切片天然对齐。
export function nativeTranslateProvider(): TranslationProvider {
  let abortHandle: { abort: () => Promise<void> } | null = null

  return {
    id: "native-bridge",

    translate(request, config, signal): AsyncIterator<TranslationChunk> {
      const queue: TranslationChunk[] = []
      let wake: (() => void) | null = null
      let finished = false
      let failure: Error | null = null
      let aborted = false

      const nudge = (): void => {
        wake?.()
        wake = null
      }

      const onAbort = (): void => {
        aborted = true
        failure = new DOMException("aborted", "AbortError")
        void abortHandle?.abort()
        nudge()
      }
      signal.addEventListener("abort", onAbort, { once: true })

      void translateStream(
        JSON.stringify({
          baseURL: config.baseURL,
          model: config.model,
          input: request.paragraphs,
          instructions: buildSystemInstructions(config),
        }),
        (raw: unknown) => {
          if (aborted) return
          if (raw === null || typeof raw !== "object") return
          const chunk = raw as { type?: string; paragraphIndex?: number; text?: string }
          if (chunk.type === "delta") {
            queue.push({
              type: "delta",
              paragraphIndex:
                typeof chunk.paragraphIndex === "number" ? chunk.paragraphIndex : 0,
              text: chunk.text ?? "",
            })
            nudge()
            return
          }
          if (chunk.type === "reasoning_delta") {
            queue.push({ type: "reasoning_delta", text: chunk.text ?? "" })
            nudge()
          }
        },
      )
        .then((handle) => {
          abortHandle = handle
          if (aborted || signal.aborted) {
            void handle.abort()
            return
          }
          // 原生 done（流内 response.completed 或 Java 在流末尾合成）→ 收尾
          finished = true
          queue.push({ type: "done" })
          nudge()
        })
        .catch((err: unknown) => {
          if (aborted || signal.aborted) return
          const message = err instanceof Error ? err.message : String(err)
          queue.push({ type: "error", code: "unknown", message, retryable: true })
          finished = true
          nudge()
        })
        .finally(() => {
          signal.removeEventListener("abort", onAbort)
          finished = true
          nudge()
        })

      const iter: AsyncIterator<TranslationChunk> = {
        async next(): Promise<IteratorResult<TranslationChunk>> {
          while (true) {
            const value = queue.shift()
            if (value !== undefined) return { value, done: false }
            if (failure) throw failure
            if (finished) return { value: undefined as never, done: true }
            await new Promise<void>((resolve) => {
              wake = resolve
            })
          }
        },
      }
      ;(iter as unknown as { [Symbol.asyncIterator]: () => AsyncIterator<TranslationChunk> })[
        Symbol.asyncIterator
      ] = () => iter
      return iter
    },

    abort(): void {
      void abortHandle?.abort()
    },
  }
}

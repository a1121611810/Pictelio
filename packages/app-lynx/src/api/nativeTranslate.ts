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
import type { TranslationChunk, TranslationErrorCode, TranslationProvider } from "./translate"

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

/**
 * 原生错误消息 → 错误码（ADR-0173 D7：UI 按 code 选 i18n 文案，不直接渲染技术串）。
 *
 * <p>为什么必须分类：适配器此前一律产出 {@code unknown}，于是 HTTP 502 这类明确的
 * 服务端错误在 UI 上显示为「未知错误」——用户拿不到任何可行动信息。
 */
export function classifyNativeError(message: string | undefined): TranslationErrorCode {
  const m = message ?? ""
  const http = /HTTP (\d{3})/.exec(m)
  if (http) {
    const status = Number(http[1])
    if (status === 401 || status === 403) return "unauthorized"
    if (status === 429) return "rate_limit"
    if (status >= 500) return "server"
    return "network"
  }
  if (m.includes("aborted")) return "aborted"
  return "network"
}

/**
 * 订阅全局事件总线上的翻译帧（事件名 {@code pictelioTranslateFrame}）。
 *
 * <p>为什么需要这条通道：NativeModule 的 callback 在真机/模拟器上实测「一条流至多投递
 * 1 次」，且轮询调用也可能完全不回调；而 {@code sendGlobalEvent} 是 benchNav 一直在用的
 * 成熟通道（事件可达 JS 侧 emitter）。
 *
 * @param onFrame 收到一帧（已 JSON 解析）时回调
 * @returns 取消订阅函数
 */
export function attachTranslateFrameListener(
  onFrame: (frame: unknown) => void,
  expectedStreamId?: string,
): () => void {
  /** 首个到达帧携带的 streamId = 原生实际使用的 id（权威值） */
  let adoptedStreamId: string | null = null
  // 与 router.ts / utils/safeArea.ts 同模式：优先全局 lynx，回退 globalThis.lynx
  // （仓内测试夹具正是用 globalThis.lynx = { getJSModule: () => emitter }，见 safeArea.test.ts）
  const lynxGlobal = (
    typeof lynx !== "undefined"
      ? lynx
      : (globalThis as { lynx?: unknown }).lynx
  ) as LynxGlobal | undefined
  const emitter = lynxGlobal?.getJSModule?.("GlobalEventEmitter") as
    | LynxGlobalEventEmitter
    | undefined
  if (!emitter || typeof emitter.addListener !== "function") {
    console.warn("[nativeTranslate] 全局事件通道不可用，翻译帧交付退回轮询")
    return () => {}
  }
  const listener = (...args: unknown[]): void => {
    const raw = args[0]
    if (typeof raw !== "string") {
      // 禁静默降级（测试硬约束 #3）：载荷类型不符 = 跨端契约破坏，必须留信号
      console.warn(
        "[nativeTranslate] 翻译帧载荷类型异常（期望 string），已丢弃：",
        raw === null ? "null" : typeof raw,
      )
      return
    }
    const parsed = parseChunk(raw)
    // 到达探针（ADR-0170「验证探针」）：Java 侧的发送计数不证明到达，交付归因以本行为准。
    // console.warn 落 logcat（tag lynx / lynx_console.cc），无 UI 信号也能判定事件是否到达。
    const probe = parsed as { type?: string; paragraphs?: unknown[]; streamId?: string } | null
    // 探针只在原生运行时打印：jsdom 测试环境没有 lynx 全局，避免测试期大量 console 流量
    // （vitest worker 关闭时 onUserConsoleLog 仍在队列 → EnvironmentTeardownError 假失败）。
    if (typeof lynx !== "undefined") {
      console.warn(
        "[nativeTranslate][probe] 事件到达 type=" +
          String(probe?.type ?? "unparsed") +
          (Array.isArray(probe?.paragraphs) ? " paragraphs=" + probe.paragraphs.length : "") +
          (probe?.streamId != null ? " streamId=" + probe.streamId : ""),
      )
    }
    // 归属过滤：陈旧流（页面切走 / 上一次翻译未结束）的帧不得写进当前翻译。
    // 以**原生回显的 streamId**（它实际使用的 _abortToken）为权威 —— JS 侧生成器与原生
    // 取值可能不同（实测出现过 JS 期望 …-1 / 原生 …-2），用 JS 值判定会误丢本流帧。
    if (expectedStreamId != null && probe?.streamId != null) {
      if (adoptedStreamId === null) adoptedStreamId = probe.streamId
      if (probe.streamId !== adoptedStreamId) {
        console.warn(
          "[nativeTranslate] 丢弃非本流帧 streamId=" + probe.streamId +
            "（本流 " + adoptedStreamId + "）",
        )
        return
      }
    }
    if (parsed === null || typeof parsed !== "object") {
      console.warn("[nativeTranslate] 翻译帧无法解析为帧对象，已丢弃 raw=", raw.slice(0, 120))
      return
    }
    onFrame(parsed)
  }
  emitter.addListener("pictelioTranslateFrame", listener)
  return () => {
    emitter.removeListener?.("pictelioTranslateFrame", listener)
  }
}

/**
 * 拉取一帧（**拉模式交付**）。
 *
 * <p>为什么需要它：实测 lynx NativeModule 的 callback 通道在一条流内至多投递 1 次
 * （逐帧直发 / 加帧间隔 / 主线程逐帧派发 / 合并单帧四种策略下 JS 都只收到 0-1 帧）。
 * 改为 JS 主动轮询：每次 poll 都是一次独立回调调用，单次回调足够可靠。
 *
 * @returns 帧 JSON（{@code delta_all} / {@code done} / {@code error} / {@code pending}）
 */
export async function translatePoll(streamId: string): Promise<unknown> {
  const mod = nativeModule()
  if (!mod) {
    throw new Error("PictelioTranslate 不可用（仅 Android 原生）")
  }
  const modWithPoll = mod as NativeTranslateModule & {
    translatePoll(streamId: string, cb: (v: string | null, e: string | null) => void): void
  }
  if (typeof modWithPoll.translatePoll !== "function") {
    return Promise.reject(new Error("translatePoll 不可用（原生模块版本过旧）"))
  }
  return new Promise((resolve, reject) => {
    modWithPoll.translatePoll(streamId, (value, err) => {
      const errMsg = unquoteNativeString(err)
      if (errMsg != null && errMsg.length > 0) {
        reject(new Error(errMsg))
        return
      }
      resolve(parseChunk(value))
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
        if (pollTimer !== null) clearTimeout(pollTimer)
        detachOnce()
        void abortHandle?.abort()
        nudge()
      }
      signal.addEventListener("abort", onAbort, { once: true })

      // 拉模式：先发起请求（拿到 streamId），再按节奏轮询 translatePoll 取帧。
      // 不再依赖「原生多次回调」—— 该通道在一条流内只投递 1 次（见 translatePoll 注释）。
      let pollTimer: ReturnType<typeof setTimeout> | null = null
      let polls = 0
      const POLL_MS = 250
      const POLL_MAX = 600

      const handle = (raw: unknown): void => {
        if (raw === null || typeof raw !== "object") return
        const chunk = raw as {
          type?: string
          paragraphIndex?: number
          text?: string
          message?: string
          paragraphs?: { index: number; text: string }[]
        }
        if (chunk.type === "delta_all" && Array.isArray(chunk.paragraphs)) {
          for (const one of chunk.paragraphs) {
            queue.push({ type: "delta", paragraphIndex: one.index, text: one.text })
          }
          nudge()
          return
        }
        if (chunk.type === "delta") {
          queue.push({
            type: "delta",
            paragraphIndex: typeof chunk.paragraphIndex === "number" ? chunk.paragraphIndex : 0,
            text: chunk.text ?? "",
          })
          nudge()
          return
        }
        if (chunk.type === "reasoning_delta") {
          queue.push({ type: "reasoning_delta", text: chunk.text ?? "" })
          nudge()
          return
        }
        if (chunk.type === "done") {
          finished = true
          queue.push({ type: "done" })
          nudge()
          return
        }
        if (chunk.type === "error") {
          finished = true
          queue.push({
            type: "error",
            code: classifyNativeError(chunk.message),
            message: chunk.message ?? "native stream failed",
            retryable: true,
          })
          nudge()
          return
        }
        // pending：继续轮询（下一 tick 再取）
      }

      const poll = (streamId: string): void => {
        if (aborted || signal.aborted || finished) return
        if (polls++ > POLL_MAX) {
          finished = true
          queue.push({
            type: "error",
            code: "unknown",
            message: "翻译轮询超时（未在预期时间内完成）",
            retryable: true,
          })
          nudge()
          return
        }
        void translatePoll(streamId)
          .then((frame) => {
            handle(frame)
            if (!finished && !aborted) {
              pollTimer = setTimeout(() => poll(streamId), POLL_MS)
            }
          })
          .catch((err: unknown) => {
            if (aborted || signal.aborted) return
            finished = true
            queue.push({
              type: "error",
              code: classifyNativeError(err instanceof Error ? err.message : String(err)),
              message: err instanceof Error ? err.message : String(err),
              retryable: true,
            })
            nudge()
          })
      }

      // 关键：**不等待** translateStream 的 promise 来获取 streamId —— 该 promise 也经由那条
      // 不可靠的回调通道 settle（实测常永不 settle），拿它当轮询起点会死锁。
      // 改为 JS 侧先生成 streamId（与 translateStream 内部 _abortToken 同源生成器），
      // 随即开始轮询；请求本身 fire-and-forget，其 promise 只用于登记 abort 句柄。
      const streamId = newStreamId()
      void translateStream(
        JSON.stringify({
          baseURL: config.baseURL,
          model: config.model,
          input: request.paragraphs,
          instructions: buildSystemInstructions(config),
          _abortToken: streamId,
        }),
        () => {
          // translateStream 的 callback 通道不可靠（一条流至多一帧），故不在此消费：
          // 帧由事件总线（主通道）交付，轮询作为兜底。
        },
      )
        .then((h) => {
          abortHandle = h
          if (aborted || signal.aborted) void h.abort()
        })
        .catch((err: unknown) => {
          if (aborted || signal.aborted) return
          finished = true
          queue.push({
            type: "error",
            code: "unknown",
            message: err instanceof Error ? err.message : String(err),
            retryable: true,
          })
          nudge()
        })
      // 交付通道一：全局事件总线（benchNav 证明可达；callback 通道实测不可靠）
      // 终态（done/error）时解绑：否则每次翻译都会在全局 emitter 上多留一个监听器，
      // N 次翻译后每帧被 N 个监听器处理（无界泄漏，且旧监听器仍会收新流的帧）。
      let detached = false
      let detachFrames: (() => void) | null = null
      const detachOnce = (): void => {
        if (detached) return
        detached = true
        detachFrames?.()
      }
      detachFrames = attachTranslateFrameListener((raw: unknown) => {
        handle(raw)
        if (finished || aborted) detachOnce()
      }, streamId)
      // 交付通道二（兜底）：轮询拉取
      poll(streamId)

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

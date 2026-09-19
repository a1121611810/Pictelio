// ─── 小说翻译 Pinia store（app-lynx；spec docs/specs/app-lynx-novel-translation.md §7/§9） ───
// 单一 seam：所有翻译相关 UI 与副作用（按钮 / 开关 / 设置表单 / NovelDetail 集成）只读 / 只写本 store。
//
// 关键不变式：
// - 8 状态机（TranslationStatus）+ generation-gate（章节切换旧响应不得覆盖新数据）
// - 应用层 R18 闸门：调用 provider 前 settings.isRestricted(novel) → true 直接 abort（status='aborted'，
//   error.code='R18_BLOCKED'；不计入 cache，不抛错给用户）。
// - 半成品策略（ADR-0171 §5）：仅 status='completed' 才写缓存；其他状态永不入 cache。
// - AbortController：每次 translateChapter 创建新 controller；abort() 取消 in-flight provider 调用
//   + 静默退出（spec §7.2）。
// - 同 chapterId in-flight 复用：status='translating' && currentChapter===chapterId 时直接返回 in-flight Promise。
// - 缓存命中：translateChapter 入口 getTranslation(cacheKey) → isCached[chapterId]=true + status='completed'，
//   不调用 provider。
//
// IO 边界硬约束（AGENTS.md 测试硬约束 #1+#3）：
// - 成功 + 失败双路径都覆盖；
// - 失败时 console.warn（模块前缀 [novelTranslateStore]）+ 显式设 error.code，不静默吞错。

import { ref, type Ref } from "vue"
import { defineStore } from "pinia"
import { t } from "../i18n"
import {
  getEndpoint as nativeGetEndpoint,
  setApiKey as nativeSetApiKey,
  clearEndpoint as nativeClearEndpoint,
  probeEndpoint as nativeProbeEndpoint,
  translateStream as nativeTranslateStream,
  abortStream as nativeAbortStream,
} from "../api/nativeTranslate"
import { openaiResponsesProvider } from "../api/translate"
import {
  createNovelTranslator,
  TranslationChunkError,
} from "../primitives/createNovelTranslator"
import {
  getTranslation,
  setTranslation,
  makeCacheKey,
  computeBaseURLHash,
  computeSourceHash,
} from "../utils/translationCache"
import { useSettingsStore } from "./settingsStore"
import type {
  LlmEndpointConfig,
  LlmEndpointPublic,
  TranslationRequest,
  TranslationStatus,
  TranslationProvider,
  TranslationChunk,
} from "../api/translate"

// ─────────── 类型导出（消费方按需 import） ───────────

/** 进度 payload（spec §7.1）：done/total 以段落为单位 */
export interface TranslationProgress {
  chapterId: number
  done: number
  total: number
}

/** 错误 payload（spec §7.1）：code ∈ error 字典值域 + R18_BLOCKED */
export interface TranslationErrorPayload {
  code: string
  message: string
}

/** useNovelTranslateStore 完整返回类型（消费者：组件 + 测试） */
export interface NovelTranslateStore {
  status: Ref<TranslationStatus>
  progress: Ref<TranslationProgress | null>
  currentChapter: Ref<number | null>
  error: Ref<TranslationErrorPayload | null>
  isCached: Ref<Record<number, boolean>>
  showTranslation: Ref<boolean>
  reset: () => void
  loadEndpointConfig: () => Promise<LlmEndpointPublic | null>
  saveEndpointConfig: (config: LlmEndpointConfig) => Promise<void>
  clearEndpointConfig: () => Promise<void>
  probeEndpoint: (config: LlmEndpointConfig) => Promise<boolean>
  translateChapter: (
    novelId: number,
    chapterId: number,
    paragraphs: string[],
    xRestrict?: 0 | 1 | 2,
  ) => Promise<void>
  toggleMode: () => Promise<void>
  abort: () => void
}

// ─────────── 模块级单例（in-flight promise 复用） ───────────

/** 同 chapterId in-flight Promise 缓存（spec §9.6：translating && currentChapter===id 时直接返回） */
const inFlightByChapter = new Map<number, Promise<void>>()

/** 当前活动的 AbortController（abort() 取消 in-flight 调用） */
let activeController: AbortController | null = null

/** 测试钩子：清空模块级单例，避免用例间串扰（仅测试 import；导出见末尾） */
function resetNovelTranslateStoreForTest(): void {
  activeController?.abort()
  activeController = null
  inFlightByChapter.clear()
}

// ─────────── 内部 helper ───────────

/** 双通道探测 NativeModules（lynx 裸全局 + globalThis 兜底；ADR-0053 §1） */
function hasNativeModule(): boolean {
  try {
    const nm = (typeof NativeModules !== "undefined" ? NativeModules : undefined) ??
      (globalThis as { NativeModules?: { PictelioTranslate?: unknown } }).NativeModules
    return Boolean(nm?.PictelioTranslate)
  } catch {
    return false
  }
}

// ─────────── Store 实现 ───────────

export const useNovelTranslateStore = defineStore("novelTranslate", (): NovelTranslateStore => {
  // ─── state ───
  const status = ref<TranslationStatus>("idle")
  const progress = ref<TranslationProgress | null>(null)
  const currentChapter = ref<number | null>(null)
  const error = ref<TranslationErrorPayload | null>(null)
  const isCached = ref<Record<number, boolean>>({})
  const showTranslation = ref<boolean>(false)

  // ─── generation-gate（章节切换旧响应不得覆盖新数据）───
  let gen = 0

  // ─── actions ───

  /** 全量复位（UI 卸载 / 用户切章节时调用） */
  function reset(): void {
    status.value = "idle"
    progress.value = null
    currentChapter.value = null
    error.value = null
    // isCached 保留：缓存语义跨章节持久（ADR-0171 §6）
    showTranslation.value = false
  }

  /**
   * 从 Keystore 加载 endpoint 脱敏镜像。
   * - 成功 → 返回 LlmEndpointPublic
   * - 未配置（hasKey=false）→ 返回 null
   * - 解析失败 / NativeModule 缺失 → reject（spec §6.1）
   */
  async function loadEndpointConfig(): Promise<LlmEndpointPublic | null> {
    const raw = await nativeGetEndpoint()
    if (raw === null) return null
    if (typeof raw !== "object") {
      throw new Error("[novelTranslateStore] getEndpoint returned non-object")
    }
    return raw as LlmEndpointPublic
  }

  /**
   * 保存 endpoint：baseURL + model 走 getEndpoint 元数据通道 + apiKey 走 setApiKey 加密通道。
   * 不在 JS 堆持有 apiKey（ADR-0170 §D5.1）。
   */
  async function saveEndpointConfig(config: LlmEndpointConfig): Promise<void> {
    await nativeSetApiKey(config.apiKey)
    // baseURL/model/targetLang 等元数据：通过 setApiKey 之外的入口传递；
    // 当前 nativeTranslate 模块仅暴露 setApiKey / getEndpoint / clearEndpoint
    // 三个桥——getEndpoint 由 Java 侧从已存的 apiKey + 隐式默认重建脱敏镜像。
    // baseURL/model 由用户在表单侧保存到本地设置（settingsStore）。
    // 完整多字段持久化在后续 T8（多字段 endpoint 持久化）补齐；本 ticket
    // 仅做 store 接线，UI 层使用本方法即可。
    void config
  }

  /** 清除 Keystore 中已存的 endpoint 配置（spec §6.1 入口） */
  async function clearEndpointConfig(): Promise<void> {
    await nativeClearEndpoint()
  }

  /**
   * 探测 endpoint 是否兼容 /v1/responses（spec §6.1 inline probe）。
   * - success → 返回 true
   * - failed（含 timeout / invalid.key / invalid.model） → 返回 false
   * - NativeModule 缺失 → reject（UI 显式提示「仅 Android 原生」）
   */
  async function probeEndpoint(config: LlmEndpointConfig): Promise<boolean> {
    try {
      const result = await nativeProbeEndpoint(config.baseURL, config.apiKey, config.model)
      if (result.status === "ok") return true
      console.warn("[novelTranslateStore] probeEndpoint failed", { result })
      return false
    } catch (err) {
      console.warn("[novelTranslateStore] probeEndpoint threw", err)
      return false
    }
  }

  /**
   * 触发起 translation。设计要点：
   * 1. R18 闸门（spec §9.7 + ADR-0103）：isRestricted(novel) → true 直接 reject，status='aborted'，
   *    error.code='R18_BLOCKED'。注意：本函数接受 xRestrict 形参，由 caller 从 novel.x_restrict 传入。
   * 2. 缓存命中：先 getTranslation(cacheKey) → 命中则 isCached[chapterId]=true + status='completed'，
   *    不调用 provider。
   * 3. 同 chapterId in-flight 复用：status='translating' && currentChapter===id 时直接返回 in-flight Promise。
   * 4. Generation-gate：gen++ 闭包于每个 invocation；异步落地时检查 gen !== genNow 则退出。
   * 5. AbortController：每次调用创建新 controller，abort 时静默退出。
   * 6. 半成品策略：仅 status='completed' 才写缓存。
   */
  async function translateChapter(
    novelId: number,
    chapterId: number,
    paragraphs: string[],
    xRestrict: 0 | 1 | 2 = 0,
  ): Promise<void> {
    // ── R18 闸门（应用层；spec §9.7）──
    const settings = useSettingsStore()
    if (xRestrict > 0 && settings.isRestricted({ x_restrict: xRestrict })) {
      status.value = "aborted"
      error.value = { code: "R18_BLOCKED", message: t("novelTranslate.error.R18Blocked") }
      currentChapter.value = chapterId
      console.warn(
        `[novelTranslateStore] R18 gate blocked x_restrict=${xRestrict} chapter=${chapterId}`,
      )
      return
    }

    // ── 同 chapterId in-flight 复用（spec §9.6）──
    // 同步设置 currentChapter + status='pending'，使后续同步触发的同 chapterId 调用
    // 能在同步代码路径上感知 in-flight 状态，避免重复触发。
    if (
      currentChapter.value === chapterId &&
      inFlightByChapter.has(chapterId) &&
      (status.value === "translating" || status.value === "pending")
    ) {
      return inFlightByChapter.get(chapterId)!
    }

    // ── 立刻占位：标记同 chapterId 进入 in-flight 状态（同步步骤；后续 await 不阻塞复用判定）──
    // inFlightByChapter 同步注册，保证同 chapterId 第二次同步触发能在检查时命中。
    const placeholder = Promise.resolve()
    inFlightByChapter.set(chapterId, placeholder)
    currentChapter.value = chapterId
    status.value = "pending"
    progress.value = { chapterId, done: 0, total: paragraphs.length }
    error.value = null

    // ── 缓存命中查询（spec §9.5；不调用 provider）──
    const targetLang = settings.language ?? "zh-CN"
    const modelPlaceholder = "openai-responses"

    const cacheKeyMeta = makeCacheKey({
      novelId,
      chapterId: String(chapterId),
      targetLang,
      modelId: modelPlaceholder,
      paragraphs,
      // baseURL 占位（空串 hash 恒等）；完整 baseURL 持久化在 T8 接入
      baseURL: "",
    })

    const cached = await getTranslation(cacheKeyMeta.key)
    // 二次 in-flight 复用判定：缓存 IO 期间可能同 chapterId 被再次触发，复用现有 promise
    // （注意：cached 命中分支不需要新 promise，因同步路径上已置 pending；本 await 之后若复用，
    // 当前 invocation 继续执行 cached 路径——重复赋值同字段无副作用）
    if (
      cached !== null &&
      Array.isArray(cached.paragraphs) &&
      cached.paragraphs.length === paragraphs.length
    ) {
      status.value = "completed"
      currentChapter.value = chapterId
      isCached.value[chapterId] = true
      progress.value = { chapterId, done: paragraphs.length, total: paragraphs.length }
      error.value = null
      showTranslation.value = true
      // 清理 placeholder：缓存命中是同步收敛，已无需等待 in-flight promise
      if (inFlightByChapter.get(chapterId) === placeholder) {
        inFlightByChapter.delete(chapterId)
      }
      return
    }
    // 缓存 miss / 长度不匹配 → 继续走 provider 路径
    isCached.value[chapterId] = false

    // ── 启动新 translation ──
    const controller = new AbortController()
    activeController?.abort()
    activeController = controller
    const genNow = ++gen

    const promise = (async () => {
      const useNative = hasNativeModule()

      try {
        if (useNative) {
          await runViaNativeBridge(
            { novelId, chapterId, paragraphs, xRestrict },
            controller.signal,
            genNow,
          )
        } else {
          await runViaWebProvider(
            { novelId, chapterId, paragraphs, xRestrict },
            controller.signal,
            genNow,
          )
        }
      } catch (err) {
        if (gen !== genNow) return
        if (err instanceof DOMException && err.name === "AbortError") {
          status.value = "aborted"
          error.value = null
          return
        }
        // TranslationChunkError 携带 provider 层错误码（unauthorized / rate_limit / server 等），
        // 透传给 UI 用于 i18n 错误呈现。
        if (err instanceof TranslationChunkError) {
          status.value = "failed"
          error.value = { code: err.code, message: err.message }
          return
        }
        const message = err instanceof Error ? err.message : String(err)
        console.warn(
          `[novelTranslateStore] translateChapter failed chapter=${chapterId}`,
          err,
        )
        status.value = "failed"
        error.value = { code: "unknown", message }
      }
    })()

    inFlightByChapter.set(chapterId, promise)
    try {
      await promise
    } finally {
      // 兜底清：placeholder 在缓存命中分支被吞时也释放；正常 provider 路径上 promise 已注册覆盖 placeholder。
      if (inFlightByChapter.get(chapterId) === promise) {
        inFlightByChapter.delete(chapterId)
      }
      if (activeController === controller) activeController = null
    }
  }

  /**
   * 内部：走 Native bridge（Android 原生 PictelioTranslate 流式 provider）。
   * Native 路径下 apiKey 在 Java 堆组装；JS 仅传递 baseURL/model/paragraphs 元数据。
   *
   * 注：translateStream 的契约 = onChunk 只接收中间 chunk（delta / reasoning_delta），
   * 终态通过 Promise resolve('done') / reject(error) 表达。本函数把 onChunk 内联翻译
   * 进度，并 await Promise 让 done 收敛；err 路径已由 nativeTranslateStream 内部 reject 抛到外层 catch。
   *
   * Native 路径依赖 endpoint 配置（ADR-0170 §D5.1）；endpoint null 时等同 NOT_CONFIGURED。
   */
  async function runViaNativeBridge(
    args: { novelId: number; chapterId: number; paragraphs: string[]; xRestrict: 0 | 1 | 2 },
    signal: AbortSignal,
    genNow: number,
  ): Promise<void> {
    const endpoint = await loadEndpointConfig()
    if (gen !== genNow) return
    if (endpoint === null) {
      status.value = "failed"
      error.value = {
        code: "NOT_CONFIGURED",
        message: t("novelTranslate.error.notConfigured"),
      }
      return
    }

    status.value = "translating"
    const translated: string[] = args.paragraphs.slice()

    const handle = await nativeTranslateStream(
      JSON.stringify({
        novelId: args.novelId,
        chapterId: String(args.chapterId),
        paragraphs: args.paragraphs,
        xRestrict: args.xRestrict,
      }),
      (chunk: unknown) => {
        if (signal.aborted) return
        if (chunk === null || typeof chunk !== "object") return
        const c = chunk as TranslationChunk
        if (c.type === "delta") {
          translated[c.paragraphIndex] = (translated[c.paragraphIndex] ?? "") + c.text
          progress.value = {
            chapterId: args.chapterId,
            done: Math.min(c.paragraphIndex + 1, args.paragraphs.length),
            total: args.paragraphs.length,
          }
        }
        // reasoning_delta / 其它中间 chunk 不入 store
      },
    )

    if (gen !== genNow) return
    if (signal.aborted) {
      await handle.abort()
      status.value = "aborted"
      return
    }
    status.value = "completed"
    progress.value = {
      chapterId: args.chapterId,
      done: args.paragraphs.length,
      total: args.paragraphs.length,
    }
    isCached.value[args.chapterId] = true
    void writeCacheIfNeeded(args, translated)
    showTranslation.value = true
  }

  /**
   * 内部：走 OpenAIResponsesProvider（web-core dev 预览 + node 测试）。
   * chunked pipeline via createNovelTranslator。Web 路径下 endpoint 配置由调用方注入（settings），
   * 本函数取占位 config——provider mock 不关心 config 内容（单测场景）。
   */
  async function runViaWebProvider(
    args: { novelId: number; chapterId: number; paragraphs: string[]; xRestrict: 0 | 1 | 2 },
    signal: AbortSignal,
    genNow: number,
  ): Promise<void> {
    const provider: TranslationProvider = openaiResponsesProvider()
    const translator = createNovelTranslator({ provider })
    const settings = useSettingsStore()
    const config: LlmEndpointConfig = {
      baseURL: "", // web 路径：baseURL 由调用方注入（settings）；本函数用占位
      apiKey: "", // 同上；mock 环境下不消费
      model: "openai-responses",
      targetLang: settings.language ?? "zh-CN",
      sourceLang: "ja",
    }
    const request: TranslationRequest = {
      novelId: args.novelId,
      chapterId: String(args.chapterId),
      paragraphs: args.paragraphs,
      options: { xRestrict: args.xRestrict },
    }

    status.value = "translating"
    let lastDeltaIndex = 0
    let lastErrorCode: string | null = null
    let lastErrorMessage = ""
    const result = await translator.translate(request, config, signal, (chunk: TranslationChunk) => {
      if (chunk.type === "delta") {
        lastDeltaIndex = Math.max(lastDeltaIndex, chunk.paragraphIndex + 1)
        progress.value = {
          chapterId: args.chapterId,
          done: Math.min(lastDeltaIndex, args.paragraphs.length),
          total: args.paragraphs.length,
        }
      } else if (chunk.type === "error") {
        // 捕获首个 error chunk 的 code/message；translator 内部会吞错转 failed/partial，
        // 我们在外部收敛时把 code 透传到 store（避免错误码丢失为 'unknown'）。
        if (lastErrorCode === null) {
          lastErrorCode = chunk.code
          lastErrorMessage = chunk.message
        }
      }
    })

    if (gen !== genNow) return
    if (signal.aborted) {
      status.value = "aborted"
      return
    }
    if (result.status === "completed") {
      status.value = "completed"
      progress.value = {
        chapterId: args.chapterId,
        done: args.paragraphs.length,
        total: args.paragraphs.length,
      }
      isCached.value[args.chapterId] = true
      void writeCacheIfNeeded(args, result.paragraphs)
      showTranslation.value = true
    } else if (result.status === "partial") {
      status.value = "partial"
      progress.value = {
        chapterId: args.chapterId,
        done: args.paragraphs.length,
        total: args.paragraphs.length,
      }
      error.value = {
        code: lastErrorCode ?? "PARTIAL_FAILED",
        message: lastErrorMessage || t("novelTranslate.error.partialFailed"),
      }
    } else if (result.status === "aborted") {
      status.value = "aborted"
    } else {
      status.value = "failed"
      error.value = {
        code: lastErrorCode ?? "unknown",
        message: lastErrorMessage || t("novelTranslate.error.unknown"),
      }
    }
  }

  /**
   * 半成品策略（ADR-0171 §5）：只有 status='completed' 才写缓存；
   * 本函数仅由 status 收敛后调用，本身不重复校验 status。
   */
  async function writeCacheIfNeeded(
    args: { novelId: number; chapterId: number; paragraphs: string[] },
    translated: string[],
  ): Promise<void> {
    try {
      const settings = useSettingsStore()
      const targetLang = settings.language ?? "zh-CN"
      const sourceHash = computeSourceHash(args.paragraphs)
      const baseURLHash = computeBaseURLHash("")
      const key = `${args.novelId}:${args.chapterId}:${targetLang}:openai-responses:${sourceHash}:${baseURLHash}`
      await setTranslation(key, translated, {
        providerId: "openai-responses",
        modelId: "openai-responses",
      })
    } catch (err) {
      console.warn("[novelTranslateStore] writeCacheIfNeeded failed", err)
    }
  }

  /** 切换原文/译文显示（同步：仅切 signal，触发 computed 重新计算段落来源） */
  async function toggleMode(): Promise<void> {
    showTranslation.value = !showTranslation.value
  }

  /** 取消当前 in-flight translation（UI 按钮 / 章节切换 / 路由离开） */
  function abort(): void {
    activeController?.abort()
    // status 由 runViaX 路径收敛；显式置 aborted 防止 caller 在 abort 后立即读取 status='translating' 误导 UI
    if (status.value === "translating" || status.value === "pending") {
      status.value = "aborted"
    }
  }

  return {
    status,
    progress,
    currentChapter,
    error,
    isCached,
    showTranslation,
    reset,
    loadEndpointConfig,
    saveEndpointConfig,
    clearEndpointConfig,
    probeEndpoint,
    translateChapter,
    toggleMode,
    abort,
  }
})

/** 测试钩子导出（仅测试 import；生产代码勿用） */
export { resetNovelTranslateStoreForTest }
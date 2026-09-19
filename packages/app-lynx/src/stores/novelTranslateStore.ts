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
import { getNativeModules, isNativeMode } from "../api/client"
import { extractHostname } from "../utils/safeParseUrl"
import { idbGet, idbRemove, idbSet } from "../utils/idbKV"
import {
  getEndpoint as nativeGetEndpoint,
  setApiKey as nativeSetApiKey,
  clearEndpoint as nativeClearEndpoint,
  probeEndpoint as nativeProbeEndpoint,
  nativeTranslateProvider,
} from "../api/nativeTranslate"
import { buildSystemInstructions, openaiResponsesProvider } from "../api/translate"
import {
  createNovelTranslator,
  TranslationChunkError,
} from "../primitives/createNovelTranslator"
import {
  getTranslation,
  setTranslation,
  makeCacheKey,
  computeSourceHash,
  isTranslationCacheAvailable,
  removeTranslation,
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
/** chunked pipeline 的块起始偏移（非枚举，只在 JS 内存传递，不进 JSON 载荷） */
export const CHUNK_OFFSET = Symbol("chunkOffset")

/**
 * 端点兼容性（**地址层**事实，spec §6.1 / ADR-0173 D1）：由 dummy-key 探测产生，
 * 与「凭据是否有效」正交。八态（含 idle 与实现新增的 incompatible）。
 */
export type EndpointCompatibilityStatus =
  | "idle"
  | "ok"
  | "azure"
  | "deepseek"
  | "vllm"
  | "partial"
  | "incompatible"
  | "unknown"

export interface ProbeClassification {
  status: EndpointCompatibilityStatus
  detail: string
  httpStatus: number
}

/** 凭据验证（**密钥层**事实，ADR-0173 D1/D4）：只由「测试连接」用真实 key 产生 */
export type CredentialVerificationState = "unverified" | "verified" | "failed"

export interface CredentialVerification {
  state: CredentialVerificationState
  /** 验证时刻（毫秒）；unverified 时为 null */
  at: number | null
  /**
   * 该结论对应的 baseURL（非密；ADR-0173 D4③）。
   * UI 必须拿它跟**当前输入框**比对 —— 否则用户改了地址但没保存时，
   * 徽章还会显示旧地址的「已验证」（ADR 点名的最危险假象）。
   */
  baseUrl: string | null
}

export interface NovelTranslateStore {
  status: Ref<TranslationStatus>
  progress: Ref<TranslationProgress | null>
  /** 端点兼容性（地址层） */
  compatibility: Ref<EndpointCompatibilityStatus>
  /** 凭据验证（密钥层） */
  credential: Ref<CredentialVerification>
  /** 当前章节译文段落（与 sourceParagraphs 等长；缺项 = 原文回退） */
  translatedParagraphs: Ref<string[]>
  /** 当前章节原文段落（displayParagraphs 的回退源） */
  sourceParagraphs: Ref<string[]>
  /** 渲染源：showTranslation 为真且译文非空 → 译文，否则原文（spec §6.3 整段切换） */
  displayParagraphs: Ref<string[]>
  currentChapter: Ref<number | null>
  error: Ref<TranslationErrorPayload | null>
  isCached: Ref<Record<number, boolean>>
  showTranslation: Ref<boolean>
  reset: () => void
  loadEndpointConfig: () => Promise<LlmEndpointPublic | null>
  saveEndpointConfig: (config: LlmEndpointConfig) => Promise<void>
  clearEndpointConfig: () => Promise<void>
  probeCompatibility: (baseURL: string) => Promise<ProbeClassification>
  testConnection: (config: LlmEndpointConfig) => Promise<{ ok: boolean; code: string; detail: string }>
  translateChapter: (
    novelId: number,
    chapterId: number,
    paragraphs: string[],
    xRestrict?: 0 | 1 | 2,
  ) => Promise<void>
  retranslate: (
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

// ─────────── endpoint 元数据持久化（ADR-0170 §D5.1） ───────────
// apiKey 走 Java Keystore（永不出 Java 堆）；非密字段（baseURL / model / targetLang）
// 走设置 KV —— 与 settingsStore 的 prefs seam 同模式：原生 SharedPreferences（跨 client 共享，
// ADR-0103）/ web-core 预览与 node 测试走 idbKV。键名加 `llm` 前缀避开设置键命名空间。
const LLM_PREFS_BASE_URL = "llm_endpoint_base_url"
const LLM_PREFS_MODEL = "llm_endpoint_model"
const LLM_PREFS_TARGET_LANG = "llm_endpoint_target_lang"
// 凭据验证（ADR-0173 D4）：只存结果枚举 + 时间戳 + 用于失效判定的 baseURL，
// **不存任何密钥材料**（连哈希都不存——无必要的离线校验面）。
const LLM_PREFS_VERIFY_STATE = "llm_endpoint_verified_state"
const LLM_PREFS_VERIFY_AT = "llm_endpoint_verified_at"
const LLM_PREFS_VERIFY_BASE_URL = "llm_endpoint_verified_base_url"

interface EndpointPrefsStorage {
  get: (key: string) => Promise<string | null>
  set: (key: string, value: string) => Promise<void>
  remove: (key: string) => Promise<void>
}

/**
 * endpoint 元数据 KV seam —— 与 settingsStore.prefs 同判定（ADR-0172 §2）：
 * `isNativeMode() ? nativePrefs : idbKV`。原生模式下若 PictelioPrefs 缺失，**必须 warn**
 * （静默回落 idbKV 在 PrimJS 上是死路：indexedDB 不存在）。
 */
function endpointPrefs(): EndpointPrefsStorage {
  if (isNativeMode() && !getNativeModules()?.PictelioPrefs) {
    console.warn("[novelTranslateStore] 原生模式缺 PictelioPrefs，endpoint 元数据将无法持久化")
  }
  const nativePrefs = getNativeModules()?.PictelioPrefs as
    | {
        prefsGet: (key: string, cb: (value: string | null) => void) => void
        prefsSet: (key: string, value: string, cb: () => void) => void
        prefsRemove: (key: string, cb: () => void) => void
      }
    | undefined
  if (nativePrefs) {
    return {
      // 原生契约：键不存在返回空串（不传 null——CallbackImpl 对 null 参数崩）
      get: (key) =>
        new Promise((resolve) => {
          nativePrefs.prefsGet(key, (value) => {
            const v = typeof value === "string" ? value : null
            resolve(v === null || v === "" ? null : v)
          })
        }),
      set: (key, value) =>
        new Promise((resolve) => {
          nativePrefs.prefsSet(key, value, () => resolve())
        }),
      remove: (key) =>
        new Promise((resolve) => {
          nativePrefs.prefsRemove(key, () => resolve())
        }),
    }
  }
  return {
    get: idbGet,
    set: (key, value) => idbSet(key, value),
    remove: idbRemove,
  }
}

/** 读 endpoint 非密元数据（缺失 → undefined，调用方回退 Java 默认值） */
async function readEndpointMetadata(): Promise<{
  baseURL?: string
  model?: string
  targetLang?: string
}> {
  try {
    const prefs = endpointPrefs()
    const [baseURL, model, targetLang] = await Promise.all([
      prefs.get(LLM_PREFS_BASE_URL),
      prefs.get(LLM_PREFS_MODEL),
      prefs.get(LLM_PREFS_TARGET_LANG),
    ])
    return {
      baseURL: baseURL ?? undefined,
      model: model ?? undefined,
      targetLang: targetLang ?? undefined,
    }
  } catch (err) {
    // 读失败不阻断翻译（回退 Java 默认值）；但必须可见（AGENTS.md 硬约束 #3）
    console.warn("[novelTranslateStore] endpoint 元数据读取失败（回退默认值）", err)
    return {}
  }
}

/** 读凭据验证状态（缺失 / 读失败 → unverified；读失败必须可见） */
async function readCredentialVerification(): Promise<CredentialVerification> {
  try {
    const prefs = endpointPrefs()
    const [state, at, baseURL] = await Promise.all([
      prefs.get(LLM_PREFS_VERIFY_STATE),
      prefs.get(LLM_PREFS_VERIFY_AT),
      prefs.get(LLM_PREFS_VERIFY_BASE_URL),
    ])
    if (state !== "verified" && state !== "failed") {
      return { state: "unverified", at: null, baseUrl: null }
    }
    // 失效规则（ADR-0173 D4③）：记录的 baseURL 与当前配置不一致 → 视为未验证
    const current = await prefs.get(LLM_PREFS_BASE_URL)
    if (baseURL !== current) return { state: "unverified", at: null, baseUrl: null }
    const ts = at === null ? null : Number(at)
    return { state, at: ts !== null && Number.isFinite(ts) ? ts : null, baseUrl: baseURL }
  } catch (err) {
    console.warn("[novelTranslateStore] 凭据验证状态读取失败（按未验证处理）", err)
    return { state: "unverified", at: null, baseUrl: null }
  }
}

/** 写凭据验证状态（写失败必须可见；不阻断 UI） */
async function writeCredentialVerification(
  state: CredentialVerificationState,
  baseURL: string,
): Promise<void> {
  try {
    const prefs = endpointPrefs()
    await prefs.set(LLM_PREFS_VERIFY_STATE, state)
    await prefs.set(LLM_PREFS_VERIFY_AT, String(Date.now()))
    await prefs.set(LLM_PREFS_VERIFY_BASE_URL, baseURL)
  } catch (err) {
    console.warn("[novelTranslateStore] 凭据验证状态写入失败", err)
  }
}

/** 清凭据验证状态（清 endpoint / baseURL 变化时调用） */
async function clearCredentialVerification(): Promise<void> {
  try {
    const prefs = endpointPrefs()
    await Promise.all([
      prefs.remove(LLM_PREFS_VERIFY_STATE),
      prefs.remove(LLM_PREFS_VERIFY_AT),
      prefs.remove(LLM_PREFS_VERIFY_BASE_URL),
    ])
  } catch (err) {
    console.warn("[novelTranslateStore] 凭据验证状态清除失败", err)
  }
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

/**
 * 缓存键所需的 endpoint 元数据（真实 model / baseURL）。
 *
 * 读失败时只 warn 并回退空值 → 该次请求必然 miss（宁多多花一次请求，也不要因占位键
 * 永不失效而命中另一模型/服务商产出的译文）。
 */
async function loadEndpointMetadataForCache(): Promise<{ model?: string; baseURL?: string }> {
  try {
    const meta = await readEndpointMetadata()
    return { model: meta.model, baseURL: meta.baseURL }
  } catch (err) {
    console.warn("[novelTranslateStore] 缓存键 endpoint 元数据读取失败（本次按 miss 处理）", err)
    return {}
  }
}

/** web-core 预览的 endpoint 配置（native 路径不用；真机不进入此分支） */
function webEndpointConfig(): LlmEndpointConfig {
  const settings = useSettingsStore()
  return {
    baseURL: "",
    apiKey: "",
    model: "openai-responses",
    targetLang: settings.language ?? "zh-CN",
    sourceLang: "ja",
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
  // 译文正文（spec §5 数据流 / §6.3 整段切换）：store 是唯一持有者，
  // 页面只读 displayParagraphs。历史缺陷：译文只进缓存、从不进渲染源 → 正文永不变化。
  const translatedParagraphs = ref<string[]>([])
  const sourceParagraphs = ref<string[]>([])
  const displayParagraphs = ref<string[]>([])
  // 两层状态（ADR-0173 D1）：地址层 / 密钥层，互不冒充
  const compatibility = ref<EndpointCompatibilityStatus>("idle")
  const credential = ref<CredentialVerification>({ state: "unverified", at: null, baseUrl: null })
  /** 兼容性探测 generation：慢响应不得覆盖后发起的探测 */
  let compatGen = 0

  /** 重算渲染源（译文/原文切换 + 增量落地都经此） */
  function refreshDisplay(): void {
    const useTranslated = showTranslation.value && translatedParagraphs.value.length > 0
    displayParagraphs.value = useTranslated
      ? sourceParagraphs.value.map((p, i) => {
          const t = translatedParagraphs.value[i]
          return t !== undefined && t !== "" ? t : p
        })
      : sourceParagraphs.value.slice()
  }

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
    translatedParagraphs.value = []
    sourceParagraphs.value = []
    refreshDisplay()
  }

  /**
   * 从 Keystore 加载 endpoint 脱敏镜像。
   * - 成功 → 返回 LlmEndpointPublic
   * - 未配置（hasKey=false）→ 返回 null
   * - 解析失败 / NativeModule 缺失 → reject（spec §6.1）
   */
  async function loadEndpointConfig(): Promise<LlmEndpointPublic | null> {
    const raw = await nativeGetEndpoint()
    console.warn(`[novelTranslateStore] getEndpoint raw=${JSON.stringify(raw)}`)
    if (raw === null) return null
    if (typeof raw !== "object") {
      throw new Error("[novelTranslateStore] getEndpoint returned non-object")
    }
    const ep = raw as LlmEndpointPublic
    // hasKey=false → Keystore 无 apiKey = 未配置（Java 侧返回带默认值的脱敏镜像而非 null；
    // 必须在此归一为 null，否则上层会尝试用空 apiKey 调 provider 而挂起/超时）
    if (ep.hasKey === false) return null
    // 非密元数据（baseURL / model / targetLang）叠加：Java 侧只持有默认值 + apiKey，
    // 用户保存在设置页的值走 endpointPrefs（ADR-0170 §D5.1）；缺失则保留 Java 默认。
    const meta = await readEndpointMetadata()
    credential.value = await readCredentialVerification()
    return {
      ...ep,
      baseURL: meta.baseURL ?? ep.baseURL,
      model: meta.model ?? ep.model,
      targetLang: meta.targetLang ?? ep.targetLang,
    }
  }

  /**
   * 保存 endpoint：baseURL + model 走 getEndpoint 元数据通道 + apiKey 走 setApiKey 加密通道。
   * 不在 JS 堆持有 apiKey（ADR-0170 §D5.1）。
   */
  async function saveEndpointConfig(config: LlmEndpointConfig): Promise<void> {
    // apiKey 走 Java 加密通道（Keystore），JS 侧不落盘
    await nativeSetApiKey(config.apiKey)
    // 非密元数据落设置 KV：翻译时随请求下发（baseURL / model），未保存则回退 Java 默认值。
    // 必须在 apiKey 写入之后 —— apiKey 失败时不留「看似已配置」的半成品元数据。
    const prefs = endpointPrefs()
    try {
      await prefs.set(LLM_PREFS_BASE_URL, config.baseURL)
      await prefs.set(LLM_PREFS_MODEL, config.model)
      if (config.targetLang) await prefs.set(LLM_PREFS_TARGET_LANG, config.targetLang)
    } catch (err) {
      // 写失败必须可见（AGENTS.md 硬约束 #3）：否则用户以为「保存成功了」
      console.warn("[novelTranslateStore] endpoint 元数据保存失败", err)
      throw err
    }
    // 失效规则（ADR-0173 D4①）：**任何一次保存都失效凭据验证** —— key 无法比较，
    // 同一个 baseURL 下换了一把新 key 时，沿用旧的「已验证」正是 D1 禁止的假象。
    await clearCredentialVerification()
    credential.value = { state: "unverified", at: null, baseUrl: null }
  }

  /** 清除 endpoint 配置：Keystore apiKey + 设置 KV 中的非密元数据（spec §6.1 入口） */
  async function clearEndpointConfig(): Promise<void> {
    await nativeClearEndpoint()
    const prefs = endpointPrefs()
    await Promise.all([
      prefs.remove(LLM_PREFS_BASE_URL),
      prefs.remove(LLM_PREFS_MODEL),
      prefs.remove(LLM_PREFS_TARGET_LANG),
    ])
    // 失效规则（ADR-0173 D4②）：配置没了，验证状态必须一起没
    await clearCredentialVerification()
    credential.value = { state: "unverified", at: null, baseUrl: null }
    compatibility.value = "idle"
  }

/**
 * 原生 probe 的**真实**状态值域（PictelioTranslateModule.classifyProbe 只发这四种）——
 * 白名单据此校验；契约测试钉住该值域，禁造不存在的 wire 值。
 */
const HOST_PROBE_STATUSES = ["ok", "partial", "incompatible", "unknown"] as const
type HostProbeStatus = (typeof HOST_PROBE_STATUSES)[number]

function isCompatibilityStatus(value: unknown): value is HostProbeStatus {
  return typeof value === "string" && (HOST_PROBE_STATUSES as readonly string[]).includes(value)
}

/**
 * provider 归属（azure / deepseek）：**JS 侧**判定，原生不回这些值。
 * 原生只回答「通不通」，归属由地址推断（ADR-0173 D3 修订）。
 */
function classifyProvider(
  hostStatus: HostProbeStatus,
  baseURL: string,
): EndpointCompatibilityStatus {
  if (hostStatus !== "ok") return hostStatus
  const host = extractHostname(baseURL)
  if (host !== null && host.toLowerCase().endsWith(".openai.azure.com")) return "azure"
  if (host !== null && host.toLowerCase().endsWith("api.deepseek.com")) return "deepseek"
  return "ok"
}

  /** 探测用的假 key（ADR-0173 D2：探测永不携带用户密钥） */
  const PROBE_DUMMY_API_KEY = "sk-pictelio-probe-not-a-real-key"
  /** 探测用的占位模型（端点不认这个模型也能从状态码判出「是不是 Responses API」） */
  const PROBE_MODEL = "gpt-5"

  /**
   * 探测**端点兼容性**（地址层，spec §6.1 inline probe；ADR-0173 D1/D2/D3）。
   *
   * - 只带 dummy key → 未配置密钥也能探测，也让「已保存的配置免密钥重测」成立；
   * - 保留 Java 侧状态分类（此前实现压成 boolean，丢掉「仅 chat/completions」「无法探测」）；
   * - NativeModule 缺失 / 网络错 → unknown（**不 reject**：探测是只读诊断，UI 需要能显示它）。
   */
  async function probeCompatibility(baseURL: string): Promise<ProbeClassification> {
    const url = baseURL.trim()
    const gen = ++compatGen
    const commit = (status: EndpointCompatibilityStatus): void => {
      // generation-gate：慢探测不得覆盖后发起的探测（AGENTS.md 即时导航硬约束 #3）
      if (gen === compatGen) compatibility.value = status
    }
    if (url.length === 0) {
      commit("idle")
      // detail 是技术诊断串（非展示文案；UI 文案走 i18n 的 compat.idle）
      return { status: "idle", detail: "empty baseURL", httpStatus: 0 }
    }
    try {
      const result = await nativeProbeEndpoint(url, PROBE_DUMMY_API_KEY, PROBE_MODEL)
      // 白名单校验：原生回未知串时回落 unknown（否则 COMPAT_KEYS 查不到 → t(undefined)）
      const raw = result.status
      const status: HostProbeStatus = isCompatibilityStatus(raw) ? raw : "unknown"
      if (!isCompatibilityStatus(raw)) {
        console.warn("[novelTranslateStore] 原生返回未知兼容性状态，回落 unknown", { raw })
      }
      const classified = classifyProvider(status, url)
      commit(classified)
      return { status: classified, detail: result.detail, httpStatus: result.httpStatus }
    } catch (err) {
      console.warn("[novelTranslateStore] probeCompatibility 失败", err)
      commit("unknown")
      return {
        status: "unknown",
        detail: err instanceof Error ? err.message : String(err),
        httpStatus: 0,
      }
    }
  }

  /**
   * 「测试连接」：用**真实 key** 验证凭据（密钥层，ADR-0173 D5）。
   *
   * 2xx → verified；401/403 → failed + invalid_key；其它 → failed + 对应 code。
   * 结果与时间戳持久化（D4）。
   */
  async function testConnection(config: LlmEndpointConfig): Promise<{
    ok: boolean
    code: string
    detail: string
  }> {
    const baseURL = config.baseURL.trim()
    const stamp = (state: CredentialVerificationState): CredentialVerification => ({
      state,
      at: Date.now(),
      baseUrl: baseURL,
    })
    try {
      const result = await nativeProbeEndpoint(baseURL, config.apiKey, config.model)
      const httpStatus = result.httpStatus
      const authenticated = httpStatus >= 200 && httpStatus < 300
      // 400 + invalid_api_key body 也属「密钥无效」（原生 keyInvalid 标记，ADR-0173 D3 修订）
      const invalidKey = result.keyInvalid === true || httpStatus === 401 || httpStatus === 403
      if (authenticated) {
        await writeCredentialVerification("verified", baseURL)
        credential.value = stamp("verified")
        return { ok: true, code: "ok", detail: result.detail }
      }
      await writeCredentialVerification("failed", baseURL)
      credential.value = stamp("failed")
      return {
        ok: false,
        code: invalidKey ? "invalid_key" : "http_" + String(httpStatus),
        detail: result.detail,
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.warn("[novelTranslateStore] testConnection 失败", err)
      await writeCredentialVerification("failed", baseURL)
      credential.value = stamp("failed")
      return { ok: false, code: "network", detail: message }
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
    // 翻译授权（spec §9.7 / ADR-0173）：**不复用内容显示谓词** —— 看见 R18 ≠ 允许把
    // R18 正文发给第三方 LLM。未授权时直接拒绝且**不发请求**（正文零外发）。
    if (xRestrict > 0 && settings.isTranslationRestricted(xRestrict)) {
      status.value = "aborted"
      error.value = {
        code: xRestrict === 2 ? "R18G_BLOCKED" : "R18_BLOCKED",
        message: xRestrict === 2 ? t("novelTranslate.error.r18gBlocked") : t("novelTranslate.error.R18Blocked"),
      }
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
    // 6 元组键必须带**真实** model 与 baseURL（ADR-0171 §1 / spec §9.10）：换模型或换
    // endpoint 必须自动 miss，否则会命中另一模型/另一服务商产出的译文（脏数据）。
    const targetLang = settings.language ?? "zh-CN"
    const endpointMeta = await loadEndpointMetadataForCache()
    const cacheKeyMeta = makeCacheKey({
      novelId,
      chapterId: String(chapterId),
      targetLang,
      modelId: endpointMeta.model ?? "openai-responses",
      paragraphs,
      baseURL: endpointMeta.baseURL ?? "",
    })

    // 缓存层不可用（真机 PrimJS 无 IndexedDB）→ 不发这次读，直接走 provider；
    // 降级在 cache 层显式 warn（不静默）。
    const cached = isTranslationCacheAvailable() ? await getTranslation(cacheKeyMeta.key) : null
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
      sourceParagraphs.value = paragraphs.slice()
      translatedParagraphs.value = cached.paragraphs.slice()
      showTranslation.value = true
      refreshDisplay()
      // 清理 placeholder：缓存命中是同步收敛，已无需等待 in-flight promise
      if (inFlightByChapter.get(chapterId) === placeholder) {
        inFlightByChapter.delete(chapterId)
      }
      return
    }
    // 缓存 miss / 长度不匹配 → 继续走 provider 路径
    console.warn(`[novelTranslateStore] cacheMiss chapter=${chapterId}`)
    isCached.value[chapterId] = false

    // ── 启动新 translation ──
    const controller = new AbortController()
    activeController?.abort()
    activeController = controller
    const genNow = ++gen

    const promise = (async () => {
      const useNative = hasNativeModule()
      console.warn(`[novelTranslateStore] path=${useNative ? "native" : "web"} chapter=${chapterId}`)

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
   * 内部：跑一轮 chunked 翻译（native / web 两个 provider 共用同一条 pipeline）。
   *
   * pipeline = createNovelTranslator（ADR-0169 D5）：段落切块 ≤2000 字 + 并发 3 + 每块独立
   * 请求 + 段落对齐 + 失败块回退原文。native 与 web 只差 provider：
   * - native：nativeTranslateProvider()（Java 侧解密 apiKey，JS 载荷不含 key）
   * - web-core 预览：openaiResponsesProvider()（配置占位；真机不走此路径）
   *
   * 为什么 native 也走 chunked：真机实测整章一次性请求（200-350 段 / 上万字）会在 OkHttp
   * read timeout 处断流，翻译永不收敛。
   */
  async function runWithProvider(
    provider: TranslationProvider,
    config: LlmEndpointConfig,
    args: { novelId: number; chapterId: number; paragraphs: string[]; xRestrict: 0 | 1 | 2 },
    signal: AbortSignal,
    genNow: number,
  ): Promise<void> {
    // native 桥并发 = 1（串行）：真机实测 3 路并发时 DeepSeek 三条 SSE 全部长时间不发
    // delta（互相饿死，体感 = 永久「0% 翻译中」）。串行代价可接受（进度单调前进），
    // 换来「每块都能推进 + 单块失败不影响其他块」的确定性。
    // web-core 预览保持默认并发 3（浏览器侧无此限制）。
    const request: TranslationRequest = {
      novelId: args.novelId,
      chapterId: String(args.chapterId),
      paragraphs: args.paragraphs,
      options: { xRestrict: args.xRestrict },
    }
    // 块起始偏移：pipeline 按块 slice 出子请求，provider 适配器需要知道这块在原数组里的起点，
    // 才能把「块内序号」还原成「绝对段落序号」。偏移经**非枚举符号属性**挂在子请求上
    // （JSON.stringify 不枚举符号 → 不会污染下发给原生的载荷）。
    const providerWithOffset: TranslationProvider = {
      ...provider,
      translate: (sub, cfg, sig) => {
        const offset = args.paragraphs.indexOf(sub.paragraphs[0] ?? "")
        Object.defineProperty(sub, CHUNK_OFFSET, {
          value: offset >= 0 ? offset : 0,
          enumerable: false,
          configurable: true,
        })
        return provider.translate(sub, cfg, sig)
      },
    }
    const translator = createNovelTranslator({
      provider: providerWithOffset,
      // native 桥并发 = 1（串行）：真机实测 3 路并发时 DeepSeek 三条 SSE 全部长时间不发
      // delta（互相饿死，体感 = 永久「0% 翻译中」）。串行代价可接受（进度单调前进），
      // 换来「每块都能推进 + 单块失败不影响其他块」的确定性。
      // web-core 预览保持默认并发 3（浏览器侧无此限制）。
      concurrency: provider.id === "native-bridge" ? 1 : undefined,
    })

    status.value = "translating"
    // 渲染源与增量译文：source 立即就位（先渲染后加载），译文按绝对段落序号累加
    sourceParagraphs.value = args.paragraphs.slice()
    translatedParagraphs.value = new Array<string>(args.paragraphs.length).fill("")
    refreshDisplay()
    // 进度按「已收到 delta 的帧数」推进，而非 chunk.paragraphIndex：
    // chunked pipeline 把每块作为独立请求下发，块内段落序号从 0 重新计数，
    // 直接用它会永远显示 0%（真机实测：按钮卡在「0% 翻译中」，直到全部块跑完）。
    // 帧计数是单调的（每帧至少推进 1 段），并 clamp 到总段落数。
    let deltaFrames = 0
    let lastErrorCode: string | null = null
    let lastErrorMessage = ""
    const result = await translator.translate(request, config, signal, (chunk: TranslationChunk) => {
      if (chunk.type === "delta") {
        deltaFrames += 1
        progress.value = {
          chapterId: args.chapterId,
          done: Math.min(deltaFrames, args.paragraphs.length),
          total: args.paragraphs.length,
        }
        // 绝对段落序号 = 本块起始偏移 + 块内序号（chunked pipeline 每块重数 0..n-1）
        const offset = (request as { [CHUNK_OFFSET]?: number })[CHUNK_OFFSET] ?? 0
        const abs = offset + chunk.paragraphIndex
        if (abs >= 0 && abs < translatedParagraphs.value.length) {
          translatedParagraphs.value[abs] = (translatedParagraphs.value[abs] ?? "") + chunk.text
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
      progress.value = {
        chapterId: args.chapterId,
        done: args.paragraphs.length,
        total: args.paragraphs.length,
      }
      // 权威来源：pipeline 的段落对齐结果（增量 transcript 可能有缺项/顺序差）
      translatedParagraphs.value = result.paragraphs.slice()
      isCached.value[args.chapterId] = true
      // 先落缓存再置 completed：spec §7.1 把 completed 定义为「已写入缓存」，
      // 且把副作用 await 掉才能让调用方/测试观测到确定的终态（此前 void 掉会
      // 在下一个用例里才落地，属测试隔离污染源）。
      await writeCacheIfNeeded(args, result.paragraphs)
      if (gen !== genNow) return
      status.value = "completed"
      showTranslation.value = true
      refreshDisplay()
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
   * 内部：native 路径入口 —— 取 endpoint 配置（缺失 = NOT_CONFIGURED）后交给共用 pipeline。
   * apiKey 永不出 Java 堆：载荷只带 baseURL / model / input / instructions（ADR-0037 / ADR-0170 §D5.1）。
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

    const config: LlmEndpointConfig = {
      baseURL: endpoint.baseURL,
      apiKey: "", // native：key 在 Java 堆解密，JS 永不持有
      model: endpoint.model,
      targetLang: endpoint.targetLang,
      sourceLang: endpoint.sourceLang,
    }
    await runWithProvider(nativeTranslateProvider(), config, args, signal, genNow)
  }

  /**
   * 内部：web-core dev 预览路径（真机不进入；NativeModule 缺失时才走）。
   * 与 native 共用 chunked pipeline；配置从设置/环境推导（web 预览的鉴权由调用方注入）。
   */
  async function runViaWebProvider(
    args: { novelId: number; chapterId: number; paragraphs: string[]; xRestrict: 0 | 1 | 2 },
    signal: AbortSignal,
    genNow: number,
  ): Promise<void> {
    await runWithProvider(openaiResponsesProvider(), webEndpointConfig(), args, signal, genNow)
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
      const endpointMeta = await loadEndpointMetadataForCache()
      // 与读路径同一个键构造器（写路径曾手写模板串 → 两侧漂移风险）
      const { key } = makeCacheKey({
        novelId: args.novelId,
        chapterId: String(args.chapterId),
        targetLang,
        modelId: endpointMeta.model ?? "openai-responses",
        paragraphs: args.paragraphs,
        baseURL: endpointMeta.baseURL ?? "",
      })
      await setTranslation(key, translated, {
        providerId: "openai-responses",
        modelId: "openai-responses",
      })
    } catch (err) {
      console.warn("[novelTranslateStore] writeCacheIfNeeded failed", err)
    }
  }

  /**
   * 重译当前章节（spec §6.2「已译 → 重译」；ADR-0173 D6）。
   *
   * 语义 = **先失效本章缓存，再重新翻译**（否则 getTranslation 命中旧译文，
   * 用户看到「重译」却什么都没变）。只失效本章，不动其它章节（cache 层提供单键删除）。
   */
  async function retranslate(
    novelId: number,
    chapterId: number,
    paragraphs: string[],
    xRestrict: 0 | 1 | 2 = 0,
  ): Promise<void> {
    try {
      const settings = useSettingsStore()
      const endpointMeta = await loadEndpointMetadataForCache()
      const { key } = makeCacheKey({
        novelId,
        chapterId: String(chapterId),
        targetLang: settings.language ?? "zh-CN",
        modelId: endpointMeta.model ?? "openai-responses",
        paragraphs,
        baseURL: endpointMeta.baseURL ?? "",
      })
      await removeTranslation(key)
      isCached.value[chapterId] = false
    } catch (err) {
      // 缓存失效失败不阻断重译（最坏情况是命中旧译文，随后被新译文覆盖）；但必须可见
      console.warn("[novelTranslateStore] retranslate 缓存失效失败", err)
    }
    await translateChapter(novelId, chapterId, paragraphs, xRestrict)
  }

  /** 切换原文/译文显示（同步：仅切 signal + 重算渲染源） */
  async function toggleMode(): Promise<void> {
    showTranslation.value = !showTranslation.value
    refreshDisplay()
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
    translatedParagraphs,
    sourceParagraphs,
    displayParagraphs,
    currentChapter,
    error,
    isCached,
    showTranslation,
    reset,
    compatibility,
    credential,
    loadEndpointConfig,
    saveEndpointConfig,
    clearEndpointConfig,
    probeCompatibility,
    testConnection,
    translateChapter,
    retranslate,
    toggleMode,
    abort,
  }
})

/** 测试钩子导出（仅测试 import；生产代码勿用） */
export { resetNovelTranslateStoreForTest }
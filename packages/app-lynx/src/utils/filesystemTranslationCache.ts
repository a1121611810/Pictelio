// ─── app-lynx 翻译缓存 filesystem adapter（ADR-0175 + wayfinder #641） ───
// 真机 PrimJS 无 indexedDB → 走 PictelioTranslateCache NativeModule（filesystem cacheDir）。
// 与 IndexedDB adapter 同接口（getTranslation / setTranslation / removeTranslation /
// clearTranslationCache / isTranslationCacheAvailable），让 translationCache.ts 单点分流。
//
// IO 边界硬约束（AGENTS.md 测试硬约束 #1 + #3）：
// - 成功 + 失败双路径都覆盖；
// - 失败时 console.warn（模块前缀 `[filesystemTranslationCache]`），不静默吞错。

import { isNativeMode } from "../api/client"
import type { TranslationCacheEntry } from "./translationCache"

// ─────────────────── NativeModule 探测 ───────────────────

/** NativeModule 公共面（与 ADR-0175 D1 契约一致；Callback 去 null：成功 cb("", "") 失败 cb("", err)） */
interface PictelioTranslateCacheModule {
  getItem: (key: string, cb: (json: string | null, err: string | null) => void) => void
  setItem: (key: string, json: string, cb: (ok: string | null, err: string | null) => void) => void
  deleteItem: (key: string, cb: (ok: string | null, err: string | null) => void) => void
  clear: (cb: (ok: string | null, err: string | null) => void) => void
  /** arity 契约：单参（Java 侧 `stats(Callback)`）—— 见 code-review P9 */
  stats: (cb: (json: string | null, err: string | null) => void) => void
  /** arity 契约：单参（Java 侧 `getCacheDirPath(Callback)`） */
  getCacheDirPath: (cb: (path: string) => void) => void
}

/**
 * 双通道探测（**裸通道优先回退**；语义见下）。
 *
 * <p><b>与仓库既有模式的关系（补审 S3 纠正）</b>：本函数**不是** `nativeTranslate.ts`
 * 的 `nativeTranslateModule()` 的「同形」实现 —— 参考实现是 **container-first**
 * （先取容器 `NativeModules ?? globalThis.NativeModules`，再取 `.PictelioTranslateCache`），
 * 本函数是 **per-channel bare-first**（逐通道取模块本体，裸通道命中即返回）。
 * 两者只在「首个容器存在但**无**该模块键、另一通道有」时不同：本实现会**继续回退**取到模块
 * （更宽容、更安全）；参考实现会返回 `null`。
 *
 * <p><b>为何不照抄 container-first</b>：真机 PrimJS 把 native module 挂成**裸 `NativeModules`**，
 * 而测试环境（node）会把 `NativeModules` 定义成**空对象**遮蔽 `globalThis` 上的注入 ——
 * 两者叠加时 container-first 会锁死空容器。（历史教训：早期实现取「`NativeModules` 存在就用它」
 * → happy-dom 下拿到空对象；改成只读 `globalThis.NativeModules` → **真机彻底失效**。）
 *
 * <p><b>后续维护须知</b>：不要为了「与仓库一致」把本函数改回 container-first —— 那会复现
 * #641 的真机失效。若要统一，应先把参考实现也改成 per-channel 语义（并有真机验证）。
 *
 * <p>2×2 通道矩阵由 `tests/unit/utils/filesystemTranslationCache.test.ts` 的
 * 「空容器不遮蔽」组守门（容器空对象 / 无模块键两种失败模式）。
 */
function nativeModule(): PictelioTranslateCacheModule | null {
  const bare = typeof NativeModules !== "undefined" ? NativeModules : undefined
  const fromBare = (
    bare as { PictelioTranslateCache?: PictelioTranslateCacheModule } | undefined
  )?.PictelioTranslateCache
  if (fromBare != null) return fromBare
  const fromGlobal = (
    globalThis as { NativeModules?: { PictelioTranslateCache?: PictelioTranslateCacheModule } }
  ).NativeModules?.PictelioTranslateCache
  return fromGlobal ?? null
}

/** NativeModule 是否可用（导出给 translationCache.ts 探测） */
export function isFilesystemTranslationCacheAvailable(): boolean {
  return isNativeMode() && nativeModule() !== null
}

// ─────────────────── Promise 包装（与 nativeTranslate.ts §双通道一致） ───────────────────

/** 安全解析 JSON（Java 侧 setItem 入参是 JSON 字符串，getItem 出参也是 JSON 字符串） */
function parseJson<T>(raw: string | null): T | null {
  if (raw == null) return null
  try {
    return JSON.parse(raw) as T
  } catch (err) {
    console.warn("[filesystemTranslationCache] JSON 解析失败", { raw: raw.slice(0, 80), err })
    return null
  }
}

function call<T>(fn: (cb: (data: string | null, err: string | null) => void) => void): Promise<T | null> {
  const mod = nativeModule()
  if (!mod) return Promise.resolve(null)
  return new Promise((resolve) => {
    try {
      fn((data, err) => {
        // ENOENT = 缓存本就允许未命中；与 IO 错区分（否则每章未命中都 warn）
        if (err === "ENOENT") {
          resolve(null)
          return
        }
        if (err != null && err.length > 0) {
          console.warn("[filesystemTranslationCache] Native 错", { err })
          resolve(null)
          return
        }
        resolve(parseJson<T>(data))
      })
    } catch (caught) {
      console.warn("[filesystemTranslationCache] 调用异常", caught)
      resolve(null)
    }
  })
}

/** 写入无返回值场景的 Promise 包装（成功 cb("") + 失败 cb("", err)） */
function callVoid(fn: (cb: (ok: string | null, err: string | null) => void) => void): Promise<boolean> {
  const mod = nativeModule()
  if (!mod) return Promise.resolve(false)
  return new Promise((resolve) => {
    try {
      fn((ok, err) => {
        if (err != null && err.length > 0) {
          console.warn("[filesystemTranslationCache] Native 错", { err })
          resolve(false)
          return
        }
        resolve(true)
      })
    } catch (caught) {
      console.warn("[filesystemTranslationCache] 调用异常", caught)
      resolve(false)
    }
  })
}

// ─────────────────── 公共 API（与 IndexedDB adapter 同接口） ───────────────────

/**
 * 读取单条缓存（不存在返回 null；IO 失败返回 null + warn，AGENTS.md #1+#3）。
 *
 * <p>key 在 Java 侧 sha256 化为文件名；JS 侧仅透传可读缓存键字符串。
 */
export async function getTranslation(key: string): Promise<TranslationCacheEntry | null> {
  if (!isFilesystemTranslationCacheAvailable()) return null
  const result = await call<TranslationCacheEntry>((cb) => nativeModule()!.getItem(key, cb))
  if (result == null) {
    // 区分 ENOENT vs 解析失败：Java 侧未命中 = cb("", "ENOENT") → resolve(null)；
    // 这里 result 已经是 null，无法区分，但调用方只关心 entry 是否存在。
    // ENOENT 在 console 不会有 warn（call 内只 warn 真错）；解析失败会 warn。
    return null
  }
  return result
}

/**
 * 写一条缓存（成功返回 true；失败返回 false + warn）。
 *
 * <p>metadata（providerId / modelId）打包进 entry 持久化；Java 侧只关心 JSON 形态。
 */
export async function setTranslation(
  key: string,
  value: string[],
  metadata: { providerId?: string; modelId?: string } = {},
): Promise<boolean> {
  if (!isFilesystemTranslationCacheAvailable()) return false
  const entry: TranslationCacheEntry = {
    key,
    novelId: 0,
    chapterId: "",
    targetLang: "",
    modelId: metadata.modelId ?? "",
    baseURLHash: "",
    sourceHash: "",
    paragraphs: value,
    createdAt: Date.now(),
    providerId: metadata.providerId ?? "openai-responses",
  }
  // 注意：上面 novelId/chapterId/targetLang/baseURLHash/sourceHash 留空 —— 调用方应
  // 直接传完整的 TranslationCacheEntry（含六元组），见下方 enrichedSetTranslation。
  // 这里为兼容原接口只填段落 + 时间戳 + provider；enriched 版本在 translationCache.ts
  // 内部组装完整 entry 后调 NativeModule.setItem(key, JSON.stringify(entry))。
  return callVoid((cb) => nativeModule()!.setItem(key, JSON.stringify(entry), cb))
}

/**
 * 写一条**完整** entry（含 6 元组 metadata）—— translationCache.ts 内部用。
 */
export async function setTranslationEntry(entry: TranslationCacheEntry): Promise<boolean> {
  if (!isFilesystemTranslationCacheAvailable()) return false
  return callVoid((cb) =>
    nativeModule()!.setItem(entry.key, JSON.stringify(entry), cb),
  )
}

/**
 * 删除单条缓存（不存在也返回 true；IO 失败返回 false + warn）。
 */
export async function removeTranslation(key: string): Promise<boolean> {
  if (!isFilesystemTranslationCacheAvailable()) return false
  return callVoid((cb) => nativeModule()!.deleteItem(key, cb))
}

/**
 * 清除整个缓存（成功返回 true；IO 失败返回 false + warn）。
 */
export async function clearTranslationCache(): Promise<boolean> {
  if (!isFilesystemTranslationCacheAvailable()) return false
  return callVoid((cb) => nativeModule()!.clear(cb))
}

/**
 * 缓存统计（entryCount / totalBytes / hitRate / missRate）—— 调试用。
 */
export async function stats(): Promise<{
  entryCount: number
  totalBytes: number
  maxBytes?: number
  maxEntries?: number
  /** null = 「未统计」（Java 不持有命中计数器）—— 不是 0（0 是合法命中率，语义不可区分） */
  hitRate: number | null
  missRate: number | null
} | null> {
  if (!isFilesystemTranslationCacheAvailable()) return null
  return call<{
    entryCount: number
    totalBytes: number
    maxBytes?: number
    maxEntries?: number
    hitRate: number | null
    missRate: number | null
  }>((cb) => nativeModule()!.stats(cb))
}
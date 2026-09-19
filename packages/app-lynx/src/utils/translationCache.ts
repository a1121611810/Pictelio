// ─── app-lynx 翻译缓存层（IndexedDB；ADR-0171） ───
// 范围限定在 app-lynx 端；不复用 webview 端 translationCache.ts（map #617 Q3）。
//
// 设计要点（ADR-0171）：
// - 键 = 6 元组：`novelId | chapterId | targetLang | modelId | sourceHash | baseURLHash`
//   任一字段变化 → miss（改 model / 改 endpoint / 改 target lang / 改 source 自动失效）。
// - 哈希算法：FNV-1a 32-bit（零依赖、不引入 spark-md5；spec §4.5 备注用 spark-md5 是笔误，
//   ADR-0171 §4 已收敛为 FNV-1a）。
// - 持久化：复用现有 `pictelio_lynx` DB + 新增 `translations` object store + version 3
//   升级路径（现有 v2 加 v3 不破坏旧 kv store，idbKV.ts line 6-8 注释说明）。
// - LRU 200 章上限（与 webview 端同基线起步；spec §12 N11）。
// - 半成品策略：`done` 之前永不写（5 个状态：translating / translating_queued /
//   partial / failed / aborted 不写缓存——避免半成品污染）。
//
// IO 边界硬约束（AGENTS.md 测试硬约束 #1 + #3）：
// - 成功 + 失败双路径都覆盖；
// - 失败时 console.warn（模块前缀 `[translationCache]`），不静默吞错。

import { openDb as openKvDb, STORE_TRANSLATIONS as STORE_TRANSLATIONS_FROM_KV } from './idbKV'
import { isNativeMode } from '../api/client'
import { utf8Encode } from './utf8'


// ─────────────────── 缓存键 ───────────────────

/**
 * 6 元组缓存键（ADR-0171 §1 + spec §4.5）。
 */
export interface TranslationCacheKey {
  novelId: number
  chapterId: string
  targetLang: string
  modelId: string
  sourceHash: string
  baseURLHash: string
}

/**
 * 缓存条目（ADR-0171 §2 schema）。
 *
 * 持久化字段含 metadata：`createdAt`（LRU 排序 + UI 「N 天前缓存」预留）/
 * `providerId`（verify 一致性） / `modelId`（跨 model namespace 隔离）。
 */
export interface TranslationCacheEntry {
  key: string
  novelId: number
  chapterId: string
  targetLang: string
  modelId: string
  baseURLHash: string
  sourceHash: string
  /** 段落译文数组；长度必须 = request.paragraphs.length */
  paragraphs: string[]
  /** 写入毫秒时间戳（LRU 排序字段） */
  createdAt: number
  /** provider id（当前唯一 = 'openai-responses'；schema 留 string 便于未来扩展） */
  providerId: string
}

/**
 * 构造缓存键字符串（6 元组冒号拼接；ADR-0171 §1）。
 *
 * 例：`12345:1:zh-CN:gpt-5:a1b2c3d4:e5f6g7h8`。
 * 不再做一次哈希压缩——key 已是可读字符串，object store keyPath 不设置（外部显式传 key）。
 */
export function buildTranslationCacheKey(k: TranslationCacheKey): string {
  return `${k.novelId}:${k.chapterId}:${k.targetLang}:${k.modelId}:${k.sourceHash}:${k.baseURLHash}`
}

// ─────────────────── FNV-1a 32-bit 哈希 ───────────────────

/**
 * FNV-1a 32-bit 哈希（ADR-0171 §4）。
 *
 * 算法：
 * ```
 * hash = 0x811c9dc5 (FNV offset basis)
 * for each byte b in UTF-8(s):
 *   hash = (hash XOR b) * 0x01000193 mod 2^32
 * return hash.toString(16).padStart(8, '0')
 * ```
 *
 * @returns 8-char zero-padded hex 字符串
 */
export function fnv1a32(s: string): string {
  let hash = 0x811c9dc5
  // 禁用 TextEncoder：Lynx PrimJS（真机）不提供该 Web API（2026-09-19 实测 undefined），
  // 直接调用抛 ReferenceError 会中断 translateChapter 同步段（按钮永久「0% 翻译中」）。
  // 纯 JS utf8Encode（utils/utf8.ts）两端可用；避免 spread `b` 的高位溢出（保持 unsigned 32-bit）
  const bytes = utf8Encode(s)
  for (let i = 0; i < bytes.length; i++) {
    hash = (hash ^ (bytes[i] & 0xff)) >>> 0
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash.toString(16).padStart(8, '0')
}

/**
 * 计算 sourceHash：join(paragraphs, '\n') 后 FNV-1a 32-bit。
 *
 * 注意：使用 LF 分隔而非 '\n\n'（避免连续空行触发 hash 漂移；段落级指纹不需要空行）。
 */
export function computeSourceHash(paragraphs: string[]): string {
  return fnv1a32(paragraphs.join('\n'))
}

/**
 * 计算 baseURLHash：baseURL 字符串直接 FNV-1a 32-bit。
 *
 * 切 endpoint → baseURLHash 变 → 旧缓存全部 miss（spec §9.5）。
 */
export function computeBaseURLHash(baseURL: string): string {
  return fnv1a32(baseURL)
}

// ─────────────────── IndexedDB schema ───────────────────

// DB 名 / version / store 与 idbKV.ts 单一事实源：translations store 由 idbKV.openDb
// 在同 version 下统一创建（ADR-0171）。历史坑：本模块曾自开 v3 而 idbKV 持有 v2 连接
// → onblocked 永不 resolve（真机实测翻译卡 "0% 翻译中"）。复用 openDb 杜绝版本分裂。
const STORE_TRANSLATIONS = STORE_TRANSLATIONS_FROM_KV

/** LRU 容量上限（ADR-0171 §3；与 webview 端 200 章同基线起步） */
const LRU_CAPACITY = 200

/** 打开数据库（复用 idbKV 共享 openDb：onblocked 显式 reject，禁静默挂起） */
function openDb(): Promise<IDBDatabase> {
  return openKvDb()
}

/** IndexedDB 可用性探测（真机 Lynx runtime 无可靠 IDB；web-core Worker 有）。
 *  真机实测（2026-09-19）：native 模式下 indexedDB.open 的事件在 PrimJS 上不触发，
 *  且 setTimeout 兜底亦不可靠 → 缓存层必须按环境整体跳过（对齐 settingsStore 的
 *  `isNativeMode() ? nativePrefs() : devPrefs()` 模式；native 缓存通道待后续 ticket）。
 *  禁止静默挂起翻译流程（IO 边界硬约束 #3）。 */
let warnedNoIdb = false

/** 缓存层是否可用（导出给 store 判断"要不要发这次缓存读"，避免无意义的 IO 调用） */
export function isTranslationCacheAvailable(): boolean {
  return isIdbAvailable()
}

function isIdbAvailable(): boolean {
  if (isNativeMode() || typeof indexedDB === "undefined" || indexedDB === null) {
    if (!warnedNoIdb) {
      warnedNoIdb = true
      // 显式暴露降级（AGENTS.md 硬约束 #3）：真机 PrimJS 无 indexedDB → 翻译缓存整体不生效，
      // 每章都会重新请求（重复计费）。native 缓存通道见 ADR-0172 §2 挂账。
      console.warn("[translationCache] IndexedDB 不可用（native runtime）→ 翻译缓存停用，本章不读写缓存")
    }
    return false
  }
  return true
}

/** 带超时的 openDb（真机 IDB 事件不触发时 3s 后 reject，避免永久挂起） */
function openDbWithTimeout(): Promise<IDBDatabase> {
  return Promise.race([
    openDb(),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("[translationCache] indexedDB open timeout (3000ms)")), 3000),
    ),
  ])
}

/**
 * 读取单条缓存（不存在返回 null；IO 失败返回 null + warn，AGENTS.md 测试硬约束 #1+#3）。
 */
export async function getTranslation(key: string): Promise<TranslationCacheEntry | null> {
  if (!isIdbAvailable()) {
    // 真机 Lynx runtime：无 IDB → 缓存层整体跳过（不挂起翻译流程）
    return null
  }
  try {
    const db = await openDbWithTimeout()
    return await new Promise<TranslationCacheEntry | null>((resolve, reject) => {
      const tx = db.transaction(STORE_TRANSLATIONS, 'readonly')
      const req = tx.objectStore(STORE_TRANSLATIONS).get(key)
      req.onsuccess = (): void => {
        const result = req.result as TranslationCacheEntry | undefined
        if (!result) {
          resolve(null)
          return
        }
        // providerId verify 一致性（ADR-0171 §7）
        if (result.providerId !== 'openai-responses') {
          console.warn(
            `[translationCache] cached providerId=${result.providerId} incompatible with current (openai-responses); treating as miss`,
            { key },
          )
          resolve(null)
          return
        }
        resolve(result)
      }
      req.onerror = (): void => reject(req.error)
    })
  } catch (err) {
    console.warn('[translationCache] read failed', { key, err })
    return null
  }
}

/**
 * 写入单条缓存 + LRU 淘汰。
 *
 * @param key 缓存键（已 buildTranslationCacheKey）
 * @param value 译文段落数组（长度必须与原文一致——caller 保证）
 * @param metadata 元数据（providerId / modelId 注入）
 *
 * @remarks
 * - 半成品不写：`translating` / `partial` / `failed` / `aborted` 等非 `done` 状态永不调用本函数；
 *   caller 自行守门（spec §5 不变量 #3 + §7.2 转移表 + ADR-0171 §5）。
 * - LRU 淘汰：写之前先 read 当前 count，超过 200 → cursor 淘汰最早 createdAt 至 199。
 *   淘汰与写入分不同事务（淘汰事务先 commit、写入事务后 commit）。
 */
export async function setTranslation(
  key: string,
  value: string[],
  metadata: { providerId?: string; modelId?: string } = {},
): Promise<void> {
  if (!isIdbAvailable()) {
    // 真机 Lynx runtime：无 IDB → 静默跳过写（warn 一次可观测）
    console.warn('[translationCache] IDB unavailable, skip write', { key })
    return
  }

  const providerId = metadata.providerId ?? 'openai-responses'
  const modelId = metadata.modelId ?? 'unknown'

  // 解析 key 元数据（buildTranslationCacheKey 输出形如
  // `<novelId>:<chapterId>:<targetLang>:<modelId>:<sourceHash>:<baseURLHash>`）
  const parsed = parseCacheKey(key)
  if (!parsed) {
    console.warn('[translationCache] invalid cache key format, skip write', { key })
    return
  }

  // parsed 必有 novelId（其他字段 parseCacheKey 已 assert 存在）；兜底用 ?? ''
  const entry: TranslationCacheEntry = {
    key,
    novelId: parsed.novelId ?? 0,
    chapterId: parsed.chapterId ?? '',
    targetLang: parsed.targetLang ?? '',
    modelId: parsed.modelId ?? modelId,
    baseURLHash: parsed.baseURLHash ?? '',
    sourceHash: parsed.sourceHash ?? '',
    paragraphs: value,
    createdAt: Date.now(),
    providerId,
  }

  let db: IDBDatabase
  try {
    db = await openDbWithTimeout()
  } catch (err) {
    console.warn('[translationCache] open database failed, skip write', { key, err })
    return
  }

  try {
    // Step 1：检查 count，超过上限启动淘汰
    const count = await new Promise<number>((resolve, reject) => {
      const tx = db.transaction(STORE_TRANSLATIONS, 'readonly')
      const req = tx.objectStore(STORE_TRANSLATIONS).count()
      req.onsuccess = (): void => resolve(req.result)
      req.onerror = (): void => reject(req.error)
    })

    if (count >= LRU_CAPACITY) {
      await evictOldestEntries(db, count - LRU_CAPACITY + 1)
    }

    // Step 2：写入新条目
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_TRANSLATIONS, 'readwrite')
      tx.objectStore(STORE_TRANSLATIONS).put(entry, key)
      tx.oncomplete = (): void => resolve()
      tx.onerror = (): void => reject(tx.error)
    })
  } catch (err) {
    console.warn('[translationCache] write failed', { key, err })
  }
}

/**
 * 解析缓存键字符串（兼容 buildTranslationCacheKey 输出格式）。
 * 失败返回 null（caller 视为非法 key + 跳过）。
 */
function parseCacheKey(key: string): Partial<TranslationCacheKey> | null {
  const parts = key.split(':')
  if (parts.length !== 6) return null
  const novelId = Number(parts[0])
  if (!Number.isFinite(novelId)) return null
  return {
    novelId,
    chapterId: parts[1],
    targetLang: parts[2],
    modelId: parts[3],
    sourceHash: parts[4],
    baseURLHash: parts[5],
  }
}

/**
 * LRU 淘汰：cursor 按 createdAt 升序遍历，淘汰指定数量最早条目。
 *
 * 注：避免多事务递归（性能 + 简化）；收集足够样本后停止 cursor 推进，
 * 排序后开启独立事务删除。删除失败时 warn（不抛错，AGENTS.md 硬约束 #3）。
 */
async function evictOldestEntries(db: IDBDatabase, targetDeleteCount: number): Promise<void> {
  const collected: Array<{ key: IDBValidKey; createdAt: number }> = []
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_TRANSLATIONS, 'readonly')
    const cursorReq = tx.objectStore(STORE_TRANSLATIONS).openCursor()
    cursorReq.onsuccess = (): void => {
      const cursor = cursorReq.result
      if (!cursor) return
      const value = cursor.value as TranslationCacheEntry
      collected.push({ key: cursor.key, createdAt: value.createdAt })
      if (collected.length >= targetDeleteCount * 2) return // 样本足够
      cursor.continue()
    }
    cursorReq.onerror = (): void => reject(cursorReq.error)
    tx.oncomplete = (): void => resolve()
    tx.onerror = (): void => reject(tx.error)
  })

  collected.sort((a, b) => a.createdAt - b.createdAt)
  const toDelete = collected.slice(0, targetDeleteCount)
  if (toDelete.length === 0) return

  await new Promise<void>((resolve, reject) => {
    const delTx = db.transaction(STORE_TRANSLATIONS, 'readwrite')
    const delStore = delTx.objectStore(STORE_TRANSLATIONS)
    for (const item of toDelete) {
      delStore.delete(item.key)
    }
    delTx.oncomplete = (): void => resolve()
    delTx.onerror = (): void => reject(delTx.error)
  })
}

/**
 * 删除单条缓存（「重译」用：只失效本章，不动其它章节）。
 *
 * IO 边界：不可用 / 失败 → warn 并返回（调用方随后必然重新请求，不会静默用旧译文）。
 */
export async function removeTranslation(key: string): Promise<void> {
  if (!isIdbAvailable()) {
    console.warn("[translationCache] removeTranslation 跳过：IndexedDB 不可用", { key })
    return
  }
  try {
    const db = await openDbWithTimeout()
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_TRANSLATIONS, "readwrite")
      tx.objectStore(STORE_TRANSLATIONS).delete(key)
      tx.oncomplete = (): void => resolve()
      tx.onerror = (): void => reject(tx.error)
    })
  } catch (err) {
    console.warn("[translationCache] removeTranslation failed", { key, err })
  }
}

/**
 * 清除整个 translations store（仅清 translations，不影响 kv store）。
 * 用户主动「清除翻译缓存」入口（spec §6.1 / §9.5）。
 */
export async function clearTranslationCache(): Promise<void> {
  if (!isIdbAvailable()) {
    console.warn("[translationCache] 清除缓存跳过：IndexedDB 不可用（本 runtime 无缓存可清）")
    return
  }
  try {
    const db = await openDbWithTimeout()
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_TRANSLATIONS, 'readwrite')
      tx.objectStore(STORE_TRANSLATIONS).clear()
      tx.oncomplete = (): void => resolve()
      tx.onerror = (): void => reject(tx.error)
    })
  } catch (err) {
    console.warn('[translationCache] clear failed', { err })
  }
}

// ─────────────────── 高层便捷方法 ───────────────────

/**
 * 构造完整缓存键（key 元数据 → 字符串）。
 * 简化调用方：6 元组字段直接传入，免去手工 buildTranslationCacheKey。
 */
export function makeCacheKey(input: {
  novelId: number
  chapterId: string
  targetLang: string
  modelId: string
  paragraphs: string[]
  baseURL: string
}): { key: string; sourceHash: string; baseURLHash: string } {
  const sourceHash = computeSourceHash(input.paragraphs)
  const baseURLHash = computeBaseURLHash(input.baseURL)
  const key = buildTranslationCacheKey({
    novelId: input.novelId,
    chapterId: input.chapterId,
    targetLang: input.targetLang,
    modelId: input.modelId,
    sourceHash,
    baseURLHash,
  })
  return { key, sourceHash, baseURLHash }
}
// ─── 浏览历史（BrowsingHistory）store（ADR-0219 / 术语文档 glossary-lynx-continue-reading / 票 #927）───
// 本地插画浏览流水：**行为流水**，与「继续读」（小说阅读位置）物理隔离（术语文档易混辨析 #2）。
// 📌 **本 store 只记插画**：两条轴按作品类型天然不相交，打开小说不在此留记录、反之亦然
//   （零去重判断、零重叠数据）。与「稍后看 / 追更 / 收藏」同样隔离（易混辨析 #1 代码红线）。
//
// 📌 **过期策略逐对象施加**：本 store **30 天过期**（沿 ADR-0094 先例）——流水记录的价值随时间
//   衰减，「我上周刷到的那张图」不值得召回。**续读（小说）不设过期**，那是另一个 store
//   （continueReadingStore）的决策：把 30 天套到「没读完的书」上等于替用户结案。
//
// 📌 **无完成态**：流水没有「读完」这回事，`completedAt` 属续读条目（票 #928 的消费面）。
//
// 📌 **不依赖停留时长**：可观测信号只有「打开了哪张图」——停留时长/滚动门槛在本栈拿不到，
//   造门槛等于造依赖不存在信号的逻辑（ADR-0219 §2.3 同款纪律，插画侧只到「打开」这一级）。
//
// 存储（照 ADR-0191 稍后看范式）：账号级键 `browsing_history_${uid}` 走 settingsStore 的
// PrefsStorage seam（原生 PictelioPrefs / web-core idbKV），值 = JSON 字符串数组。
// Pinia setup store（ADR-0139 模式，先例 watchLaterStore / continueReadingStore）。
import { ref, watch } from "vue"
import { defineStore } from "pinia"
import { prefs } from "./settingsStore"
import { useAuthStore } from "./authStore"
import type { PixivIllust } from "../api/types"

/**
 * 浏览记录条目（术语文档核心术语「浏览记录条目」）：
 * 一条 = 一次插画浏览的快照。`visitCount` 承载「重复打开同一张图不新增条目、只累计次数」
 * （ADR-0094 旧 `historyStore` 语义，本项目只重建其插画侧）。
 */
export interface BrowsingHistoryItem {
  illustId: number
  title: string
  /** 封面原始 URL（存 API 原值，不烘焙代理前缀——渲染时经 proxyImageUrl） */
  coverUrl: string
  userId: number
  userName: string
  /** 受限等级 0/1/2；存快照使列表**零网络**判定受限卡（ADR-0219 §2.5） */
  xRestrict: number
  /** 最近浏览时刻（epoch ms）——排序仅靠数组顺序，字段供展示与调试 */
  visitedAt: number
  /** 累计浏览次数（首次 = 1；重复打开只 +1，不新增条目） */
  visitCount: number
  /**
   * 作品已失效（作者删除 / 下架 / 不可访问）。由**再次点开时**的详情加载失败置位，
   * 不做列表批量探活——那会让每行都发一次请求（且受限行连请求都不该发）。
   * 📌 置位后列表**照常渲染该条目**并标注不可用、保留移除入口（禁静默降级）。
   */
  unavailable?: boolean
}

/** 容量上限（ADR-0219 §2.5：300 条，超出丢最旧 + warn。⚠️ 与续读的 200 是两套规则） */
export const BROWSING_HISTORY_CAP = 300

/** 过期时长（ADR-0219 §2.5 / 沿用 ADR-0094 先例：30 天） */
export const BROWSING_HISTORY_TTL_MS = 30 * 24 * 60 * 60 * 1000

/** 账号级持久化键（照 `watch_later_${uid}` 范式；⚠️ 不在备份域的 `ACCOUNT_KEY_PREFIXES` 内） */
const browsingHistoryKey = (uid: number) => `browsing_history_${uid}`

/**
 * 过期判定（边界含当天）：`now - visitedAt > TTL` ⇒ **恰好 30 天那条仍可见**，跨过 1ms 才消失。
 * 📌 用严格大于而非 `>=`：把「30 天整」判成过期会让用户在第 30 天当天眼看我刷过的图消失。
 */
export function isHistoryExpired(visitedAt: number, now: number): boolean {
  return now - visitedAt > BROWSING_HISTORY_TTL_MS
}

/** 懒清除：逐条独立判定（不同条目按各自 visitedAt 算，不按「历史」这个词统一施加） */
export function pruneExpiredHistory(items: BrowsingHistoryItem[], now: number): BrowsingHistoryItem[] {
  return items.filter((it) => !isHistoryExpired(it.visitedAt, now))
}

/** 条目形状校验（持久化回放防御：字段残缺/类型漂移的条目不进内存） */
export function isBrowsingHistoryItem(v: unknown): v is BrowsingHistoryItem {
  if (typeof v !== "object" || v === null) return false
  const o = v as Record<string, unknown>
  return (
    typeof o.illustId === "number" &&
    typeof o.title === "string" &&
    typeof o.coverUrl === "string" &&
    typeof o.userId === "number" &&
    typeof o.userName === "string" &&
    typeof o.xRestrict === "number" &&
    typeof o.visitedAt === "number" &&
    typeof o.visitCount === "number" &&
    o.visitCount >= 1 &&
    (o.unavailable === undefined || typeof o.unavailable === "boolean")
  )
}

/**
 * 存储值解析（ADR-0219 §2.5）：仅接受浏览记录条目数组。
 * 损坏/非法 JSON → console.warn（模块前缀）+ 空列表兜底（禁静默降级）；
 * 数组内非法条目逐条跳过并 warn；过期条目懒清除；超容量截断保留最新并 warn。
 *
 * 📌 **小说形状的条目（`novelId`）在这里必被跳过**——两条轴的存储互不串味是形状级的
 *   （`isBrowsingHistoryItem` 要求 illustId），不是靠调用方自觉。
 */
export function parseBrowsingHistoryRaw(
  raw: string,
  now: number = Date.now(),
): BrowsingHistoryItem[] {
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) {
      console.warn("[browsingHistoryStore] 浏览历史数据非法（非数组），按空列表处理:", raw)
      return []
    }
    const items = parsed.filter(isBrowsingHistoryItem)
    if (items.length !== parsed.length) {
      console.warn(
        "[browsingHistoryStore] 浏览历史含非法条目，已跳过:",
        parsed.length - items.length,
      )
    }
    const kept = pruneExpiredHistory(items, now)
    if (kept.length !== items.length) {
      console.warn("[browsingHistoryStore] 已清除超期浏览记录:", items.length - kept.length)
    }
    if (kept.length > BROWSING_HISTORY_CAP) {
      console.warn(
        "[browsingHistoryStore] 浏览历史存储值超容量，截断保留最新:",
        kept.length,
        BROWSING_HISTORY_CAP,
      )
    }
    return kept.slice(0, BROWSING_HISTORY_CAP)
  } catch {
    console.warn("[browsingHistoryStore] 浏览历史 JSON 解析失败，按空列表处理:", raw)
    return []
  }
}

/**
 * 快照构造（从**详情页已有数据**构造，**零新增网络请求**——照 watchLater 的 toIllustSnapshot 范式）。
 * 封面 square_medium 优先（列表小图档），缺失逐级回退 medium。
 */
export function toIllustHistorySnapshot(
  illust: PixivIllust,
  visitedAt: number = Date.now(),
): BrowsingHistoryItem {
  return {
    illustId: illust.id,
    title: illust.title,
    coverUrl: illust.image_urls.square_medium || illust.image_urls.medium || "",
    userId: illust.user.id,
    userName: illust.user.name,
    xRestrict: illust.x_restrict,
    visitedAt,
    visitCount: 1,
  }
}

export const useBrowsingHistoryStore = defineStore("browsingHistory", () => {
  const auth = useAuthStore()
  /** 当前账号 ID（未登录 null）——uid 变化由下方 watch 重载 */
  const uid = (): number | null => auth.currentUser?.id ?? null

  /** state：有序数组（新条目前插，最新在前——数组顺序即排序依据） */
  const _items = ref<BrowsingHistoryItem[]>([])
  const items = _items
  /**
   * hydrate 是否已落定（`ready`）。页面据此区分「还不知道」与「确实没有」——
   * 缺它会把 hydrate 在飞渲染成空列表，正是测试硬约束 #3 禁的那类静默降级。
   */
  const ready = ref(false)

  /** hydrate 代闸：uid 连续切换时旧账号的在飞读取作废（竞态防护硬约束 #3） */
  let hydrateGeneration = 0

  /** 已记录判定：按 illustId 精确匹配 */
  function has(illustId: number): boolean {
    return _items.value.some((it) => it.illustId === illustId)
  }

  /**
   * 落盘（先更内存后持久化）：未登录不写盘（账号级语义）；
   * 写失败 warn 可见、不回滚内存态（禁静默降级，watchLaterStore.persist 同策略）。
   */
  function persist(): void {
    const id = uid()
    if (id === null) return
    void prefs()
      .set(browsingHistoryKey(id), JSON.stringify(_items.value))
      .catch((e) => console.warn("[browsingHistoryStore] 浏览历史写入失败（内存态保留）", e))
  }

  /**
   * 记录一次浏览（**打开即记，零门槛**，ADR-0219 §2.3 同款纪律的插画侧形态）：
   * 重复浏览同一张图 = **更新时间戳 + 累计次数 + 移位到最前**，**不新增条目**。
   *
   * 📌 `visitCount` 取 `existing + 1` 而非入参值：快照恒带 1，若直接采纳入参
   *   会把累计次数重置成 1——那条「次数」正是本条存在的理由之一。
   * 📌 写入前先懒清除超期条目：让过期流水**不占容量**（否则 300 的上限会被死条目吃光）。
   * 📌 `unavailable` 清掉：用户能点开说明作品可读了，失效标记应自愈而非永久粘住。
   */
  function record(snapshot: BrowsingHistoryItem): void {
    const existing = _items.value.find((it) => it.illustId === snapshot.illustId)
    const next: BrowsingHistoryItem = existing
      ? {
          ...existing,
          ...snapshot,
          visitCount: existing.visitCount + 1,
          unavailable: false,
        }
      : snapshot
    const rest = pruneExpiredHistory(
      _items.value.filter((it) => it.illustId !== snapshot.illustId),
      snapshot.visitedAt,
    )
    const merged = [next, ...rest]
    if (merged.length > BROWSING_HISTORY_CAP) {
      const dropped = merged.splice(BROWSING_HISTORY_CAP)
      console.warn(
        "[browsingHistoryStore] 容量已满，丢弃最旧条目:",
        dropped.length,
        BROWSING_HISTORY_CAP,
      )
    }
    _items.value = merged
    persist()
  }

  /**
   * 标记作品失效（票 #927 AC #10）：由插画详情页加载失败时调用。
   * 已在列表中才写（避免为没浏览过的作品建条目）；已标记则 no-op。
   */
  function markUnavailable(illustId: number): void {
    const hit = _items.value.find((it) => it.illustId === illustId)
    if (!hit || hit.unavailable === true) return
    hit.unavailable = true
    _items.value = [..._items.value]
    persist()
  }

  /** 单条移除：不存在则 no-op 且不写盘（watchLaterStore.remove 同语义） */
  function remove(illustId: number): void {
    if (!has(illustId)) return
    _items.value = _items.value.filter((it) => it.illustId !== illustId)
    persist()
  }

  /**
   * 账号数据装载（认证就绪后调用一次；uid 变化由下方 watch 自动重载）。
   * 键缺失 = 该账号暂无数据（空列表，不 warn）；
   * 损坏/读失败 → warn + 空列表兜底（禁静默降级）；
   * 装载时顺带**懒清除超期条目**（流水的过期在装载这一读点施加，不做后台定时器）。
   */
  async function hydrate(): Promise<void> {
    const gen = ++hydrateGeneration
    const id = uid()
    if (id === null) {
      _items.value = []
      ready.value = true
      return
    }
    let raw: string | null
    try {
      raw = await prefs().get(browsingHistoryKey(id))
    } catch (e) {
      if (gen !== hydrateGeneration) return
      console.warn("[browsingHistoryStore] 浏览历史读取失败（按空列表处理）", e)
      _items.value = []
      ready.value = true
      return
    }
    if (gen !== hydrateGeneration) return // 旧账号在飞响应作废
    _items.value = raw === null ? [] : parseBrowsingHistoryRaw(raw)
    ready.value = true
  }

  // uid 变化（登录 / 登出 / 换号）重载对应账号键；只跟 id 数值——token 刷新替换
  // user 对象但 id 不变，不触发重载（watchLaterStore / continueReadingStore 同款）
  watch(
    () => auth.currentUser?.id ?? null,
    () => {
      ready.value = false // 换号期间回到「还不知道」，别把新账号的空渲染成「你没有」
      void hydrate()
    },
  )

  return { items, ready, has, record, markUnavailable, remove, hydrate }
})

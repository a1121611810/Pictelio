// ─── 续读（ContinueReading）store（ADR-0219 / 术语文档 glossary-lynx-continue-reading / 票 #926）───
// 本地小说话级阅读位置：**未完成事项**，与「稍后看」「浏览历史」物理隔离（术语文档易混辨析 #1/#2）。
//
// 📌 **位置语义 = 会话末**（ADR-0219 §2.2）：记录**本次退出时读到的那话**，允许往回拨。
//   刻意**不**采用 Kindle 的「最远水位」与 Mihon 的「最旧未读」——那两者是**跨端冲突**
//   逼出来的最小仲裁规则，本项目本地单机、无需仲裁的冲突。本语义使**重读场景正确**。
//
// 📌 **粒度停在话级是平台约束，不是取舍**：`main-thread-bindscroll` 在当前构建未确认派发
//   （NovelDetail.vue:161-163，2026-09-02 真机复测），段内位置拿不到可靠信号。
//
// 📌 **过期策略逐对象施加**：本 store **不设过期**——半年前在读的书今天继续是真实场景。
//   30 天过期属于**浏览历史**（插画侧，另一 store），见 glossary 辨析 #2。
//
// 存储（照 ADR-0191 稍后看范式）：账号级键 `continue_reading_${uid}` 走 settingsStore 的
// PrefsStorage seam（原生 PictelioPrefs / web-core idbKV），值 = JSON 字符串数组。
// Pinia setup store（ADR-0139 模式，先例 watchLaterStore / searchHistoryStore / settingsStore）。
import { ref, computed, watch } from "vue"
import { defineStore } from "pinia"
import { prefs } from "./settingsStore"
import { useAuthStore } from "./authStore"
import type { PixivNovel } from "../api/types"

/**
 * 续读条目（Continue Reading Entry，术语文档核心术语）：
 * 一条 = 一个小说作品的一条话级位置。
 * `chapterNo` / `chapterTotal` 是**显示派生量**——`chapterTotal` 缺失（单本小说，
 * 或章节不在服务端首页返回范围内）时不渲染「第N话」，**不推算、不假装**。
 */
export interface ContinueReadingItem {
  novelId: number
  /** 系列 id；单本小说无系列时为 undefined */
  seriesId?: number
  /** 本话在系列中的序号（1-based）；不可确定时 undefined */
  chapterNo?: number
  /** 系列总话数；单本小说无系列时为 undefined */
  chapterTotal?: number
  title: string
  /** 封面原始 URL（存 API 原值，不烘焙代理前缀——渲染时经 proxyImageUrl） */
  coverUrl: string
  userId: number
  userName: string
  /** 受限等级 0/1/2；存快照使列表**零网络**判定受限卡（ADR-0219 §2.5） */
  xRestrict: number
  /** 最近打开时刻（epoch ms）——排序仅靠数组顺序，字段供展示与调试 */
  lastOpenedAt: number
  /** 完成时刻（epoch ms）。软删标记：完成后不进入主列表，但**不删除**（票 #928 写入） */
  completedAt?: number
  /**
   * 作品已失效（作者删除 / 下架 / 不可访问）。由**用户点开时**的加载失败置位，
   * 不做列表批量探活——那会让每行都发一次请求（且受限行连请求都不该发）。
   * 📌 置位后列表**照常渲染该条目**并标注不可用、保留移除入口（禁静默降级）。
   */
  unavailable?: boolean
}

/** 容量上限（ADR-0219 §2.5：200 条，超出丢最旧 + warn） */
export const CONTINUE_READING_CAP = 200

/** 账号级持久化键（照 `watch_later_${uid}` 范式；⚠️ 不在备份域的 `ACCOUNT_KEY_PREFIXES` 内） */
const continueReadingKey = (uid: number) => `continue_reading_${uid}`

function isOptionalPositiveInt(v: unknown): boolean {
  return v === undefined || (typeof v === "number" && Number.isInteger(v) && v > 0)
}

/** 续读条目形状校验（持久化回放防御：字段残缺/类型漂移的条目不进内存） */
export function isContinueReadingItem(v: unknown): v is ContinueReadingItem {
  if (typeof v !== "object" || v === null) return false
  const o = v as Record<string, unknown>
  return (
    typeof o.novelId === "number" &&
    typeof o.title === "string" &&
    typeof o.coverUrl === "string" &&
    typeof o.userId === "number" &&
    typeof o.userName === "string" &&
    typeof o.xRestrict === "number" &&
    typeof o.lastOpenedAt === "number" &&
    isOptionalPositiveInt(o.seriesId) &&
    isOptionalPositiveInt(o.chapterNo) &&
    isOptionalPositiveInt(o.chapterTotal) &&
    (o.completedAt === undefined || typeof o.completedAt === "number") &&
    (o.unavailable === undefined || typeof o.unavailable === "boolean")
  )
}

/**
 * 存储值解析（ADR-0219 §2.5）：仅接受续读条目数组。
 * 损坏/非法 JSON → console.warn（模块前缀）+ 空列表兜底（禁静默降级）；
 * 数组内非法条目逐条跳过并 warn；超容量截断保留最新并 warn。
 */
export function parseContinueReadingRaw(raw: string): ContinueReadingItem[] {
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) {
      console.warn("[continueReadingStore] 续读数据非法（非数组），按空列表处理:", raw)
      return []
    }
    const items = parsed.filter(isContinueReadingItem)
    if (items.length !== parsed.length) {
      console.warn(
        "[continueReadingStore] 续读含非法条目，已跳过:",
        parsed.length - items.length,
      )
    }
    if (items.length > CONTINUE_READING_CAP) {
      console.warn(
        "[continueReadingStore] 续读存储值超容量，截断保留最新:",
        items.length,
        CONTINUE_READING_CAP,
      )
    }
    return items.slice(0, CONTINUE_READING_CAP)
  } catch {
    console.warn("[continueReadingStore] 续读 JSON 解析失败，按空列表处理:", raw)
    return []
  }
}

/**
 * 快照构造（从正文页已有数据构造，**零新增网络请求**——照 watchLater 的 toNovelSnapshot 范式）。
 * 封面 square_medium 优先（列表小图档），缺失逐级回退 medium。
 */
export function toNovelContinueSnapshot(
  novel: PixivNovel,
  lastOpenedAt: number = Date.now(),
  series?: { id: number; chapterNo?: number; chapterTotal?: number },
): ContinueReadingItem {
  const item: ContinueReadingItem = {
    novelId: Number(novel.id),
    title: novel.title,
    coverUrl: novel.image_urls.square_medium || novel.image_urls.medium || "",
    userId: novel.user.id,
    userName: novel.user.name,
    xRestrict: novel.x_restrict,
    lastOpenedAt,
  }
  // ⚠️ 显式 undefined 会被 JSON.stringify 省略 ⇒ 不污染存储形状
  const seriesId = series?.id ?? novel.series?.id
  if (seriesId != null) item.seriesId = Number(seriesId)
  if (series?.chapterNo != null) item.chapterNo = series.chapterNo
  if (series?.chapterTotal != null) item.chapterTotal = series.chapterTotal
  return item
}

/**
 * 段内状态文案（ADR-0219 §2.1 展示形态）：「上次读到 第N话」。
 * 📌 **不可确定时返回 null**（单本小说 / 章节不在服务端首页范围 / chapterNo 超出总量）——
 *   不推算、不输出自相矛盾的坐标。返回 i18n 键的**参数**而非成品文案，文案本身由 i18n 决定。
 */
export function decideContinueLabel(
  item: Pick<ContinueReadingItem, "chapterNo" | "chapterTotal">,
): { chapterNo: number } | null {
  const { chapterNo, chapterTotal } = item
  if (chapterNo == null) return null
  if (chapterTotal != null && chapterNo > chapterTotal) return null
  return { chapterNo }
}

export const useContinueReadingStore = defineStore("continueReading", () => {
  const auth = useAuthStore()
  /** 当前账号 ID（未登录 null）——uid 变化由下方 watch 重载 */
  const uid = (): number | null => auth.currentUser?.id ?? null

  /** state：有序数组（新条目前插，最新在前——数组顺序即排序依据） */
  const _items = ref<ContinueReadingItem[]>([])
  const items = _items
  /**
   * hydrate 是否已落定（`ready`）。页面据此区分「还不知道」与「确实没有」——
   * 缺它会把 hydrate 在飞渲染成空列表，正是测试硬约束 #3 禁的那类静默降级。
   */
  const ready = ref(false)
  /** 未完成条目（已完成项由票 #928 移出主列表；本字段为 #928 的消费面预留） */
  const active = computed(() => _items.value.filter((it) => it.completedAt === undefined))

  /** hydrate 代闸：uid 连续切换时旧账号的在飞读取作废（竞态防护硬约束 #3） */
  let hydrateGeneration = 0

  /** 已记录判定：按 novelId 精确匹配 */
  function has(novelId: number): boolean {
    return _items.value.some((it) => it.novelId === novelId)
  }

  /**
   * 落盘（先更内存后持久化）：未登录不写盘（账号级语义）；
   * 写失败 warn 可见、不回滚内存态（禁静默降级，watchLaterStore.persist 同策略）。
   */
  function persist(): void {
    const id = uid()
    if (id === null) return
    void prefs()
      .set(continueReadingKey(id), JSON.stringify(_items.value))
      .catch((e) => console.warn("[continueReadingStore] 续读写入失败（内存态保留）", e))
  }

  /**
   * 记录位置（**会话末语义**，ADR-0219 §2.2）：
   * 重复记录同一本 = **位置更新 + 移位到最前**，不新增条目。
   *
   * 📌 **completedAt 刻意保留**：完成后重开该作品时，完成态不被一次好奇点开抹掉，
   *   而位置照常更新——三者串起来构成重读闭环（ADR-0219 §2.3）。
   */
  function record(snapshot: ContinueReadingItem): void {
    const existing = _items.value.find((it) => it.novelId === snapshot.novelId)
    // 📌 completedAt 刻意保留（完成后重开不复活）；unavailable 则**清掉**——
    //   用户能点开说明作品可读了，失效标记应自愈而非永久粘住。
    const next: ContinueReadingItem = existing
      ? { ...existing, ...snapshot, completedAt: existing.completedAt, unavailable: false }
      : snapshot
    const rest = _items.value.filter((it) => it.novelId !== snapshot.novelId)
    const merged = [next, ...rest]
    if (merged.length > CONTINUE_READING_CAP) {
      const dropped = merged.splice(CONTINUE_READING_CAP)
      console.warn(
        "[continueReadingStore] 容量已满，丢弃最旧条目:",
        dropped.length,
        CONTINUE_READING_CAP,
      )
    }
    _items.value = merged
    persist()
  }

  /**
   * 标记作品失效（票 #926 AC #9）：由正文页加载失败时调用。
   * 已在列表中才写（避免为没读过的作品建条目）；已标记则 no-op。
   */
  function markUnavailable(novelId: number): void {
    const hit = _items.value.find((it) => it.novelId === novelId)
    if (!hit || hit.unavailable === true) return
    hit.unavailable = true
    _items.value = [..._items.value]
    persist()
  }

  /** 单条移除：不存在则 no-op 且不写盘（watchLaterStore.remove 同语义） */
  function remove(novelId: number): void {
    if (!has(novelId)) return
    _items.value = _items.value.filter((it) => it.novelId !== novelId)
    persist()
  }

  /**
   * 账号数据装载（认证就绪后调用一次；uid 变化由下方 watch 自动重载）。
   * 键缺失 = 该账号暂无数据（空列表，不 warn）；
   * 损坏/读失败 → warn + 空列表兜底（禁静默降级）。
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
      raw = await prefs().get(continueReadingKey(id))
    } catch (e) {
      if (gen !== hydrateGeneration) return
      console.warn("[continueReadingStore] 续读读取失败（按空列表处理）", e)
      _items.value = []
      ready.value = true
      return
    }
    if (gen !== hydrateGeneration) return // 旧账号在飞响应作废
    _items.value = raw === null ? [] : parseContinueReadingRaw(raw)
    ready.value = true
  }

  // uid 变化（登录 / 登出 / 换号）重载对应账号键；只跟 id 数值——token 刷新替换
  // user 对象但 id 不变，不触发重载（watchLaterStore 同款）
  watch(
    () => auth.currentUser?.id ?? null,
    () => {
      ready.value = false // 换号期间回到「还不知道」，别把新账号的空渲染成「你没有」
      void hydrate()
    },
  )

  return { items, ready, active, has, record, markUnavailable, remove, hydrate }
})

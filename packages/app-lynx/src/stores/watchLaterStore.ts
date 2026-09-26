// ─── 稍后看（WatchLater）store（ADR-0191 / spec docs/specs/lynx-watch-later.md / #751 T3）───
// 本地暂存作品列表：插画与小说双类型快照条目，纯客户端能力（Pixiv 无"稍后观看"端点）。
// 术语红线（docs/adr/glossary-lynx-four-features.md 易混辨析 #1）：本链路全量 later / watchLater
// 命名（路由 /later、i18n 前缀 later.*、键 watch_later_${uid}），与既有追更功能物理隔离、
// 零数据零联动——两侧词根不得交叉（源级守卫见本目录 watchLaterStore.test.ts）。
// 模型（ADR-0191 D1/D2）：存储单元 = 快照条目（标题/封面/作者/加入时刻），加入时从页面
// 已有数据构造（零新增网络请求）；去重键 = (WorkKind, id)；新条目前插（最新在前）。
// 持久化（ADR-0191 D4）：账号级键 watch_later_${uid} 走 settingsStore 的 PrefsStorage seam
//（原生 PictelioPrefs / web-core idbKV，ADR-0103 决策 3），值 = JSON 字符串数组。
// Pinia setup store（ADR-0139 模式，先例 searchHistoryStore / settingsStore）：
// state 为闭包内 ref，跨 store 消费经 setup 内 useAuthStore() 取 uid，uid 变化 watch 重载。
import { ref, computed, watch } from "vue"
import { defineStore } from "pinia"
import { prefs } from "./settingsStore"
import { useAuthStore } from "./authStore"
import type { PixivIllust, PixivNovel } from "../api/types"

/** 作品类型（术语表「WorkKind」）：快照条目类型维度，去重键的一半 */
export type WorkKind = "illust" | "novel"

/** 快照条目（术语表「快照条目」：字段固定七项，加入时从已有页面数据构造） */
export interface WatchLaterItem {
  kind: WorkKind
  id: number
  title: string
  /** 封面原始 URL（存 API 原值，不烘焙代理前缀——渲染时经 proxyImageUrl 代理） */
  coverUrl: string
  userId: number
  userName: string
  /** 加入时刻（epoch ms）——排序仅靠数组顺序（新在前），此字段供列表页展示 */
  addedAt: number
}

/** 容量上限（ADR-0191 D3：500 条，超出丢最旧 + warn） */
export const WATCH_LATER_CAP = 500

/** 账号级持久化键（ADR-0103 账号级模式：双端逐字同键的契约预留） */
const watchLaterKey = (uid: number) => `watch_later_${uid}`

/**
 * 快照条目构造（插画）：从详情页/卡片已有 PixivIllust 现成字段取值，封面 square_medium
 * 优先（列表小图档）、缺失逐级回退 medium（字段契约恒在，|| 为运行时防御）。
 */
export function toIllustSnapshot(illust: PixivIllust, addedAt: number = Date.now()): WatchLaterItem {
  return {
    kind: "illust",
    id: illust.id,
    title: illust.title,
    coverUrl: illust.image_urls.square_medium || illust.image_urls.medium || "",
    userId: illust.user.id,
    userName: illust.user.name,
    addedAt,
  }
}

/** 快照条目构造（小说）：同上，从 PixivNovel 现成字段取值 */
export function toNovelSnapshot(novel: PixivNovel, addedAt: number = Date.now()): WatchLaterItem {
  return {
    kind: "novel",
    id: novel.id,
    title: novel.title,
    coverUrl: novel.image_urls.square_medium || novel.image_urls.medium || "",
    userId: novel.user.id,
    userName: novel.user.name,
    addedAt,
  }
}

function isWorkKind(v: unknown): v is WorkKind {
  return v === "illust" || v === "novel"
}

/** 快照条目形状校验（持久化回放防御：字段残缺/类型漂移的条目不进内存） */
export function isWatchLaterItem(v: unknown): v is WatchLaterItem {
  if (typeof v !== "object" || v === null) return false
  const o = v as Record<string, unknown>
  return (
    isWorkKind(o.kind) &&
    typeof o.id === "number" &&
    typeof o.title === "string" &&
    typeof o.coverUrl === "string" &&
    typeof o.userId === "number" &&
    typeof o.userName === "string" &&
    typeof o.addedAt === "number"
  )
}

/**
 * 存储值解析（ADR-0191 D4 / spec D5）：仅接受快照条目数组。
 * 损坏/非法 JSON → console.warn（模块前缀）+ 空列表兜底（parseMuteTagsRaw 先例，禁静默降级）；
 * 数组内非法条目逐条跳过并 warn；超容量截断保留最新并 warn（存储值理论恒 ≤ 上限，防御旧版本/脏数据）。
 */
export function parseWatchLaterRaw(raw: string): WatchLaterItem[] {
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) {
      console.warn("[watchLaterStore] 稍后看数据非法（非数组），按空列表处理:", raw)
      return []
    }
    const items = parsed.filter(isWatchLaterItem)
    if (items.length !== parsed.length) {
      console.warn("[watchLaterStore] 稍后看含非法快照条目，已跳过:", parsed.length - items.length)
    }
    if (items.length > WATCH_LATER_CAP) {
      console.warn("[watchLaterStore] 稍后看存储值超容量，截断保留最新:", items.length, WATCH_LATER_CAP)
    }
    return items.slice(0, WATCH_LATER_CAP)
  } catch {
    console.warn("[watchLaterStore] 稍后看 JSON 解析失败，按空列表处理:", raw)
    return []
  }
}

export const useWatchLaterStore = defineStore("watchLater", () => {
  // ── 跨 store 组合：读 authStore.currentUser.id 推导 uid（settingsStore 同模式）──
  const auth = useAuthStore()
  /** 当前账号 ID（未登录 null）——uid 变化由下方 watch 重载 */
  const uid = (): number | null => auth.currentUser?.id ?? null

  // ── state：有序数组（新条目前插，最新在前；ADR-0191 D2）──
  const _items = ref<WatchLaterItem[]>([])
  /** 公共 state（setup store 自动解包） */
  const items = _items
  /** 条目计数 getter（Me 页入口徽标数据源） */
  const count = computed(() => _items.value.length)

  /** hydrate 代闸：uid 连续切换时旧账号的在飞读取作废（竞态防护硬约束） */
  let hydrateGeneration = 0

  /** 已加入判定（详情入口高亮数据源）：按 (WorkKind, id) 精确匹配 */
  function has(kind: WorkKind, id: number): boolean {
    return _items.value.some((it) => it.kind === kind && it.id === id)
  }

  /**
   * 落盘（先更内存后持久化）：未登录不写盘（账号级语义，settingsStore 账号键同款）；
   * 写失败 warn 可见、不回滚内存态（禁静默降级，searchHistoryStore.persist 同策略）。
   */
  function persist(): void {
    const id = uid()
    if (id === null) return
    void prefs()
      .set(watchLaterKey(id), JSON.stringify(_items.value))
      .catch((e) => console.warn("[watchLaterStore] 稍后看写入失败（内存态保留）", e))
  }

  /**
   * 加入（幂等）：重复 (kind, id) 不重复插入、不移位、不更新原条目（ADR-0191 D2）。
   * 超容量从尾部（最旧）弹出并 warn（ADR-0191 D3，降级必须可见）。
   */
  function add(snapshot: WatchLaterItem): void {
    if (has(snapshot.kind, snapshot.id)) return
    const next = [snapshot, ..._items.value]
    if (next.length > WATCH_LATER_CAP) {
      const dropped = next.splice(WATCH_LATER_CAP)
      console.warn("[watchLaterStore] 容量已满，丢弃最旧条目:", dropped.length, WATCH_LATER_CAP)
    }
    _items.value = next
    persist()
  }

  /** 单条移除：不存在则 no-op 不写盘（searchHistoryStore.removeHistory 同语义） */
  function remove(kind: WorkKind, id: number): void {
    if (!has(kind, id)) return
    _items.value = _items.value.filter((it) => !(it.kind === kind && it.id === id))
    persist()
  }

  /** toggle：未在 → 加入；已在 → 移除（两详情入口的唯一消费形态） */
  function toggle(snapshot: WatchLaterItem): void {
    if (has(snapshot.kind, snapshot.id)) remove(snapshot.kind, snapshot.id)
    else add(snapshot)
  }

  /**
   * 账号数据装载（认证就绪后调用一次，挂载点 = router initRouter 的 loadSettings 之后；
   * 此后 uid 变化由下方 watch 自动重载）。键缺失 = 该账号暂无数据（空列表，不 warn）；
   * 损坏/读失败 → warn + 空列表兜底（禁静默降级）。
   */
  async function hydrate(): Promise<void> {
    const gen = ++hydrateGeneration
    const id = uid()
    if (id === null) {
      _items.value = []
      return
    }
    let raw: string | null
    try {
      raw = await prefs().get(watchLaterKey(id))
    } catch (e) {
      if (gen !== hydrateGeneration) return
      console.warn("[watchLaterStore] 稍后看读取失败（按空列表处理）", e)
      _items.value = []
      return
    }
    if (gen !== hydrateGeneration) return // 旧账号在飞响应作废
    _items.value = raw === null ? [] : parseWatchLaterRaw(raw)
  }

  // uid 变化（登录 / 登出 / 换号）重载对应账号键；只跟 id 数值——token 刷新替换
  // user 对象但 id 不变，不触发重载（避免在飞写入被回读覆盖）。setup 内注册
  //（store 单例，watcher 常驻；首启 restoreToken 先于本 store 实例化，初装由
  // initRouter 的显式 hydrate 承担，watch 只管此后的登录态变化）。
  watch(
    () => auth.currentUser?.id ?? null,
    () => {
      void hydrate()
    },
  )

  return { items, count, has, add, remove, toggle, hydrate }
})

// 浏览历史（BrowsingHistory）store 单测（ADR-0219 / spec docs/specs/lynx-continue-reading-and-browsing-history.md / 票 #927）。
//
// **同缝约定**（票 #927 AC「与小说侧同缝，1 条主缝，不新开缝」）：本文件与 continueReadingStore.test.ts
// 同目录同形状——可注入 prefs 假存储 + 纯函数直测 + 源级守卫，混在一个文件里（spec §缝的划分 明文如此）。
//
// 期望值溯源（测试硬约束 #6：不自洽反推，每条指回一条已拍板决策或票面 AC）：
// - 打开插画详情页**即**产生/更新记录，**不依赖停留时长**（拿不到该信号） → 票 #927 AC #1
// - 重复打开**不新增条目**，只更新时间戳 + 累计次数                          → 票 #927 AC #2
// - 两类条目进入书架段 3 与**同一个** `/continue` 页；不建 `/history`、不扩第 4 段 → ADR-0219 §2.1 + AC #3
// - 两轴按**最近活动统一倒序混排**；插画行**无**「上次读到 第N话」              → ADR-0219 §2.1 + AC #4
// - **30 天过期**（沿 ADR-0094 先例），**边界含当天**，逐条独立计算           → ADR-0219 §2.5 + AC #5
// - 容量 300、超限丢最旧 + 模块前缀 warn（禁静默降级）                        → ADR-0219 §2.5 + AC #6
// - 账号级键隔离、不串号、uid 连续切换时旧在飞读取作废                        → 术语文档「关系」+ AC #7
// - 损坏存储值 → warn + 降级空列表；非法条目逐条跳过并 warn                     → AC #8
// - R-18 以受限卡呈现，**零网络请求**（快照存 xRestrict 本地判定）              → ADR-0219 §2.5 + AC #9
// - 作品失效显式标注「已不可用」+ 可移除，**不静默隐藏**                         → AC #10
// - 键**不进备份域**（备份只收三类受限相关键）                                → ADR-0219 §2.5 + AC #11
// - 数据层与小说侧完全不相交（形状级 + 接线级双向断言）                        → AC #12
// - mock 模式 → 先例 continueReadingStore.test.ts / watchLaterStore.test.ts
//   （vi.mock 注入 prefs，node 无 idbKV）+ 可控 authStore.currentUser 真实 Vue ref getter
// - PrefsStorage seam 假实现（原生/idbKV 分流不在本测内）
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest"
import type { MockInstance } from "vitest"
import { readFileSync } from "node:fs"
import { ref } from "vue"
import { setActivePinia, createPinia } from "pinia"
import {
  useBrowsingHistoryStore,
  BROWSING_HISTORY_CAP,
  BROWSING_HISTORY_TTL_MS,
  isHistoryExpired,
  pruneExpiredHistory,
  parseBrowsingHistoryRaw,
  isBrowsingHistoryItem,
  toIllustHistorySnapshot,
  type BrowsingHistoryItem,
} from "./browsingHistoryStore"
// 聚合层是**纯函数**（不 import store）⇒ 直测无需任何 store 桩
import { mergeContinueEntries } from "../primitives/continueEntries"
// 备份域判定是**纯函数**（utils/backupCore）⇒ 用来证明「键不进备份域」是行为事实而非注释
import { isAccountScopedKey } from "../utils/backupCore"
// t() 是纯函数（locale = 模块级 ref，默认 zh-CN）⇒ 可直测插值是否真的生效
import { t } from "../i18n"
import type { ContinueReadingItem } from "./continueReadingStore"

/** 可控 prefs 假存储（vi.hoisted：vi.mock 工厂提升后仍可引用） */
const prefsState = vi.hoisted(() => {
  const map = new Map<string, string>()
  const control = {
    failSet: false,
    failGet: false,
    /** 只挂起**第一次** get：用于构造「旧账号响应晚到」的竞态（代闸用例） */
    holdFirstGet: false,
    firstGetRelease: null as null | (() => void),
  }
  return { map, control }
})

vi.mock("./settingsStore", () => ({
  prefs: () => ({
    get: async (key: string) => {
      if (prefsState.control.holdFirstGet) {
        prefsState.control.holdFirstGet = false
        await new Promise<void>((release) => {
          prefsState.control.firstGetRelease = release
        })
      }
      if (prefsState.control.failGet) throw new Error("get failed")
      return prefsState.map.get(key) ?? null
    },
    set: async (key: string, value: string) => {
      if (prefsState.control.failSet) throw new Error("set failed")
      prefsState.map.set(key, value)
    },
    remove: async (key: string) => {
      prefsState.map.delete(key)
    },
  }),
}))

/** 可控 authStore.currentUser（真实 Vue ref getter，watch 可跟踪） */
const mockUser = ref<{ id: number } | null>(null)
vi.mock("./authStore", () => ({
  useAuthStore: () => ({
    get currentUser() {
      return mockUser.value
    },
  }),
}))

let warnSpy: MockInstance<typeof console.warn>
let store: ReturnType<typeof useBrowsingHistoryStore>

/** 有任一 warn 调用带本模块前缀（禁静默降级红线）。对参数个数不敏感——比固定 arity 的
 *  toHaveBeenCalledWith 更强：它只钉「前缀存在」这一契约，不被 warn 的上下文参数个数绑死。 */
const warnedByModule = (): boolean =>
  warnSpy.mock.calls.some((c) => String(c[0]).includes("[browsingHistoryStore]"))

const setUid = (id: number | null): void => {
  mockUser.value = id === null ? null : { id }
}

/** 浏览记录条目工厂（字段集 = 术语表「浏览记录条目」） */
const entry = (illustId: number, overrides: Partial<BrowsingHistoryItem> = {}): BrowsingHistoryItem => ({
  illustId,
  title: `插画${illustId}`,
  coverUrl: `https://i.pximg.net/c/150x150/img-master/img/${illustId}.jpg`,
  userId: 42,
  userName: "作者",
  xRestrict: 0,
  visitedAt: 1_000 + illustId,
  visitCount: 1,
  ...overrides,
})

/** 续读条目工厂（小说侧形状，只用于混排用例；**不是**本 store 的条目） */
const novelEntry = (novelId: number, overrides: Partial<ContinueReadingItem> = {}): ContinueReadingItem => ({
  novelId,
  title: `小说${novelId}`,
  coverUrl: `https://i.pximg.net/c/150x150/img-master/img/novel-${novelId}.jpg`,
  userId: 42,
  userName: "作者",
  xRestrict: 0,
  lastOpenedAt: 1_000 + novelId,
  ...overrides,
})

/** 最小 PixivIllust 形状（仅快照构造用到的字段） */
const illust = (id: number, overrides: Record<string, unknown> = {}): never =>
  ({
    id,
    title: `插画${id}`,
    type: "illust",
    user: { id: 42, name: "作者" },
    image_urls: { square_medium: `https://i.pximg.net/c/150x150/img-master/img/${id}.jpg` },
    x_restrict: 0,
    ...overrides,
  }) as never

beforeEach(() => {
  setActivePinia(createPinia())
  store = useBrowsingHistoryStore()
  prefsState.map.clear()
  prefsState.control.failSet = false
  prefsState.control.failGet = false
  prefsState.control.holdFirstGet = false
  prefsState.control.firstGetRelease = null
  setUid(1)
  warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
})

afterEach(() => {
  warnSpy.mockRestore()
})

describe("打开即记 + 重复打开不新增条目（票 #927 AC #1 / #2）", () => {
  it("首次浏览一张插画 → 产生唯一一条记录（不依赖停留时长这类拿不到的信号）", () => {
    store.record(toIllustHistorySnapshot(illust(100), 5_000))
    expect(store.items.map((it) => it.illustId)).toEqual([100])
    expect(store.items[0]?.visitCount).toBe(1)
    expect(store.items[0]?.visitedAt).toBe(5_000)
  })

  it("📌 重复打开同一张图：**不新增条目**，只更新时间戳 + 累计次数 + 移位到最前", () => {
    store.record(entry(100, { visitedAt: 1_000 }))
    store.record(entry(200, { visitedAt: 2_000 }))
    store.record(entry(100, { visitedAt: 3_000 }))
    expect(store.items.map((it) => it.illustId)).toEqual([100, 200])
    expect(store.items[0]?.visitedAt).toBe(3_000)
    expect(store.items[0]?.visitCount).toBe(2)
    // 原条目的其他字段随快照刷新（标题/封面以最新一次浏览时的数据为准）
    store.record(entry(100, { visitedAt: 4_000, title: "新标题" }))
    expect(store.items[0]?.title).toBe("新标题")
    expect(store.items[0]?.visitCount).toBe(3)
  })

  it("多次浏览各记各的，互不干扰", () => {
    store.record(entry(100, { visitedAt: 1_000 }))
    store.record(entry(200, { visitedAt: 2_000 }))
    store.record(entry(100, { visitedAt: 3_000 }))
    expect(store.items.find((it) => it.illustId === 100)?.visitCount).toBe(2)
    expect(store.items.find((it) => it.illustId === 200)?.visitCount).toBe(1)
  })
})

describe("30 天过期：边界含当天、逐条独立计算（ADR-0219 §2.5 / AC #5）", () => {
  it("📌 边界含当天：恰好 30 天那条**仍可见**，跨过 1ms 才消失", () => {
    const t0 = 1_000_000
    expect(isHistoryExpired(t0, t0 + BROWSING_HISTORY_TTL_MS)).toBe(false)
    expect(isHistoryExpired(t0, t0 + BROWSING_HISTORY_TTL_MS + 1)).toBe(true)
  })

  it("逐条独立：只有超期那条被清，边界当天与 29 天内的留下（不按「历史」这个词统一施加）", () => {
    const now = 1_000_000
    const kept = pruneExpiredHistory(
      [
        entry(1, { visitedAt: now - BROWSING_HISTORY_TTL_MS - 1 }), // 超期
        entry(2, { visitedAt: now - BROWSING_HISTORY_TTL_MS }), // 边界当天：仍可见
        entry(3, { visitedAt: now - 60_000 }), // 刚看过
      ],
      now,
    )
    expect(kept.map((it) => it.illustId)).toEqual([2, 3])
  })

  it("装载时懒清除超期条目 + warn（过期判定施加在读点，不是后台定时器）", () => {
    const now = 1_000_000
    const raw = JSON.stringify([
      entry(1, { visitedAt: now - BROWSING_HISTORY_TTL_MS - 1 }),
      entry(2, { visitedAt: now - 1 }),
    ])
    expect(parseBrowsingHistoryRaw(raw, now).map((it) => it.illustId)).toEqual([2])
    expect(warnedByModule()).toBe(true)
  })

  it("hydrate 走真实存储值：31 天前的记录不再出现，29 天内的还在", async () => {
    const now = Date.now()
    prefsState.map.set(
      "browsing_history_1",
      JSON.stringify([
        entry(1, { visitedAt: now - 31 * 24 * 60 * 60 * 1000 }),
        entry(2, { visitedAt: now - 29 * 24 * 60 * 60 * 1000 }),
      ]),
    )
    await store.hydrate()
    expect(store.items.map((it) => it.illustId)).toEqual([2])
  })

  it("📌 超期条目**不占容量**：写入前先清掉，300 的上限不会被死条目吃光", () => {
    const t0 = 1_000_000
    for (let i = 1; i <= BROWSING_HISTORY_CAP; i += 1) store.record(entry(i, { visitedAt: t0 }))
    expect(store.items).toHaveLength(BROWSING_HISTORY_CAP)
    // 31 天后我打开另一张图 ⇒ 原来那 300 条相对新记录的时刻**全部超期**，写入前先清。
    //   若不清，容量截断会把新记录之外的老条目留下一批死数据继续占位。
    store.record(entry(999, { visitedAt: t0 + 31 * 24 * 60 * 60 * 1000 }))
    expect(store.items.map((it) => it.illustId)).toEqual([999])
  })
})

describe("容量上限（ADR-0219 §2.5 / AC #6）", () => {
  it(`容量上限 ${BROWSING_HISTORY_CAP}：超出丢最旧 + 模块前缀 warn（禁静默降级）`, () => {
    for (let i = 1; i <= BROWSING_HISTORY_CAP + 2; i += 1) {
      store.record(entry(i, { visitedAt: 1_000_000 + i }))
    }
    expect(store.items).toHaveLength(BROWSING_HISTORY_CAP)
    expect(store.items[0]?.illustId).toBe(BROWSING_HISTORY_CAP + 2)
    expect(warnedByModule()).toBe(true)
  })

  it("📌 容量是 300 而非续读的 200（逐对象施加的独立规则，两轴不共享）", () => {
    expect(BROWSING_HISTORY_CAP).toBe(300)
  })
})

describe("账号级隔离（术语文档「关系」/ AC #7）", () => {
  it("键为 browsing_history_${uid}；未登录不写盘", () => {
    store.record(entry(100))
    expect(prefsState.map.get("browsing_history_1")).toContain('"illustId":100')
    setUid(null)
    store.record(entry(200))
    expect([...prefsState.map.keys()]).toEqual(["browsing_history_1"])
  })

  it("换账号不串号：uid 变化经 watcher 重载对应账号数据", async () => {
    store.record(entry(100))
    prefsState.map.set("browsing_history_9", JSON.stringify([entry(999, { visitedAt: Date.now() })]))
    setUid(9)
    await vi.waitFor(() => expect(store.items.map((it) => it.illustId)).toEqual([999]))
  })

  it("📌 代闸：uid 连续切换时旧账号在飞读取作废（旧响应**晚到**也不覆盖新账号）", async () => {
    const now = Date.now()
    prefsState.map.set("browsing_history_1", JSON.stringify([entry(100, { visitedAt: now })]))
    prefsState.map.set("browsing_history_9", JSON.stringify([entry(999, { visitedAt: now })]))
    prefsState.control.holdFirstGet = true
    const first = store.hydrate() // uid=1 的读取挂起
    setUid(9) // 切号 ⇒ watcher 触发第二次 hydrate（立即返回）
    await vi.waitFor(() => expect(store.items.map((it) => it.illustId)).toEqual([999]))
    prefsState.control.firstGetRelease?.() // 旧账号的响应现在才落
    await first
    expect(store.items.map((it) => it.illustId)).toEqual([999])
  })
})

describe("损坏存储值与非法条目（AC #8）", () => {
  it("损坏 JSON → warn + 降级空列表（禁静默降级）", async () => {
    prefsState.map.set("browsing_history_1", "{ 不是 JSON")
    await store.hydrate()
    expect(store.items).toEqual([])
    expect(warnedByModule()).toBe(true)
  })

  it("非数组存储值 → warn + 降级空列表", async () => {
    prefsState.map.set("browsing_history_1", JSON.stringify({ illustId: 1 }))
    await store.hydrate()
    expect(store.items).toEqual([])
    expect(warnedByModule()).toBe(true)
  })

  it("数组内非法条目逐条跳过并 warn，合法条目保留", async () => {
    prefsState.map.set(
      "browsing_history_1",
      JSON.stringify([entry(1, { visitedAt: Date.now() }), { illustId: "x" }, entry(2, { visitedAt: Date.now() })]),
    )
    await store.hydrate()
    expect(store.items.map((it) => it.illustId)).toEqual([1, 2])
    expect(warnedByModule()).toBe(true)
  })

  it("📌 小说形状的条目（续读 store 的东西）**进不来**——两轴不相交是形状级的", () => {
    // 期望值溯源：术语文档易混辨析 #2「两条轴按作品类型天然不相交」+ AC #12
    expect(isBrowsingHistoryItem(novelEntry(100))).toBe(false)
    expect(isBrowsingHistoryItem({ ...entry(1), visitCount: 0 })).toBe(false)
    expect(isBrowsingHistoryItem({ ...entry(1), visitedAt: "x" })).toBe(false)
    expect(isBrowsingHistoryItem(null)).toBe(false)
    expect(isBrowsingHistoryItem({})).toBe(false)
    expect(isBrowsingHistoryItem(entry(1))).toBe(true)
  })
})

describe("IO 边界双路径（测试硬约束 #1）", () => {
  it("prefs.set 失败 → 内存态保留 + warn（不静默丢数据）", async () => {
    prefsState.control.failSet = true
    store.record(entry(100))
    expect(store.items).toHaveLength(1)
    await vi.waitFor(() => expect(warnedByModule()).toBe(true))
  })

  it("prefs.get 失败 → warn + 空列表（且 ready 落定，页面不会卡在骨架）", async () => {
    prefsState.control.failGet = true
    await store.hydrate()
    expect(store.items).toEqual([])
    expect(warnedByModule()).toBe(true)
    expect(store.ready).toBe(true)
  })
})

describe("ready 标志：区分「还不知道」与「确实没有」（测试硬约束 #3）", () => {
  it("hydrate 落定前 ready=false", () => {
    expect(store.ready).toBe(false)
  })

  it("键缺失（该账号无记录）也置 ready=true", async () => {
    await store.hydrate()
    expect(store.ready).toBe(true)
    expect(store.items).toEqual([])
  })
})

describe("remove / has", () => {
  it("remove 存在的条目 → 从列表消失并写盘", () => {
    store.record(entry(100))
    store.remove(100)
    expect(store.items).toEqual([])
    expect(prefsState.map.get("browsing_history_1")).toBe("[]")
  })

  it("remove 不存在的 id → no-op 且不写盘", () => {
    store.record(entry(100))
    const before = prefsState.map.get("browsing_history_1")
    store.remove(12345)
    expect(store.items).toHaveLength(1)
    expect(prefsState.map.get("browsing_history_1")).toBe(before)
  })

  it("has 按 illustId 精确判定", () => {
    store.record(entry(100))
    expect(store.has(100)).toBe(true)
    expect(store.has(101)).toBe(false)
  })
})

describe("受限内容与失效作品（ADR-0219 §2.5 / AC #9 / #10）", () => {
  it("快照保留 xRestrict ⇒ 列表可**零网络**判定受限卡", () => {
    const snap = toIllustHistorySnapshot(illust(1, { x_restrict: 1 }))
    expect(snap.xRestrict).toBe(1)
    store.record(snap)
    expect(store.items[0]?.xRestrict).toBe(1)
  })

  it("markUnavailable 后条目**仍在列表**（不静默隐藏）", () => {
    store.record(entry(100))
    store.markUnavailable(100)
    expect(store.items.map((it) => it.illustId)).toEqual([100])
    expect(store.items[0]?.unavailable).toBe(true)
  })

  it("没浏览过的作品 markUnavailable 是 no-op（不为没看过的图建条目）", () => {
    store.markUnavailable(999)
    expect(store.items).toEqual([])
  })

  it("失效可自愈：作品恢复可读并再次 record ⇒ 标记被清掉", () => {
    store.record(entry(100))
    store.markUnavailable(100)
    store.record(entry(100, { visitedAt: 9_999 }))
    expect(store.items[0]?.unavailable).toBe(false)
  })

  it("失效状态经持久化往返保留（重启后仍是显式标注，不是静默消失）", async () => {
    store.record(entry(100, { visitedAt: Date.now() }))
    store.markUnavailable(100)
    await store.hydrate()
    expect(store.items[0]?.unavailable).toBe(true)
  })
})

describe("混排聚合：最近活动统一倒序（ADR-0219 §2.1 / AC #4）", () => {
  it("两轴交错时按最近活动倒序，**不分段**（同段同页）", () => {
    const merged = mergeContinueEntries(
      [novelEntry(1, { lastOpenedAt: 3_000 }), novelEntry(2, { lastOpenedAt: 1_000 })],
      [entry(10, { visitedAt: 4_000 }), entry(11, { visitedAt: 2_000 })],
    )
    expect(merged.map((e) => e.key)).toEqual(["h-10", "n-1", "h-11", "n-2"])
  })

  it("📌 插画行**无**状态文案（chapterNo 恒 null），小说有坐标时才有", () => {
    const merged = mergeContinueEntries(
      [novelEntry(1, { lastOpenedAt: 1_000, chapterNo: 3, chapterTotal: 12 })],
      [entry(10, { visitedAt: 2_000 })],
    )
    expect(merged.find((e) => e.kind === "illust")?.chapterNo).toBeNull()
    expect(merged.find((e) => e.kind === "novel")?.chapterNo).toBe(3)
    // 单本小说（无坐标）同样为 null ⇒ 不推算、不假装
    expect(mergeContinueEntries([novelEntry(2, { lastOpenedAt: 1 })], []).at(0)?.chapterNo).toBeNull()
  })

  it("key 带类型前缀：小说 id 与插画 id 同号也不会撞 `:key`", () => {
    const merged = mergeContinueEntries(
      [novelEntry(7, { lastOpenedAt: 1_000 })],
      [entry(7, { visitedAt: 2_000 })],
    )
    expect(merged.map((e) => e.key)).toEqual(["h-7", "n-7"])
    expect(new Set(merged.map((e) => e.key)).size).toBe(2)
  })

  it("同一时刻的平手按类型固定次序（不依赖两轴各自 hydrate 完成的时刻）", () => {
    const merged = mergeContinueEntries(
      [novelEntry(1, { lastOpenedAt: 5_000 })],
      [entry(10, { visitedAt: 5_000 })],
    )
    expect(merged.map((e) => e.kind)).toEqual(["novel", "illust"])
  })

  it("空输入 → 空列表（不是 undefined，页面直接 slice/遍历即可）", () => {
    expect(mergeContinueEntries([], [])).toEqual([])
  })

  it("受限等级与失效标记透传（两轴同一套呈现规则）", () => {
    const merged = mergeContinueEntries(
      [],
      [entry(10, { visitedAt: 1_000, xRestrict: 2, unavailable: true })],
    )
    expect(merged[0]?.xRestrict).toBe(2)
    expect(merged[0]?.unavailable).toBe(true)
  })
})

describe("备份域边界（ADR-0219 §2.5 / AC #11）", () => {
  it("📌 浏览历史键**不进**备份域（与稍后看同一条边界，不为它开口子）", () => {
    // 行为断言而非注释断言：把 "browsing_history_" 加进 ACCOUNT_KEY_PREFIXES 即转红
    expect(isAccountScopedKey("browsing_history_1")).toBe(false)
  })
})

// ─── 源级守卫（票 #927 验收项 / ADR-0219 §2.1-§2.5）────────────────────────────
// 守卫防的是「有人把接线拆了而 store 用例全绿」。⚠️ 每条都做过**反事实检验**：
//   把被守卫的代码删掉/改坏，这条断言必须变红；只匹配「标识符存在」的一律不写
//   （上一票的教训：那种守卫对着死代码恒绿）。
describe("源级守卫（票 #927 / ADR-0219 §2.1-§2.5）", () => {
  const src = (rel: string): string => readFileSync(new URL(rel, import.meta.url), "utf-8")

  it("插画详情页在**详情落地后立刻**写浏览记录，且快照取自该次响应（零新增网络请求）", () => {
    const s = src("../pages/IllustDetail.vue")
    // 反事实：改成用新请求的数据构造快照、或删掉 record ⇒ 下面两条都红
    const iLoad = s.indexOf("const res = await loadDetail(")
    const iRecord = s.indexOf("historyStore.record(toIllustHistorySnapshot(res.illust)")
    expect(iLoad).toBeGreaterThan(-1)
    expect(iRecord).toBeGreaterThan(iLoad)
    // 「零新增网络请求」是可数的：全文只允许出现一次详情请求
    expect(s.match(/loadDetail\(/g) ?? []).toHaveLength(1)
  })

  it("详情加载失败 ⇒ 显式标注已有记录不可用（AC #10，不静默隐藏）", () => {
    const s = src("../pages/IllustDetail.vue")
    expect(s).toContain("historyStore.markUnavailable(illustId.value)")
    // 反事实：把 catch 分支里这行删掉 ⇒ 转红
    const iCatch = s.indexOf("} catch (err) {")
    const iMark = s.indexOf("historyStore.markUnavailable(illustId.value)")
    expect(iCatch).toBeGreaterThan(-1)
    expect(iMark).toBeGreaterThan(iCatch)
  })

  it("📌 两轴接线互不交叉：插画页只碰浏览历史、小说页只碰续读（AC #12）", () => {
    // 反事实：给 NovelDetail 加一行 browsingHistory.record ⇒ 红；给 IllustDetail 加 continueReading ⇒ 红
    expect(/continueReading/i.test(src("../pages/IllustDetail.vue"))).toBe(false)
    expect(/browsingHistory/i.test(src("../pages/NovelDetail.vue"))).toBe(false)
    // 反向钉住：两条轴的写点确实各在各自那一侧（不是压根没接）
    expect(src("../pages/IllustDetail.vue")).toContain("useBrowsingHistoryStore")
    expect(src("../pages/NovelDetail.vue")).toContain("useContinueReadingStore")
  })

  it("📌 浏览历史 store 不 import / 不调用 watchLater·watchlist·continueReading 任何符号", () => {
    const impl = src("./browsingHistoryStore.ts")
    // watchlist：**零容忍**（连注释里都不该出现——它是服务端追更，与本地两条轴无关）
    expect(/watchlist/i.test(impl)).toBe(false)
    // watchLater / continueReading：只禁**代码**（import / 调用），
    // 注释里引用「先例 watchLaterStore」「另一 store continueReadingStore」是合法文档
    expect(/from ["'][^"']*watchLater/i.test(impl)).toBe(false)
    expect(/useWatchLaterStore/i.test(impl)).toBe(false)
    expect(/from ["'][^"']*continueReading/i.test(impl)).toBe(false)
    expect(/useContinueReadingStore/i.test(impl)).toBe(false)
  })

  it("📌 段 3 的骨架/空态条件以**合并列表**为准（退回单轴即红）", () => {
    const s = src("../pages/Shelf.vue")
    expect(s).toContain('v-if="continueLoading && continueEntries.length === 0"')
    expect(s).toContain('v-else-if="continueEntries.length === 0"')
    // 反事实：把条件改回 `continueStore.items.length`（只看小说轴）⇒ 红
    expect(s).not.toContain("continueStore.items.length")
  })

  it("📌 段 3 骨架旗标等**两条轴都**落定才撤（只等小说侧会让插画段静悄悄消失）", () => {
    const s = src("../pages/Shelf.vue")
    // 反事实：把置 false 挪回小说侧自己的 finally（不等 historyDone）⇒ 红
    expect(
      s,
      "骨架旗标必须在 Promise.all([continueDone, historyDone]) 之后才撤",
    ).toMatch(/Promise\.all\(\[[^\]]*historyDone[^\]]*\]\)\.finally\(\(\) => \{\s*continueLoading\.value = false/)
    expect(s).toContain("const historyDone = historyStore")
  })

  it("📌 /continue 页渲染**合并列表**，且移除分流到两条 store（AC #3 / #7）", () => {
    const s = src("../pages/ContinueReading.vue")
    expect(s).toContain("mergeContinueEntries(continueStore.items, historyStore.items)")
    expect(s).toContain("continueStore.remove(entry.id)")
    expect(s).toContain("historyStore.remove(entry.id)")
    // 反事实：删掉 removeItem 的 else 分支 ⇒ 红
    expect(s).toContain("if (entry.kind === 'novel') continueStore.remove(entry.id)")
  })

  it("/continue 页的空态/骨架等**两轴都** ready（只等小说侧会把插画段说成「你没有」）", () => {
    const s = src("../pages/ContinueReading.vue")
    expect(s).toContain("continueStore.ready && historyStore.ready")
  })

  it("📌 混排行的点击分流：小说走 openNovel 的 resume 单点缝隙，插画走插画详情路由", () => {
    for (const page of ["../pages/Shelf.vue", "../pages/ContinueReading.vue"]) {
      const s = src(page)
      expect(s).toContain("entry.kind === 'novel'")
      expect(s).toContain("navigate(`/illust/${entry.id}`)")
      // `/intro` 串只许存在于 novelNavigation.ts（novelIntroEntryGuards 源级守卫）
      expect(s).not.toContain("/intro")
    }
  })

  it("📌 AC #3：不新建 `/history` 页、也不扩为第 4 段（路由表与段数都没动）", () => {
    const r = src("../router.ts")
    expect(r).not.toContain("'/history'")
    expect(r).not.toContain('"/history"')
    // `/continue` 仍是**唯一**的完整列表次级页
    expect(r.match(/path: '\/continue'/g) ?? []).toHaveLength(1)
  })

  it("📌 类型徽章的 i18n 键既有定义**也有消费点**（上一票的教训：只定义不消费 = 死键）", () => {
    const row = src("../components/ContinueRow.vue")
    for (const key of ["continue.badge.novel", "continue.badge.illust"]) {
      expect(row, `${key} 无消费点`).toContain(`t('${key}')`)
      expect(src("../i18n/locales/zh-CN/pages.ts")).toContain(`"${key}"`)
      expect(src("../i18n/locales/en/pages.ts")).toContain(`"${key}"`)
    }
    // 徽章还要进无障碍标签：整行挂了 accessibility-label，子文本不再被朗读
    expect(row).toContain("t('continue.open', { type: typeBadge.value })")
  })

  it("📌 行内状态文案只由 chapterNo 决定（插画恒 null ⇒ 永不渲染「第N话」）", () => {
    const row = src("../components/ContinueRow.vue")
    // 反事实：改回按 store 条目现算 decideContinueLabel(item) ⇒ 红
    expect(row).toContain("entry.chapterNo === null")
  })
})

describe("i18n 插值真的生效（行为断言，不是「键存在」）", () => {
  // ⚠️ 本仓 `t()` 的占位符是 `{{name}}`（i18n/index.ts 的 applyVars 只替换双花括号）。
  //   写成单花括号 `{name}` 时 t() **原样返回**——键在、守卫全绿、行里却显示字面量「{n}」。
  //   票 #926 的 `continue.label.chapter` 就是这样坏的（小说行显示「上次读到 第{n}话」），
  //   本组用例把它钉死。期望值溯源：i18n/index.ts applyVars 的实现 + 两份 locale 的写法。
  it("章节文案：t() 真的把 {{n}} 换成话数（单花括号 = 静默失效）", () => {
    const out = t("continue.label.chapter", { n: "3" })
    expect(out).toContain("3")
    expect(out).not.toContain("{n}")
  })

  it("行无障碍标签：t() 真的把 {{type}} 换成类型徽章文案", () => {
    const out = t("continue.open", { type: t("continue.badge.novel") })
    expect(out).toContain(t("continue.badge.novel"))
    expect(out).not.toContain("{type}")
  })
})

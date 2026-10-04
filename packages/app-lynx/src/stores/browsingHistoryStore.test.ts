// 浏览历史（BrowsingHistory）store 单测（ADR-0219 / spec docs/specs/lynx-continue-reading-and-browsing-history.md / 票 #927）。
//
// 📦 **按被测对象拆缝**（门禁冻结线规模线：单个门禁文件 ≤ 被测对象 30%）。
//    票 #927 的「同缝」AC 讲的是**产品数据缝**（小说侧与插画侧同段同页、不新开缝），
//    不是「一个测试文件里混三类被测对象」。本文件 = 被测对象
//    `browsingHistoryStore.ts` 的**有状态面**（Pinia store 行为）。同主题域另两类已迁出，
//    断言与用例逐字未动：
//    - 纯函数直测（isHistoryExpired / pruneExpiredHistory / parseBrowsingHistoryRaw /
//      isBrowsingHistoryItem）→ browsingHistoryStore.pure.test.ts
//    - 纯聚合层（mergeContinueEntries，被测对象是 primitives/continueEntries.ts）
//      → ../primitives/continueEntries.test.ts
//    - 跨文件接线守卫（IllustDetail.vue / Shelf.vue / ContinueReading.vue / ContinueRow.vue /
//      router.ts / i18n locale）→ browsingHistoryWiring.template.test.ts
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
import { ref } from "vue"
import { setActivePinia, createPinia } from "pinia"
import {
  useBrowsingHistoryStore,
  BROWSING_HISTORY_CAP,
  BROWSING_HISTORY_TTL_MS,
  toIllustHistorySnapshot,
  type BrowsingHistoryItem,
} from "./browsingHistoryStore"
// 备份域判定是**纯函数**（utils/backupCore）⇒ 用来证明「键不进备份域」是行为事实而非注释
import { isAccountScopedKey } from "../utils/backupCore"

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

describe("备份域边界（ADR-0219 §2.5 / AC #11）", () => {
  it("📌 浏览历史键**不进**备份域（与稍后看同一条边界，不为它开口子）", () => {
    // 行为断言而非注释断言：把 "browsing_history_" 加进 ACCOUNT_KEY_PREFIXES 即转红
    expect(isAccountScopedKey("browsing_history_1")).toBe(false)
  })
})

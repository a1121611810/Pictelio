// 稍后看（WatchLater）store 单测（ADR-0191 / spec docs/specs/lynx-watch-later.md / #751 T3）。
// 期望值溯源：
// - 去重键 (WorkKind, id)、新条目前插、重复 add 幂等（不移位）→ ADR-0191 D2 / spec D1
// - 容量上限 500、超出丢最旧 + 模块前缀 console.warn → ADR-0191 D3 / spec D4（禁静默降级）
// - 账号级键 watch_later_${uid}、值 = JSON 字符串数组、损坏降级空列表 + warn → ADR-0191 D4 / spec D3/D5
// - uid 切换重载对应账号数据且互不串 → spec D5 / 用户故事 14
// - mock 模式 → 先例 stores/searchHistoryStore.test.ts（vi.mock 注入，node 无 idbKV）
//   + stores/settingsStore.test.ts（可控 authStore.currentUser 真实 Vue ref getter）
// - PrefsStorage seam 假实现 → store 经 settingsStore 导出的 prefs() 读写（原生/idbKV 分流不在本测内）
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest"
import type { MockInstance } from "vitest"
import { readFileSync } from "node:fs"
import { ref } from "vue"
import { setActivePinia, createPinia } from "pinia"
import {
  useWatchLaterStore,
  WATCH_LATER_CAP,
  parseWatchLaterRaw,
  toIllustSnapshot,
  toNovelSnapshot,
  type WatchLaterItem,
} from "./watchLaterStore"

/** 可控 prefs 假存储（vi.hoisted：vi.mock 工厂提升后仍可引用） */
const prefsState = vi.hoisted(() => {
  const map = new Map<string, string>()
  const control = { failSet: false, failGet: false }
  return { map, control }
})

vi.mock("./settingsStore", () => ({
  prefs: () => ({
    get: async (key: string) => {
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

/** 可控 authStore.currentUser（真实 Vue ref getter，watch 可跟踪——settingsStore.test.ts 同模式） */
const mockUser = ref<{ id: number } | null>(null)
vi.mock("./authStore", () => ({
  useAuthStore: () => ({
    get currentUser() {
      return mockUser.value
    },
  }),
}))

let warnSpy: MockInstance<typeof console.warn>
let store: ReturnType<typeof useWatchLaterStore>

const setUid = (id: number | null): void => {
  mockUser.value = id === null ? null : { id }
}

/** 快照条目工厂（字段集 = 术语表「快照条目」固定七字段） */
const item = (kind: WatchLaterItem["kind"], id: number, overrides: Partial<WatchLaterItem> = {}): WatchLaterItem => ({
  kind,
  id,
  title: `作品${id}`,
  coverUrl: `https://i.pximg.net/c/150x150/img-master/img/${id}.jpg`,
  userId: 42,
  userName: "作者",
  addedAt: 1000 + id,
  ...overrides,
})

beforeEach(() => {
  setActivePinia(createPinia())
  store = useWatchLaterStore()
  prefsState.map.clear()
  prefsState.control.failSet = false
  prefsState.control.failGet = false
  setUid(1)
  warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
})

afterEach(() => {
  warnSpy.mockRestore()
})

describe("watchLaterStore — 内存态行为（spec D1：去重 / 前插 / 幂等）", () => {
  it("初始 items 为空数组、count 为 0", () => {
    expect(store.items).toEqual([])
    expect(store.count).toBe(0)
  })

  it("add 新条目前插（最新在前）", () => {
    store.add(item("illust", 1))
    store.add(item("illust", 2))
    expect(store.items.map((it) => it.id)).toEqual([2, 1])
  })

  it("重复 add 幂等：不重复插入、不移位、不更新原条目", () => {
    store.add(item("illust", 1))
    store.add(item("illust", 2))
    store.add(item("illust", 1, { title: "改名了", addedAt: 9999 }))
    expect(store.items.map((it) => it.id)).toEqual([2, 1])
    expect(store.items[1].title).toBe("作品1")
    expect(store.items[1].addedAt).toBe(1001)
    expect(store.count).toBe(2)
  })

  it("去重键含 kind：同 id 的插画与小说互不干扰（两条并存）", () => {
    store.add(item("illust", 7))
    store.add(item("novel", 7))
    expect(store.count).toBe(2)
    expect(store.has("illust", 7)).toBe(true)
    expect(store.has("novel", 7)).toBe(true)
    store.remove("illust", 7)
    expect(store.has("novel", 7)).toBe(true)
    expect(store.has("illust", 7)).toBe(false)
  })

  it("remove(kind, id) 精确移除并同步落盘", () => {
    store.add(item("illust", 1))
    store.add(item("novel", 2))
    store.remove("novel", 2)
    expect(store.items.map((it) => it.kind)).toEqual(["illust"])
    expect(prefsState.map.get("watch_later_1")).toBe(JSON.stringify(store.items))
  })

  it("remove 不存在的条目：no-op 不写盘", () => {
    store.add(item("illust", 1))
    prefsState.map.clear()
    store.remove("illust", 404)
    expect(store.items).toHaveLength(1)
    expect(prefsState.map.size).toBe(0)
  })

  it("toggle：未在 → 加入；已在 → 移除", () => {
    const snapshot = item("illust", 9)
    store.toggle(snapshot)
    expect(store.has("illust", 9)).toBe(true)
    store.toggle(item("illust", 9))
    expect(store.has("illust", 9)).toBe(false)
    expect(store.count).toBe(0)
  })

  it("has(kind, id)：按 (kind, id) 判定已加入态", () => {
    expect(store.has("illust", 1)).toBe(false)
    store.add(item("illust", 1))
    expect(store.has("illust", 1)).toBe(true)
    expect(store.has("novel", 1)).toBe(false)
  })
})

describe("watchLaterStore — 容量上限（ADR-0191 D3：丢最旧 + warn，禁静默）", () => {
  it(`插入超过 ${WATCH_LATER_CAP} 条 → 尾部淘汰最旧、总数回到上限、模块前缀 warn`, () => {
    for (let id = 1; id <= WATCH_LATER_CAP + 1; id++) store.add(item("illust", id))
    expect(store.count).toBe(WATCH_LATER_CAP)
    expect(store.items[0].id).toBe(WATCH_LATER_CAP + 1) // 最新在前
    expect(store.items[WATCH_LATER_CAP - 1].id).toBe(2) // 最旧（id=1）已淘汰
    expect(store.has("illust", 1)).toBe(false)
    expect(warnSpy).toHaveBeenCalled()
    expect(String(warnSpy.mock.calls[0][0])).toContain("[watchLaterStore]")
  })
})

describe("watchLaterStore — 持久化（IO 边界：成功 + 失败双路径）", () => {
  it("add 落盘：键 watch_later_${uid}，值为快照条目 JSON 数组字符串（成功路径）", () => {
    store.add(item("illust", 1))
    store.add(item("novel", 2))
    const raw = prefsState.map.get("watch_later_1")
    expect(raw).toBeDefined()
    expect(JSON.parse(raw as string)).toEqual(store.items)
  })

  it("hydrate 持久化往返：读回数据与写入一致（含全部七字段）", async () => {
    store.add(item("illust", 1))
    store.add(item("novel", 2))
    const written = JSON.parse(prefsState.map.get("watch_later_1") as string) as WatchLaterItem[]
    // 模拟重启：新 pinia + 新 store 实例，从假存储读回
    setActivePinia(createPinia())
    const fresh = useWatchLaterStore()
    await fresh.hydrate()
    expect(fresh.items).toEqual(written)
    expect(fresh.items[0]).toMatchObject({ kind: "novel", id: 2, userId: 42, userName: "作者" })
  })

  it("hydrate 键缺失（新账号首次使用）→ 空列表，不 warn", async () => {
    await store.hydrate()
    expect(store.items).toEqual([])
    expect(warnSpy).not.toHaveBeenCalled()
  })

  it("hydrate JSON 损坏 → 空列表 + warn（禁静默降级）", async () => {
    prefsState.map.set("watch_later_1", "{not json")
    await store.hydrate()
    expect(store.items).toEqual([])
    expect(warnSpy).toHaveBeenCalled()
    expect(String(warnSpy.mock.calls[0][0])).toContain("[watchLaterStore]")
  })

  it("hydrate 非数组 JSON → 空列表 + warn", async () => {
    prefsState.map.set("watch_later_1", '{"a":1}')
    await store.hydrate()
    expect(store.items).toEqual([])
    expect(String(warnSpy.mock.calls[0][0])).toContain("[watchLaterStore]")
  })

  it("hydrate 数组含非法条目 → 跳过非法条目 + warn，合法条目保留", async () => {
    const good = item("illust", 5)
    prefsState.map.set("watch_later_1", JSON.stringify([good, { kind: "bogus" }, 42]))
    await store.hydrate()
    expect(store.items).toEqual([good])
    expect(warnSpy.mock.calls.some((c) => String(c[0]).includes("[watchLaterStore]"))).toBe(true)
  })

  it("写失败（IO 异常）→ warn + 内存态保留（不回滚，失败路径）", async () => {
    prefsState.control.failSet = true
    store.add(item("illust", 1))
    expect(store.items).toHaveLength(1) // 内存态保留
    await vi.waitFor(() => expect(warnSpy).toHaveBeenCalled())
    expect(String(warnSpy.mock.calls[0][0])).toContain("[watchLaterStore]")
  })

  it("读失败（IO 异常）→ warn + 空列表兜底（失败路径）", async () => {
    prefsState.control.failGet = true
    await store.hydrate()
    expect(store.items).toEqual([])
    expect(warnSpy).toHaveBeenCalled()
    expect(String(warnSpy.mock.calls[0][0])).toContain("[watchLaterStore]")
  })

  it("未登录（uid null）：内存态可用但不落盘（账号级语义）", () => {
    setUid(null)
    store.add(item("illust", 1))
    expect(store.items).toHaveLength(1)
    expect(prefsState.map.size).toBe(0)
  })
})

describe("watchLaterStore — uid 切换重载（spec D5 / 用户故事 14：多账号互不污染）", () => {
  it("切换 uid → 自动重载对应账号键数据，旧账号数据不串", async () => {
    // 账号 2 预置数据
    prefsState.map.set("watch_later_2", JSON.stringify([item("novel", 100)]))
    store.add(item("illust", 1)) // 账号 1 加入
    setUid(2) // 登录切换 → watch 触发 hydrate
    await vi.waitFor(() => expect(store.items.map((it) => it.id)).toEqual([100]))
    expect(store.has("illust", 1)).toBe(false)
  })

  it("切回原 uid → 原账号数据恢复（含本会话写入）", async () => {
    store.add(item("illust", 1))
    setUid(2)
    await vi.waitFor(() => expect(store.count).toBe(0))
    setUid(1)
    await vi.waitFor(() => expect(store.items.map((it) => it.id)).toEqual([1]))
  })

  it("登出（uid → null）→ 清空内存态", async () => {
    store.add(item("illust", 1))
    setUid(null)
    await vi.waitFor(() => expect(store.count).toBe(0))
  })

  it("切换后写入落到新账号键", async () => {
    setUid(2)
    await vi.waitFor(() => expect(store.count).toBe(0))
    store.add(item("illust", 3))
    expect(prefsState.map.has("watch_later_2")).toBe(true)
    expect(prefsState.map.has("watch_later_1")).toBe(false)
  })
})

describe("watchLaterStore — 快照构造与解析纯函数（spec D2：从已有数据构造，零新增请求）", () => {
  it("toIllustSnapshot：从 PixivIllust 现成字段构造七字段快照（square_medium 优先）", () => {
    const snap = toIllustSnapshot(
      {
        id: 11,
        title: "星空",
        user: { id: 42, name: "作者" },
        image_urls: { square_medium: "sq.jpg", medium: "md.jpg", large: "lg.jpg" },
      } as never,
      1700000000000,
    )
    expect(snap).toEqual({
      kind: "illust",
      id: 11,
      title: "星空",
      coverUrl: "sq.jpg",
      userId: 42,
      userName: "作者",
      addedAt: 1700000000000,
    })
  })

  it("toNovelSnapshot：kind = novel，封面取 square_medium", () => {
    const snap = toNovelSnapshot(
      {
        id: 12,
        title: "舰娘",
        user: { id: 43, name: "小说家" },
        image_urls: { square_medium: "nsq.jpg", medium: "nmd.jpg", large: "nlg.jpg" },
      } as never,
      1700000000001,
    )
    expect(snap).toMatchObject({ kind: "novel", id: 12, coverUrl: "nsq.jpg", userId: 43 })
  })

  it("parseWatchLaterRaw：合法 JSON 数组原样还原", () => {
    const good = [item("illust", 1), item("novel", 2)]
    expect(parseWatchLaterRaw(JSON.stringify(good))).toEqual(good)
  })

  it("parseWatchLaterRaw：损坏 JSON → 空数组 + warn", () => {
    expect(parseWatchLaterRaw("{bad")).toEqual([])
    expect(String(warnSpy.mock.calls[0][0])).toContain("[watchLaterStore]")
  })
})

describe("watchLaterStore — 术语红线（glossary 易混辨析 #1）", () => {
  it("store 源码零 watchlist 词根（WatchLater 与追更物理隔离）", () => {
    const src = readFileSync(new URL("./watchLaterStore.ts", import.meta.url), "utf-8")
    expect(/watchlist/i.test(src)).toBe(false)
  })
})

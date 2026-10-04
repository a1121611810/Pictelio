// 续读（ContinueReading）store 单测（ADR-0219 / spec docs/specs/lynx-continue-reading-and-browsing-history.md / 票 #926）。
//
// 期望值溯源（测试硬约束 #6：不自洽反推，每条指回一条已拍板决策）：
// - 位置语义 = **会话末**（可回拨），非最远水位 / 非最旧未读 → ADR-0219 §2.2
// - 进入即记录、零门槛（不依赖停留/滚动信号）              → ADR-0219 §2.3
// - 完成后重开：**完成态保留 + 位置更新**，不复活为在读      → ADR-0219 §2.3
// - 容量上限 200、超限丢最旧 + 模块前缀 warn                  → ADR-0219 §2.5
// - 过期策略逐对象：续读**不设过期**                          → ADR-0219 §2.5
// - 账号级键 continue_reading_${uid}、损坏 warn + 降级空      → ADR-0219 §2.5 + §存储
// - 「上次读到 第N话」仅在可算出 chapterNo 时出现              → ADR-0219 §2.1 展示形态
// - 导航落点：resume 时无视介绍页开关                          → ADR-0219 §2.4
// - mock 模式 → 先例 watchLaterStore.test.ts（vi.mock 注入 prefs，node 无 idbKV）
//   + 可控 authStore.currentUser 真实 Vue ref getter
// - PrefsStorage seam 假实现（原生/idbKV 分流不在本测内）
//
// 📦 **按被测对象拆缝**（门禁冻结线规模线：单个门禁文件 ≤ 被测对象 30%）。
//    本文件 = 被测对象 `continueReadingStore.ts` 的**有状态面**（Pinia store 行为）。
//    同主题域的另两类已迁出，断言与用例逐字未动：
//    - 纯函数直测（decideContinueLabel / isContinueReadingItem / parseContinueReadingRaw）
//      → continueReadingStore.pure.test.ts
//    - 跨文件接线守卫（NovelDetail.vue / Shelf.vue / ContinueReading.vue / i18n locale）
//      → continueReadingWiring.template.test.ts
//    - decideNovelTarget（被测对象是 primitives/novelNavigationTarget.ts，**从来不属于**本 store）
//      → ../primitives/novelNavigationTarget.test.ts
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest"
import type { MockInstance } from "vitest"
import { ref } from "vue"
import { setActivePinia, createPinia } from "pinia"
import {
  useContinueReadingStore,
  CONTINUE_READING_CAP,
  toNovelContinueSnapshot,
  type ContinueReadingItem,
} from "./continueReadingStore"

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
let store: ReturnType<typeof useContinueReadingStore>

/** 有任一 warn 调用带本模块前缀（禁静默降级红线）。对参数个数不敏感——比固定 arity 的
 *  toHaveBeenCalledWith 更强：它只钉「前缀存在」这一契约，不被 warn 的上下文参数个数绑死。 */
const warnedByModule = (): boolean =>
  warnSpy.mock.calls.some((c) => String(c[0]).includes("[continueReadingStore]"))

const setUid = (id: number | null): void => {
  mockUser.value = id === null ? null : { id }
}

/** 续读条目工厂（字段集 = 术语表「续读条目」） */
const item = (novelId: number, overrides: Partial<ContinueReadingItem> = {}): ContinueReadingItem => ({
  novelId,
  title: `小说${novelId}`,
  coverUrl: `https://i.pximg.net/c/150x150/img-master/img/${novelId}.jpg`,
  userId: 42,
  userName: "作者",
  xRestrict: 0,
  lastOpenedAt: 1000 + novelId,
  ...overrides,
})

/** 最小 PixivNovel 形状（仅快照构造用到的字段） */
const novel = (id: number, overrides: Record<string, unknown> = {}): never =>
  ({
    id,
    title: `小说${id}`,
    user: { id: 42, name: "作者" },
    image_urls: { square_medium: `https://i.pximg.net/c/150x150/img-master/img/${id}.jpg` },
    x_restrict: 0,
    ...overrides,
  }) as never

beforeEach(() => {
  setActivePinia(createPinia())
  store = useContinueReadingStore()
  prefsState.map.clear()
  prefsState.control.failSet = false
  prefsState.control.failGet = false
  setUid(1)
  warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
})

afterEach(() => {
  warnSpy.mockRestore()
})

describe("位置语义 = 会话末（ADR-0219 §2.2）", () => {
  it("首次记录某本 → 该本成为唯一条目", () => {
    store.record(item(100))
    expect(store.items.map((it) => it.novelId)).toEqual([100])
  })

  it("重新打开同一本 → 位置更新为新话、移位到最前，**不新增条目**", () => {
    store.record(item(100, { lastOpenedAt: 1000 }))
    store.record(item(200, { lastOpenedAt: 2000 }))
    store.record(item(100, { lastOpenedAt: 3000, chapterNo: 5 }))
    expect(store.items.map((it) => it.novelId)).toEqual([100, 200])
    expect(store.items[0]?.lastOpenedAt).toBe(3000)
    expect(store.items[0]?.chapterNo).toBe(5)
  })

  it("📌 会话末而非最远水位：位置**允许往回拨**（重读场景）", () => {
    store.record(item(100, { lastOpenedAt: 1000, chapterNo: 21 }))
    // 用户重读，退回到第 5 话——最远水位语义下这里会被忽略，会话末下应采纳
    store.record(item(100, { lastOpenedAt: 2000, chapterNo: 5 }))
    expect(store.items[0]?.chapterNo).toBe(5)
  })

  it("多本并行互不干扰（各记各的位置）", () => {
    store.record(item(100, { chapterNo: 3 }))
    store.record(item(200, { chapterNo: 9 }))
    expect(store.items.find((it) => it.novelId === 100)?.chapterNo).toBe(3)
    expect(store.items.find((it) => it.novelId === 200)?.chapterNo).toBe(9)
  })
})

describe("完成后重开：完成态保留 + 位置更新（ADR-0219 §2.3）", () => {
  it("record 不清除已有 completedAt（不复活为在读），但位置照常更新", () => {
    store.record(item(100, { chapterNo: 12, completedAt: 5000 }))
    store.record(item(100, { chapterNo: 4, lastOpenedAt: 9000 }))
    const cur = store.items[0]
    expect(cur?.completedAt).toBe(5000)
    expect(cur?.chapterNo).toBe(4)
  })
})

describe("生命周期（ADR-0219 §2.5）", () => {
  it(`容量上限 ${CONTINUE_READING_CAP}：超出丢最旧 + 模块前缀 warn（禁静默降级）`, () => {
    for (let i = 1; i <= CONTINUE_READING_CAP + 2; i += 1) {
      store.record(item(i, { lastOpenedAt: i }))
    }
    expect(store.items).toHaveLength(CONTINUE_READING_CAP)
    // 最旧两条（id 1 / 2）被丢，最新在保留
    expect(store.items[0]?.novelId).toBe(CONTINUE_READING_CAP + 2)
    expect(warnedByModule()).toBe(true)
  })

  it("📌 反例：续读**不设过期**——极旧的条目不会因时间被清（未完成事项 ≠ 行为流水）", async () => {
    // 手工塞一条 1970 年的时间戳，若存在过期逻辑此条应被清
    prefsState.map.set("continue_reading_1", JSON.stringify([item(100, { lastOpenedAt: 1 })]))
    await store.hydrate()
    expect(store.items.map((it) => it.novelId)).toEqual([100])
    expect(warnSpy).not.toHaveBeenCalled()
  })

  it("账号级键为 continue_reading_${uid}，未登录不写盘", async () => {
    store.record(item(100))
    expect(prefsState.map.get("continue_reading_1")).toContain('"novelId":100')
    setUid(null)
    store.record(item(200))
    // 未登录不新增账号级键
    expect([...prefsState.map.keys()]).toEqual(["continue_reading_1"])
  })

  it("换账号不串号：uid 变化经 watcher 重载对应账号数据", async () => {
    store.record(item(100))
    prefsState.map.set("continue_reading_9", JSON.stringify([item(999)]))
    setUid(9)
    await vi.waitFor(() => expect(store.items.map((it) => it.novelId)).toEqual([999]))
  })

  it("损坏存储值 → warn + 降级空列表（禁静默降级）", async () => {
    prefsState.map.set("continue_reading_1", "{ 不是 JSON")
    await store.hydrate()
    expect(store.items).toEqual([])
    expect(warnedByModule()).toBe(true)
  })

  it("非数组存储值 → warn + 降级空列表", async () => {
    prefsState.map.set("continue_reading_1", JSON.stringify({ novelId: 1 }))
    await store.hydrate()
    expect(store.items).toEqual([])
    expect(warnSpy).toHaveBeenCalled()
  })

  it("数组内非法条目逐条跳过并 warn，合法条目保留", async () => {
    prefsState.map.set(
      "continue_reading_1",
      JSON.stringify([item(1), { novelId: "x" }, item(2)]),
    )
    await store.hydrate()
    expect(store.items.map((it) => it.novelId)).toEqual([1, 2])
    expect(warnSpy).toHaveBeenCalled()
  })

  it("IO 边界：prefs.set 失败 → 内存态保留 + warn（不静默丢数据）", async () => {
    prefsState.control.failSet = true
    store.record(item(100))
    expect(store.items).toHaveLength(1)
    await vi.waitFor(() => expect(warnSpy).toHaveBeenCalled())
  })

  it("IO 边界：prefs.get 失败 → warn + 空列表", async () => {
    prefsState.control.failGet = true
    await store.hydrate()
    expect(store.items).toEqual([])
    expect(warnedByModule()).toBe(true)
  })
})

describe("作品失效标记（票 #926 AC #9：不静默隐藏）", () => {
  it("markUnavailable 置位后条目**仍在列表**（不从列表消失）", () => {
    store.record(item(100))
    store.markUnavailable(100)
    expect(store.items.map((it) => it.novelId)).toEqual([100])
    expect(store.items[0]?.unavailable).toBe(true)
  })

  it("未记录过的作品 markUnavailable 是 no-op（不为没读过的作品建条目）", () => {
    store.markUnavailable(999)
    expect(store.items).toEqual([])
  })

  it("重复 markUnavailable 幂等", () => {
    store.record(item(100))
    store.markUnavailable(100)
    store.markUnavailable(100)
    expect(store.items[0]?.unavailable).toBe(true)
  })

  it("📌 失效后可自愈：作品恢复可读并再次 record ⇒ 标记被清掉", () => {
    store.record(item(100))
    store.markUnavailable(100)
    store.record(item(100, { lastOpenedAt: 9999 }))
    expect(store.items[0]?.unavailable).toBe(false)
  })

  it("失效状态经持久化往返保留", async () => {
    store.record(item(100))
    store.markUnavailable(100)
    await store.hydrate()
    expect(store.items[0]?.unavailable).toBe(true)
  })
})

describe("ready 标志：区分「还不知道」与「确实没有」（测试硬约束 #3）", () => {
  it("hydrate 落定前 ready=false（此时不得渲染空态）", () => {
    expect(store.ready).toBe(false)
  })

  it("hydrate 成功后 ready=true", async () => {
    await store.hydrate()
    expect(store.ready).toBe(true)
  })

  it("📌 键缺失（该账号无记录）也置 ready=true——「确实没有」而非「还不知道」", async () => {
    await store.hydrate()
    expect(store.ready).toBe(true)
    expect(store.items).toEqual([])
  })

  it("IO 失败路径同样置 ready=true（否则页面永远停在骨架）", async () => {
    prefsState.control.failGet = true
    await store.hydrate()
    expect(store.ready).toBe(true)
  })
})

describe("remove / has（ADR-0219 §2.1 列表管理）", () => {
  it("remove 存在的条目 → 从列表消失并写盘", () => {
    store.record(item(100))
    store.remove(100)
    expect(store.items).toEqual([])
    expect(prefsState.map.get("continue_reading_1")).toBe("[]")
  })

  it("remove 不存在的 id → no-op 且不写盘", () => {
    store.record(item(100))
    const before = prefsState.map.get("continue_reading_1")
    store.remove(12345)
    expect(store.items).toHaveLength(1)
    expect(prefsState.map.get("continue_reading_1")).toBe(before)
  })

  it("has 按 novelId 精确判定", () => {
    store.record(item(100))
    expect(store.has(100)).toBe(true)
    expect(store.has(101)).toBe(false)
  })
})

describe("受限内容的本地判定（ADR-0219 §2.5 零网络）", () => {
  it("快照保留 xRestrict，列表可零网络判定受限", () => {
    const snap = toNovelContinueSnapshot(novel(1, { x_restrict: 1 }))
    expect(snap.xRestrict).toBe(1)
    store.record(snap)
    expect(store.items[0]?.xRestrict).toBe(1)
  })
})

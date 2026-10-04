// 续读**批量操作 + 系列级联**行为面（spec §11.2 / 票 #929）。
//
// 📦 **按被测对象拆缝**（门禁冻结线规模线：单个门禁文件 ≤ 被测对象 30%）。
//    `continueReadingStore.test.ts`（320 行）对着 `continueReadingStore.ts` 已超标，
//    `continueReadingCompletion.test.ts`（456 行）同样超标 ⇒ 本批**新开**文件，
//    绝不往那两个里加。
//    本文件只断言**有状态行为**：`markCompleted` 的系列级联在 store 里真的生效、
//    `clearCompleted` / `clearAll` 的清空与落盘。**纯函数面**（`decideSeriesSweepIds` 的
//    坐标边界矩阵：< 而非 ≤、跨系列、缺坐标、已完成排除……）已拆到
//    continueReadingSweep.pure.test.ts —— 混进来会让「有状态行为」的分母失真。
//
// 期望值溯源（测试硬约束 #6：不从实现反推，每条指回 spec / ADR 的某条）：
// - 同系列读完留下僵尸条目（12 话 = 12 条记录、只有末话完成）→ spec §11.2「机制」
// - 级联集合 = 同 seriesId 且 chapterNo < N → spec §11.2「建议修法」
// - **只在末话触发**（跳读场景不受损）                          → spec §11.2「⚠️ 跳读场景」
// - seriesId / chapterNo 缺失的条目不参与                        → spec §11.2 修法前提
// - 「清除全部浏览记录」跨两条 store 归 #929 承接                  → spec §11「28 ❌ 未实现」
// - 清除是硬删、不可逆 ⇒ 不可静默、必有 warn 路径                  → ADR-0219 §2.5 完成态行
// - 两条轴物理隔离：清浏览历史不得连带清续读                       → ADR-0219 §2.1 + 易混辨析 #2
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest"
import type { MockInstance } from "vitest"
import { ref } from "vue"
import { setActivePinia, createPinia } from "pinia"
import {
  useContinueReadingStore,
  type ContinueReadingItem,
} from "./continueReadingStore"
import { useBrowsingHistoryStore, type BrowsingHistoryItem } from "./browsingHistoryStore"

/** 可控 prefs 假存储（沿 continueReadingStore.test.ts 同款 vi.hoisted 样板） */
const prefsState = vi.hoisted(() => {
  const map = new Map<string, string>()
  const control = { failSet: false, failGet: false }
  // 📌 setCalls 计数：断言「**没有发生写**」时，光比 map 的值不够——
  //   写同一个值会留下完全相同的 map 快照，对照断言照样绿（本项目已吃过这个亏：
  //   变异「空列表也 persist」全绿，恰恰因为它写回的是同一个值）。计数才是可数的。
  const setCalls: string[] = []
  return { map, control, setCalls }
})

vi.mock("./settingsStore", () => ({
  prefs: () => ({
    get: async (key: string) => {
      if (prefsState.control.failGet) throw new Error("get failed")
      return prefsState.map.get(key) ?? null
    },
    set: async (key: string, value: string) => {
      prefsState.setCalls.push(key)
      if (prefsState.control.failSet) throw new Error("set failed")
      prefsState.map.set(key, value)
    },
  }),
}))

const mockUser = ref<{ id: number } | null>(null)
vi.mock("./authStore", () => ({
  useAuthStore: () => ({
    get currentUser() {
      return mockUser.value
    },
  }),
}))

let warnSpy: MockInstance<typeof console.warn>
let cont: ReturnType<typeof useContinueReadingStore>
let hist: ReturnType<typeof useBrowsingHistoryStore>

const warnedBy = (prefix: string): boolean =>
  warnSpy.mock.calls.some((c) => String(c[0]).includes(prefix))

/** 续读条目工厂（seriesId / chapterNo = 话级坐标，可覆盖） */
const item = (novelId: number, o: Partial<ContinueReadingItem> = {}): ContinueReadingItem => ({
  novelId,
  title: `小说${novelId}`,
  coverUrl: `https://i.pximg.net/c/150x150/img-master/img/${novelId}.jpg`,
  userId: 42,
  userName: "作者",
  xRestrict: 0,
  lastOpenedAt: 1000 + novelId,
  ...o,
})

/** 浏览记录条目工厂 */
const hItem = (illustId: number): BrowsingHistoryItem => ({
  illustId,
  title: `插画${illustId}`,
  coverUrl: `https://i.pximg.net/c/150x150/img-master/img/${illustId}.jpg`,
  userId: 42,
  userName: "作者",
  xRestrict: 0,
  visitedAt: 1000 + illustId,
  visitCount: 1,
})

beforeEach(() => {
  setActivePinia(createPinia())
  cont = useContinueReadingStore()
  hist = useBrowsingHistoryStore()
  prefsState.map.clear()
  prefsState.setCalls.length = 0
  prefsState.control.failSet = false
  prefsState.control.failGet = false
  mockUser.value = { id: 1 }
  warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
})

afterEach(() => {
  warnSpy.mockRestore()
})

// ─── 系列级联补完（spec §11.2）────────────────────────────────────────────
describe("系列僵尸条目修复：末话完成时同系列更早的话一并完成（spec §11.2）", () => {
  it("📌 正例：12 话系列读完末话 ⇒ 12 条记录全部完成，**active 出列**（不留僵尸）", () => {
    for (let n = 1; n <= 12; n += 1) {
      cont.record(item(1000 + n, { seriesId: 7, chapterNo: n, chapterTotal: 12 }))
    }
    expect(cont.active).toHaveLength(12) // 读完前：12 条都在「在读」
    cont.markCompleted(1012, 5000) // 末话（第 12 话）读完
    // spec §11.2 的核心主张：只有末话被标完成时，其余 11 条永远挂在「在读」
    expect(cont.completed).toHaveLength(12)
    expect(cont.active).toHaveLength(0)
  })

  it("📌 软删不是删除：级联完成的条目**仍在存储里**（「已读完」分组可见可清）", () => {
    cont.record(item(1001, { seriesId: 7, chapterNo: 1, chapterTotal: 12 }))
    cont.record(item(1012, { seriesId: 7, chapterNo: 12, chapterTotal: 12 }))
    cont.markCompleted(1012, 5000)
    expect(cont.items.map((it) => it.novelId).sort()).toEqual([1001, 1012])
  })

  it("📌 幂等：重复 markCompleted 不刷新完成时刻，也不二次写盘", () => {
    cont.record(item(1001, { seriesId: 7, chapterNo: 1, chapterTotal: 12 }))
    cont.record(item(1012, { seriesId: 7, chapterNo: 12, chapterTotal: 12 }))
    cont.markCompleted(1012, 5000)
    cont.markCompleted(1012, 9000)
    // 完成时刻是「读完了」的事实，不是退出时刻
    expect(cont.items.find((it) => it.novelId === 1012)?.completedAt).toBe(5000)
    expect(cont.items.find((it) => it.novelId === 1001)?.completedAt).toBe(5000)
  })

  it("📌 级联**不覆盖**同系列更早那条已有的完成时刻（各自完成于自己被读到底的那一刻）", () => {
    // 第 1 话早在 3000 时刻就已单独读完；此刻读末话第 12 话不能把它改写成 5000
    cont.record(item(1001, { seriesId: 7, chapterNo: 1, chapterTotal: 12 }))
    cont.record(item(1012, { seriesId: 7, chapterNo: 12, chapterTotal: 12 }))
    cont.markCompleted(1001, 3000)
    cont.markCompleted(1012, 5000)
    // 📌 反事实锚点：把 decideSeriesSweepIds 的 `completedAt === undefined` 过滤去掉 ⇒ 此条转红
    expect(cont.items.find((it) => it.novelId === 1001)?.completedAt).toBe(3000)
    expect(cont.items.find((it) => it.novelId === 1012)?.completedAt).toBe(5000)
  })

  it("📌 级联经持久化往返保留（杀进程重开仍全在「已读完」，不是一次性内存态）", async () => {
    cont.record(item(1001, { seriesId: 7, chapterNo: 1, chapterTotal: 12 }))
    cont.record(item(1012, { seriesId: 7, chapterNo: 12, chapterTotal: 12 }))
    cont.markCompleted(1012, 5000)
    await cont.hydrate()
    expect(cont.completed).toHaveLength(2)
    expect(cont.active).toHaveLength(0)
  })

  it("IO 边界：级联触发的写盘失败 → 内存态保留 + 模块前缀 warn（禁静默降级）", async () => {
    cont.record(item(1001, { seriesId: 7, chapterNo: 1, chapterTotal: 12 }))
    cont.record(item(1012, { seriesId: 7, chapterNo: 12, chapterTotal: 12 }))
    prefsState.control.failSet = true
    cont.markCompleted(1012, 5000)
    expect(cont.completed).toHaveLength(2)
    await vi.waitFor(() => expect(warnedBy("[continueReadingStore]")).toBe(true))
  })
})

// ─── 「清除已读完」（批量硬删，票 #929）───────────────────────────────────
describe("clearCompleted：只清已读完，**在读的保留**（票 #929 / spec US10）", () => {
  it("清除已读完 → 那些条目消失，在读条目**一条不少**", () => {
    // 📌 三本分属不同系列 / 单本 ⇒ 标完成末话时级联**不牵连**它们（否则这条测的就不是
    //   「clearCompleted 只清已读完」，而是级联规则）。级联本身由上一组用例单独覆盖。
    cont.record(item(1001, { seriesId: 7, chapterNo: 1, chapterTotal: 12 }))
    cont.record(item(1012, { seriesId: 7, chapterNo: 12, chapterTotal: 12 }))
    cont.record(item(2001, { seriesId: 88, chapterNo: 1, chapterTotal: 20 })) // 另一系列在读
    cont.record(item(3001)) // 单本在读
    cont.markCompleted(1012, 5000)
    cont.clearCompleted()
    expect(cont.items.map((it) => it.novelId).sort()).toEqual([2001, 3001])
    expect(cont.completed).toEqual([])
  })

  it("无已读完条目时 no-op 且**不写盘**（不给不存在的操作造一次写）", () => {
    cont.record(item(2001))
    prefsState.setCalls.length = 0
    cont.clearCompleted()
    expect(cont.items).toHaveLength(1)
    // 📌 断言**写入次数**而非 map 的值：写回同一个值会留下相同快照、值断言照样绿
    expect(prefsState.setCalls, "空操作也落了盘").toEqual([])
  })

  it("清除后持久化确实落盘（不是只改内存态）", () => {
    cont.record(item(1012))
    cont.markCompleted(1012, 5000)
    cont.clearCompleted()
    expect(prefsState.map.get("continue_reading_1")).toBe("[]")
  })

  it("IO 边界：prefs.set 失败 → 内存态已清 + warn（不静默假成功）", async () => {
    cont.record(item(1012))
    cont.markCompleted(1012, 5000)
    prefsState.control.failSet = true
    cont.clearCompleted()
    expect(cont.items).toEqual([])
    await vi.waitFor(() => expect(warnedBy("[continueReadingStore]")).toBe(true))
  })
})

// ─── 「清除全部浏览记录」（spec US28，票 #929 兑现）──────────────────────
describe("clearAll：清空浏览历史，且**不牵连另一条轴**（spec US28 / 易混辨析 #2）", () => {
  it("清除全部浏览记录 → 本轴清空", () => {
    hist.record(hItem(1))
    hist.record(hItem(2))
    hist.clearAll()
    expect(hist.items).toEqual([])
    expect(prefsState.map.get("browsing_history_1")).toBe("[]")
  })

  it("📌 清除真的**落盘**（不只改内存态 ⇒ 否则下次启动整批复活）", async () => {
    hist.record(hItem(1))
    hist.record(hItem(2))
    hist.clearAll()
    // 📌 反事实锚点：把 clearAll 里的 persist() 删掉 ⇒ 内存态对、盘上仍是旧值 ⇒ 此条转红
    expect(prefsState.map.get("browsing_history_1"), "clearAll 未落盘").toBe("[]")
    await hist.hydrate()
    expect(hist.items, "重载后旧记录复活").toEqual([])
  })

  it("📌 两条轴物理隔离：清浏览历史**不得**动续读（在读的书不是浏览记录）", () => {
    hist.record(hItem(1))
    cont.record(item(1001))
    hist.clearAll()
    expect(hist.items).toEqual([])
    expect(cont.items.map((it) => it.novelId)).toEqual([1001])
  })

  it("📌 反向：清已读完**不得**动浏览历史（两轴各清各的）", () => {
    hist.record(hItem(1))
    cont.record(item(1012))
    cont.markCompleted(1012, 5000)
    cont.clearCompleted()
    expect(hist.items.map((it) => it.illustId)).toEqual([1])
  })

  it("空列表时 no-op 且**不写盘**（可数断言：不是比值）", () => {
    prefsState.setCalls.length = 0
    hist.clearAll()
    expect(prefsState.setCalls, "空操作也落了盘").toEqual([])
  })

  it("IO 边界：prefs.set 失败 → 内存态已清 + 本模块前缀 warn（禁静默降级）", async () => {
    hist.record(hItem(1))
    prefsState.control.failSet = true
    hist.clearAll()
    expect(hist.items).toEqual([])
    await vi.waitFor(() => expect(warnedBy("[browsingHistoryStore]")).toBe(true))
  })
})

// 完成判定 + 重读闭环 + 介绍页 CTA（ADR-0219 §2.2-§2.4 / 票 #928）。
//
// 📦 **为什么单开一个门禁缝**（门禁冻结线规模线：单个门禁文件 ≤ 被测对象 30%）：
//    `continueReadingStore.test.ts`（320 行）对着 `continueReadingStore.ts`（≈340 行）
//    已经超标，**继续往里加就是给回归创造就业**。本票的用例按票面「同缝」的要求聚到一处，
//    但分三段、逐段声明被测对象：
//      ① 完成判定的**纯函数面** → `stores/continueReadingStore.ts` 的 `decideNovelCompletion`
//      ② 完成态的**行为面**（有状态）→ 同文件的 `markCompleted` / `active` / `completed`
//      ③ CTA 文案分支的**纯决策面** → `primitives/novelNavigationTarget.ts` 的 `decideIntroReadAction`
//    ④ **接线面**（源级守卫）→ 三个页面之间的关系，不是任一文件的内部行为
//
// 期望值溯源（测试硬约束 #6：不从实现反推，每条指回一条已拍板决策或一条票面 AC）：
// - 完成判定只有两种情形：单本读到底 / 系列末话读到底  → ADR-0219 §2.3 触底两行 + 票 #928 AC #1
// - 系列**中间**话读到底**不**触发（反例，防判定被放宽）→ ADR-0219 §2.3 + 票 #928 AC #2
// - 完成是软删：条目仍在存储、`/continue` 页可见可清      → ADR-0219 §2.5 完成态行 + 票 #928 AC #3
// - 完成后重开：完成态保留、仅更新位置，不复活为在读      → ADR-0219 §2.3 完成重开行 + 票 #928 AC #4
// - 可观测信号只有「打开了哪本」「是否触底」两个            → ADR-0219 §2.3 末段
// - 介绍页 CTA：无位置=开始阅读 / 有位置=继续阅读，单按钮形态不变 → ADR-0219 §2.4 末段 + 票 #928 AC #6
// - 闭环一致性：完成判定 + 位置仍更新 + 会话末语义三者串联   → 票 #928 AC #5
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest"
import type { MockInstance } from "vitest"
import { ref } from "vue"
import { setActivePinia, createPinia } from "pinia"
import { readFileSync } from "node:fs"
import {
  useContinueReadingStore,
  decideNovelCompletion,
  type ContinueReadingItem,
} from "./continueReadingStore"
import { decideIntroReadAction } from "../primitives/novelNavigationTarget"

// ─── ① 完成判定纯函数（ADR-0219 §2.3 / 票 #928 AC #1、#2）────────────────
describe("完成判定：只有两种情形触发（ADR-0219 §2.3 / 票 #928 AC #1）", () => {
  it("① 正例：单本小说（无系列）读到底 ⇒ 完成", () => {
    // 📌 Pixiv 上单篇小说是最常见形态；只判「系列末话」会让该场景永不离场（ADR-0219 §2.3 单本告警）
    expect(
      decideNovelCompletion({
        reachedBottom: true,
        contentExceedsViewport: true,
        seriesId: null,
      }),
    ).toBe(true)
  })

  it("② 正例：系列的末话读到底 ⇒ 完成", () => {
    expect(
      decideNovelCompletion({
        reachedBottom: true,
        contentExceedsViewport: true,
        seriesId: 7,
        chapterNo: 12,
        chapterTotal: 12,
      }),
    ).toBe(true)
  })

  it("📌 反例（票 #928 AC #2）：系列**中间**话读到底 ⇒ **不**完成（防判定被放宽）", () => {
    expect(
      decideNovelCompletion({
        reachedBottom: true,
        contentExceedsViewport: true,
        seriesId: 7,
        chapterNo: 5,
        chapterTotal: 12,
      }),
    ).toBe(false)
    // 紧邻末话的那话同样不是末话：严格相等，不是「≥ total - 1」
    expect(
      decideNovelCompletion({
        reachedBottom: true,
        contentExceedsViewport: true,
        seriesId: 7,
        chapterNo: 11,
        chapterTotal: 12,
      }),
    ).toBe(false)
  })

  it("未触底 ⇒ 不完成（进入正文只记位置；触底才是完成信号）", () => {
    expect(
      decideNovelCompletion({
        reachedBottom: false,
        contentExceedsViewport: true,
        seriesId: null,
      }),
    ).toBe(false)
    expect(
      decideNovelCompletion({
        reachedBottom: false,
        contentExceedsViewport: true,
        seriesId: 7,
        chapterNo: 12,
        chapterTotal: 12,
      }),
    ).toBe(false)
  })

  it("系列坐标不可确定 ⇒ **不**完成（宁可留在列表里也不误软删）", () => {
    // 本话不在服务端首页返回范围内（如第 30 话 / 共 50 话）⇒ 序号不可确定
    expect(
      decideNovelCompletion({
        reachedBottom: true,
        contentExceedsViewport: true,
        seriesId: 7,
      }),
    ).toBe(false)
    expect(
      decideNovelCompletion({
        reachedBottom: true,
        contentExceedsViewport: true,
        seriesId: 7, chapterNo: 30 }),
    ).toBe(false)
    expect(
      decideNovelCompletion({
        reachedBottom: true,
        contentExceedsViewport: true,
        seriesId: 7, chapterTotal: 50 }),
    ).toBe(false)
  })

  it("📌 坐标越界（脏数据 chapterNo > chapterTotal）⇒ 不完成（不把脏数据当末话）", () => {
    expect(
      decideNovelCompletion({
        reachedBottom: true,
        contentExceedsViewport: true,
        seriesId: 7,
        chapterNo: 99,
        chapterTotal: 12,
      }),
    ).toBe(false)
  })
})

// ─── ② 完成态的行为面（软删 / 不复活 / 可清，ADR-0219 §2.3+§2.5 / 票 #928 AC #3、#4）──
/** 可控 prefs 假存储（与 continueReadingStore.test.ts 同款 seam） */
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

const warnedByModule = (): boolean =>
  warnSpy.mock.calls.some((c) => String(c[0]).includes("[continueReadingStore]"))

beforeEach(() => {
  setActivePinia(createPinia())
  store = useContinueReadingStore()
  prefsState.map.clear()
  prefsState.control.failSet = false
  prefsState.control.failGet = false
  mockUser.value = { id: 1 }
  warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
})

afterEach(() => {
  warnSpy.mockRestore()
})

describe("完成 = 软删：条目留在存储里，只是不在主列表（ADR-0219 §2.5 / 票 #928 AC #3）", () => {
  it("markCompleted 置 completedAt：active 出列、completed 入列、items 仍含该条目", () => {
    store.record(item(100))
    store.markCompleted(100, 5000)
    expect(store.items.map((it) => it.novelId)).toEqual([100]) // 软删 ≠ 删除
    expect(store.active.map((it) => it.novelId)).toEqual([])
    expect(store.completed.map((it) => it.novelId)).toEqual([100])
    expect(store.items[0]?.completedAt).toBe(5000)
  })

  it("📌 软删经持久化往返保留（杀进程重开仍在「已读完」，不是一次性内存态）", async () => {
    store.record(item(100))
    store.markCompleted(100, 5000)
    expect(prefsState.map.get("continue_reading_1")).toContain('"completedAt":5000')
    await store.hydrate()
    expect(store.items.map((it) => it.novelId)).toEqual([100])
    expect(store.completed.map((it) => it.novelId)).toEqual([100])
  })

  it("「已读完」条目可清：remove 真的删掉（否则用户永远清不掉它）", () => {
    store.record(item(100))
    store.markCompleted(100, 5000)
    store.remove(100)
    expect(store.items).toEqual([])
    expect(store.completed).toEqual([])
    expect(prefsState.map.get("continue_reading_1")).toBe("[]")
  })

  it("未记录过的作品 markCompleted 是 no-op（不为例外作品凭空建条目）", () => {
    store.markCompleted(999)
    expect(store.items).toEqual([])
  })

  it("重复 markCompleted 幂等，且**不刷新**完成时刻（完成时刻是「读完了」的事实）", () => {
    store.record(item(100))
    store.markCompleted(100, 5000)
    store.markCompleted(100, 9000)
    expect(store.items[0]?.completedAt).toBe(5000)
  })

  it("IO 边界：markCompleted 触发写盘，prefs.set 失败 → 内存态保留 + 模块前缀 warn", async () => {
    store.record(item(100))
    prefsState.control.failSet = true
    store.markCompleted(100, 5000)
    expect(store.items[0]?.completedAt).toBe(5000) // 内存态保留，不回滚
    await vi.waitFor(() => expect(warnedByModule()).toBe(true))
  })
})

describe("闭环：完成后重开 ⇒ 完成态保留 + 位置照常更新（票 #928 AC #4、#5）", () => {
  it("📌 完成后重新进入该作品：**不复活**为在读，位置更新为这次读到的那话", () => {
    // 读完第 12 话（末话）→ 完成
    store.record(item(100, { seriesId: 7, chapterNo: 12, chapterTotal: 12 }))
    store.markCompleted(100, 5000)
    // 用户重读，位置拨回第 5 话
    store.record(item(100, { seriesId: 7, chapterNo: 5, chapterTotal: 12, lastOpenedAt: 9000 }))
    const cur = store.items[0]
    expect(cur?.completedAt).toBe(5000) // 完成态保留（没复活）
    expect(cur?.chapterNo).toBe(5) // 位置照常更新（票 #928 AC #5：回的是这次读到的那话）
    expect(cur?.lastOpenedAt).toBe(9000)
  })

  it("闭环全链：单本读到底 → 软删 → 重开 → 位置更新 → 再进列表仍归「已读完」", () => {
    // 用纯判定函数驱动，验的是「判定 + store 行为」串起来的结果（票 #928 AC #5）
    store.record(item(100, { lastOpenedAt: 1000 }))
    if (decideNovelCompletion({
        reachedBottom: true,
        contentExceedsViewport: true,
        seriesId: null,
      })) {
      store.markCompleted(100, 2000)
    }
    expect(store.active).toEqual([]) // 已离场主列表
    // 重读到第 21 话（此处单本无坐标，chapterNo 仅作位置快照的一部分）
    store.record(item(100, { lastOpenedAt: 3000 }))
    expect(store.active).toEqual([]) // 仍不复活
    expect(store.completed).toHaveLength(1)
    expect(store.completed[0]?.lastOpenedAt).toBe(3000) // 位置更新为本次
  })

  it("重读后再次触底完成态不丢（用户又读完了同一本）", () => {
    store.record(item(100))
    store.markCompleted(100, 5000)
    store.record(item(100, { lastOpenedAt: 9000 }))
    expect(store.completed[0]?.completedAt).toBe(5000)
  })
})

// ─── ③ 介绍页 CTA 文案分支（ADR-0219 §2.4 末段 / 票 #928 AC #6）───────────
describe("介绍页主 CTA：有位置 →「继续阅读」，无位置 →「开始阅读」（票 #928 AC #6）", () => {
  it("无位置 ⇒ start（从未读过这本书）", () => {
    expect(decideIntroReadAction(false)).toBe("start")
  })

  it("📌 有位置 ⇒ continue（含**已完成**的条目：完成后位置照常更新，仍是「有位置」）", () => {
    expect(decideIntroReadAction(true)).toBe("continue")
  })

  it("📌 判定输入是「该作品有无条目」而非「是否未完成」——完成的书也是 continue", () => {
    store.record(item(100))
    store.markCompleted(100, 5000)
    expect(store.has(100)).toBe(true) // 条目仍在（软删）
    expect(decideIntroReadAction(store.has(100))).toBe("continue")
  })
})

// ─── ④ 接线面源级守卫（票 #928 / ADR-0219 §2.3、§2.5）────────────────────
// 守卫防的是「有人把接线拆了而上面的用例全绿」。⚠️ 每条都做过**反事实检验**（见交付报告）：
//   把被守卫的那一行改坏，这条断言必须转红；只匹配「标识符在文件里出现过」的一律不写
//   （本仓已连续三次出现那种守卫对着死代码恒绿）。
// ⚠️ 锚点找不到**必须即红**：本仓 v1 版守卫写了「找不到就 return」的兜底，
//   模板换行一变就命中兜底 ⇒ 守卫恒绿、形同不存在。故全部用 indexOf + 显式 expect。
describe("源级守卫（票 #928 / ADR-0219 §2.3、§2.5）", () => {
  const src = (rel: string): string => readFileSync(new URL(rel, import.meta.url), "utf-8")

  it("📌 触底事件驱动完成判定（@scrolltolower 是唯一权威触底信号）", () => {
    const s = src("../pages/NovelDetail.vue")
    const iStart = s.indexOf("function onNovelToBottom")
    expect(iStart, "锚点 onNovelToBottom 未命中 ⇒ 本守卫已失效").toBeGreaterThan(-1)
    // ⚠️ 按**下一个 function 边界**切函数体，不用固定字符窗口（窗口外的调用不被检查）
    const iEnd = s.indexOf("\nfunction ", iStart + 1)
    const body = s.slice(iStart, iEnd === -1 ? undefined : iEnd)
    // 反事实：删掉 evaluateCompletion(loadGeneration) 这一行 ⇒ 转红
    expect(body, "触底未驱动完成判定 ⇒ 读完的书永远不会离场").toContain("evaluateCompletion(")
    // 反向钉住：判定真的落在 scrolltolower 上，不是压根没接
    expect(s).toContain('@scrolltolower="onNovelToBottom"')
  })

  it("📌 完成判定**两个时机**都跑：坐标后台落地后补判一次（否则触底早于补齐的用户漏判）", () => {
    const s = src("../pages/NovelDetail.vue")
    // 锚点是**真实赋值语句**而非标识符出现：`chapterPosition` 只有被写进去才算坐标落地
    const iAssign = s.indexOf("chapterPosition = {")
    expect(iAssign, "锚点 chapterPosition 赋值未命中 ⇒ 本守卫已失效").toBeGreaterThan(-1)
    // 从赋值处往后找 ⇒ 排除函数开头那两次「必然为 false」的调用（那两处是死代码，不写）
    const tail = s.slice(iAssign)
    expect(
      tail.indexOf("evaluateCompletion("),
      "坐标落地后未补判完成 ⇒ 触底早于章节响应时永远判不出末话",
    ).toBeGreaterThan(-1)
  })

  it("📌 章节坐标是**代闸内**状态：每次重载必须清空（否则跨章节用旧序号判末话）", () => {
    const s = src("../pages/NovelDetail.vue")
    const iLoad = s.indexOf("async function loadNovel()")
    expect(iLoad, "锚点 loadNovel 未命中 ⇒ 本守卫已失效").toBeGreaterThan(-1)
    const iEnd = s.indexOf("\nasync function ", iLoad + 1)
    const body = s.slice(iLoad, iEnd === -1 ? undefined : iEnd)
    expect(body, "loadNovel 未重置 chapterPosition ⇒ 章节内跳转会用上一话的序号判末话").toContain(
      "chapterPosition = null",
    )
    // 触底标志也必须同批复位，否则上一话触底会让下一话一进来就判完成
    expect(body).toContain("reachedBottom.value = false")
  })

  it("📌 反例守卫：写位置不得挂在触底路径上（触底只是完成判定，不是进入判定）", () => {
    const s = src("../pages/NovelDetail.vue")
    const iStart = s.indexOf("function onNovelToBottom")
    const iEnd = s.indexOf("\nfunction ", iStart + 1)
    const body = s.slice(iStart, iEnd === -1 ? undefined : iEnd)
    // 反事实：把 record 调用挪进 onNovelToBottom ⇒ 转红
    expect(body).not.toMatch(/continueStore\.(record|markCompleted)\b/)
    // 反向钉住：record 确实挂在「进入」路径上（loadNovel 内）
    expect(s).toContain("recordContinueReading(detailRes.novel")
  })

  it("📌 书架段 3 与 /continue 主列表都吃 `active`（完成的作品离场主列表）", () => {
    for (const page of ["../pages/Shelf.vue", "../pages/ContinueReading.vue"]) {
      const s = src(page)
      // 反事实：退回 mergeContinueEntries(continueStore.items, …) ⇒ 转红
      expect(s, `${page} 未按 active 过滤，完成的作品不会离场主列表`).toContain(
        "mergeContinueEntries(continueStore.active,",
      )
      // 反向钉住：不得两处并存（并存时 items 那条会绕过软删）
      expect(s, `${page} 仍有一处吃全量 items`).not.toContain(
        "mergeContinueEntries(continueStore.items,",
      )
    }
  })

  it("📌 /continue 页有「已读完」分组，吃 `completed` 且带组头（软删的另一半：可见可清）", () => {
    const s = src("../pages/ContinueReading.vue")
    // 反事实：删掉这行 ⇒ 已读完的条目在本页无处可寻 = 吞掉用户数据
    expect(s, "「已读完」分组缺失").toContain("mergeContinueEntries(continueStore.completed,")
    // 插画侧恒空数组：浏览历史无完成态（若改成 historyStore.items 会凭空多出一个空分组）
    expect(s).toContain("mergeContinueEntries(continueStore.completed, [])")
    // 组头真的有 i18n 读点（上一票遗留的死键 `continue.completed.title` 由本票点亮）
    expect(s, "「已读完」组头未接 i18n").toContain("t('continue.completed.title')")
  })

  it("📌 空态与骨架判据都覆盖**两组**（只有「已读完」条目时不得说成「什么都没有」）", () => {
    const s = src("../pages/ContinueReading.vue")
    // 反事实：把 isEmpty 退回只数 entries.length ⇒ 用户有记录却被告知没有
    const iEmpty = s.indexOf("const isEmpty = computed(")
    expect(iEmpty, "锚点 isEmpty 未命中 ⇒ 本守卫已失效").toBeGreaterThan(-1)
    const emptyBody = s.slice(iEmpty, s.indexOf("const showSkeleton", iEmpty))
    // ⚠️ **两处都要查**（反事实实证）：只查 isEmpty 时，把 showSkeleton 的 finishedEntries
    //   条件删掉本守卫照样绿 ⇒ 骨架在「主列表空但已读完非空」时不再出现，
    //   也就是「还不知道」被渲染成「就这些」。骨架与空态是同一件事的两个分支。
    expect(emptyBody).toContain("entries.value.length === 0")
    expect(emptyBody).toContain("finishedEntries.value.length === 0")
    const iSkeleton = s.indexOf("const showSkeleton = computed(")
    expect(iSkeleton, "锚点 showSkeleton 未命中 ⇒ 本守卫已失效").toBeGreaterThan(-1)
    const skeletonBody = s.slice(iSkeleton, s.indexOf("</script>", iSkeleton))
    expect(skeletonBody).toContain("entries.value.length === 0")
    expect(skeletonBody).toContain("finishedEntries.value.length === 0")
  })

  it("📌 介绍页 CTA 走判定派生量，不是写死「开始阅读」", () => {
    const s = src("../pages/NovelIntro.vue")
    // 反事实：把 {{ readActionLabel }} 改回 {{ t('novelIntro.startReading') }} ⇒ 转红
    expect(s, "主 CTA 文案未接判定派生量").toContain("{{ readActionLabel }}")
    expect(s, "主 CTA 无障碍标签未接判定派生量").toContain(':accessibility-label="readActionA11yLabel"')
    // 判定读的是**续读 store 的有无条目**（读全局 store，不复制状态到页面局部）
    expect(s).toContain("decideIntroReadAction(continueStore.has(novelId.value))")
    // 单按钮形态不变：票 #734 定的「次级行 + 主 CTA 行」布局不得被拆成两颗按钮。
    // ⚠️ 钉「唯一绑定 startReading 的交互元素」而不是钉某个高度类串——后者在注释里
    //   也出现过（file 头注），是同义反复。真正的反事实是「多长出一颗同 handler 的按钮」。
    expect(
      s.match(/@tap="startReading"/g) ?? [],
      "主 CTA 被复制成多颗按钮（单按钮形态是票 #928 AC #6 的硬约束）",
    ).toHaveLength(1)
  })

  it("📌 判定入参面**不得**出现段内信号字段（停留时长 / 滚动百分比，ADR-0219 §2.3）", () => {
    const s = src("./continueReadingStore.ts")
    const iStart = s.indexOf("export interface NovelCompletionInput {")
    expect(iStart, "锚点 NovelCompletionInput 未命中 ⇒ 本守卫已失效").toBeGreaterThan(-1)
    // ⚠️ 按下一个顶层 `}` 切接口体（不用固定窗口：字段加了但落在窗口外就静默失效）
    const iEnd = s.indexOf("\n}", iStart)
    expect(iEnd, "未能匹配 NovelCompletionInput 的闭合").toBeGreaterThan(iStart)
    const body = s.slice(iStart, iEnd)
    // 反事实：往入参加一个 `dwellMs?: number` 并据此收紧门槛 ⇒ 转红
    //   （段内滚动在当前构建不可观测，main-thread-bindscroll 未确认派发；
    //    造出依赖不存在信号的门槛会让最常见的短读场景永远判不出完成）
    expect(body, "完成判定入参出现段内信号字段").not.toMatch(
      /dwell|elapsed|scrollPct|scrollRatio|progress|percent|readSeconds/i,
    )
    // 反向钉住：两个权威信号**在**入参里（不是把判定改成别的东西）
    expect(body).toContain("reachedBottom: boolean")
    expect(body).toContain("seriesId: number | null")
  })

  it("i18n 键在 zh-CN 与 en 两侧齐备（缺一侧 = 静默回退到另一语言）", () => {
    const zh = src("../i18n/locales/zh-CN/pages.ts")
    const en = src("../i18n/locales/en/pages.ts")
    for (const key of ["novelIntro.continueReading", "novelIntro.continueReadingA11y"]) {
      expect(zh, `zh-CN 缺 ${key}`).toContain(`"${key}"`)
      expect(en, `en 缺 ${key}`).toContain(`"${key}"`)
    }
  })

  it("📌 术语文档易混辨析 #1：续读 store 不 import / 不调用 watchLater·watchlist 任何符号", () => {
    const impl = src("./continueReadingStore.ts")
    expect(/watchlist/i.test(impl)).toBe(false)
    expect(/from ["'][^"']*watchLater/i.test(impl)).toBe(false)
    expect(/useWatchLaterStore/i.test(impl)).toBe(false)
  })
})

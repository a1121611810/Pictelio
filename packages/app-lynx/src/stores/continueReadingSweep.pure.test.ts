// 系列级联的**纯函数面**直测（spec §11.2 / 票 #929）。
//
// 📦 **按被测对象拆缝**（门禁冻结线规模线：单个门禁文件 ≤ 被测对象 30%）。
//    被测对象 = `continueReadingStore.ts` 导出的纯函数 `decideSeriesSweepIds`（约 20 行）。
//    它**无 IO、无 Pinia**，与 store 行为用例混在一个文件里会让「289 行门禁 / 20 行被测」
//    的分母彻底失真（那是给回归创造就业，不是防回归）。有状态面留在
//    continueReadingBulkOps.test.ts，页面接线在 continueReadingBulkWiring.template.test.ts。
//    命名沿仓内 `*.pure.test.ts` 既有约定（先例 continueReadingStore.pure.test.ts）。
//
// 期望值溯源（测试硬约束 #6：不从实现反推，每条指回 spec §11.2 的一句）：
// - 级联集合 = 同 seriesId 且 **chapterNo < N**        → §11.2「建议修法」原句
// - 走到末话不蕴含「后面读了」⇒ 更大 chapterNo 不参与   → §11.2「走到末话意味着前面都读了」
// - seriesId 缺失（单本）不参与                         → §11.2 修法的前提（同系列）
// - chapterNo 缺失（坐标不可确定）不参与                → §11.2 + ADR-0219 §2.3 保守口径
// - 跳读场景不受损：中间话完成根本不调 markCompleted     → §11.2「⚠️ 跳读场景…不在中间话触发」
// - 已完成的条目不被重新计入（完成时刻不被刷新）          → 既有 ADR-0219 §2.3 完成态语义
import { describe, expect, it } from "vitest"
import { decideSeriesSweepIds, type ContinueReadingItem } from "./continueReadingStore"

const item = (novelId: number, o: Partial<ContinueReadingItem> = {}): ContinueReadingItem => ({
  novelId,
  title: `小说${novelId}`,
  coverUrl: "c",
  userId: 42,
  userName: "作者",
  xRestrict: 0,
  lastOpenedAt: 1000 + novelId,
  ...o,
})

/** 12 话系列的 1..12 话条目（顺读轨迹：全部已记录） */
const series12 = (): ContinueReadingItem[] =>
  Array.from({ length: 12 }, (_, i) =>
    item(1000 + i + 1, { seriesId: 7, chapterNo: i + 1, chapterTotal: 12, lastOpenedAt: i + 1 }),
  )

describe("decideSeriesSweepIds：末话完成时的同系列补完集合（spec §11.2）", () => {
  it("📌 正例：完成第 12 话 ⇒ 1..11 话全部进集合（僵尸条目的正解）", () => {
    const items = series12()
    const seed = items[11]!
    expect(decideSeriesSweepIds(items, seed)).toEqual(
      [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map((n) => 1000 + n),
    )
  })

  it("📌 集合**不含 seed 自身**（不自我重复标记）", () => {
    const items = series12()
    const seed = items[11]!
    expect(decideSeriesSweepIds(items, seed)).not.toContain(seed.novelId)
  })

  it("📌 反例：更后的 chapterNo 不进集合（走到末话不蕴含后面读了）", () => {
    // ⚠️ 对照：同系列、坐标**更早**的一条该入；更后的那条不该入
    const items = [
      item(1, { seriesId: 7, chapterNo: 1, chapterTotal: 20 }), // 更早 ⇒ 该入
      item(2, { seriesId: 7, chapterNo: 20, chapterTotal: 20 }), // 更后 ⇒ 不该入
      item(3, { seriesId: 7, chapterNo: 5, chapterTotal: 20 }), // seed
    ]
    expect(decideSeriesSweepIds(items, items[2]!)).toEqual([1])
  })

  it("📌 严格小于：同 chapterNo 的另一条（脏数据重复坐标）不进集合", () => {
    const items = [item(1, { seriesId: 7, chapterNo: 3, chapterTotal: 12 }), item(2, { seriesId: 7, chapterNo: 3, chapterTotal: 12 })]
    expect(decideSeriesSweepIds(items, items[1]!)).toEqual([])
  })

  it("📌 不同 seriesId 一律不进集合（两个系列各读各的）", () => {
    // ⚠️ 坐标必须**有区分度**：另一个系列的候选话取 chapterNo 1（比 seed 的 3 小），
    //   去掉 seriesId 约束它就会误入 ⇒ 本条才抓得住「跨系列也级联」这个变异。
    //   （首版两条都取 chapterNo 1，`<` 与 seriesId 两个条件同时不满足 ⇒ 断言无区分力，
    //    变异去掉任一条件都照样绿。本仓已吃过这种「看着绿其实没信号」的亏。）
    const items = [
      item(1, { seriesId: 7, chapterNo: 1, chapterTotal: 3 }), // 同系列、更早 ⇒ 该入
      item(2, { seriesId: 99, chapterNo: 1, chapterTotal: 3 }), // 异系列、更早 ⇒ 不该入
      item(3, { seriesId: 7, chapterNo: 3, chapterTotal: 3 }), // seed
    ]
    expect(decideSeriesSweepIds(items, items[2]!)).toEqual([1])
  })

  it("📌 seed 自身不入集合（`chapterNo < N` 严格小于已隐含排除，此处是纵深防御的显式钉）", () => {
    // ⚠️ **诚实登记**：`it.novelId !== seed.novelId` 在当前实现里是**冗余**条件——
    //   seed 自己的 chapterNo 永远不小于自己，那条 `<` 判定已把它挡在外面。
    //   变异（把它去掉）在本实现下**不会改变输出** ⇒ 变异检验抓不到它。
    //   但它便宜、且让「集合绝不含 seed」这件事不依赖读者去推 `<` 的自反性 ⇒ 留着。
    //   📌 严格性本身由上面「同 chapterNo 不进集合」那条钉住（`<=` 变异会把它打红）。
    const items = [item(1, { seriesId: 7, chapterNo: 1, chapterTotal: 12 }), item(2, { seriesId: 7, chapterNo: 12, chapterTotal: 12 })]
    const out = decideSeriesSweepIds(items, items[1]!)
    expect(out).toEqual([1]) // 第 1 话入
    expect(out).not.toContain(2) // seed 自己不入
  })

  it("📌 seed 无 seriesId（单本小说）⇒ 空集合", () => {
    // ⚠️ 对照条目取**更早坐标**的同轴条目：seed 缺 seriesId 早退掉时它们本会入集合，
    //   返回空 ⇒ 早退真的发生了。
    const items = [item(1), item(2, { seriesId: 7, chapterNo: 1, chapterTotal: 12 })]
    expect(decideSeriesSweepIds(items, items[0]!)).toEqual([])
  })

  it("📌 seed 无 chapterNo（坐标不可确定）⇒ 空集合（保守侧宁可不级联）", () => {
    // ⚠️ 对照：同系列、坐标更早的一条（chapterNo 1）本该入集合；seed 坐标缺失时返回空
    const items = [item(1, { seriesId: 7, chapterNo: 1, chapterTotal: 12 }), item(2, { seriesId: 7, chapterTotal: 12 })]
    expect(decideSeriesSweepIds(items, items[1]!)).toEqual([])
  })

  it("📌 候选条目自身无 chapterNo ⇒ 不进集合（无法判断它是否更早）", () => {
    // ⚠️ 三条坐标各异 ⇒ 去掉「候选自身须有 chapterNo」这条时，坐标为 1 的那条会误入
    const items = [
      item(1, { seriesId: 7, chapterTotal: 12 }), // 候选无坐标 ⇒ 不该入
      item(2, { seriesId: 7, chapterNo: 2, chapterTotal: 12 }), // 对照：合法且更早 ⇒ 该入
      item(3, { seriesId: 7, chapterNo: 12, chapterTotal: 12 }), // seed
    ]
    expect(decideSeriesSweepIds(items, items[2]!)).toEqual([2])
  })

  it("📌 已完成的条目不进集合（各自完成于自己被读到底的那一刻，不被改写）", () => {
    // ⚠️ 对照：同系列、坐标更早、**未完成**的一条该入；已完成的那条不该被改写
    const items = [
      item(1, { seriesId: 7, chapterNo: 1, chapterTotal: 12, completedAt: 3000 }), // 已完成 ⇒ 不入
      item(2, { seriesId: 7, chapterNo: 2, chapterTotal: 12 }), // 未完成 ⇒ 入
      item(3, { seriesId: 7, chapterNo: 12, chapterTotal: 12 }), // seed
    ]
    expect(decideSeriesSweepIds(items, items[2]!)).toEqual([2])
  })

  it("📌 空集合（无任何可级联条目）不是错误，返回 [] 而非抛异常", () => {
    expect(decideSeriesSweepIds([], item(1, { seriesId: 7, chapterNo: 12 }))).toEqual([])
  })

  it("📌 幂等：seed 已完成时，调用方早退；本函数对已完成 seed 仍只算坐标区间（不读 completedAt）", () => {
    // 📌 本函数**刻意不判 seed 是否已完成**——「当前是不是末话 / 是否已完成」由调用点
    //   （markCompleted 的早退 + decideNovelCompletion）保证。这里只钉它不做多余判断。
    const items = series12()
    const seed = { ...items[11]!, completedAt: 5000 }
    expect(decideSeriesSweepIds(items, seed)).toHaveLength(11)
  })
})

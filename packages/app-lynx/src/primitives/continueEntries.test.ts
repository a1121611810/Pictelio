// 继续读聚合层（mergeContinueEntries）纯函数直测
// （ADR-0219 §2.1 / 术语文档易混辨析 #2 / 票 #927）。
//
// 📦 **按被测对象拆缝**（门禁冻结线规模线：单个门禁文件 ≤ 被测对象 30%）。
//    本文件 = 被测对象 `primitives/continueEntries.ts`（88 行纯函数，零 store 依赖）。
//    它此前寄居在 browsingHistoryStore.test.ts 里——把聚合层的分母算到 282 行的
//    browsingHistoryStore.ts 头上是失真。断言、测试名、注释自原文件逐字搬运，未作任何改动。
//
// 期望值溯源（测试硬约束 #6：不自洽反推，每条指回一条已拍板决策或票面 AC）：
// - 两轴按**最近活动统一倒序混排**；插画行**无**「上次读到 第N话」              → ADR-0219 §2.1 + AC #4
// - 行 key 必须带类型前缀（小说 / 插画是两套独立 id 空间，同号可撞）             → ADR-0162 索引错位族
// - 同一时刻的平手按类型固定次序（不依赖两轴各自 hydrate 完成的时刻）          → ADR-0219 §2.1
// - 坐标不可算的小说（单本/脏数据）与插画行同样为 null，不推算、不假装           → ADR-0219 §2.1
import { describe, expect, it } from "vitest"
import { mergeContinueEntries } from "./continueEntries"
import type { BrowsingHistoryItem } from "../stores/browsingHistoryStore"
import type { ContinueReadingItem } from "../stores/continueReadingStore"

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

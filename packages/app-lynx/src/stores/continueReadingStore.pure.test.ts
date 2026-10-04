// 续读（ContinueReading）**纯函数**直测（ADR-0219 / spec docs/specs/lynx-continue-reading-and-browsing-history.md / 票 #926）。
//
// 📦 **按被测对象拆缝**（门禁冻结线规模线：单个门禁文件 ≤ 被测对象 30%）。
//    本文件 = 被测对象 `continueReadingStore.ts` 的**纯导出面**——这三个函数无 IO、无 Pinia，
//    混在 store 行为用例里会让「store 有 281 行」的分母失真。有状态面留在
//    continueReadingStore.test.ts，跨文件接线守卫在 continueReadingWiring.template.test.ts。
//    断言、测试名、注释自原 continueReadingStore.test.ts 逐字搬运，未作任何改动。
//
// 期望值溯源（测试硬约束 #6：不自洽反推，每条指回一条已拍板决策）：
// - 「上次读到 第N话」仅在可算出 chapterNo 时出现              → ADR-0219 §2.1 展示形态
// - 损坏存储值 → 逐条跳过非法条目 + 降级，合法条目保序保留     → ADR-0219 §2.5 + §存储
import { describe, expect, it } from "vitest"
import {
  parseContinueReadingRaw,
  isContinueReadingItem,
  decideContinueLabel,
  type ContinueReadingItem,
} from "./continueReadingStore"

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

describe("展示派生量：「上次读到 第N话」（ADR-0219 §2.1）", () => {
  // ⚠️ 断言**坐标参数**而非中文字符串：文案归 i18n（zh-CN + en 两份），
  //    纯逻辑只负责「能不能渲染 + 渲染第几话」这个决策。文案本身由 i18n 键承载。
  it("有 chapterNo → 可渲染并返回坐标参数", () => {
    expect(decideContinueLabel(item(100, { chapterNo: 3, chapterTotal: 12 }))).toEqual({
      chapterNo: 3,
    })
  })

  it("单本小说（无 chapterTotal）→ 不渲染坐标（不推算、不假装）", () => {
    expect(decideContinueLabel(item(100))).toBeNull()
  })

  it("chapterNo 超出总量（脏数据）→ 不渲染，不输出自相矛盾的坐标", () => {
    expect(decideContinueLabel(item(100, { chapterNo: 99, chapterTotal: 12 }))).toBeNull()
  })
})

describe("持久化解析器（纯函数直测）", () => {
  it("isContinueReadingItem 字段形状校验", () => {
    expect(isContinueReadingItem(item(1))).toBe(true)
    expect(isContinueReadingItem({ ...item(1), lastOpenedAt: "x" })).toBe(false)
    expect(isContinueReadingItem(null)).toBe(false)
    expect(isContinueReadingItem({})).toBe(false)
  })

  it("parseContinueReadingRaw 接受合法数组并保序", () => {
    const raw = JSON.stringify([item(2), item(1)])
    expect(parseContinueReadingRaw(raw).map((it) => it.novelId)).toEqual([2, 1])
  })
})

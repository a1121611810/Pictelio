// 浏览历史（BrowsingHistory）**纯函数**直测（ADR-0219 / spec
// docs/specs/lynx-continue-reading-and-browsing-history.md / 票 #927）。
//
// 📦 **按被测对象拆缝**（门禁冻结线规模线：单个门禁文件 ≤ 被测对象 30%）。
//    本文件 = 被测对象 `browsingHistoryStore.ts` 的**纯导出面**——过期判定、剪枝、持久化
//    解析、形状校验都无 IO 无 Pinia。混在 store 行为用例里会让「store 有 282 行」的分母失真。
//    有状态面留在 browsingHistoryStore.test.ts，跨文件接线守卫在
//    browsingHistoryWiring.template.test.ts。断言、测试名、注释自原
//    browsingHistoryStore.test.ts 逐字搬运，未作任何改动。
//
// 期望值溯源（测试硬约束 #6：不自洽反推，每条指回一条已拍板决策或票面 AC）：
// - **30 天过期**（沿 ADR-0094 先例），**边界含当天**，逐条独立计算           → ADR-0219 §2.5 + AC #5
// - 过期判定施加在**读点**，不是后台定时器（解析时懒清 + warn）              → ADR-0219 §2.5
// - 数据层与小说侧完全不相交（**形状级**；接线级断言在 browsingHistoryWiring.template.test.ts）
//                                                                            → 术语文档易混辨析 #2 + AC #12
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest"
import type { MockInstance } from "vitest"
import {
  BROWSING_HISTORY_TTL_MS,
  isHistoryExpired,
  pruneExpiredHistory,
  parseBrowsingHistoryRaw,
  isBrowsingHistoryItem,
  type BrowsingHistoryItem,
} from "./browsingHistoryStore"
import type { ContinueReadingItem } from "./continueReadingStore"

let warnSpy: MockInstance<typeof console.warn>

/** 有任一 warn 调用带本模块前缀（禁静默降级红线）。对参数个数不敏感——比固定 arity 的
 *  toHaveBeenCalledWith 更强：它只钉「前缀存在」这一契约，不被 warn 的上下文参数个数绑死。 */
const warnedByModule = (): boolean =>
  warnSpy.mock.calls.some((c) => String(c[0]).includes("[browsingHistoryStore]"))

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

beforeEach(() => {
  warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
})

afterEach(() => {
  warnSpy.mockRestore()
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
})

describe("损坏存储值与非法条目（AC #8）", () => {
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

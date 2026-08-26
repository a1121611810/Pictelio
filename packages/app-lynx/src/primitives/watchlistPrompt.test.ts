// oracle：docs/specs/app-lynx-novel-series-watchlist.md §2 决策记录 D1–D3
// - D1：滚动 ≥70% 或到达底部，且停留 ≥10s
// - D2：本会话「暂不」后不再弹
// - D3：已完结系列也弹（is_concluded 不参与判定）
// - watchlistAdded === null（状态未知）→ 保守不弹（spec §US2）
import { describe, it, expect } from "vitest"
import {
  shouldPromptWatchlist,
  WATCHLIST_PROMPT_MIN_DWELL_MS,
  WATCHLIST_PROMPT_SCROLL_THRESHOLD,
  type WatchlistPromptInput,
} from "./watchlistPrompt"

/** 全条件命中的基准输入，各用例在此基础上单点破坏 */
function baseInput(): WatchlistPromptInput {
  return {
    hasSeries: true,
    watchlistAdded: false,
    dismissedThisSession: false,
    scrollProgress: 1,
    reachedBottom: true,
    dwellMs: WATCHLIST_PROMPT_MIN_DWELL_MS,
  }
}

describe("shouldPromptWatchlist", () => {
  // Oracle 锚定（AGENTS.md 测试硬约束 §6）：阈值常量的字面值独立锚定 spec §2 D1，
  // 防止常量被静默改动后整个判定矩阵靠常量推算仍假绿
  it("阈值常量锚定 spec §2 D1 字面值：停留 10_000ms / 滚动 0.7", () => {
    expect(WATCHLIST_PROMPT_MIN_DWELL_MS).toBe(10_000)
    expect(WATCHLIST_PROMPT_SCROLL_THRESHOLD).toBe(0.7)
  })

  it("全条件命中 → 弹", () => {
    expect(shouldPromptWatchlist(baseInput())).toBe(true)
  })

  it("非系列小说（hasSeries=false）→ 不弹", () => {
    expect(shouldPromptWatchlist({ ...baseInput(), hasSeries: false })).toBe(false)
  })

  describe("watchlistAdded 三态", () => {
    it("已追更（true）→ 不弹", () => {
      expect(shouldPromptWatchlist({ ...baseInput(), watchlistAdded: true })).toBe(false)
    })

    it("状态未知（null，预取失败/未回）→ 保守不弹", () => {
      expect(shouldPromptWatchlist({ ...baseInput(), watchlistAdded: null })).toBe(false)
    })

    it("未追更（false）→ 弹", () => {
      expect(shouldPromptWatchlist({ ...baseInput(), watchlistAdded: false })).toBe(true)
    })
  })

  it("本会话已「暂不」（D2）→ 不弹", () => {
    expect(shouldPromptWatchlist({ ...baseInput(), dismissedThisSession: true })).toBe(false)
  })

  describe("停留时长边界（D1：≥10s）", () => {
    it("9.999s → 不弹", () => {
      expect(
        shouldPromptWatchlist({ ...baseInput(), dwellMs: WATCHLIST_PROMPT_MIN_DWELL_MS - 1 }),
      ).toBe(false)
    })

    it("恰好 10s → 弹", () => {
      expect(
        shouldPromptWatchlist({ ...baseInput(), dwellMs: WATCHLIST_PROMPT_MIN_DWELL_MS }),
      ).toBe(true)
    })
  })

  describe("滚动进度边界（D1：≥70% 或到达底部）", () => {
    it("69% 未到底 → 不弹", () => {
      expect(
        shouldPromptWatchlist({
          ...baseInput(),
          scrollProgress: WATCHLIST_PROMPT_SCROLL_THRESHOLD - 0.01,
          reachedBottom: false,
        }),
      ).toBe(false)
    })

    it("恰好 70% 未到底 → 弹（阈值含等号）", () => {
      expect(
        shouldPromptWatchlist({
          ...baseInput(),
          scrollProgress: WATCHLIST_PROMPT_SCROLL_THRESHOLD,
          reachedBottom: false,
        }),
      ).toBe(true)
    })

    it("进度不足但到达底部 → 弹（reachedBottom 短路）", () => {
      expect(
        shouldPromptWatchlist({ ...baseInput(), scrollProgress: 0, reachedBottom: true }),
      ).toBe(true)
    })

    it("进度不足且未到底 → 不弹", () => {
      expect(
        shouldPromptWatchlist({ ...baseInput(), scrollProgress: 0, reachedBottom: false }),
      ).toBe(false)
    })
  })

  it("已完结系列不影响判定（D3）：判定输入不含 is_concluded，全条件命中仍弹", () => {
    // 完结状态不在 WatchlistPromptInput 中——类型层面保证 D3；
    // 此处以运行时对象带多余字段验证逻辑上也不读它
    expect(shouldPromptWatchlist({ ...baseInput(), is_concluded: true } as WatchlistPromptInput)).toBe(
      true,
    )
  })
})

// ─── 收藏标签选择 reducer 纯函数单测（T3 / issue #531，spec docs/specs/bookmark-tags.md D5）───
// oracle 溯源：spec D5 面板状态模型——toggle（勾/取消）、上限 10（拒绝第 11 个并反馈）、
// 去重（勾选态幂等）、新建提交（空格提交 token、trim、非空校验、并入已选）。
// 与 webview 同语义、独立实现（spec D5：无双端共享包）；10 上限双源为官方 App
// （docs/research/bookmark-tags-similar-clients.md §4）。
import { describe, expect, it } from "vitest"
import { commitBookmarkTagToken, toggleBookmarkTag } from "./bookmarkTags"

describe("toggleBookmarkTag（有序追加/移除/幂等/超限拒收）", () => {
  it("空集追加 → 成为首个元素", () => {
    expect(toggleBookmarkTag([], "風景")).toEqual({ selected: ["風景"] })
  })

  it("追加保持既有顺序（新元素排尾）", () => {
    expect(toggleBookmarkTag(["風景", "花"], "オリジナル")).toEqual({
      selected: ["風景", "花", "オリジナル"],
    })
  })

  it("已选标签再 toggle → 移除（取消勾选）", () => {
    expect(toggleBookmarkTag(["風景", "花"], "風景")).toEqual({ selected: ["花"] })
  })

  it("幂等：同一标签 toggle 两次回到初始状态", () => {
    const start = ["風景"]
    const once = toggleBookmarkTag(start, "花")
    const twice = toggleBookmarkTag(once.selected, "花")
    expect(twice.selected).toEqual(start)
    expect("rejected" in twice).toBe(false)
  })

  it("满 10 个再追加新标签 → rejected=limit 且已选集不变", () => {
    const full = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10"]
    const result = toggleBookmarkTag(full, "11")
    expect(result.rejected).toBe("limit")
    expect(result.selected).toEqual(full)
  })

  it("满员时移除不受限（取消勾选总是可行）", () => {
    const full = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10"]
    const result = toggleBookmarkTag(full, "1")
    expect("rejected" in result).toBe(false)
    expect(result.selected).toEqual(["2", "3", "4", "5", "6", "7", "8", "9", "10"])
  })

  it("自定义 limit 生效（拒绝第 limit+1 个）", () => {
    const result = toggleBookmarkTag(["a", "b"], "c", 2)
    expect(result.rejected).toBe("limit")
    expect(result.selected).toEqual(["a", "b"])
  })

  it("纯函数：不改变传入数组", () => {
    const input = ["風景"]
    toggleBookmarkTag(input, "花")
    expect(input).toEqual(["風景"])
  })
})

describe("commitBookmarkTagToken（新建提交：trim/非空/去重/上限）", () => {
  it("空串 → error=empty，已选不变", () => {
    const result = commitBookmarkTagToken(["風景"], "")
    expect(result.error).toBe("empty")
    expect(result.selected).toEqual(["風景"])
  })

  it("纯空格 → trim 后为空 → error=empty", () => {
    const result = commitBookmarkTagToken([], "   ")
    expect(result.error).toBe("empty")
    expect(result.selected).toEqual([])
  })

  it("有效 token：trim 后有序追加", () => {
    expect(commitBookmarkTagToken(["風景"], "  花  ")).toEqual({
      selected: ["風景", "花"],
    })
  })

  it("与已选重复（含仅首尾空白差异）→ error=duplicate，已选不变", () => {
    const result = commitBookmarkTagToken(["風景"], " 風景 ")
    expect(result.error).toBe("duplicate")
    expect(result.selected).toEqual(["風景"])
  })

  it("满 10 个再提交有效新 token → error=limit，已选不变", () => {
    const full = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10"]
    const result = commitBookmarkTagToken(full, "11")
    expect(result.error).toBe("limit")
    expect(result.selected).toEqual(full)
  })

  it("重复判定优先于上限（满员时重复提交报 duplicate 而非 limit）", () => {
    const full = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10"]
    const result = commitBookmarkTagToken(full, "1")
    expect(result.error).toBe("duplicate")
  })

  it("自定义 limit 生效", () => {
    const result = commitBookmarkTagToken(["a", "b"], "c", 2)
    expect(result.error).toBe("limit")
    expect(result.selected).toEqual(["a", "b"])
  })

  it("纯函数：不改变传入数组", () => {
    const input = ["風景"]
    commitBookmarkTagToken(input, "花")
    expect(input).toEqual(["風景"])
  })
})

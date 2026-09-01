// searchHistoryStore 单测（issue #293 T3）：去重/上限 10/最新在前/空词忽略、
// remove/clear 持久化与内存同步、idbKV 读写失败降级（注入 fake 存储）。
// 期望值溯源：
// - key "search_history"、上限 10、写入时机 = 搜索提交点 → spec `docs/specs/app-lynx-global-search.md` D3
// - 设备级 idbKV（不经 SharedPreferences/账号级契约键）→ 同上 D3 + glossary「搜索历史」
// - warn 前缀 "[searchHistoryStore]" → issue #293 验收行
// - idbKV mock 模式 → 先例 `stores/settingsStore.test.ts`（vi.mock 注入，node 无 indexedDB）
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest"
import type { MockInstance } from "vitest"
import {
  addHistory,
  clearHistory,
  history,
  loadHistory,
  removeHistory,
  resetSearchHistoryForTest,
} from "./searchHistoryStore"
import { idbGet, idbSet } from "../utils/idbKV"

vi.mock("../utils/idbKV", () => ({
  idbGet: vi.fn(),
  idbSet: vi.fn(async () => {}),
}))

let warnSpy: MockInstance<typeof console.warn>

beforeEach(() => {
  resetSearchHistoryForTest()
  vi.mocked(idbGet).mockReset().mockResolvedValue(null)
  vi.mocked(idbSet).mockReset().mockResolvedValue(undefined)
  warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
})

afterEach(() => {
  warnSpy.mockRestore()
})

describe("searchHistoryStore — 基础约定（spec D3）", () => {
  it("初始 history 为空数组", () => {
    expect(history.value).toEqual([])
  })

  it("addHistory 空词忽略（不写盘）", () => {
    addHistory("")
    addHistory("   ")
    expect(history.value).toEqual([])
    expect(vi.mocked(idbSet)).not.toHaveBeenCalled()
  })

  it("addHistory 先 trim 再写入", () => {
    addHistory("  星空  ")
    expect(history.value).toEqual(["星空"])
    expect(vi.mocked(idbSet)).toHaveBeenCalledWith("search_history", JSON.stringify(["星空"]))
  })

  it("addHistory 去重：重复词移到头部且仅一条", () => {
    addHistory("a")
    addHistory("b")
    addHistory("a")
    expect(history.value).toEqual(["a", "b"])
  })

  it("addHistory 最新在前", () => {
    addHistory("a")
    addHistory("b")
    addHistory("c")
    expect(history.value).toEqual(["c", "b", "a"])
  })

  it("addHistory 上限 10：第 11 个词挤出最旧", () => {
    for (let i = 1; i <= 11; i++) addHistory(`词${i}`)
    expect(history.value).toHaveLength(10)
    expect(history.value[0]).toBe("词11")
    expect(history.value[9]).toBe("词2")
  })

  it("每次变更持久化 JSON 数组到 idbKV key search_history", () => {
    addHistory("a")
    addHistory("b")
    expect(vi.mocked(idbSet)).toHaveBeenLastCalledWith("search_history", JSON.stringify(["b", "a"]))
  })
})

describe("searchHistoryStore — remove/clear", () => {
  it("removeHistory 删除词条并持久化（内存 + 落盘同步）", () => {
    addHistory("a")
    addHistory("b")
    addHistory("c")
    removeHistory("b")
    expect(history.value).toEqual(["c", "a"])
    expect(vi.mocked(idbSet)).toHaveBeenLastCalledWith("search_history", JSON.stringify(["c", "a"]))
  })

  it("removeHistory 不存在的词：no-op 不写盘", () => {
    addHistory("a")
    vi.mocked(idbSet).mockClear()
    removeHistory("不存在")
    expect(history.value).toEqual(["a"])
    expect(vi.mocked(idbSet)).not.toHaveBeenCalled()
  })

  it("clearHistory 清空内存并持久化空数组", () => {
    addHistory("a")
    clearHistory()
    expect(history.value).toEqual([])
    expect(vi.mocked(idbSet)).toHaveBeenLastCalledWith("search_history", "[]")
  })

  it("clearHistory 已空：no-op 不写盘", () => {
    clearHistory()
    expect(vi.mocked(idbSet)).not.toHaveBeenCalled()
  })
})

describe("searchHistoryStore — loadHistory", () => {
  it("从 idbKV 恢复，顺序保持（最新在前）", async () => {
    vi.mocked(idbGet).mockResolvedValue(JSON.stringify(["星空", "舰娘"]))
    await loadHistory()
    expect(history.value).toEqual(["星空", "舰娘"])
    expect(warnSpy).not.toHaveBeenCalled()
  })

  it("恢复超过上限的数据：只保留前 10 条（存储顺序即最新在前，保持一致）", async () => {
    const big = Array.from({ length: 15 }, (_, i) => `词${i + 1}`)
    vi.mocked(idbGet).mockResolvedValue(JSON.stringify(big))
    await loadHistory()
    expect(history.value).toHaveLength(10)
    expect(history.value[0]).toBe("词1")
    expect(history.value[9]).toBe("词10")
  })

  it("键缺失（首次使用）→ 空历史，不 warn 不重置", async () => {
    vi.mocked(idbGet).mockResolvedValue(null)
    await loadHistory()
    expect(history.value).toEqual([])
    expect(warnSpy).not.toHaveBeenCalled()
  })

  it("内存已有词但读取缺失（存储故障）→ 维持内存态 + warn，不重置", async () => {
    addHistory("内存词")
    vi.mocked(idbGet).mockResolvedValue(null)
    await loadHistory()
    expect(history.value).toEqual(["内存词"])
    expect(String(warnSpy.mock.calls[0][0])).toContain("[searchHistoryStore]")
  })

  it("JSON 解析失败 → 空数组 + warn", async () => {
    vi.mocked(idbGet).mockResolvedValue("{not json")
    await loadHistory()
    expect(history.value).toEqual([])
    expect(String(warnSpy.mock.calls[0][0])).toContain("[searchHistoryStore]")
  })

  it("数据非法（非数组）→ 空数组 + warn", async () => {
    vi.mocked(idbGet).mockResolvedValue('{"a":1}')
    await loadHistory()
    expect(history.value).toEqual([])
    expect(String(warnSpy.mock.calls[0][0])).toContain("[searchHistoryStore]")
  })

  it("数组含非字符串条目：跳过并 warn", async () => {
    vi.mocked(idbGet).mockResolvedValue(JSON.stringify(["a", 42, "b"]))
    await loadHistory()
    expect(history.value).toEqual(["a", "b"])
    expect(warnSpy.mock.calls.some((c) => String(c[0]).includes("[searchHistoryStore]"))).toBe(true)
  })
})

describe("searchHistoryStore — 写失败降级（禁止静默降级）", () => {
  it("addHistory 写失败 → warn + 不回滚内存态", async () => {
    vi.mocked(idbSet).mockRejectedValue(new Error("quota"))
    addHistory("a")
    expect(history.value).toEqual(["a"])
    await vi.waitFor(() => expect(warnSpy).toHaveBeenCalled())
    expect(String(warnSpy.mock.calls[0][0])).toContain("[searchHistoryStore]")
  })

  it("removeHistory 写失败 → warn + 内存态保留（不回滚）", async () => {
    addHistory("a")
    vi.mocked(idbSet).mockRejectedValue(new Error("quota"))
    removeHistory("a")
    expect(history.value).toEqual([])
    await vi.waitFor(() => expect(warnSpy).toHaveBeenCalled())
    expect(String(warnSpy.mock.calls[0][0])).toContain("[searchHistoryStore]")
  })
})

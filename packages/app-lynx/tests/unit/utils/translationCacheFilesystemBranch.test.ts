// ─── translationCache filesystem 分支的 providerId 兼容校验（code-review P7） ───
//
// 背景：ADR-0175 D5.4 明文要求 fs 读路径的 providerId 校验「同左（与 IDB 分支同形态）」，
// 但初版实现在 `isFilesystemTranslationCacheAvailable()` 分支直接 `return fsGetTranslation(key)`，
// 跳过了校验 → 换 provider 后会命中陈旧条目而不报错（IDB 分支会 miss + warn）。
//
// 本文件把 filesystem adapter 整体 mock 为「可用」，从而在不起 native module 的前提下
// 覆盖 `translationCache.getTranslation` 的 fs 分支。
//
// Oracle（AGENTS.md 测试硬约束 #2 真实样例）：
// - providerId 语义 = ADR-0171 §7 verify + ADR-0175 D5.4「同左」
// - 真实形态：`TranslationCacheEntry`（六元组 + paragraphs + createdAt + providerId）
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

// vi.mock 工厂会被 hoist 到文件顶部，不能直接闭包引用普通 const（否则
// "Cannot access 'mocks' before initialization"）—— 用 vi.hoisted 提升。
const mocks = vi.hoisted(() => ({
  available: true,
  get: vi.fn(),
  setEntry: vi.fn(),
  remove: vi.fn(),
  clear: vi.fn(),
}))

vi.mock("../../../src/utils/filesystemTranslationCache", () => ({
  isFilesystemTranslationCacheAvailable: () => mocks.available,
  getTranslation: mocks.get,
  setTranslationEntry: mocks.setEntry,
  removeTranslation: mocks.remove,
  clearTranslationCache: mocks.clear,
}))

import { getTranslation } from "../../../src/utils/translationCache"

/** 真实形态的 cache entry（含六元组；providerId 可变） */
function makeEntry(providerId: string) {
  return {
    key: "1:c1:zh-CN:gpt-5:src:abcd:b:efgh",
    novelId: 1,
    chapterId: "c1",
    targetLang: "zh-CN",
    modelId: "gpt-5",
    baseURLHash: "efgh",
    sourceHash: "abcd",
    paragraphs: ["译文一"],
    createdAt: 1700000000000,
    providerId,
  }
}

describe("translationCache fs 分支 providerId 校验（code-review P7）", () => {
  let warn: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    mocks.available = true
    mocks.get.mockReset()
    warn = vi.spyOn(console, "warn").mockImplementation(() => {})
  })

  afterEach(() => {
    warn.mockRestore()
  })

  it("providerId 匹配 → 返回条目", async () => {
    const entry = makeEntry("openai-responses")
    mocks.get.mockResolvedValueOnce(entry)
    await expect(getTranslation(entry.key)).resolves.toEqual(entry)
  })

  it("providerId 不匹配 → 视为 miss + warn（与 IDB 分支同形）", async () => {
    const stale = makeEntry("chat-completions")
    mocks.get.mockResolvedValueOnce(stale)
    await expect(getTranslation(stale.key)).resolves.toBeNull()
    expect(warn).toHaveBeenCalled()
    expect(String(warn.mock.calls[0][0])).toContain("providerId=chat-completions")
  })

  it("未命中（null）→ 返回 null 且不 warn", async () => {
    mocks.get.mockResolvedValueOnce(null)
    await expect(getTranslation("anything")).resolves.toBeNull()
    expect(warn).not.toHaveBeenCalled()
  })
})

// ─── 纯 JS UTF-8 编码工具单测（翻译缓存 FNV-1a 依赖） ───
//
// 背景（真机实测 2026-09-19，emulator-5554 + PrimJS）：
// Lynx JS runtime 不提供 TextEncoder / TextDecoder / crypto / indexedDB
// （在设备上经 SharedPreferences 探针读出全部 typeof === "undefined"）。
// translationCache.fnv1a32 曾用 new TextEncoder() 取字节 → 真机抛 ReferenceError
// → translateChapter 在同步段中断 → 按钮永久停在「0% 翻译中」。
//
// Oracle 溯源（AGENTS.md 测试硬约束 #2/#6）：
// 期望字节来自 UTF-8 标准（RFC 3629）编码规则，**非**实现自洽反推：
//   U+00E9 → C3 A9（2 字节）· U+65E5 → E6 97 A5（3 字节）· U+1F600 → F0 9F 98 80（4 字节代理对）
import { describe, expect, it } from "vitest"
import { utf8Encode } from "../../../src/utils/utf8"

describe("utf8Encode 纯 JS UTF-8 编码（RFC 3629）", () => {
  it("空串 → 空字节数组", () => {
    expect(Array.from(utf8Encode(""))).toEqual([])
  })

  it("ASCII 单字节", () => {
    expect(Array.from(utf8Encode("abc"))).toEqual([0x61, 0x62, 0x63])
  })

  it("2 字节序列（é = U+00E9）", () => {
    expect(Array.from(utf8Encode("\u00e9"))).toEqual([0xc3, 0xa9])
  })

  it("3 字节序列（日本語 = U+65E5 U+672C U+8A9E）", () => {
    expect(Array.from(utf8Encode("日本語"))).toEqual([
      0xe6, 0x97, 0xa5, 0xe6, 0x9c, 0xac, 0xe8, 0xaa, 0x9e,
    ])
  })

  it("4 字节序列 / 代理对（U+1F600 → surrogate pair）", () => {
    expect(Array.from(utf8Encode("\u{1f600}"))).toEqual([0xf0, 0x9f, 0x98, 0x80])
  })

  it("代理对 + 后续 BMP 字符（不吞下一个字符）", () => {
    expect(Array.from(utf8Encode("\u{1f600}A"))).toEqual([0xf0, 0x9f, 0x98, 0x80, 0x41])
  })

  it("孤立高位代理（无低位跟随）不抛错（防御性）", () => {
    expect(() => utf8Encode("\ud83d")).not.toThrow()
  })

  it("与 Node TextEncoder 字节序列逐字节一致（独立 oracle：node 内建实现）", () => {
    const samples = ["", "abc", "日本語", "\u{1f600}", "a\u00e9\u{1f600}中"]
    for (const s of samples) {
      expect(Array.from(utf8Encode(s))).toEqual(Array.from(new TextEncoder().encode(s)))
    }
  })
})

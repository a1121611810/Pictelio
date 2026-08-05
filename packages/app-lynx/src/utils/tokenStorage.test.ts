// tokenStorage 单测：unquoteNativeString 还原 lynx Callback JSON 序列化（issue #120）
import { describe, expect, it } from "vitest"
import { unquoteNativeString } from "./tokenStorage"

describe("unquoteNativeString", () => {
  it("null → null", () => {
    expect(unquoteNativeString(null)).toBeNull()
  })

  it("无引号真实 token 形态 → 原样返回", () => {
    const token = "LXa0TEPbcckouDoW5BJymPY01Q7guBjBW7_FB4apwGs"
    expect(unquoteNativeString(token)).toBe(token)
  })

  it("JSON 双引号包裹的 token（lynx getItem 实测形态）→ 去引号还原", () => {
    const token = "LXa0TEPbcckouDoW5BJymPY01Q7guBjBW7_FB4apwGs"
    expect(unquoteNativeString(`"${token}"`)).toBe(token)
  })

  it("JSON 空串 \"\" → 空串（parse 为 string，去引号）", () => {
    expect(unquoteNativeString('""')).toBe("")
  })

  it("含转义的 JSON 字符串 → 正确还原", () => {
    expect(unquoteNativeString('"a\\"b"')).toBe('a"b')
  })

  it("仅单侧引号（非合法 JSON 字符串）→ 原样返回", () => {
    expect(unquoteNativeString('"abc')).toBe('"abc')
    expect(unquoteNativeString('abc"')).toBe('abc"')
  })

  it("普通非引号字符串（如错误消息）→ 原样返回", () => {
    expect(unquoteNativeString("some error message")).toBe("some error message")
  })
})

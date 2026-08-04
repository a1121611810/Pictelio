// isRestricted 单测：R18/R18G 遮罩判定（issue #91 方案：过滤 → 遮罩）
// 用例矩阵：x_restrict ∈ {0,1,2} × showR18 × showR18G 共 12 例（纯函数无 IO）
// 每个 it 内显式设定开关状态，避免依赖 describe 块的执行顺序
import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { isRestricted, setShowR18, setShowR18G } from "./settingsStore"

const here = dirname(fileURLToPath(import.meta.url))

describe("settingsStore.isRestricted", () => {
  describe("showR18=off, showR18G=off（默认）", () => {
    it("x_restrict=0 不限制", () => {
      setShowR18(false); setShowR18G(false)
      expect(isRestricted({ x_restrict: 0 })).toBe(false)
    })
    it("x_restrict=1 限制", () => {
      setShowR18(false); setShowR18G(false)
      expect(isRestricted({ x_restrict: 1 })).toBe(true)
    })
    it("x_restrict=2 限制", () => {
      setShowR18(false); setShowR18G(false)
      expect(isRestricted({ x_restrict: 2 })).toBe(true)
    })
  })

  describe("showR18=on, showR18G=off", () => {
    it("x_restrict=0 不限制", () => {
      setShowR18(true); setShowR18G(false)
      expect(isRestricted({ x_restrict: 0 })).toBe(false)
    })
    it("x_restrict=1 不限制", () => {
      setShowR18(true); setShowR18G(false)
      expect(isRestricted({ x_restrict: 1 })).toBe(false)
    })
    it("x_restrict=2 限制", () => {
      setShowR18(true); setShowR18G(false)
      expect(isRestricted({ x_restrict: 2 })).toBe(true)
    })
  })

  describe("showR18=off, showR18G=on", () => {
    it("x_restrict=0 不限制", () => {
      setShowR18(false); setShowR18G(true)
      expect(isRestricted({ x_restrict: 0 })).toBe(false)
    })
    it("x_restrict=1 限制", () => {
      setShowR18(false); setShowR18G(true)
      expect(isRestricted({ x_restrict: 1 })).toBe(true)
    })
    it("x_restrict=2 不限制", () => {
      setShowR18(false); setShowR18G(true)
      expect(isRestricted({ x_restrict: 2 })).toBe(false)
    })
  })

  describe("showR18=on, showR18G=on", () => {
    it("x_restrict=0 不限制", () => {
      setShowR18(true); setShowR18G(true)
      expect(isRestricted({ x_restrict: 0 })).toBe(false)
    })
    it("x_restrict=1 不限制", () => {
      setShowR18(true); setShowR18G(true)
      expect(isRestricted({ x_restrict: 1 })).toBe(false)
    })
    it("x_restrict=2 不限制", () => {
      setShowR18(true); setShowR18G(true)
      expect(isRestricted({ x_restrict: 2 })).toBe(false)
    })
  })
})

// 契约断言：玻璃遮罩 token 必须真实存在于 tokens.css（真实样例硬约束，
// 参照 tests/unit.test.ts 的 tailwind↔tokens 契约模式，读真实源文件比对）
describe("玻璃遮罩 token 契约（issue #91）", () => {
  const tokensCss = readFileSync(resolve(here, "../styles/tokens.css"), "utf-8")
  for (const token of ["--glassBg", "--glassBlur", "--glassSaturate", "--glassBorder"]) {
    it(`tokens.css 定义 ${token}`, () => {
      expect(tokensCss, `tokens.css 缺少 ${token}`).toContain(`${token}:`)
    })
  }
  it("RestrictOverlay 玻璃样式块引用 token 而非字面色值", () => {
    const overlaySrc = readFileSync(resolve(here, "../components/RestrictOverlay.vue"), "utf-8")
    expect(overlaySrc).toContain("var(--glassBg)")
    expect(overlaySrc).toContain("var(--glassBlur)")
    expect(overlaySrc).toContain("@supports")
    // 只约束玻璃样式块（徽章等 UI 允许合法用色）
    const styleBlock = overlaySrc.split(".restrict-overlay")[1] ?? ""
    expect(styleBlock).not.toMatch(/rgba?\(|#[0-9a-fA-F]{3,8}/)
  })
  it("tokens.css 定义玻璃降级 token --glassBgMuted", () => {
    expect(tokensCss).toContain("--glassBgMuted:")
  })
})

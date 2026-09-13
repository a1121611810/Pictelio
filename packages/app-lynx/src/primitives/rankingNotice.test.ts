// R-18 指引显隐判定（spec docs/specs/ranking.md §5.7；lynx #518）。
// oracle：spec §5.7「R-18/R-18G 档返回空或报错 → 可操作指引，不静默降级为空态」。
// 本端不过滤受限条目（保留 + 遮罩），serverCount = 服务端返回数。
import { describe, expect, it } from "vitest"
import { isR18Mode, shouldShowR18Notice } from "./rankingNotice"

const input = (over: Partial<Parameters<typeof shouldShowR18Notice>[0]> = {}) => ({
  mode: "r18" as const,
  hasError: false,
  serverCount: 0,
  loading: false,
  ...over,
})

describe("shouldShowR18Notice (lynx)", () => {
  it("非 R-18 档永不显示", () => {
    expect(shouldShowR18Notice(input({ mode: "daily" }))).toBe(false)
    expect(shouldShowR18Notice(input({ mode: "weekly", hasError: true }))).toBe(false)
  })

  it("R-18/R-18G 档服务端空且落定 → 显示", () => {
    expect(shouldShowR18Notice(input({ mode: "r18" }))).toBe(true)
    expect(shouldShowR18Notice(input({ mode: "r18g" }))).toBe(true)
  })

  it("加载中不显示（骨架优先，即便已置 error）", () => {
    expect(shouldShowR18Notice(input({ loading: true }))).toBe(false)
    expect(shouldShowR18Notice(input({ hasError: true, loading: true }))).toBe(false)
  })

  it("有数据不显示（即便报错，避免覆盖已渲染列表）", () => {
    expect(shouldShowR18Notice(input({ serverCount: 5 }))).toBe(false)
    expect(shouldShowR18Notice(input({ hasError: true, serverCount: 5 }))).toBe(false)
  })

  it("首载报错且无数据 → 显示", () => {
    expect(shouldShowR18Notice(input({ hasError: true }))).toBe(true)
  })

  it("isR18Mode 由核心目录派生（r18/r18g）", () => {
    expect(isR18Mode("r18")).toBe(true)
    expect(isR18Mode("r18g")).toBe(true)
    expect(isR18Mode("daily")).toBe(false)
    expect(isR18Mode("rookie")).toBe(false)
  })
})

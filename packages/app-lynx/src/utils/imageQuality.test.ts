// resolveQualityUrl 单测：详情页画质三档位映射 + fallback 链（issue #146 T1）
import { describe, expect, it } from "vitest"
import { resolveQualityUrl } from "./imageQuality"
import type { ImageQuality } from "./imageQuality"

const FULL = { medium: "m.jpg", large: "l.jpg", original: "o.jpg" }

describe("resolveQualityUrl", () => {
  it("medium → urls.medium", () => {
    expect(resolveQualityUrl(FULL, "medium")).toBe("m.jpg")
  })

  it("large → urls.large", () => {
    expect(resolveQualityUrl(FULL, "large")).toBe("l.jpg")
  })

  it("original 优先 originalImageUrl", () => {
    expect(resolveQualityUrl(FULL, "original", "orig-real.jpg")).toBe("orig-real.jpg")
  })

  it("original 无 originalImageUrl → urls.original", () => {
    expect(resolveQualityUrl(FULL, "original")).toBe("o.jpg")
  })

  it("original 无 originalImageUrl 且缺 urls.original → urls.large", () => {
    const urls = { medium: "m.jpg", large: "l.jpg" }
    expect(resolveQualityUrl(urls, "original")).toBe("l.jpg")
  })

  it("original 只剩 urls.medium → urls.medium", () => {
    expect(resolveQualityUrl({ medium: "m.jpg" }, "original")).toBe("m.jpg")
  })

  it("medium 缺档降 urls.large", () => {
    const urls = { large: "l.jpg" }
    expect(resolveQualityUrl(urls, "medium")).toBe("l.jpg")
  })

  it("large 缺档降 urls.medium", () => {
    const urls = { medium: "m.jpg" }
    expect(resolveQualityUrl(urls, "large")).toBe("m.jpg")
  })

  it("空 urls 对象 → 空串", () => {
    expect(resolveQualityUrl({}, "medium")).toBe("")
    expect(resolveQualityUrl({}, "large")).toBe("")
    expect(resolveQualityUrl({}, "original")).toBe("")
  })

  it("可选字段显式 undefined 与缺档等价", () => {
    const urls = { medium: "m.jpg", large: undefined, original: undefined }
    expect(resolveQualityUrl(urls, "original")).toBe("m.jpg")
  })

  it("全缺（仅 undefined 字段）→ 空串", () => {
    const urls = { medium: undefined, large: undefined, original: undefined }
    expect(resolveQualityUrl(urls, "original")).toBe("")
  })

  it("三档位类型约束：字面量可赋值给 ImageQuality", () => {
    const qs: ImageQuality[] = ["medium", "large", "original"]
    for (const q of qs) {
      expect(typeof resolveQualityUrl(FULL, q)).toBe("string")
    }
  })
})

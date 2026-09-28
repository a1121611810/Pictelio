// oracle（期望值溯源，非自洽反推）：
// - ADR-0062「单引擎 client switch hiding」：引擎切换入口**仅在同时含 webview+lynx 时渲染**，
//   独立包隐藏。`supportsClientSwitch` 就是该 ADR 的唯一判定点。
// - #610 沙盒：`BuildConfig.CLIENT_KINDS` 塌缩为 `{"lynx"}`（build.gradle defaultConfig，
//   单引擎 Lynx 形态）。故 `["lynx"]` 必须是本组用例的真实生产取值，不是构造出来的假数据。
// - #806 缺陷根因：`Callback.invoke(Object...)` 是**变参**签名，Java 侧传 `String[]`
//   会被摊平成位置参数，JS 实收字符串。本组用 `normalizeKinds("lynx")` 把这个实测形态钉死，
//   防止有人再把 Java 侧改回 `callback.invoke(String[])`。
import { describe, it, expect } from "vitest"
import { normalizeKinds, supportsClientSwitch, type ClientKind } from "./clientSwitchStore"

describe("normalizeKinds", () => {
  it("单引擎真实取值 [\"lynx\"] 原样透传（#610 生产取值）", () => {
    expect(normalizeKinds(["lynx"])).toEqual<ClientKind[]>(["lynx"])
  })

  it("双引擎 [\"webview\",\"lynx\"] 保持原顺序", () => {
    expect(normalizeKinds(["webview", "lynx"])).toEqual<ClientKind[]>(["webview", "lynx"])
  })

  it("#806 生产形态：JSON 文本（oracle = Java JSONArray.toString() 的真实输出）", () => {
    // Java 侧 new JSONArray().put("lynx").toString() 逐字等于 '["lynx"]'
    expect(normalizeKinds('["lynx"]')).toEqual<ClientKind[]>(["lynx"])
    expect(normalizeKinds('["webview","lynx"]')).toEqual<ClientKind[]>(["webview", "lynx"])
    // 文本内的非法值同样被剔除
    expect(normalizeKinds('["lynx","bogus"]')).toEqual<ClientKind[]>(["lynx"])
  })


  it("非法 JSON 文本与无法识别的输入 → null", () => {
    // 回归钉子：以下形态都曾让门控退化到「未知=视为支持」
    // 裸单词不兼容：保持 tests/unit.test.ts 已钉死的「非数组 → null」契约
    expect(normalizeKinds("[not json")).toBeNull()
    expect(normalizeKinds("lynx")).toBeNull()
    expect(normalizeKinds("")).toBeNull()
    expect(normalizeKinds(undefined)).toBeNull()
    expect(normalizeKinds(null)).toBeNull()
    expect(normalizeKinds({ 0: "lynx" })).toBeNull()
    // JSON 文本全非法
    expect(normalizeKinds('["bogus"]')).toBeNull()
    expect(normalizeKinds("[]")).toBeNull()
  })

  it("剔除非法值，全非法 → null", () => {
    expect(normalizeKinds(["lynx", "bogus"])).toEqual<ClientKind[]>(["lynx"])
    expect(normalizeKinds(["bogus"])).toBeNull()
    expect(normalizeKinds([])).toBeNull()
  })
})

describe("supportsClientSwitch（ADR-0062 门控判定点）", () => {
  it("单引擎 [\"lynx\"] → false：#806 核心断言，卡片必须隐藏", () => {
    expect(supportsClientSwitch(["lynx"])).toBe(false)
  })

  it("双引擎同时含 webview+lynx → true", () => {
    expect(supportsClientSwitch(["webview", "lynx"])).toBe(true)
    expect(supportsClientSwitch(["lynx", "webview"])).toBe(true)
  })

  it("仅 webview 单引擎 → false（对称，ADR-0062 独立包隐藏）", () => {
    expect(supportsClientSwitch(["webview"])).toBe(false)
  })

  it("null = 未知，保守视为支持（ADR-0062 既有兜底语义，钉住不漂移）", () => {
    expect(supportsClientSwitch(null)).toBe(true)
  })
})

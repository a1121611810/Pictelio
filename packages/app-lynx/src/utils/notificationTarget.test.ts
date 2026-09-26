// ─── resolveNotificationTarget 纯函数测试（ADR-0188 D6 / spec 测试决策）───
// scheme 映射 oracle：ADR-0188 D6（pixiv://users|illusts|novels/{id} → 端内路由；
// http(s) → 系统浏览器；其它 scheme 静默忽略）。lynx 平台陷阱：全程字符串解析
//（禁 new URL()——URL polyfill hostname 为 undefined），负例含畸形 id / 未知 scheme。
// 模块尾部含运行时跳转层（openNotificationTarget）→ router/novelNavigation/nativeUrl
// 打桩隔离（novelNavigation.test 同款：vi.mock 求值早于模块体，.vue 链不进 node 转换）。
import { describe, expect, it, vi } from "vitest"

vi.mock("../router", () => ({ navigate: vi.fn() }))
vi.mock("./nativeUrl", () => ({ openExternalUrl: vi.fn() }))
vi.mock("./novelNavigation", () => ({ openNovel: vi.fn() }))

import { resolveNotificationTarget } from "./notificationTarget"

describe("resolveNotificationTarget（pixiv:// 三 scheme + http(s) + 未知 scheme 忽略）", () => {
  it("pixiv://users/{id} → user 目标", () => {
    expect(resolveNotificationTarget("pixiv://users/100000000")).toEqual({ kind: "user", id: 100000000 })
  })

  it("pixiv://illusts/{id} → illust 目标", () => {
    expect(resolveNotificationTarget("pixiv://illusts/12345")).toEqual({ kind: "illust", id: 12345 })
  })

  it("pixiv://novels/{id} → novel 目标", () => {
    expect(resolveNotificationTarget("pixiv://novels/987654")).toEqual({ kind: "novel", id: 987654 })
  })

  it("https:// → external（url 原样透传给系统浏览器通道）", () => {
    expect(resolveNotificationTarget("https://www.pixiv.net/announcement.php?p=1")).toEqual({
      kind: "external",
      url: "https://www.pixiv.net/announcement.php?p=1",
    })
  })

  it("http:// → external", () => {
    expect(resolveNotificationTarget("http://example.com/a")).toEqual({
      kind: "external",
      url: "http://example.com/a",
    })
  })

  it("未知 pixiv 主机段（pixiv://stickers/1）→ 忽略", () => {
    expect(resolveNotificationTarget("pixiv://stickers/1")).toEqual({ kind: "ignore" })
  })

  it("未知 scheme（pixiv-ish://、intent://）→ 忽略", () => {
    expect(resolveNotificationTarget("pixiv-ish://users/1")).toEqual({ kind: "ignore" })
    expect(resolveNotificationTarget("intent://x")).toEqual({ kind: "ignore" })
  })

  it("畸形：非数字 id / 无 id / 空主机段 → 忽略（fail-closed，不产生坏路由）", () => {
    expect(resolveNotificationTarget("pixiv://users/abc")).toEqual({ kind: "ignore" })
    expect(resolveNotificationTarget("pixiv://users/")).toEqual({ kind: "ignore" })
    expect(resolveNotificationTarget("pixiv://users")).toEqual({ kind: "ignore" })
    expect(resolveNotificationTarget("pixiv://")).toEqual({ kind: "ignore" })
  })

  it("id 带尾部 query/hash → 剥尾后仍可解析（服务端加参不破）", () => {
    expect(resolveNotificationTarget("pixiv://users/42?from=notif")).toEqual({ kind: "user", id: 42 })
    expect(resolveNotificationTarget("pixiv://novels/42#top")).toEqual({ kind: "novel", id: 42 })
  })

  it("空串 / null / undefined → 忽略（target_url 宽容缺省）", () => {
    expect(resolveNotificationTarget("")).toEqual({ kind: "ignore" })
    expect(resolveNotificationTarget(null)).toEqual({ kind: "ignore" })
    expect(resolveNotificationTarget(undefined)).toEqual({ kind: "ignore" })
  })
})

// 顶层目的地 path → tab 匹配（维度重构 2026-10-03 · P2-1 真机取证后补）。
//
// 【为什么需要它】spec §4 P0.5 的「顶层触达率」原先只在 `stores/globalFab.ts` 的
// FAB `dispatch` 里记一次。**模拟器实测抓到漏记**：冷启动直接落在「发现」页，
// 全程没点过外环 ⇒ `tabHits.discover === 0` ⇒ 面板显示「发现 0% / 我的 100%」。
// 而用户每次启动**都**看到「发现」——这个数字会让产品经理判反。
// 登录成功后的 `navigate(DISCOVER_PATH)` 同理不经过 FAB dispatch。
//
// 【语义澄清】指标名是「**触达**」而非「切入」：到达一个顶层目的地就是触达，
// 冷启动落点与登录后跳转都必须计入。故记录点从「手势发起侧」上移到「路由落定侧」
// （App.vue 监听 routeState.value —— 监听**对象**而非 .value.path：占位初值与首落点
// 同为 /discover，监听 .path 会因值未变而不触发）。
//
// 【口径来源】匹配**只**用 NAV_TABS 的 path 字段（顶层目的地的单点事实源），
// 不在本文件另写一份 path 字面量数组 —— 那是「顶层有 5 个还是 6 个」漂移的源头。
import { describe, it, expect } from "vitest"
import { NAV_TABS, topLevelTabForPath } from "./navTabs"

describe("topLevelTabForPath（顶层目的地 path 匹配）", () => {
  it("四个顶层 path 各自匹配回自身（往返无损）", () => {
    for (const tab of NAV_TABS) {
      expect(topLevelTabForPath(tab.path)?.name, `${tab.path} 未匹配回 ${tab.name}`).toBe(tab.name)
    }
  })

  it("次级页 / 非顶层路由返回 null（不得被记成某次顶层触达）", () => {
    for (const p of [
      "/login",
      "/error",
      "/update",
      "/illust/123",
      "/novel/456",
      "/bookmarks",
      "/watch-later",
      "/settings",
      "/notifications",
      "/advanced",
      "/network-check",
      "/platform-check",
    ]) {
      expect(topLevelTabForPath(p), `${p} 被误判为顶层目的地`).toBeNull()
    }
  })

  it("带 query / hash 的顶层 path 仍匹配（路由落定的 path 可能带参数串）", () => {
    expect(topLevelTabForPath("/discover?tab=novel")?.name).toBe("discover")
    expect(topLevelTabForPath("/shelf#top")?.name).toBe("shelf")
  })

  it("前缀相同但不同段的路径不误匹配（'/shelf' 不得吃掉 '/shelf-x'）", () => {
    expect(topLevelTabForPath("/shelf-x")).toBeNull()
    expect(topLevelTabForPath("/updatesomething")).toBeNull()
  })

  it("空串 / 根路径 / 缺前导斜杠的路径返回 null（不得被记成某次顶层触达）", () => {
    expect(topLevelTabForPath("")).toBeNull()
    expect(topLevelTabForPath("/")).toBeNull()
    expect(topLevelTabForPath("discover")).toBeNull()
    expect(topLevelTabForPath("  /discover")).toBeNull() // 前导空白不宽容
  })
})

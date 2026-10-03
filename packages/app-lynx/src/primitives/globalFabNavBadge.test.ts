// 外环未读角标接线测试（Spec 审计 P-3）——「声明驱动关系」的读点存在性证据。
//
// 【缺陷来源】spec §2.2「更新」与 §3.2「撤掉同一功能两条路」两处承诺「外环「更新」项带未读计数」，
//   并把「撤掉首页顶栏铃铛」的论证建立在这个角标上（"有外环角标兜底"）。
//   实际：**角标根本不存在** —— `NavTab` 无 badge 字段、`createGlobalFab` 无角标计算、
//   `GlobalFab.vue` 外环项无角标节点。⇒ 撤铃铛后，通知的首页级可发现性**净减少**，
//   而承诺的兜底是空的。审计一 read-point 反事实判据：把 unreadCount 由 0 改成 5，
//   外环渲染会变吗？不会 ⇒ 未接线。
//
// 【期望值出处】spec §2.2「外环「更新」项带未读计数（复用 notificationStore 的
//   unreadCount 计算口径）」+ §4 P0-7「通知唯一入口 = 更新页第三段（+ 外环角标）」。
//   **不是**从 createGlobalFab 的实现反推。
//   ⚠️ 引用只到**章节**不给行号：spec 每次复核都会重排行，行号会腐化成假坐标
//     （这两处曾写作 §2.2:84 / §3.2:133，现已分别指向代码围栏与无关表格行）。
import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { ref } from "vue"
import type { RouteState } from "../router"
import type { NavTab } from "../components/navTabs"
import { createGlobalFab, type CreateGlobalFabDeps } from "../primitives/createGlobalFab"

const TABS: NavTab[] = [
  { name: "discover", path: "/discover", icon: "home", labelKey: "navTabs.discover", a11yLabel: "发现" },
  { name: "updates", path: "/updates", icon: "notifications", labelKey: "navTabs.updates", a11yLabel: "更新" },
  { name: "shelf", path: "/shelf", icon: "favorite_border", labelKey: "navTabs.shelf", a11yLabel: "书架" },
  { name: "me", path: "/me", icon: "person", labelKey: "navTabs.me", a11yLabel: "我的" },
]

function setup(navBadge?: CreateGlobalFabDeps["navBadge"]) {
  const routeState = ref<RouteState>({ name: "discover", path: "/discover", params: {}, topInset: "self" })
  const navigate = vi.fn()
  const fab = createGlobalFab({ routeState, navigate, navTabs: TABS, navBadge })
  return { fab, routeState, navigate }
}

// 局部引入 vi（该文件不依赖全局注入）
import { vi } from "vitest"

describe("外环未读角标接线（spec §2.2 / §3.2）", () => {
  it("navBadge 提供的计数必须出现在对应 tab 的 view.outer 条目上", () => {
    const { fab } = setup((name) => (name === "updates" ? 5 : 0))
    const updates = fab.view.value.outer.find((t) => t.name === "updates")
    expect(updates?.badge, "「更新」外环项必须带未读计数").toBe(5)
  })

  it("无未读时计数为 0（渲染层据此不画角标节点）", () => {
    const { fab } = setup(() => 0)
    for (const t of fab.view.value.outer) expect(t.badge).toBe(0)
  })

  it("未接 navBadge 依赖时不得抛错，且计数回落 0（向后兼容）", () => {
    const { fab } = setup(undefined)
    expect(fab.view.value.outer.every((t) => t.badge === 0)).toBe(true)
  })

  it("计数随来源响应式变化（读点真接到值，不是快照）", async () => {
    const unread = ref(0)
    const { fab } = setup((name) => (name === "updates" ? unread.value : 0))
    expect(fab.view.value.outer.find((t) => t.name === "updates")?.badge).toBe(0)
    unread.value = 3
    await Promise.resolve()
    expect(fab.view.value.outer.find((t) => t.name === "updates")?.badge).toBe(3)
  })

  it("角标只落在「更新」上（哪些 tab 挂角标由接线方决定，不是深模块硬编码）", () => {
    // ⚠️ 刻意不复现成 setup(() => 9)：那等于要求深模块自己知道「只有 updates 挂角标」，
    //   而那是 store 层的职责（stores/globalFab.ts 的 navBadge 闭包）。
    //   深模块只负责「把接线方给的值透传到渲染层」，职责边界不能被测试写歪。
    const { fab } = setup((name) => (name === "updates" ? 9 : 0))
    expect(fab.view.value.outer.find((t) => t.name === "updates")?.badge).toBe(9)
    for (const t of fab.view.value.outer.filter((x) => x.name !== "updates")) {
      expect(t.badge).toBe(0)
    }
  })

  it("角标定位内收在自身圆环之内（第三轮 review I-2：此前这条只有注释、没有判据）", () => {
    // 背景：外环 4 项在 80° 扫角内中心距 60.5px、环项圆直径 56px，间隙仅 ~4px。
    // 角标若向外伸（`-top` / `-right`）必被相邻环项压住。
    // ⚠️ GlobalFab.vue 的注释曾写「判据在本文件」而本文件**从不对偏移断言** ——
    //   注释描述的防线当时并不存在（第三轮 Standards 审查 I-2 实证）。此处补上。
    const vue = readFileSync(new URL("../components/GlobalFab.vue", import.meta.url), "utf8")
    const badge = vue.match(/<view\s+v-if="e\.tab\.badge > 0"[\s\S]*?>/)
    expect(badge, "未找到角标节点（模板形态变了？）").not.toBeNull()
    const cls = badge![0]
    // 剥注释后再断言：class 附近常有注释，token 写进注释就能假绿
    const clsNoComment = cls.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/[^\n]*/g, "")
    expect(clsNoComment).toMatch(/\btop-\[/)
    expect(clsNoComment).toMatch(/\bright-\[/)
    expect(clsNoComment, "角标不得向外伸（负偏移会被相邻环项压住）").not.toMatch(/(^|\s)-top-/)
    expect(clsNoComment, "角标不得向外伸（负偏移会被相邻环项压住）").not.toMatch(/(^|\s)-right-/)
  })
})

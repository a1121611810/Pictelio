// 「更新」页关注段空态引导契约断言（spec §7 风险表「关注更新空时引导去作者页/榜单」）。
//
// 【缺陷来源】spec §7 把这条写进了「更新页冷启动全空」的缓解措施里，但实现只有一句
// 通用 `updates.empty`（"暂无"）——第三轮 Spec 审查 I-2 实证：全仓无任何引导出口。
// 这类「文档承诺了、代码只留一个泛化空态」的缺口**极易再次退化**：补了提示、下一轮
// 简化空态时就会连提示一起删掉，而没有任何一条断言会转红。
//
// 【期望值出处】spec §7 原文「三段**空态不隐藏**，各显示一行说明；「关注更新」空时
// 引导去作者页/榜单」。本文件钉的是**承诺本身**，不复述实现文案。
import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

import { UPDATES_A11Y_LABELS } from "../src/utils/accessibility"

const updatesVue = readFileSync(fileURLToPath(new URL("../src/pages/Updates.vue", import.meta.url)), "utf8")
const zhPages = readFileSync(
  fileURLToPath(new URL("../src/i18n/locales/zh-CN/pages.ts", import.meta.url)),
  "utf8",
)
const enPages = readFileSync(
  fileURLToPath(new URL("../src/i18n/locales/en/pages.ts", import.meta.url)),
  "utf8",
)

/** 剥注释后再断言：token 写进注释就能让门禁恒绿（本仓已踩过两次） */
const code = updatesVue.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/[^\n]*/g, "")

describe("「更新」页关注段空态 · spec §7 引导出口", () => {
  it("空态不得退回通用「暂无」——那既不解释为什么空，也没有下一步", () => {
    // 负断言：关注段空态不得只渲染 updates.empty
    const emptyBranch = code.slice(code.indexOf('v-else-if="following.length === 0"'))
    expect(emptyBranch, "未找到关注段空态分支").not.toBe("")
    expect(emptyBranch.slice(0, 2000), "关注段空态仍直接用 updates.empty（零引导）").not.toMatch(
      /t\('updates\.empty'\)/,
    )
  })

  it("空态给出「为什么空」的解释文案，而非只有一句状态", () => {
    expect(code).toMatch(/t\('updates\.emptyFollowingTitle'\)/)
    expect(code).toMatch(/t\('updates\.emptyFollowingHint'\)/)
  })

  it("引导出口指向 spec §7 指定的两个去处（路由存在性由 routeLiteralDrift 钉）", () => {
    // ⚠️ 这里**不** import router 校验路径存在：router.ts 会连带 import 全部 .vue 页面，
    //   而本仓 vitest 未装 @vitejs/plugin-vue ⇒ 不打桩就在收集期解析失败
    //   （routeLiteralDrift.test.ts 为此维护了 30 行 vi.mock）。重复那套桩不划算，
    //   故「路径在路由表里」这条交给已有路由表的那个门禁，见下条注释指引。
    expect(code).toMatch(/FOLLOWING_EMPTY_ACTIONS/)
    for (const to of ["/following", "/ranking"]) {
      expect(code, `关注段空态缺少引导出口 ${to}`).toContain(`to: '${to}'`)
    }
  })

  it("失败态不得混入引导（取不到数据 ≠ 没关注，推荐「去关注」是误导）", () => {
    const emptyBranch = code.slice(code.indexOf('v-else-if="following.length === 0"'))
    // ⚠️ 必须钉在**渲染出口的那个元素**上，不能只断言分支里"出现过" v-if="!followingError"
    //   —— 提示文案上也有一个同名字段，只查"出现过"是恒真的：把出口容器上的那个删掉，
    //   断言照样绿（变异实测：删掉后 13 条全过）。
    // ⚠️ 且 v-if 在**外层包裹**、v-for 在**内层**，不是同一个元素（同一元素上 v-if 优先于
    //   v-for，是 Vue 反模式）。故断言「v-if 容器**直接包住** v-for 元素」这段相邻关系，
    //   而不是去匹配单个元素 —— 后者会匹配到没有 v-if 的内层，恒红或恒绿都无意义。
    const wraps =
      /<view[^>]*v-if="!followingError"[^>]*>\s*<view\s+v-for="a in FOLLOWING_EMPTY_ACTIONS"/.test(emptyBranch)
    expect(
      wraps,
      "引导出口必须被 v-if=\"!followingError\" 的容器直接包住，否则加载失败时也会引导用户去关注",
    ).toBe(true)
    expect(emptyBranch, "未找到渲染引导出口的容器").toMatch(/v-for="a in FOLLOWING_EMPTY_ACTIONS"/)
    // 提示文案同理：失败时不该解释「为什么空」
    const hintTag = emptyBranch.match(/<text[^>]*v-if="!followingError"[^>]*>\s*\{\{ t\('updates\.emptyFollowingHint'\)/)
    expect(hintTag, "「为什么空」的提示也必须受 !followingError 约束").not.toBeNull()
  })

  it("双语键位齐备（en 受 satisfies Record<ZhPagesKey, string> 约束，缺 zh 键会编译红）", () => {
    for (const k of [
      "updates.emptyFollowingTitle",
      "updates.emptyFollowingHint",
      "updates.emptyFollowingToFollowing",
      "updates.emptyFollowingToRanking",
    ]) {
      expect(zhPages, `zh-CN 缺 ${k}`).toContain(`"${k}"`)
      expect(enPages, `en 缺 ${k}`).toContain(`"${k}"`)
    }
  })

  it("两个出口都有 a11y 标注（读屏用户不该只听到颜色和位置）", () => {
    expect(UPDATES_A11Y_LABELS.emptyFollowingToFollowing).toBeTruthy()
    expect(UPDATES_A11Y_LABELS.emptyFollowingToRanking).toBeTruthy()
    expect(code).toMatch(/UPDATES_A11Y_LABELS\.emptyFollowingTo/)
  })
})

// 「更新」页通知段契约断言（[维度重构 2026-10-03] 补做，review 真机取证发现）。
//
// 【缺陷来源】模拟器实测（emulator-5554，/updates 第三段）：
//   Pixiv 的 `notification.content.text` 是**含 HTML 标签的片段**（ADR-0188 D4 已记载「日文为主」），
//   本页 v1 直接把 `n.content?.text` 插值上屏 ⇒ 真机可见 `<b>jie geng</b>关注了你。`
//   —— 标签字面量泄漏给用户。同项目的 `pages/Notifications.vue:146` 早已用
//   `notificationPlainText(item.content?.text)` 处理同一字段，本页漏接 = 违反既有约定。
//
// 【期望值出处】ADR-0188 D4「lynx 无 HTML 渲染能力，v1 一律剥标签为纯文本渲染」+ utils/notificationText.ts
//   自身的契约测试（真实抓包样本）。本文件**不复述实现**，只钉「必须走既定工具」这条约定。
import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

import { notificationPlainText } from "../src/utils/notificationText"

const updatesVue = readFileSync(fileURLToPath(new URL("../src/pages/Updates.vue", import.meta.url)), "utf8")
const notificationsVue = readFileSync(
  fileURLToPath(new URL("../src/pages/Notifications.vue", import.meta.url)),
  "utf8",
)

describe("「更新」页通知段 · 通知文案纯文本化（ADR-0188 D4）", () => {
  it("负断言：不得把 content.text 原样插值上屏（这正是本缺陷本身）", () => {
    // 直接消费 content?.text / content.text 而不经工具 = 标签泄漏。
    // 正则刻意只匹配「未包裹工具调用」的直取写法，避免误伤 `notificationPlainText(n.content?.text)`。
    const directUse = updatesVue.match(/(?<!PlainText\()\btext:\s*n\.content\??\.text\b/)
    expect(directUse, "Updates.vue 出现未经 notificationPlainText 处理的 content.text 直取").toBeNull()
  })

  it("正断言：导入并使用既定工具 notificationPlainText", () => {
    expect(updatesVue).toContain("import { notificationPlainText }")
    expect(updatesVue).toMatch(/notificationPlainText\(\s*n\.content\??\.text\s*\)/)
  })

  it("与通知页同源：两个页面对同一字段的处理口径必须一致", () => {
    // 防止将来某一页改口径、另一页没跟上（这次缺陷的本质就是两页口径分叉）。
    expect(notificationsVue).toMatch(/notificationPlainText\(/)
    expect(updatesVue).toMatch(/notificationPlainText\(/)
  })

  it("行为级：真实抓包形状的样本经该路径后不得残留任何标签", () => {
    // 样本取自模拟器真机输出（2026-10-03，/updates 第三段实拍），非手编。
    const real = "<b>jie geng</b>关注了你。"
    expect(notificationPlainText(real)).toBe("jie geng关注了你。")
    expect(notificationPlainText(real)).not.toMatch(/<[^>]*>/)
    // 带实体 + 自闭合标签的变体（同样来自抓包形态）
    expect(notificationPlainText("<b>aa5511</b>喜欢!了<b>第 4 章：加速 &amp; 变化</b>。")).toBe(
      "aa5511喜欢!了第 4 章：加速 & 变化。",
    )
    // null/undefined → 空串（调用方据空串判空渲染占位）
    expect(notificationPlainText(null)).toBe("")
    expect(notificationPlainText(undefined)).toBe("")
  })
})

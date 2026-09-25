// ─── notificationPlainText differential 测试（ADR-0188 D4 / spec 测试决策）───
// 与 webview 端（packages/app）同语义双端各自实现，期望值 = spec 边界 4 语义表
// （<b> 保留内文 / 嵌套标签剔除 / 实体解码 / 空串 / null / trim），双端测试用例逐字同构。
// 期望值出处独立于实现：fixture 真实样本（users/すき！通知文本）+ spec 语义表。
import { describe, expect, it } from "vitest"
import { notificationPlainText } from "./notificationText"

describe("notificationPlainText（HTML 剥离纯文本）", () => {
  it("<b> 标签剔除、内文保留（真实抓包样本文案形态）", () => {
    expect(notificationPlainText("<b>ユーザーA</b>さんがあなたをフォローしました。")).toBe(
      "ユーザーAさんがあなたをフォローしました。",
    )
  })

  it("多个 <b> 段（すき！通知：用户名 + 作品名两段加粗）", () => {
    expect(notificationPlainText("<b>ユーザーB</b>さんが<b>第 1 章：🌈 森林奇遇！神秘的彩虹蘑菇</b>にすき！しました。")).toBe(
      "ユーザーBさんが第 1 章：🌈 森林奇遇！神秘的彩虹蘑菇にすき！しました。",
    )
  })

  it("嵌套标签逐个剔除（内文不损）", () => {
    expect(notificationPlainText("<a href=\"x\"><b>deep</b></a> text")).toBe("deep text")
  })

  it("带属性标签与自闭合标签剔除", () => {
    expect(notificationPlainText("a <span class=\"x\">b</span><br/>c")).toBe("a bc")
  })

  it("实体解码（&amp; &lt; &gt; &quot; &#39; &nbsp;）", () => {
    expect(notificationPlainText("A &amp; B")).toBe("A & B")
    expect(notificationPlainText("&lt;tag&gt;")).toBe("<tag>")
    expect(notificationPlainText("&quot;q&quot;&#39;apos&nbsp;!")).toBe("\"q\"'apos !")
  })

  it("实体单层解码（&amp;lt; → &lt;，对齐 DOM 语义，不二次解码）", () => {
    expect(notificationPlainText("&amp;lt;")).toBe("&lt;")
  })

  it("纯文本原样（无标签无实体）", () => {
    expect(notificationPlainText(" plain text ")).toBe("plain text")
  })

  it("空串 → 空串；null / undefined → 空串（content 为 null 的宽容消费）", () => {
    expect(notificationPlainText("")).toBe("")
    expect(notificationPlainText(null)).toBe("")
    expect(notificationPlainText(undefined)).toBe("")
  })

  it("首尾空白 trim（含标签剥离后暴露的空白）", () => {
    expect(notificationPlainText("  <b> x </b>  ")).toBe("x")
  })
})

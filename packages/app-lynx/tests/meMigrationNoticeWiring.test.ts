// 一次性迁移提示的**接线**门禁（spec §7「老用户找不到收藏/追更」第 2 条缓解）。
//
// 【为什么 store 单测不够】`navMigrationNotice.test.ts` 证明了 store 语义正确，
// 但**没有**证明 Me.vue 真的读了它、真的按 `seen` 显隐、关闭按钮真的绑到 dismiss。
// 这类「机制在、没接线」正是审计一 read-point 纪律要防的 silent misconfiguration：
// store 绿、界面不显示，没有任何一条断言会转红。
//
// 【期望值出处】spec §7 原文「老用户找不到收藏/追更 → 「我的」保留次级入口 +
// 一次性迁移提示」。本文件钉「提示被消费且受已读旗标控制」这条承诺。
import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

const meVue = readFileSync(fileURLToPath(new URL("../src/pages/Me.vue", import.meta.url)), "utf8")
const zhPages = readFileSync(
  fileURLToPath(new URL("../src/i18n/locales/zh-CN/pages.ts", import.meta.url)),
  "utf8",
)
const enPages = readFileSync(
  fileURLToPath(new URL("../src/i18n/locales/en/pages.ts", import.meta.url)),
  "utf8",
)

/** 剥注释后再断言：token 写进注释就能让门禁恒绿（本仓已踩过两次） */
const code = meVue.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/[^\n]*/g, "")

/**
 * 取 i18n 键的**值**。
 *
 * ⚠️ 刻意不用 `/"k":[^"]*X/` 这种写法：键值对之间还有一个开引号，`[^"]*` 在那里就停了，
 *   根本走不到 X ⇒ **正断言恒红、负断言恒真**。首版就是这么写的（负断言看着绿，
 *   其实什么都没查）。故先把值捕获出来，再对值做判断。
 */
function i18nValue(src: string, key: string): string {
  const m = src.match(new RegExp(`"${key.replace(/\./g, "\\.")}"\\s*:\\s*"([^"]*)"`))
  expect(m, `i18n 源里找不到 ${key}`).not.toBeNull()
  return m![1]!
}

describe("一次性迁移提示 · Me 页接线（spec §7）", () => {
  it("Me 页必须真的读该 store（否则 store 绿而界面不显示）", () => {
    expect(code).toMatch(/useNavMigrationNoticeStore\(\)/)
    // load 必须在挂载时被触发：只 import 不 load ⇒ seen 永远是初值 false ⇒ 提示永显
    expect(code, "store 已引入但没有调用 load()").toMatch(/migration\.load\(\)/)
  })

  it("提示受已读旗标控制（不是常显，也不是永不显）", () => {
    expect(code, "提示未受 !migration.seen 控制").toMatch(/v-if="!migration\.seen"/)
  })

  it("关闭按钮绑到 dismiss（否则用户关不掉 ⇒ '一次性' 名不副实）", () => {
    expect(code).toMatch(/dismissMigrationNotice/)
    expect(code, "关闭按钮未绑定 dismissMigrationNotice").toMatch(/@tap="dismissMigrationNotice"/)
    expect(code).toMatch(/migration\.dismiss\(\)/)
  })

  it("提示落在保留入口**之前**（它的作用就是解释下面为什么不一样了）", () => {
    const noticeAt = code.indexOf('v-if="!migration.seen"')
    // 「我的」保留的次级入口之一：收藏
    const bookmarksAt = code.search(/ME_A11Y_LABELS\.bookmarks/)
    expect(noticeAt, "未找到迁移提示节点").toBeGreaterThan(-1)
    expect(bookmarksAt, "未找到收藏入口，判据前提不成立").toBeGreaterThan(-1)
    expect(noticeAt, "提示压在保留入口之后 ⇒ 解释失去上下文").toBeLessThan(bookmarksAt)
  })

  it("提示正文的落点描述必须是**重构后**的目的地（防再次写成旧结构）", () => {
    const zh = i18nValue(zhPages, "me.migration.body")
    const en = i18nValue(enPages, "me.migration.body")
    // 负断言：不得再出现旧顶层目的地「个人中心」/ your profile
    expect(zh, "提示正文仍在说旧目的地「个人中心」").not.toContain("个人中心")
    expect(en, "提示正文仍在说旧目的地 your profile").not.toContain("your profile")
    // 正断言：必须指向重构后的「发现」/ Discover
    expect(zh, "提示正文未指向「发现」").toContain("发现")
    expect(en, "提示正文未指向 Discover").toContain("Discover")
  })

  it("双语键位齐备（en 受 satisfies Record<ZhPagesKey, string> 约束）", () => {
    for (const k of ["me.migration.title", "me.migration.body", "me.migration.dismiss"]) {
      expect(zhPages, `zh-CN 缺 ${k}`).toContain(`"${k}"`)
      expect(enPages, `en 缺 ${k}`).toContain(`"${k}"`)
    }
    expect(code, "模板未消费这三个键").toMatch(/t\('me\.migration\.title'\)/)
    expect(code).toMatch(/t\('me\.migration\.body'\)/)
    expect(code).toMatch(/t\('me\.migration\.dismiss'\)/)
  })
})

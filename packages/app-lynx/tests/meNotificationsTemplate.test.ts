// Me.vue 通知入口行模板断言（ADR-0188 D7 / #728）。
// 期望值出处：ADR-0188 D7（lynx = Me 功能入口卡区行 + 行尾未读圆点，禁 NAV_TABS 外环扩容）+
// unit.test.ts 既有注册表配平约束（ME_A11Y_LABELS 每键必被消费且 element/label 数量严格一致）。
import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

const meVue = readFileSync(fileURLToPath(new URL("../src/pages/Me.vue", import.meta.url)), "utf8")
const a11y = readFileSync(fileURLToPath(new URL("../src/utils/accessibility.ts", import.meta.url)), "utf8")

describe("Me.vue 通知中心入口（ADR-0188 D7 / #728）", () => {
  it("入口行：networkCheck 行后、openNotifications → /notifications", () => {
    // 行序：networkCheck 消费点在 notifications 消费点之前（票面指定插入位）
    const networkCheckIdx = meVue.indexOf("ME_A11Y_LABELS.networkCheck")
    const notificationsIdx = meVue.indexOf("ME_A11Y_LABELS.notifications")
    expect(networkCheckIdx).toBeGreaterThan(-1)
    expect(notificationsIdx).toBeGreaterThan(networkCheckIdx)
    expect(meVue).toContain("function openNotifications()")
    expect(meVue).toContain("navigate('/notifications')")
  })

  it("入口行消费 i18n 键 me.notifications", () => {
    expect(meVue).toContain("t('me.notifications')")
  })

  it("未读圆点：纯 CSS、M3 语义色类 bg-error（禁硬编码色值——全局 hardcodeColorGate 兜底）", () => {
    expect(meVue).toMatch(/notificationStore\.unreadCount > 0/)
    expect(meVue).toMatch(/rounded-full bg-error/)
    // 禁清单形态（AGENTS.md）：attr 穿插硬编码 var 的旧写法不回流
    expect(meVue).not.toContain("[color:var(")
    expect(meVue).not.toContain("[background-color:var(")
  })

  it("挂载时静默刷新未读（refreshUnreadBadge，fire-and-forget）", () => {
    expect(meVue).toContain("void notificationStore.refreshUnreadBadge()")
  })

  it("ME_A11Y_LABELS.notifications 登记且与其它键无重复（注册表唯一性口径与 unit.test 一致）", () => {
    const registryMatch = /ME_A11Y_LABELS = \{([^}]*)\}/.exec(a11y)
    expect(registryMatch).not.toBeNull()
    const labels = [...(registryMatch![1]!.matchAll(/'([^']*)'/g))].map((m) => m[1]!)
    expect(labels).toContain("通知")
    expect(new Set(labels).size).toBe(labels.length)
  })
})

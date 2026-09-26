// Me.vue 稍后看入口行模板断言（ADR-0191 D5 / #753 T4）。
// 期望值出处：ADR-0191 D5（Me 功能入口卡区行 + 条目计数徽标，跟随 Watchlist 入口行模式，spec D8）+
// unit.test.ts 既有注册表配平约束（ME_A11Y_LABELS 每键必被消费且 element/label 数量严格一致）。
// 术语红线：i18n 键走 later.*（spec D9），注册表键名 watchLater——与追更（watchlist）物理隔离。
import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

const meVue = readFileSync(fileURLToPath(new URL("../src/pages/Me.vue", import.meta.url)), "utf8")
const a11y = readFileSync(fileURLToPath(new URL("../src/utils/accessibility.ts", import.meta.url)), "utf8")

describe("Me.vue 稍后看入口（ADR-0191 D5 / #753 T4）", () => {
  it("入口行：watchlist 行后（ADR-0191 卡区行序）、openWatchLater → /later", () => {
    // 行序：watchlist 消费点在 watchLater 消费点之前（ADR-0191 中性注：bookmarks / watchlist / 稍后看 / …）
    const watchlistIdx = meVue.indexOf("ME_A11Y_LABELS.watchlist")
    const watchLaterIdx = meVue.indexOf("ME_A11Y_LABELS.watchLater")
    expect(watchlistIdx).toBeGreaterThan(-1)
    expect(watchLaterIdx).toBeGreaterThan(watchlistIdx)
    expect(meVue).toContain("function openWatchLater()")
    expect(meVue).toContain("navigate('/later')")
  })

  it("计数徽标绑定 store.count：消费 useWatchLaterStore 且模板插值 .count", () => {
    expect(meVue).toContain("useWatchLaterStore()")
    expect(meVue).toMatch(/\{\{ \w+\.count \}\}/)
  })

  it("入口行消费 i18n 键 later.me.entry（spec D9：入口行文案走 later.* 前缀）", () => {
    expect(meVue).toContain("t('later.me.entry')")
  })

  it("ME_A11Y_LABELS.watchLater 登记且与其它键无重复（注册表唯一性口径与 unit.test 一致）", () => {
    const registryMatch = /ME_A11Y_LABELS = \{([^}]*)\}/.exec(a11y)
    expect(registryMatch).not.toBeNull()
    const labels = [...(registryMatch![1]!.matchAll(/'([^']*)'/g))].map((m) => m[1]!)
    expect(labels).toContain("稍后看")
    expect(new Set(labels).size).toBe(labels.length)
  })

  it("入口行 element + label 成对（ADR-0061）：新行同时带两绑定，配平约束不破", () => {
    // 行绑定成对：accessibility-label 与 accessibility-element 同 view 出现（unit.test 全页
    // labelCount === elementCount 守卫的行级等价断言——本行新增不破配平）
    const row = meVue.match(/<view[^>]*:accessibility-label="ME_A11Y_LABELS\.watchLater"[^>]*>/)?.[0] ?? ""
    expect(row).not.toBe("")
    expect(row).toContain(':accessibility-element="A11Y_ELEMENT_ENABLED"')
    const labelCount = (meVue.match(/:accessibility-label="ME_A11Y_LABELS\.\w+"/g) ?? []).length
    const elementCount = (meVue.match(/:accessibility-element="A11Y_ELEMENT_ENABLED"/g) ?? []).length
    expect(labelCount).toBe(elementCount)
  })
})

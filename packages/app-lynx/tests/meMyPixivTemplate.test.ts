// Me.vue 好P友入口行模板断言（ADR-0193 D3 / #754 T7）。
// 期望值出处：ADR-0193 D3（Me 功能入口卡区「好P友」行，i18n key me.mypixiv，文案「好P友」；
// 邻位对齐 bookmarks/watchlist 行序，T4 稍后看行附近同组）+ unit.test.ts 既有注册表配平约束
// （ME_A11Y_LABELS 每键必被消费且 element/label 数量严格一致）。
// 术语红线（glossary 核心术语表）：好P友（MyPixiv）；「好友/朋友/相互关注列表」别称禁用。
import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

const meVue = readFileSync(fileURLToPath(new URL("../src/pages/Me.vue", import.meta.url)), "utf8")
const a11y = readFileSync(fileURLToPath(new URL("../src/utils/accessibility.ts", import.meta.url)), "utf8")

describe("Me.vue 好P友入口（ADR-0193 D3 / #754 T7）", () => {
  it("入口行：稍后看行后（T4 行附近同组）、openMyPixiv → /mypixiv", () => {
    // 行序：稍后看（watchLater）消费点在 mypixiv 消费点之前（ADR-0193 D3 邻位对齐）
    const watchLaterIdx = meVue.indexOf("ME_A11Y_LABELS.watchLater")
    const myPixivIdx = meVue.indexOf("ME_A11Y_LABELS.mypixiv")
    expect(watchLaterIdx).toBeGreaterThan(-1)
    expect(myPixivIdx).toBeGreaterThan(watchLaterIdx)
    expect(meVue).toContain("function openMyPixiv()")
    expect(meVue).toContain("navigate('/mypixiv')")
  })

  it("入口行消费 i18n 键 me.mypixiv（spec D4：文案「好P友」）", () => {
    expect(meVue).toContain("t('me.mypixiv')")
  })

  it("ME_A11Y_LABELS.mypixiv 登记且值 =「好P友」，与其它键无重复（注册表唯一性口径与 unit.test 一致）", () => {
    const registryMatch = /ME_A11Y_LABELS = \{([^}]*)\}/.exec(a11y)
    expect(registryMatch).not.toBeNull()
    const labels = [...(registryMatch![1]!.matchAll(/'([^']*)'/g))].map((m) => m[1]!)
    expect(labels).toContain("好P友")
    expect(new Set(labels).size).toBe(labels.length)
  })

  it("入口行 element + label 成对（ADR-0061）：新行同时带两绑定，全页配平约束不破", () => {
    const row = meVue.match(/<view[^>]*:accessibility-label="ME_A11Y_LABELS\.mypixiv"[^>]*>/)?.[0] ?? ""
    expect(row).not.toBe("")
    expect(row).toContain(':accessibility-element="A11Y_ELEMENT_ENABLED"')
    // [维度重构 2026-10-03] 计数改为**注册表无关**（匹配任意 `*.key` 形式的 a11y-label）。
    //   本页新增「高级」行用的是 ADVANCED_A11Y_LABELS 而非 ME_A11Y_LABELS，但**真不变量**
    //   是「每个 accessibility-label 都配一个 accessibility-element」，
    //   而不是「必须用哪个注册表」。原写法把不变量误写成注册表专属，页面一旦引入第二个
    //   注册表就假红 —— 那是判据写窄了，不是页面写错了。
    const labelCount = (meVue.match(/:accessibility-label="[A-Z_0-9]+A11Y_LABELS\.\w+"/g) ?? []).length
    const elementCount = (meVue.match(/:accessibility-element="A11Y_ELEMENT_ENABLED"/g) ?? []).length
    expect(labelCount).toBe(elementCount)
  })

  it("术语红线：Me.vue 不出现禁用别称「相互关注列表」/「我的好友」（glossary _Avoid_）", () => {
    expect(meVue).not.toContain("相互关注列表")
    expect(meVue).not.toContain("我的好友")
  })
})

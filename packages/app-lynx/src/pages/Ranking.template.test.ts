// Ranking.vue 模板硬约束（ticket #517/#518 / spec docs/specs/ranking.md §5.3/§5.6/§5.7/§6.3）。
// 期望值出处：ticket AC + spec §6.3 既有约束 + ADR-0048（轴间距）/ ADR-0049（KeepAlive）/
// ADR-0150（三态单链）/ ADR-0061（a11y element+label）/ issue #140（显式高度）。
import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

const src = readFileSync(fileURLToPath(new URL("./Ranking.vue", import.meta.url)), "utf8")
const app = readFileSync(fileURLToPath(new URL("../App.vue", import.meta.url)), "utf8")

describe("Ranking.vue 骨架硬约束（#517）", () => {
  it("首载三态互斥单链（ADR-0150：deriveFirstLoadView）", () => {
    expect(src).toContain("deriveFirstLoadView")
    expect(src).toContain("view === 'skeleton'")
    expect(src).toContain("view === 'error'")
    expect(src).toContain("view === 'empty'")
  })

  it("list-item 图片显式高度（原生 LynxView issue #140）", () => {
    expect(src).toMatch(/<SkeletonImage[^>]*height="14vw"/)
  })

  it("间距走 list 轴间距属性（spec §6.3 / ADR-0048）", () => {
    expect(src).toContain("listMainAxisGap")
    expect(src).toContain("listCrossAxisGap")
  })

  it("KeepAlive include 与组件 name 配对（ADR-0049）", () => {
    expect(src).toContain("name: 'ranking'")
    expect(app).toContain("'ranking'")
  })

  it("受限条目保留并盖遮罩、不可点入（spec §5.6）", () => {
    expect(src).toContain("RestrictOverlay")
    expect(src).toContain("isAiRestricted")
    expect(src).toContain("openRow")
  })
})

describe("Ranking.vue 维度/日期控件（#518）", () => {
  it("渲染 7 档维度 chips（RANK_MODES 单点，selectMode）", () => {
    expect(src).toContain("RANK_MODES")
    expect(src).toContain('v-for="m in RANK_MODES"')
    expect(src).toContain("selectMode(m.id)")
  })

  it("日期行：‹/文本/今日/›；无日历（Lynx input 不支持日期，spec §6.3）", () => {
    expect(src).toContain("shiftDay(-1)")
    expect(src).toContain("shiftDay(1)")
    expect(src).toContain("ranking.dateLong")
    expect(src).not.toContain('type="date"')
  })

  it("今日时后一天禁用（isTodayDate 纯函数判定）", () => {
    expect(src).toContain("isTodayDate")
    expect(src).toContain("!isToday && shiftDay(1)")
  })

  it("R-18 失败/空态指引（spec §5.7）", () => {
    expect(src).toContain("showR18Notice")
    expect(src).toContain("ranking.r18Notice.title")
    expect(src).toContain("openPixivSettings")
  })

  it("可访问性：模式容器 element+label 成对（ADR-0061）", () => {
    expect(src).toContain("ranking.modeListAria")
    expect(src).toContain("accessibility-element")
  })
})

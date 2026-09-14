// RankingEntryCard.vue 入口大卡硬约束（ticket #519 / spec docs/specs/ranking.md §5.1/§5.2/§5.8）。
// 期望值出处：ticket AC + spec §5.2（大卡形态）+ ADR-0049/issue #140（显式高度）+ 禁静默降级。
import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import zhPages from "../i18n/locales/zh-CN/pages"
import enPages from "../i18n/locales/en/pages"

const src = readFileSync(fileURLToPath(new URL("./RankingEntryCard.vue", import.meta.url)), "utf8")
const illustList = readFileSync(fileURLToPath(new URL("../pages/IllustList.vue", import.meta.url)), "utf8")

describe("RankingEntryCard.vue（#519）", () => {
  it("固定日榜·今日：默认 createRankingFeed(DEFAULT_RANK_MODE)", () => {
    expect(src).toContain("createRankingFeed({ mode: DEFAULT_RANK_MODE, date: null }")
    expect(src).toContain("DEFAULT_RANK_MODE")
  })

  it("榜首大卡：第 1 名徽章 / 榜名·今日 / 全部 / 收起", () => {
    expect(src).toContain("ranking.entry.firstBadge")
    expect(src).toContain("ranking.mode.daily")
    expect(src).toContain("ranking.entry.viewAll")
    expect(src).toContain("ranking.entry.collapseAria")
    expect(src).toContain("dismissed = true")
  })

  it("收起后刷新/重进恢复（refreshEpoch watch + onActivated）", () => {
    expect(src).toContain("watch(")
    expect(src).toContain("refreshEpoch")
    expect(src).toContain("onActivated")
    expect(src).toContain("isEntryVisible")
  })

  it("图片显式高度（issue #140）+ 无 scoped CSS / 无 rem", () => {
    expect(src).toMatch(/height="62vw"/)
    expect(src).toMatch(/height="16vw"/)
    expect(src).not.toContain("<style")
    expect(src).not.toMatch(/[\d.]rem/)
  })

  it("失败隐藏 + warn（禁静默降级）", () => {
    expect(src).toContain("console.warn")
    expect(src).toContain("hasError: !!error.value")
    expect(src).toContain('v-if="visible"')
  })

  it("settled-empty 不由可见性误显示 + 无死状态 loading（审阅修复）", () => {
    expect(src).toContain("settled: settled.value")
    expect(src).toContain("itemCount: illusts.value.length")
    expect(src).not.toContain("const loading = ref")
    expect(src).toContain("void refresh()")
  })

  it("宿主 IllustList 受开关控制且仅推荐 tab 渲染", () => {
    expect(illustList).toContain("RankingEntryCard")
    expect(illustList).toContain("mode === 'recommend' && settings.rankingEntry")
  })

  it("runners 由 PixivIllust[] 构造 {rank, illust}（防 webview 形状串端，S1 回归）", () => {
    expect(src).toContain("illusts.value.slice(1, 3).map((illust, i) => ({ rank: i + 2, illust }))")
  })

  it("所有 t('<key>') 键在 zh-CN 与 en 字典均存在（防悬空键，S2 回归）", () => {
    const keys = [...src.matchAll(/t\('([^']+)'/g)].map((m) => m[1]!)
    expect(keys.length).toBeGreaterThan(0)
    for (const key of keys) {
      expect(zhPages).toHaveProperty(key)
      expect(enPages).toHaveProperty(key)
    }
  })
})

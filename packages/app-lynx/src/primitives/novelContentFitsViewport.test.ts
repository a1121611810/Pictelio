// 正文「是否高于视口」的几何前置（ADR-0219 §2.3 触底前置）。
//
// 被测对象：`primitives/novelContentFitsViewport.ts`（纯几何）+ `stores/continueReadingStore.ts`
// 的 `decideNovelCompletion` 前置分支。**接线面**（页面怎么把几何喂进去）在
// `tests/novelCompletionViewportWiring.test.ts`，不混进本文件。
//
// 期望值溯源（测试硬约束 #6：不从实现反推）：
// - 前置语义「内容高于视口 且 滚到底」  → ADR-0219 §2.3 触底行 + 票 #930 前置
// - 一屏放得下 ⇒ 不判完成              → 票 #930 缺陷本体（真机 emulator-5554 实证存证
//   `docs/research/screenshots-2026-10/22-continue-single-novel-fits-one-screen.png`）
// - 单位换算方向（vw → @375 基准设计 px）→ `glossary-lynx-units.md` 375 设计稿口径 +
//   `primitives/novelParagraphEstimate.ts` 头注「估算取 375 基准」
// - 拿不到视口高取保守侧 + warn         → 测试硬约束 #3 禁静默降级 + 票 #930
// - 单本读到底 / 末话读到底仍成立        → ADR-0219 §2.3 触底两行（前置**不得**把判定整体打死）
import { describe, expect, it } from 'vitest'
import {
  DESIGN_BASE_WIDTH_PX,
  viewportHeightDesignPx,
  novelContentHeightPx,
  resolveNovelContentGeometry,
} from './novelContentFitsViewport'
import { decideNovelCompletion } from '../stores/continueReadingStore'
import type { ViewportContentSize } from '../utils/viewportGeometry'

/** 390×844 设备（Pixiv 客户端常见竖屏基准）；内容区尺寸 = 全屏（无系统条 inset 时） */
const DEVICE: ViewportContentSize = { w: 390, h: 844 }
/** 该设备下的视口高（@375 基准设计 px）= 844/390 × 375 = 811.538… */
const DEVICE_VIEWPORT_DESIGN_PX = (844 / 390) * DESIGN_BASE_WIDTH_PX

// ─── [单位] vw ↔ @375 基准设计 px 的换算 ─────────────────────────────────
describe("单位换算：视口 vw → @375 基准设计 px（glossary-lynx-units.md）", () => {
  it("正例：844/390 的屏高折成 811.54 设计 px（= 375 屏上的屏高）", () => {
    expect(viewportHeightDesignPx((844 / 390) * 100)).toBeCloseTo(DEVICE_VIEWPORT_DESIGN_PX, 6)
    expect(DEVICE_VIEWPORT_DESIGN_PX).toBeCloseTo(811.538, 3)
  })

  it("📌 反例方向①：漏乘 375/100（216.4vw 当 216.4px）会让**短文也判成可滚**", () => {
    // 真实世界：正文 500 设计 px（十来段短文），844 高的视口 ⇒ **一屏放得下**（缺陷本体场景）
    const geometry = resolveNovelContentGeometry({
      contentSize: DEVICE,
      systemInfo: undefined,
      paragraphCount: 10,
      avgParagraphHeightPx: 50,
    })
    expect(geometry.viewportHeightPx).toBeCloseTo(DEVICE_VIEWPORT_DESIGN_PX, 6)
    // ⚠️ 换算若少乘 3.75 倍（视口变成 216.4px），500 > 216 ⇒ 本断言转红 ⇒ 守卫生效
    expect(
      geometry.contentExceedsViewport,
      "短文被判成「高于视口」⇒ 一屏放得下也会判完成，票 #930 缺陷复发",
    ).toBe(false)
  })

  it("📌 反例方向②：漏除 100（216.4vw 当 81075px）会让**长篇也判成放得下**", () => {
    // 真实长篇：约 20000 设计 px（≈900 段 × 22px），844 高的视口 ⇒ 远远可滚
    const geometry = resolveNovelContentGeometry({
      contentSize: DEVICE,
      systemInfo: undefined,
      paragraphCount: 900,
      avgParagraphHeightPx: 22,
    })
    expect(geometry.contentHeightPx).toBe(19800)
    // ⚠️ 换算若少除 100（视口变成 81075px），19800 < 81075 ⇒ 本断言转红 ⇒ 守卫生效
    expect(
      geometry.contentExceedsViewport,
      "长篇被判成「放得下」⇒ 读完永远判不出完成，功能反向失效",
    ).toBe(true)
  })

  it("正例：长正文判「高于视口」，短正文判「放得下」——判定在边界两侧都成立", () => {
    const long = resolveNovelContentGeometry({
      contentSize: DEVICE,
      systemInfo: undefined,
      paragraphCount: 100,
      avgParagraphHeightPx: 22,
    })
    const short = resolveNovelContentGeometry({
      contentSize: DEVICE,
      systemInfo: undefined,
      paragraphCount: 5,
      avgParagraphHeightPx: 22,
    })
    expect(long.contentHeightPx).toBeGreaterThan(DEVICE_VIEWPORT_DESIGN_PX)
    expect(long.contentExceedsViewport).toBe(true)
    expect(short.contentHeightPx).toBeLessThan(DEVICE_VIEWPORT_DESIGN_PX)
    expect(short.contentExceedsViewport).toBe(false)
  })

  it("正例：正文高恰好等于视口高 ⇒ 判「放得下」（严格 >；等高时确实没有可滚的余量）", () => {
    const geometry = resolveNovelContentGeometry({
      contentSize: DEVICE,
      systemInfo: undefined,
      paragraphCount: 1,
      avgParagraphHeightPx: DEVICE_VIEWPORT_DESIGN_PX,
    })
    expect(geometry.contentHeightPx).toBeCloseTo(DEVICE_VIEWPORT_DESIGN_PX, 6)
    expect(geometry.contentExceedsViewport).toBe(false)
  })
})

// ─── 正文高估算（@375 基准设计 px）───────────────────────────────────────
describe("正文高 = 段数 × 中位段高（与 estimatedHeightPx 同口径）", () => {
  it("正例：乘法外推；零段 ⇒ 0（不判完成）", () => {
    expect(novelContentHeightPx(0, 22)).toBe(0)
    expect(novelContentHeightPx(12, 22)).toBe(264)
  })

  it("📌 反例：负段数（脏数据）不得产出负高度（否则负数恒「小于视口」而误判完成）", () => {
    // 负高恒小于视口 ⇒ 若被当作「放得下」会放行完成；这里只钉「不产出负数」这一层事实
    expect(novelContentHeightPx(-5, 22)).toBe(0)
  })
})

// ─── 前置条件 → 完成判定（ADR-0219 §2.3 / 票 #930）──────────────────────
describe("前置条件：内容高于视口 才谈得上「读到了底」（票 #930）", () => {
  it("📌 正例（缺陷本体）：单本小说一屏放得下 + 引擎报触底 ⇒ **不**完成", () => {
    // 真机实证：<list> 首帧就在下边界 ⇒ scrolltolower 立即派发（此时用户一字未读）
    expect(
      decideNovelCompletion({
        reachedBottom: true,
        contentExceedsViewport: false,
        seriesId: null,
      }),
      "一屏放得下的单本小说被当场软删 ⇒ 票 #930 缺陷复发",
    ).toBe(false)
  })

  it("📌 正例：系列末话一屏放得下 ⇒ 同样**不**完成（前置对两类情形一视同仁）", () => {
    expect(
      decideNovelCompletion({
        reachedBottom: true,
        contentExceedsViewport: false,
        seriesId: 7,
        chapterNo: 12,
        chapterTotal: 12,
      }),
    ).toBe(false)
  })

  it("📌 反向钉住：内容高于视口时，原有两条正例**不得**被前置打死", () => {
    // 前置是**收紧**语义，不是把功能整体关掉：长篇读完仍要能离场（ADR-0219 §2.3 单本告警）
    expect(
      decideNovelCompletion({ reachedBottom: true, contentExceedsViewport: true, seriesId: null }),
    ).toBe(true)
    expect(
      decideNovelCompletion({
        reachedBottom: true,
        contentExceedsViewport: true,
        seriesId: 7,
        chapterNo: 12,
        chapterTotal: 12,
      }),
    ).toBe(true)
    // 中间话的反例不受影响
    expect(
      decideNovelCompletion({
        reachedBottom: true,
        contentExceedsViewport: true,
        seriesId: 7,
        chapterNo: 5,
        chapterTotal: 12,
      }),
    ).toBe(false)
  })

  it("未触底 ⇒ 不完成（前置与触底是**与**关系，任一不成立即不完成）", () => {
    expect(
      decideNovelCompletion({
        reachedBottom: false,
        contentExceedsViewport: true,
        seriesId: null,
      }),
    ).toBe(false)
  })
})

// ─── 视口来源优先级 + 降级（ADR-0131 / 测试硬约束 #3）────────────────────
describe("视口高来源优先级：内容区 > SystemInfo（ADR-0131 决策 2）", () => {
  it("正例：内容区有效 ⇒ 以内容区为准（撇除系统条 inset）", () => {
    const geometry = resolveNovelContentGeometry({
      contentSize: { w: 390, h: 800 },
      systemInfo: { pixelWidth: 1080, pixelHeight: 2340, pixelRatio: 2.769 },
      paragraphCount: 10,
      avgParagraphHeightPx: 50,
    })
    expect(geometry.viewportMeasured).toBe(true)
    expect(geometry.viewportHeightPx).toBeCloseTo(viewportHeightDesignPx((800 / 390) * 100), 6)
  })

  it("正例：内容区是未布局哨兵 -1×-1 ⇒ 回退 SystemInfo（不取哨兵值）", () => {
    const geometry = resolveNovelContentGeometry({
      contentSize: { w: -1, h: -1 },
      systemInfo: { pixelWidth: 1080, pixelHeight: 2340, pixelRatio: 3 },
      paragraphCount: 10,
      avgParagraphHeightPx: 50,
    })
    // SystemInfo 口径：2340/3 ÷ (1080/3) × 100 = 216.67vw → 812.5 设计 px
    expect(geometry.viewportMeasured).toBe(true)
    expect(geometry.viewportHeightPx).toBeCloseTo(viewportHeightDesignPx((780 / 360) * 100), 6)
  })

  it("📌 降级：两者皆无 ⇒ viewportHeightPx=null + measured=false + 取**保守侧** false", () => {
    const geometry = resolveNovelContentGeometry({
      contentSize: null,
      systemInfo: undefined,
      paragraphCount: 900, // 长到足够超任何视口
      avgParagraphHeightPx: 22,
    })
    expect(geometry.viewportMeasured).toBe(false)
    expect(geometry.viewportHeightPx).toBeNull()
    // 保守侧：宁可漏完成（自愈），也不误软删（吞数据）
    expect(geometry.contentExceedsViewport).toBe(false)
    // 且这个 false 真的会让判定不成立——降级不是「标个记号」
    expect(
      decideNovelCompletion({
        reachedBottom: true,
        contentExceedsViewport: geometry.contentExceedsViewport,
        seriesId: null,
      }),
    ).toBe(false)
  })
})

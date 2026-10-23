// NovelIntro 动作行「极窄屏（<320dp）降级矩阵」的源级守卫（票 #756）。
//
// oracle 溯源（期望值全部来自**独立来源**，不从被测实现反推）：
// - 阈值 320 + 降级形态口径 = docs/specs/app-lynx-novel-intro-action-row.md §12 风险表
//   那一行（#756 已订正并标记「已落地」）：
//   「… ｜ 视口宽 < 320px ｜ **已实现**：降级为 **2 列 × 3 行**（5 动作 + 1 空占位，空位固定右下角…）」。
//   ⚠️ 该行原文曾是「改 2×2 网格布局」（四动作时代的计划口径）；#756 落地后订正为 2 列 × 3 行，
//   本断言随 spec 同步（订正日期 2026-10-23）。
// - 五动作扩容口径 = ADR-0191 D5 后果段「小说介绍页 Row 1 由四动作增至五动作
//   （…极窄屏 < 320px 降级矩阵需在 spec 同步扩容）」。
// - ADR ↔ spec ↔ 实现同口径 = ADR-0189 顶部「订正（2026-10-23，#756）」横幅。
// - 触控下限 40px = 票 #756 验收标准第 2 条（T3 实测口径）。
// - 间距/字号档位 = packages/app-lynx/tailwind.config.ts 的 spacing / fontSize 档（单一事实源）。
// - 图标尺寸 = packages/app-lynx/src/components/AppIcon.vue 的缺省 size。
// - rpx→vw 换算（750rpx = 屏宽）= docs/adr/glossary-lynx-units.md「换算速查」。
// - i18n 键 = src/i18n/locales/{zh-CN,en}/{pages,misc}.ts 字典实值。
//
// 仓库约定：.vue 不经 vitest 渲染，模板接线以**源级断言**做机器防线
// （对齐 src/pages/novelIntro.template.test.ts / watchLaterEntry.template.test.ts 模式）。
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import zhPages from '../src/i18n/locales/zh-CN/pages'
import enPages from '../src/i18n/locales/en/pages'
import zhMisc from '../src/i18n/locales/zh-CN/misc'
import enMisc from '../src/i18n/locales/en/misc'

const src = (p: string) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), 'utf8')

const rawIntro = src('../src/pages/NovelIntro.vue')
const tailwindSrc = src('../tailwind.config.ts')
const appIconSrc = src('../src/components/AppIcon.vue')
const specSrc = src('../../../docs/specs/app-lynx-novel-intro-action-row.md')
const adr0191Src = src('../../../docs/adr/ADR-0191-lynx-watch-later.md')
const adr0189Src = src('../../../docs/adr/ADR-0189-lynx-novel-intro-action-row.md')

/** 去 HTML 注释与整行行注释（注释里也会提到动作名，断言须落在代码本文上） */
const strip = (s: string) => s.replace(/<!--[\s\S]*?-->/g, '').replace(/^\s*\/\/.*$/gm, '')

/** 宽屏分支（v-if="!narrowViewport"）与极窄屏分支（v-if="narrowViewport"）的源码切片 */
const wideStart = rawIntro.indexOf('v-if="!narrowViewport"')
const narrowStart = rawIntro.indexOf('v-if="narrowViewport"')
const row2Start = rawIntro.indexOf('<!-- Row 2')
const wideBlock = strip(rawIntro.slice(wideStart, narrowStart))
const narrowBlock = strip(rawIntro.slice(narrowStart, row2Start))

/** 单元格身份（靠动作自身的标记串判定，不靠位置猜测） */
function identify(cell: string): string {
  if (cell.includes('<BookmarkButton')) return 'bookmark'
  if (cell.includes('<WatchlistAction')) return 'watch'
  if (cell.includes("novelIntro.actionDownload")) return 'download'
  if (cell.includes("novelIntro.actionSeries")) return 'series'
  if (cell.includes("later.action.add")) return 'later'
  return 'empty'
}

/** 把极窄屏分支解析成「行 → 单元格身份」矩阵（行容器 = flex flex-row items-stretch，格 = flex-1 开头） */
function parseNarrowMatrix(): string[][] {
  const rows = narrowBlock.split('class="flex flex-row items-stretch').slice(1)
  return rows.map((row) => row.split('class="flex-1').slice(1).map(identify))
}

describe('NovelIntro 极窄屏降级分支存在且是**条件渲染**（票 #756 / ADR-0189 spec §12）', () => {
  it('两个互斥分支都由 v-if 驱动（不是「两支都渲染再靠 CSS 隐藏」）', () => {
    expect(rawIntro).toContain('v-if="!narrowViewport"')
    expect(rawIntro).toContain('v-if="narrowViewport"')
    expect(wideStart).toBeGreaterThan(-1)
    expect(narrowStart).toBeGreaterThan(wideStart)
  })

  it('极窄屏分支不得靠 CSS 隐藏（Lynx 里 display/opacity 隐藏不是分支语义）', () => {
    expect(narrowBlock).not.toMatch(/hidden|display:\s*none|opacity-0/)
  })

  it('极窄屏分支是纵向容器（网格行堆叠），宽屏分支是横向单行', () => {
    expect(narrowBlock).toContain('class="mt-4 flex flex-col"')
    expect(wideBlock).toContain('class="mt-4 flex flex-row items-stretch"')
    expect(wideBlock).not.toContain('flex-wrap')
  })

  it('判定阈值与判定口径写在源码里（320dp + SystemInfo 物理像素 ÷ 像素密度）', () => {
    expect(rawIntro).toContain('const NARROW_VIEWPORT_DP = 320')
    expect(rawIntro).toContain('SystemInfo.pixelWidth / SystemInfo.pixelRatio')
    // 判定只取一次快照（Lynx 无响应式视口宽度事件）
    expect(rawIntro).toContain('const narrowViewport = ref(viewportWidthDp() < NARROW_VIEWPORT_DP)')
  })

  it('阈值与降级口径可回溯到 spec §12 风险表与 ADR-0191 D5 后果段（oracle 链接）', () => {
    expect(specSrc).toContain('视口宽 < 320px')
    // spec §12 风险表那一行的降级形态（#756 订正后 = 2 列 × 3 行 + 右下角空占位）
    expect(specSrc).toContain('降级为 **2 列 × 3 行**')
    expect(specSrc).toContain('空位固定右下角')
    expect(adr0191Src).toContain('降级矩阵需在 spec 同步扩容')
  })

  it('ADR-0189 顶部带 #756 订正横幅 ⇒ ADR / spec / 实现三者同口径', () => {
    expect(adr0189Src).toMatch(/订正（2026-10-23，\[#756\]/)
    expect(adr0189Src).toContain('2 列 × 3 行')
  })
})

describe('NovelIntro 极窄屏降级矩阵（2 列 × 3 行，五动作排布 + 留空位）', () => {
  it('矩阵 = 行1[收藏,追更] / 行2[下载,目录] / 行3[稍后看,空]', () => {
    expect(parseNarrowMatrix()).toEqual([
      ['bookmark', 'watch'],
      ['download', 'series'],
      ['later', 'empty'],
    ])
  })

  it('行数 = 3、每行格数 = 2（恒定 2 列，不出现单格行）', () => {
    const matrix = parseNarrowMatrix()
    expect(matrix).toHaveLength(3)
    for (const row of matrix) expect(row).toHaveLength(2)
  })

  it('空位固定在右下角（行3 右列）；追更/目录 缺席时格位恒在（该格即空占位，不出现中间空洞）', () => {
    const matrix = parseNarrowMatrix()
    expect(matrix[2][1]).toBe('empty')
    // 追更格 / 目录格：格位恒在（flex-1 min-w-0 的容器），条件渲染挂在**动作**上
    expect(narrowBlock).toMatch(/<view class="flex-1 min-w-0">\s*<WatchlistAction\s+v-if="novel\.series"/)
    expect(narrowBlock).toMatch(/<view class="flex-1 min-w-0">\s*<ActionButton\s+v-if="novel\.series"/)
    expect((narrowBlock.match(/v-if="novel\.series"/g) ?? []).length).toBe(2)
    // 全分支只有一处「恒空」格位（行3 右列 = 第六格）
    expect((narrowBlock.match(/<view class="flex-1 min-w-0" \/>/g) ?? []).length).toBe(1)
  })

  it('两个分支的 <WatchlistAction> 都带 :key="novel.series.id"（init-only props 的 remount 契约）', () => {
    // WatchlistAction 是 init-only props 组件（setup 一次传入 seriesId / initialAdded）：
    // 没有 :key 时换章节后状态会冻结在首章 ⇒ 两个宿主都必须强制 remount。
    // 极窄屏分支是本轮新增的**第二个宿主**，此前无任何门禁钉这条契约。
    expect(wideBlock).toMatch(/<WatchlistAction[\s\S]{0,200}?:key="novel\.series\.id"/)
    expect(narrowBlock).toMatch(/<WatchlistAction[\s\S]{0,200}?:key="novel\.series\.id"/)
  })

  it('降级分支复用同一套组件与同一批 i18n 键（不新增动作、不新增文案）', () => {
    expect((narrowBlock.match(/<BookmarkButton/g) ?? []).length).toBe(1)
    expect((narrowBlock.match(/<WatchlistAction/g) ?? []).length).toBe(1)
    expect((narrowBlock.match(/<ActionButton/g) ?? []).length).toBe(3)
    // 每个键在两个分支各出现一次（宽屏 + 极窄屏）
    for (const key of [
      "t('novelIntro.actionDownload')",
      "t('novelIntro.actionDownloaded')",
      "t('novelIntro.actionSeries')",
      "t('later.action.add')",
      "t('later.action.added')",
    ]) {
      expect(rawIntro.split(key).length - 1, key).toBe(2)
    }
  })
})

describe('NovelIntro 宽屏分支仍是单行 5 等分（非降级路径不改形态）', () => {
  it('宽屏分支 = 5 个动作槽位（收藏 / 追更 / 下载 / 目录 / 稍后看）', () => {
    expect((wideBlock.match(/<BookmarkButton/g) ?? []).length).toBe(1)
    expect((wideBlock.match(/<WatchlistAction/g) ?? []).length).toBe(1)
    expect((wideBlock.match(/<ActionButton/g) ?? []).length).toBe(3)
  })

  it('宽屏分支仍是等宽 flex-1 单行（不换行、不两列）', () => {
    expect(wideBlock).toContain('class="mt-4 flex flex-row items-stretch"')
    expect(wideBlock).not.toContain('flex-wrap')
    expect(wideBlock).not.toContain('flex-col')
  })
})

describe('NovelIntro 极窄屏降级后的触控目标下限（票 #756 验收口径：≥ 40px）', () => {
  /** spacing 档位取值（vw）：tailwind.config.ts 的 theme.spacing 是间距单一事实源 */
  const spacingBlock = tailwindSrc.slice(
    tailwindSrc.indexOf('spacing: {'),
    tailwindSrc.indexOf('\n    },', tailwindSrc.indexOf('spacing: {')),
  )
  function spacingVw(key: string): number {
    const m = spacingBlock.match(new RegExp(`^\\s*${key}:\\s*'([\\d.]+)vw'`, 'm'))
    if (!m) throw new Error(`tailwind.config.ts 缺 spacing 档位 ${key}`)
    return Number(m[1])
  }

  /** 750rpx = 100vw（docs/adr/glossary-lynx-units.md「换算速查」） */
  const RPX_TO_VW = 100 / 750
  /** label-small 的行高（rpx）：tailwind.config.ts fontSize 四元组 */
  const labelLineHeightVw =
    Number(tailwindSrc.match(/'label-small':\s*\['\d+rpx',\s*\{\s*lineHeight:\s*'(\d+)rpx'/)?.[1]) *
    RPX_TO_VW
  /** 图标缺省尺寸（vw）：components/AppIcon.vue 的 withDefaults 缺省值 */
  const iconSizeVw = Number(appIconSrc.match(/\{ size:\s*([\d.]+),\s*class:\s*''\s*\}/)?.[1])

  /**
   * 动作行可用宽：**只扣 scrim 的 `px-6`**（两侧各扣一次）。
   *
   * ⚠️ **订正（2026-10-23，Spec 轴 Round 2 复核 F2）**：原算式扣了 `px-6 + px-4`
   * （scrim 内边距 + 卡片内边距），但**动作行不是那张卡片的子节点**——
   * `NovelIntro.vue` 的 DOM 是：scrim（`:405` `px-6`）→ 信息卡（`:422` `px-4`，**在 `:501` 就闭合**）
   * → 动作行（`:519` 宽屏 / `:603` 极窄屏）是 **scrim 的直接子节点** ⇒ `px-4` 不参与动作行宽度。
   * 独立验算（真机 UI 树）：300dp 视口下行容器 x=69 w=942px ⇒ 行内宽 261.67dp = **0.87233W**
   * （= 1 − 2×6.400/100），每格 130.8dp；若按旧的 0.78667W 算则应为 118.0dp，**与实测矛盾**。
   * ⇒ 修正后算式**预测值 = 实测值**（130.8dp），旧算式已被实测证伪。
   */
  const padPerSideVw = spacingVw('6')
  /** 可用宽占视口宽的比例 */
  const availableFrac = 1 - (2 * padPerSideVw) / 100
  /** 每格宽（占视口宽的比例）：极窄屏 2 列 / 宽屏 5 等分 */
  const narrowWidthFrac = availableFrac / 2
  const wideWidthFrac = availableFrac / 5
  /** 格高（vw）：图标 + mt-1 + 标签行高 + py-2×2（ActionButton 的盒子） */
  const cellHeightVw = iconSizeVw + spacingVw('1') + labelLineHeightVw + spacingVw('2') * 2

  const narrowCellWidthDp = (w: number) => w * narrowWidthFrac
  const narrowCellHeightDp = (w: number) => (w * cellHeightVw) / 100
  const wideButtonWidthDp = (w: number) => w * wideWidthFrac

  it('极窄屏分支：2 列时每格宽高均 ≥ 40px（320dp 边界与 280dp 现实最窄机型）', () => {
    // 320dp = 分支上边界（视口 < 320 才进本分支，320 是它能达到的最大宽度）
    expect(narrowCellWidthDp(320)).toBeGreaterThanOrEqual(40)
    expect(narrowCellHeightDp(320)).toBeGreaterThanOrEqual(40)
    // 280dp = Galaxy Fold 封面屏等现实最窄机型
    expect(narrowCellWidthDp(280)).toBeGreaterThanOrEqual(40)
    expect(narrowCellHeightDp(280)).toBeGreaterThanOrEqual(40)
  })

  it('触底宽度算式：高度 ≥ 40px ⇔ 视口 ≥ 250dp；宽度维度不是瓶颈', () => {
    // 格高 = 15.99967vw（6.4 + 1.067 + 32rpx→4.26667 + 2×2.133）⇒ 40px 需要视口 ≥ 40 / 0.1599967 ≈ 250dp
    expect(40 / (cellHeightVw / 100)).toBeCloseTo(250, 1)
    // 格宽触底宽度（91.7dp）远低于高度触底宽度 ⇒ 宽度维度先富余
    expect(40 / narrowWidthFrac).toBeLessThan(40 / (cellHeightVw / 100))
  })

  it('宽屏分支在 320dp 处每钮仍 ≥ 40px（宽屏触底宽度 229.36dp < 320dp ⇒ 该分支恒达标）', () => {
    expect(wideButtonWidthDp(320)).toBeGreaterThanOrEqual(40)
    expect(40 / wideWidthFrac).toBeCloseTo(229.36, 1)
    expect(40 / wideWidthFrac).toBeLessThan(320)
  })

  it('漂移报警：三个关键尺寸的具体值（padding/字号档位一旦改动即判红，需复核触底宽度）', () => {
    // 订正（2026-10-23，F2）：可用宽只扣 scrim 的 px-6（不是 px-6 + px-4）⇒ 三值随之订正
    expect(narrowCellWidthDp(320)).toBeCloseTo(139.52, 2)
    expect(narrowCellHeightDp(320)).toBeCloseTo(51.2, 2)
    expect(wideButtonWidthDp(320)).toBeCloseTo(55.81, 2)
  })

  it('算式与真机 UI 树实测一致（300dp 视口：每格 130.8dp，行内宽 261.7dp）', () => {
    // 订正（2026-10-23，F2）：修正后的算式必须**预测出实测值**——旧算式（多扣 px-4）预测 118.0dp，
    // 与实测 130.8dp 矛盾 ⇒ 那正是 F2 的证伪点。
    expect(narrowCellWidthDp(300)).toBeCloseTo(130.8, 1)
    expect(availableFrac * 300).toBeCloseTo(261.6, 1)
  })
})

describe('NovelIntro 五动作的 i18n 键真实存在（双语字典实值）', () => {
  it('zh-CN 五个动作标签键齐备且非空', () => {
    expect(zhMisc['novelIntro.actionWatch']).toBe('追更')
    expect(zhMisc['novelIntro.actionWatched']).toBe('已追更')
    expect(zhMisc['novelIntro.actionDownload']).toBe('下载')
    expect(zhMisc['novelIntro.actionDownloaded']).toBe('已下载')
    expect(zhMisc['novelIntro.actionSeries']).toBe('目录')
    expect(zhPages['later.action.add']).toBe('稍后看')
    expect(zhPages['later.action.added']).toBe('已在稍后看')
  })

  it('en 五个动作标签键齐备且非空', () => {
    expect(enMisc['novelIntro.actionWatch']).toBe('Follow')
    expect(enMisc['novelIntro.actionWatched']).toBe('Following')
    expect(enMisc['novelIntro.actionDownload']).toBe('Download')
    expect(enMisc['novelIntro.actionDownloaded']).toBe('Downloaded')
    expect(enMisc['novelIntro.actionSeries']).toBe('Series')
    expect(enPages['later.action.add']).toBe('Watch Later')
    expect(enPages['later.action.added']).toBe('In Watch Later')
  })

  it('收藏动作不占文字标签位（chip 只显心形 + 计数），故无 i18n 键', () => {
    // BookmarkButton 的 chip = 图标 + 计数文本（无 label 文本）⇒ 矩阵第一格无文案键
    expect(rawIntro).not.toContain('novelIntro.actionBookmark')
  })
})

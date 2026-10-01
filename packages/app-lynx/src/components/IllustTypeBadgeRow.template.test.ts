// IllustTypeBadgeRow 图标守恒门禁（ADR-0208 决策 3 + issue #860 T12 验收第 1 条）。
//
// 锁的真实缺陷：徽标符号（U+25B6+U+FE0E / U+29C9）**写死在 i18n 文案里**。三条后果：
//   ① 图标位没走 <AppIcon>——而 tests/iconMap.test.ts 的零容忍门禁只扫 .vue 模板、
//      显式排除 i18n/，i18n 是它的**结构性盲区**（这正是缺陷能长期存活的缝隙）；
//   ② iconMap 登记的 play_arrow / photo_library 零消费，注释还写着「随 i18n 字典进文案」
//      ——那是在骗人：字典里是 U+25B6/U+29C9，不是这两个码点；
//   ③ U+FE0E 的存在说明踩过「emoji-able 码点被渲染成彩色 emoji」的坑，跨设备一致性无保障。
//
// Oracle 分两层，**都不与被测对象同源**：
//   ① 渲染文本层：用真实 t() 跑镜像的契约真值表（7 例，见下方 CASES；期望徽标集合
//      来自 spec，非实现反推），再与**本文件写死的纯文字期望值**逐字比对；
//   ② 结构层：读组件源码，断言图标位是 <AppIcon>、图标名由 kind → IconName 的
//      satisfies 表解析（禁 as 断言），并复查渲染文本里没有任何图标字形。
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { t } from '../i18n'
import zhMisc from '../i18n/locales/zh-CN/misc'
import enMisc from '../i18n/locales/en/misc'
import { resolveIllustTypeBadges } from './illustTypeBadges'

/**
 * 契约真值表 7 例，**逐行镜像** tests/contract/sharedIllustTypeBadgeCases.ts
 * （期望徽标集合来自 spec docs/specs/work-type-badges.md 决策 1 + ADR-0113 决策 2）。
 * 为什么不 import 那个 fixture：`pnpm check` 的项目是 src/tsconfig.json（只含 src/**），
 * 跨边界 import 会报 TS6307 并让 check 转红——本文件在 src/ 内，故内联并保持逐行同源。
 * 读文本（readFileSync）不算 import，不触发 TS6307，故镜像关系仍可被断言钉住（见
 * 「与共享 fixture 同源」用例）：内联副本与 fixture 一旦分叉就当场转红。
 */
const CASES: { type: string; page_count: number }[] = [
  { type: 'illust', page_count: 1 },
  { type: 'ugoira', page_count: 1 },
  { type: 'manga', page_count: 3 },
  { type: 'illust', page_count: 12 },
  { type: 'ugoira', page_count: 5 },
  { type: 'manga', page_count: 1 },
  { type: 'illust', page_count: 0 },
]

/** 共享 fixture 原文（唯一事实源；本仓 Lynx 侧副本，随 packages/app 删除后为唯一副本） */
const SHARED_FIXTURE_SRC = readFileSync(
  fileURLToPath(new URL('../../tests/contract/sharedIllustTypeBadgeCases.ts', import.meta.url)),
  'utf8',
)

/**
 * 从 fixture 源码抽出输入矩阵 `{ type, page_count }`。
 * 用 `\\s*` 吃掉行内换行——fixture 里有多行书法的行；抽不抽得出直接决定下面的同步
 * 断言是真判据还是恒真（`[] === []` 两种情况同形），故配非空下界 + 点名锚点。
 */
function fixtureInputsOf(source: string): { type: string; page_count: number }[] {
  return [...source.matchAll(/type:\s*"([^"]+)",\s*page_count:\s*(\d+)/g)].map((m) => ({
    type: m[1]!,
    page_count: Number(m[2]),
  }))
}

const src = readFileSync(fileURLToPath(new URL('./IllustTypeBadgeRow.vue', import.meta.url)), 'utf8')
const script = [...src.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]!).join('\n')
const template = src
  .replace(/<script[\s\S]*?<\/script>/g, '')
  .replace(/<style[\s\S]*?<\/style>/g, '')
  .replace(/<!--[\s\S]*?-->/g, '')

/**
 * 图标字形区段（与 tests/iconMap.test.ts 的 GLYPH_BLOCKS 同口径的精简集：
 * 只取「徽标这类行内符号」会落到的区段 + emoji 区，够判「图标又写回文案了」）。
 * 判据按**码点**而非按具体字形——把 ▶ 换成 ▶︎/► 之类变体同样判红。
 */
const GLYPH_RANGES: [number, number][] = [
  [0x2000, 0x2bff], // 通用标点 / 箭头 / 数学 / 几何 / 杂项符号（U+25B6 ▶ 与 U+29C9 ⧉ 都在这段）
  [0xfe00, 0xfe0f], // 变体选择符 VS15–VS18（旧实现的 U+FE0E 就在这里，单独一段因为它不在上一段）
  [0x1f000, 0x1faff], // emoji 区
]
function iconGlyphsOf(text: string): string[] {
  return [...text]
    .filter((ch) => {
      const cp = ch.codePointAt(0)!
      return GLYPH_RANGES.some(([lo, hi]) => cp >= lo && cp <= hi)
    })
    .map((ch) => `U+${ch.codePointAt(0)!.toString(16).toUpperCase()}`)
}

/** 组件里 label 的求值方式（与模板同形：ugoira 用固定串，多图用 count 插值） */
function renderedLabels(illust: { type: string; page_count: number }): string[] {
  return resolveIllustTypeBadges(illust).map((b) =>
    b.kind === 'ugoira'
      ? t('illustTypeBadgeRow.ugoira')
      : t('illustTypeBadgeRow.multiPages', { count: b.pageCount }),
  )
}

describe('IllustTypeBadgeRow · 契约真值表与共享 fixture 同源', () => {
  it('内联 CASES 与 tests/contract/sharedIllustTypeBadgeCases.ts 逐行同源', () => {
    const fromFixture = fixtureInputsOf(SHARED_FIXTURE_SRC)
    // 非空下界 + 点名锚点：没有它们，「抽取器整体失效」与「两边都为空」同形，同步断言会假绿
    expect(fromFixture.length, '从共享 fixture 抽出的输入行数').toBeGreaterThanOrEqual(7)
    expect(fromFixture[0]).toEqual({ type: 'illust', page_count: 1 })
    expect(fromFixture[2]).toEqual({ type: 'manga', page_count: 3 })
    expect(
      CASES,
      '内联 CASES 与 tests/contract/sharedIllustTypeBadgeCases.ts 不同源 ⇒ 下面两条矩阵用例' +
        '跑的是一份与共享事实源无关的私有数据，镜像关系已静默失效。修法：两边同步改。',
    ).toEqual(fromFixture)
  })

  it('反事实：共享 fixture 与内联副本分叉时同一条判据当场转红（证明同步断言不是恒真）', () => {
    const base = fixtureInputsOf(SHARED_FIXTURE_SRC)
    // 前提一：现状确实同源。同一判据先绿，下一句的「红」才说明得了判据有判别力
    expect(base.length, '从共享 fixture 抽出的输入行数').toBeGreaterThanOrEqual(7)
    expect(CASES).toEqual(base)
    // 前提二：抽取器看得见「新增一行」——否则下面的红是因为抽取器坏了，不是判据没判别力
    const extra = '\n  { type: "manga", page_count: 7, expectedBadges: [] },'
    const diverged = fixtureInputsOf(SHARED_FIXTURE_SRC + extra)
    expect(
      diverged,
      '往 fixture 追加一行后抽取器仍只看到原来的行数 ⇒ 同步断言看不见分叉',
    ).toHaveLength(base.length + 1)
    // 缺陷形态原样复现：共享 fixture 多一行、内联副本没跟上 ⇒ 上面那条 toEqual 判据转红
    expect(
      CASES,
      '共享 fixture 多了一行而内联 CASES 没跟上，同一条判据仍判同源 ⇒ 同步断言恒真，无判别力',
    ).not.toEqual(diverged)
  })
})

describe('IllustTypeBadgeRow · 徽标文本（图标不进文案）', () => {
  it('镜像契约真值表全矩阵：渲染文本逐字等于纯文字期望值（期望值写死在本文件，不取自字典）', () => {
    // 7 例矩阵（镜像 tests/contract/sharedIllustTypeBadgeCases.ts）：输入取自契约，
    // 文字期望由本文件的字面量给出。把 "▶︎ " / "⧉ " 塞回字典 ⇒ 下面每一行都转红。
    const EXPECTED: Record<string, string[]> = {
      'illust:1': [],
      'ugoira:1': ['动图'],
      'manga:3': ['3 图'],
      'illust:12': ['12 图'],
      'ugoira:5': ['动图', '5 图'],
      'manga:1': [],
      'illust:0': [],
    }
    const actual: Record<string, string[]> = {}
    for (const c of CASES) {
      actual[`${c.type}:${c.page_count}`] = renderedLabels(c)
    }
    expect(actual, '徽标文本与纯文字期望不符 ⇒ 图标符号又混回 i18n 文案了').toEqual(EXPECTED)
  })

  it('镜像契约真值表全矩阵：渲染文本里没有任何图标字形（码点级判据，挡掉符号变体）', () => {
    for (const c of CASES) {
      for (const [i, label] of renderedLabels(c).entries()) {
        expect(iconGlyphsOf(label), `${c.type}:${c.page_count} 第 ${i + 1} 枚徽标`).toEqual([])
      }
    }
  })

  it('两个 locale 的词条都是纯文字（zh/en 逐字锁定，禁 emoji 或符号前缀）', () => {
    expect(zhMisc['illustTypeBadgeRow.ugoira']).toBe('动图')
    expect(zhMisc['illustTypeBadgeRow.multiPages']).toBe('{{count}} 图')
    expect(enMisc['illustTypeBadgeRow.ugoira']).toBe('Ugoira')
    expect(enMisc['illustTypeBadgeRow.multiPages']).toBe('{{count}} images')
    for (const [localeName, value] of [
      ['zh', zhMisc['illustTypeBadgeRow.ugoira']],
      ['zh', zhMisc['illustTypeBadgeRow.multiPages']],
      ['en', enMisc['illustTypeBadgeRow.ugoira']],
      ['en', enMisc['illustTypeBadgeRow.multiPages']],
    ] as const) {
      expect(iconGlyphsOf(value), `${localeName}: ${value}`).toEqual([])
    }
  })
})

describe('IllustTypeBadgeRow · 图标位结构（图标走 <AppIcon>）', () => {
  it('模板的图标位是 <AppIcon>，文字是裸 label（符号不得拼进文案）', () => {
    expect(template).toContain('<AppIcon :name="b.icon"')
    // chip 内只能有一个 AppIcon + 一个裸 label 文本：`:class` 拼前缀、图标+文字同体都判红
    expect([...template.matchAll(/<AppIcon/g)]).toHaveLength(1)
    expect(template).toMatch(/<text[^>]*>\s*\{\{ b\.label \}\}\s*<\/text>/)
    expect(script).toContain("import AppIcon from './AppIcon.vue'")
  })

  it('模板里不出现任何图标字形（unicode 写法不得回流）', () => {
    expect(iconGlyphsOf(template)).toEqual([])
  })

  it('图标名由 kind → IconName 的 satisfies 表解析：两个 name 逐个钉死', () => {
    expect(script).toMatch(/\n\s{2}ugoira:\s*'play_arrow',\n/)
    expect(script).toMatch(/\n\s{2}multi:\s*'photo_library',\n/)
    // 收口靠 satisfies（漏一种类 / 写错名字 ⇒ 编译期报错），不是 as 断言
    expect(script).toContain("as const satisfies Record<IllustTypeBadgeItem['kind'], IconName>")
    expect(script, '类型收窄不许用 as 断言糊过去').not.toMatch(/\bas\s+(unknown\s+as\s+)?IconName\b/)
    // computed 必须真的查表（表若与 badges 断链，图标名恒为 undefined ⇒ 空白图标）
    expect(script).toContain('icon: BADGE_ICONS[b.kind]')
  })
})

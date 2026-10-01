// ─── PagePickerSheet：表面色调令牌（--md-surface-tint）的真实消费 ───
//
// 依据：issue #857（T09）验收第 2/3 条 —— 「至少一处真实消费表面色调令牌」且
// 「若此前零消费，本票后不再零消费（否则是死代码，应删而非留着）」。
// 缺口背景：ADR-0207 决策 7 复核判据第 5 条要求 `--md-surface-tint` 至少一处消费；
// 此前 `tailwind.config.ts` 登记了 `surface.tint`（能生成 utility），但**渲染侧零消费** ——
// 「能生成」不等于「有人用」，只验前者会得到一条恒绿的假门禁。
//
// 本文件把「能生成」升级为「**产物里有规则 + 模板里有真实 class 属性 + 低透明度合成真的生效**」，
// 并且刻意挡住最容易出现的假消费：**把 700/全强度 tint 当成 bg-primary 的改名**。
//
// ⚠️ 期望值纪律：高度期望值由**真实 tailwind.config.ts 的 spacing 与 title-medium 行高**推导
// （padding + 标题行盒 = 色调层高度），不写死魔数；颜色期望值取自 tokens.css 的令牌名。
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { Config } from 'tailwindcss'

import {
  buildTailwindArtifact,
  projectTailwindConfig,
  tryDeclarationsForClass,
} from '../../tests/helpers/md3TailwindArtifact'

const SOURCE = readFileSync(fileURLToPath(new URL('./PagePickerSheet.vue', import.meta.url)), 'utf8')

/** 去掉 HTML 注释 —— 注释里的类名不是消费（否则「解释为什么用它的注释」会把自己变成消费点） */
function stripHtmlComments(source: string): string {
  return source.replace(/<!--[\s\S]*?-->/g, '')
}

/** 取模板 class 属性值里的类名 token */
function classAttrTokens(source: string): string[] {
  const tokens: string[] = []
  const attr = /(?::class|class)\s*=\s*(["'])([\s\S]*?)\1/g
  let match: RegExpExecArray | null
  while ((match = attr.exec(stripHtmlComments(source))) !== null) {
    for (const token of match[2]!.split(/\s+/)) {
      if (token) tokens.push(token)
    }
  }
  return tokens
}

/** 含指定 token 的那个 class 属性的完整 token 列表（用来判「是否与透明度同层」） */
function classAttrContaining(token: string): string[] {
  const attr = /(?::class|class)\s*=\s*(["'])([\s\S]*?)\1/g
  let match: RegExpExecArray | null
  while ((match = attr.exec(stripHtmlComments(SOURCE))) !== null) {
    const tokens = match[2]!.split(/\s+/).filter(Boolean)
    if (tokens.includes(token)) return tokens
  }
  return []
}

const TEMPLATE = stripHtmlComments(SOURCE)
const TOKENS = classAttrTokens(SOURCE)
const TINT = 'bg-surface-tint'

/** `'4.267vw'` / `'16px'` → px（375 设计稿：1px = 0.2667vw） */
function toPx(value: string): number {
  if (value.endsWith('vw')) return (Number.parseFloat(value) / 100) * 375
  if (value.endsWith('rpx')) return Number.parseFloat(value) / 2
  if (value.endsWith('px')) return Number.parseFloat(value)
  throw new Error(`未识别的长度单位：${value}`)
}

describe('PagePickerSheet 真实消费表面色调令牌（--md-surface-tint）', () => {
  it('色调 utility 出现在模板的真实 class 属性里（不是只出现在注释里）', () => {
    expect(TOKENS, '模板 class 属性里没有色调 utility ⇒ 令牌仍是零消费的死代码').toContain(TINT)
  })

  it('色调层是低透明度合成，不是 bg-primary 的改名', () => {
    // 防「假消费」：--md-surface-tint 与 --md-primary 在 tokens.css 全部色板里取值完全相同，
    // 若不加透明度直接铺满，这个 class 就只是 bg-primary 换了个名字，MD3「用色调表达层级」
    // 的意图一点没实现。故要求同一元素上必须带 opacity-*。
    const layer = classAttrContaining(TINT)
    expect(layer, '找不到承载色调 utility 的元素').not.toEqual([])
    expect(
      layer.some((t) => t === 'opacity-[0.08]' || /^opacity-/.test(t)),
      `色调层缺少透明度合成：${layer.join(' ')} —— 全强度 tint 等于 bg-primary 改名`,
    ).toBe(true)
  })

  it('色调与透明度两个 utility 在真实构建产物里都产出规则（不是死类名）', async () => {
    const artifact = await buildTailwindArtifact([TINT, 'opacity-[0.08]'])
    expect(tryDeclarationsForClass(artifact, TINT), '色调 utility 无规则').toBeDefined()
    expect(tryDeclarationsForClass(artifact, 'opacity-[0.08]'), '透明度 utility 无规则').toBeDefined()
  })

  it('反事实：把 surface.tint 从颜色档位摘掉，色调 utility 必须失去规则', async () => {
    // 证明上一条有判别力：若删掉令牌登记后规则仍在，则该断言恒绿。
    // 注意 `colors` 挂在 `theme.extend` 下（顶层只有 spacing/fontSize 等），改错层级会静默无效。
    const real = projectTailwindConfig()
    const extend = real.theme?.extend as Record<string, unknown>
    const colors = extend.colors as Record<string, Record<string, unknown>>
    const { tint: _tint, ...surfaceWithoutTint } = colors.surface
    const artifact = await buildTailwindArtifact([TINT], {
      // 这里**故意**构造一份被改坏的配置来驱动反事实。宽成 Record<string, unknown>
      // 的 extend 与 Tailwind 的 RecursiveKeyValuePair 不兼容，所以在**构造点**一次性
      // 收敛回 Config['theme']，而不是去改 helper 的类型（helper 服务多个调用方）。
      theme: {
        ...real.theme,
        extend: { ...extend, colors: { ...colors, surface: surfaceWithoutTint } },
      } as Config['theme'],
    })
    expect(
      tryDeclarationsForClass(artifact, TINT),
      '摘掉 tint 档位后规则仍在 ⇒ 上一条断言恒绿',
    ).toBeUndefined()
  })

  it('反事实：把透明度从色调层去掉，本接缝必须判红', () => {
    // 合成一条「未做透明度处理」的假层，验证「改名检测」真的会拦
    const fake = classAttrTokens('<template><view class="bg-surface-tint" /></template>')
    const layer = fake.filter((t) => t === TINT)
    expect(layer).toEqual([TINT])
    expect(layer.some((t) => /^opacity-/.test(t)), '改名检测没生效').toBe(false)
  })

  it('色调层高度由「面板内边距 + 标题档位行高」推导，不是随手写的魔数', () => {
    const config = projectTailwindConfig()
    const spacing = config.theme?.spacing as Record<string, string>
    const fontSize = config.theme?.fontSize as Record<string, [string, { lineHeight: string }]>

    // 面板 p-4 + 标题 text-title-medium 的行盒（1sp = 2rpx = 1dp，见 AGENTS.md 单位换算）
    const expectedPx = toPx(spacing['4']!) + toPx(fontSize['title-medium']![1].lineHeight)
    const expectedVw = (expectedPx / 375) * 100

    const height = classAttrContaining(TINT).find((t) => t.startsWith('h-['))
    expect(height, '色调层没有显式高度').toBeDefined()
    expect(Number.parseFloat(height!.slice(3, -1))).toBeCloseTo(expectedVw, 2)
  })

  it('色调层不吃点击，且不依赖已失效的点击穿透 utility', async () => {
    // pointer-events-none 在本 preset 下不产出任何规则（实测），写了也是死类名 ⇒ 静默失效。
    // 交互正确性改由 DOM 顺序保证：色调层必须排在头部行**之前**。
    const layer = classAttrContaining(TINT)
    expect(
      layer,
      '色调层依赖 pointer-events-none，而该 utility 在本 preset 下无规则 ⇒ 静默吞点击',
    ).not.toContain('pointer-events-none')

    const layerIndex = TEMPLATE.indexOf(TINT)
    const headerIndex = TEMPLATE.indexOf('t(\'pagePicker.title\')')
    expect(layerIndex, '找不到色调层').toBeGreaterThan(-1)
    expect(headerIndex, '找不到头部行').toBeGreaterThan(-1)
    expect(
      layerIndex,
      '色调层必须排在头部行之前 —— 后画的头部行才会压在其上并优先吃点击',
    ).toBeLessThan(headerIndex)

    // 同一事实用产物再验一次：那个 utility 确实无规则（所以不能靠它）
    const artifact = await buildTailwindArtifact(['pointer-events-none'])
    expect(tryDeclarationsForClass(artifact, 'pointer-events-none')).toBeUndefined()
  })

  it('色调层是面板的首个子元素（裸区 tap 仍冒泡到面板的 @tap.stop，防穿透语义不变）', () => {
    const panel = TEMPLATE.indexOf('@tap.stop')
    const layer = TEMPLATE.indexOf(TINT)
    const header = TEMPLATE.indexOf('t(\'pagePicker.title\')')
    expect(panel, '找不到底部面板').toBeGreaterThan(-1)
    expect(layer).toBeGreaterThan(panel)
    expect(layer).toBeLessThan(header)
  })
})

// ─── EmptyState.vue 结构契约（ADR-0194 / T1 #748；先例 M3SegmentedButton.template.test.ts）───
// 仓库无 vue-lynx 渲染器（vitest node 环境）——沿用「模板源码断言」约定。
// 本文件锁：三段式结构（icon/title/hint）、关键类串（三段字号/间距/色 token 逐字）、
// 组件零文案零 CJK（hardcode-gate 面不变，spec D4）、组件不发 i18n（noDeadKeys 面不变）。
//
// 期望值出处（Oracle 溯源）：迁移前 13 处存量空态逐 class 快照（Following/NovelList/
// Bookmarks×2/UserHome×2/MuteTags/FollowList/Ranking/Notifications/Watchlist/DownloadManager/
// IllustList）——三行结构完全同构，仅图标名与文案不同。
//
// 图标位契约（ADR-0208 决策 2/3，2026-09 迁移）：`icon` 由字形串改为 **IconName**
// （utils/iconMap.ts ICON_CODEPOINTS 的键），字形由 `<AppIcon>` 查表渲染。IconName 的
// 定义源（= ICON_CODEPOINTS 键联合）从 iconMap.ts 读取，不从本组件反推。
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const src = readFileSync(fileURLToPath(new URL('./EmptyState.vue', import.meta.url)), 'utf8')
/** IconName / 缺省字号的定义源（独立于被测组件，避免拿组件现状当期望值） */
const iconMapSrc = readFileSync(fileURLToPath(new URL('../utils/iconMap.ts', import.meta.url)), 'utf8')
const appIconSrc = readFileSync(fileURLToPath(new URL('./AppIcon.vue', import.meta.url)), 'utf8')
/** 去 HTML 注释与行/块注释（约束说明本身会提到被禁止的串，负向断言必须在代码本文上做） */
const code = src
  .replace(/<!--[\s\S]*?-->/g, '')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '')

describe('EmptyState 公开接口（icon + title + hint 三 props，spec D4）', () => {
  it('props：icon 必填且为 IconName（非字形串），title / hint 必填 string', () => {
    // IconName = ICON_CODEPOINTS 键联合（ADR-0208 决策 2），定义源在 utils/iconMap.ts
    expect(iconMapSrc).toMatch(/export type IconName = keyof typeof ICON_CODEPOINTS/)
    expect(code).toMatch(/icon\s*:\s*IconName/)
    expect(code).toMatch(/title\s*:\s*string/)
    expect(code).toMatch(/hint\s*:\s*string/)
    // 反向锁：icon 不得退回 string（传私用区码点会被默认字体静默渲染成空白 = 禁静默降级）
    expect(code).not.toMatch(/icon\s*:\s*string/)
    // 类型来源可追溯：IconName 从 utils/iconMap 引入，不是本地另立一套
    expect(code).toMatch(/import type \{ IconName \} from '\.\.\/utils\/iconMap'/)
  })

  it('组件零 i18n：不 import t、模板无 t( 调用（文案全部调用方注入）', () => {
    expect(code).not.toMatch(/from '\.\.\/i18n'/)
    expect(code).not.toMatch(/\bt\(/)
  })

  it('组件零 CJK 字符（代码本文不含汉字——文案由调用方经 i18n 传入，hardcode-gate 面不变）', () => {
    expect(code).not.toMatch(/[一-鿿]/)
  })
})

describe('EmptyState 三段结构（存量 13 处逐 class 快照）', () => {
  it('根容器：flex flex-col items-center（页面级居中包裹留在调用方）', () => {
    expect(code).toMatch(/<view class="flex flex-col items-center">/)
  })

  it('图标段：AppIcon 渲染位 :size="10.667"（vw 单位） + class text-outline-variant（巨字描边色）', () => {
    // ADR-0208 决策 3：图标位只给「图标名 + 尺寸 + 配色」，字形由 <AppIcon> 查 ICON_CODEPOINTS 渲染。
    // 尺寸 10.667 = 迁移前 text-[10.667vw] 的同一数值（AppIcon :size 的单位恒为 vw，见下方事实源断言）。
    expect(code).toContain('<AppIcon :name="icon" :size="10.667" class="text-outline-variant" />')
    // :size 单位恒为 vw（AppIcon 内 `${size}vw`）——与 ADR-0086 禁 rem 一致
    expect(appIconSrc).toContain('`${props.size}vw`')
    // leading-none 由 AppIcon 内部自带（原 text 类上的 leading-none 随迁移下沉），本组件不重复声明
    expect(appIconSrc).toContain('class="leading-none"')
    expect(code).not.toMatch(/<text[^>]*leading-none[^>]*>\s*\{\{\s*icon\s*\}\}/)
  })

  it('标题段：text-body-large text-surface-on mt-3', () => {
    expect(code).toContain('<text class="text-body-large text-surface-on mt-3">{{ title }}</text>')
  })

  it('提示段：text-body-medium text-surface-on-variant mt-1.5', () => {
    expect(code).toContain(
      '<text class="text-body-medium text-surface-on-variant mt-1.5">{{ hint }}</text>',
    )
  })

  it('三段顺序：AppIcon → title → hint（间距递进 mt-3 / mt-1.5）', () => {
    const i = code.indexOf('<AppIcon :name="icon"')
    const t = code.indexOf('{{ title }}')
    const h = code.indexOf('{{ hint }}')
    expect(i).toBeGreaterThanOrEqual(0)
    expect(i).toBeLessThan(t)
    expect(t).toBeLessThan(h)
  })
})

describe('EmptyState 禁手写 scoped CSS / 边界（防 characterization 漂移）', () => {
  it('组件无 <style> 块（app-lynx Tailwind utility 硬性约定）', () => {
    expect(code).not.toContain('<style')
  })

  it('组件不感知三态链与页面布局（无 v-if / w-full / flex-1 布局类——包裹层留调用方）', () => {
    expect(code).not.toMatch(/v-if|v-else/)
    expect(code).not.toMatch(/w-full|flex-1|min-h-0/)
  })
})

// ─── EmptyState.vue 结构契约（ADR-0194 / T1 #748；先例 M3SegmentedButton.template.test.ts）───
// 仓库无 vue-lynx 渲染器（vitest node 环境）——沿用「模板源码断言」约定。
// 本文件锁：三段式结构（icon/title/hint）、关键类串（三段字号/间距/色 token 逐字）、
// 组件零文案零 CJK（hardcode-gate 面不变，spec D4）、组件不发 i18n（noDeadKeys 面不变）。
//
// 期望值出处（Oracle 溯源）：迁移前 13 处存量空态逐 class 快照（Following/NovelList/
// Bookmarks×2/UserHome×2/MuteTags/FollowList/Ranking/Notifications/Watchlist/DownloadManager/
// IllustList）——三行结构完全同构，仅 icon 字形与文案不同。
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const src = readFileSync(fileURLToPath(new URL('./EmptyState.vue', import.meta.url)), 'utf8')
/** 去 HTML 注释与行/块注释（约束说明本身会提到被禁止的串，负向断言必须在代码本文上做） */
const code = src
  .replace(/<!--[\s\S]*?-->/g, '')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '')

describe('EmptyState 公开接口（icon + title + hint 三 props，spec D4）', () => {
  it('props：icon / title / hint 全部必填 string（图标是文本字形非资源）', () => {
    expect(code).toMatch(/icon\s*:\s*string/)
    expect(code).toMatch(/title\s*:\s*string/)
    expect(code).toMatch(/hint\s*:\s*string/)
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

  it('图标段：text-[10.667vw] leading-none text-outline-variant（巨字描边色）', () => {
    expect(code).toMatch(
      /<text class="text-\[10\.667vw\] leading-none text-outline-variant">\{\{ icon \}\}<\/text>/,
    )
  })

  it('标题段：text-body-large text-surface-on mt-3', () => {
    expect(code).toContain('<text class="text-body-large text-surface-on mt-3">{{ title }}</text>')
  })

  it('提示段：text-body-medium text-surface-on-variant mt-1.5', () => {
    expect(code).toContain(
      '<text class="text-body-medium text-surface-on-variant mt-1.5">{{ hint }}</text>',
    )
  })

  it('三段顺序：icon → title → hint（间距递进 mt-3 / mt-1.5）', () => {
    const i = code.indexOf('{{ icon }}')
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

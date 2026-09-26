// ─── FeedListFooter.vue 结构契约（ADR-0194 / T1 #748；先例 M3SegmentedButton.template.test.ts）───
// 仓库无 vue-lynx 渲染器（vitest node 环境）——沿用「模板源码断言」约定。
// 本文件锁：三态互斥渲染顺序（loading → 重试错误 → 纯文本错误 → end）、三态关键类串逐字、
// 重试事件上抛（loadMore 决策留调用方）、组件零 i18n 文案、list-item 边界（外层留页）。
//
// 期望值出处（Oracle 溯源）：迁移前 11 处存量列表尾逐 class 快照——
//   标准组 = Following/IllustList/NovelList/Bookmarks×2/UserHome×2/Watchlist/Notifications
//   （loading/error/end 纯文本三段）；重试组 = Ranking（错误 + retry 并排可点）；
//   单态组 = FollowList（仅 loading）。
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const src = readFileSync(fileURLToPath(new URL('./FeedListFooter.vue', import.meta.url)), 'utf8')
/** 去 HTML 注释与行/块注释（约束说明本身会提到被禁止的串，负向断言必须在代码本文上做） */
const code = src
  .replace(/<!--[\s\S]*?-->/g, '')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '')

describe('FeedListFooter 公开接口（loading/error/end 三态 props + retry 上抛，spec D5）', () => {
  it('props：loading / end 布尔可选，error / loadingText / endText / retryText 字符串可选', () => {
    expect(code).toMatch(/loading\?\s*:\s*boolean/)
    expect(code).toMatch(/error\?\s*:\s*string/)
    expect(code).toMatch(/end\?\s*:\s*boolean/)
    expect(code).toMatch(/loadingText\?\s*:\s*string/)
    expect(code).toMatch(/endText\?\s*:\s*string/)
    expect(code).toMatch(/retryText\?\s*:\s*string/)
  })

  it('重试事件上抛：defineEmits retry；组件不 import router / api（loadMore 留调用方）', () => {
    expect(code).toMatch(/defineEmits<\{\s*\(e:\s*'retry'\):\s*void\s*\}>/)
    expect(code).toContain("emit('retry')")
    expect(code).not.toContain("'../router'")
    expect(code).not.toContain("'../api")
  })

  it('组件零 i18n：不 import t、模板无 t( 调用（文案全部调用方注入）', () => {
    expect(code).not.toMatch(/from '\.\.\/i18n'/)
    expect(code).not.toMatch(/\bt\(/)
  })

  it('组件不渲染 list-item（外层 list-item 保留在各页——原生 list 只认 list-item 子节点）', () => {
    expect(code).not.toContain('<list-item')
    expect(code).not.toContain('full-span')
  })
})

describe('FeedListFooter 三态互斥渲染（存量类串逐字）', () => {
  it('渲染顺序：loading → 重试错误 → 纯文本错误 → end（v-if / v-else-if 链）', () => {
    const iLoading = code.indexOf('v-if="loading"')
    const iRetry = code.indexOf('v-else-if="error && retryText"')
    const iError = code.indexOf('v-else-if="error"')
    const iEnd = code.indexOf('v-else-if="end"')
    expect(iLoading).toBeGreaterThanOrEqual(0)
    expect(iLoading).toBeLessThan(iRetry)
    expect(iRetry).toBeLessThan(iError)
    expect(iError).toBeLessThan(iEnd)
  })

  it('加载中：text-body-medium text-outline（标准组/FollowList 单态组逐字）', () => {
    expect(code).toMatch(
      /<text v-if="loading" class="text-body-medium text-outline">\{\{ loadingText \}\}<\/text>/,
    )
  })

  it('重试形态（Ranking 先例）：错误 + retryText 并排于可点 view，text-error / text-primary ml-2', () => {
    expect(code).toMatch(
      /<view v-else-if="error && retryText" class="flex flex-row items-center" @tap="emit\('retry'\)">\s*<text class="text-body-medium text-error">\{\{ error \}\}<\/text>\s*<text class="text-body-medium text-primary ml-2">\{\{ retryText \}\}<\/text>\s*<\/view>/,
    )
  })

  it('纯文本错误（缺省形态）：text-body-medium text-error，不可点（不给存量页凭空加热区）', () => {
    expect(code).toMatch(
      /<text v-else-if="error" class="text-body-medium text-error">\{\{ error \}\}<\/text>/,
    )
  })

  it('到底：text-body-medium text-outline', () => {
    expect(code).toMatch(
      /<text v-else-if="end" class="text-body-medium text-outline">\{\{ endText \}\}<\/text>/,
    )
  })

  it('互斥由 v-if/v-else-if 链保证（无平铺多态并渲）', () => {
    expect((code.match(/v-else-if=/g) ?? []).length).toBe(3)
    expect((code.match(/v-if=/g) ?? []).length).toBe(1)
  })
})

describe('FeedListFooter 禁手写 scoped CSS / 无行为冗余', () => {
  it('组件无 <style> 块（app-lynx Tailwind utility 硬性约定）', () => {
    expect(code).not.toContain('<style')
  })

  it('不内置防抖/计时器逻辑（三态纯展示，翻页防抖留各页 loadMore）', () => {
    expect(code).not.toMatch(/setTimeout|Date\.now|onUnmounted/)
  })
})

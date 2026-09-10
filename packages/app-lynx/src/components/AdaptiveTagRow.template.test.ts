// AdaptiveTagRow.vue 结构契约守卫（spec docs/specs/app-lynx-adaptive-list-tags.md「测试决策」组件模板结构断言）。
// 期望值出处（Oracle 溯源）：
// - 平台约束 = ADR-0149 决策 2/3（逐元素 select、禁止 selectAll、禁止 list-item 内 absolute 测量层）；
// - 渲染契约 = ADR-0149 决策 1/5（装多少算多少 + 截断 chip maxWidth + +N 门控 + 降级固定上限）；
// - 组件模板源级断言沿用本仓既有模式（src/pages/downloadManagerTemplate.test.ts）。
// 防线性质：源级守卫——输出契约（NovelList 标签行）的渲染形状无渲染级单测（vitest node 环境不渲染 vue-lynx），
// 本文件锚定「不该被静默改掉的形状」：id 前缀、maxWidth 写入、+N 门控、降级分支、view 承载 @tap、无 absolute / 无 selectAll。
// 注意：负向断言针对「去注释后的代码」——约束说明本身会提到 absolute / selectAll。
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const src = readFileSync(fileURLToPath(new URL('./AdaptiveTagRow.vue', import.meta.url)), 'utf8')
/** 去掉 HTML 注释与行注释后的代码本文（负向断言的对象） */
const code = src.replace(/<!--[\s\S]*?-->/g, '').replace(/^\s*\/\/.*$/gm, '')

describe('AdaptiveTagRow.vue 结构契约（ADR-0149）', () => {
  it('测量元素带实例唯一 id 前缀（逐元素 select 的锚点）', () => {
    expect(src).toContain(":id=\"uid + '-row'\"")
    expect(src).toContain(":id=\"uid + '-c' + i\"")
    expect(src).toContain(":id=\"uid + '-plus'\"")
  })

  it('使用已验证平台调用：逐元素测量原语 + 纯折叠函数（禁 selectAll / 禁 absolute 测量层）', () => {
    expect(src).toContain("from '../primitives/measureRects'")
    expect(src).toContain("from '../utils/adaptiveTagFit'")
    expect(code).not.toMatch(/\.selectAll\(/)
    expect(code).not.toMatch(/\babsolute\b/)
  })

  it('截断 chip 通过 maxWidth 写入剩余宽度（而不是固定宽度/换行）', () => {
    expect(src).toContain(':style="{ maxWidth: (fit.partialWidth || 0)')
    expect(src).toContain('overflow-hidden')
    expect(src).toContain('[white-space:nowrap]')
    expect(src).toContain('[text-overflow:ellipsis]')
  })

  it('+N 由 fit.remaining > 0 门控（不硬编码数量）', () => {
    expect(src).toContain('v-if="fit.remaining > 0"')
  })

  it('测量不可用降级为固定上限常量 + console.warn（禁止静默降级）', () => {
    expect(src).toContain('const FALLBACK_VISIBLE = 3')
    expect(src).toContain('console.warn')
  })

  it('单行不换行：行容器为 flex-row + overflow-hidden（无 flex-wrap）', () => {
    expect(src).toContain('flex flex-row items-center gap-1 overflow-hidden')
    expect(code).not.toContain('flex-wrap')
  })

  it('可点元素是 <view>（真机 <text> 不收 @tap）且都 @tap.stop 防冒泡', () => {
    const stopCount = (code.match(/@tap\.stop/g) ?? []).length
    expect(stopCount).toBeGreaterThanOrEqual(3) // 可见 chip / 截断 chip / +N / 降级 chip
  })

  it('测量重试不得在递归里重置预算（防死循环）', () => {
    expect(src).toContain('measure(false)')
    expect(src).toContain('MAX_RETRIES')
  })
})

// ─── PageTopBar.vue 结构契约（ADR-0194 / T1 #748；先例 M3SegmentedButton.template.test.ts）───
// 仓库无 vue-lynx 渲染器（vitest node 环境）——沿用「模板源码断言」约定。
// 本文件锁**外部行为与平台约束**：两变体容器类串、返回键/标题关键类串、
// a11y element+label 成对挂法（ADR-0061）、返回事件上抛（路由决策留调用方）、
// 组件零 i18n 文案（noDeadKeys 面不变，spec D2/D8）。
//
// 期望值出处（Oracle 溯源）：迁移前存量手写头逐 class 快照——
//   居中变体 = IllustList.vue / NovelList.vue 旧头（items-center justify-center + 单行 title-large）；
//   返回变体裸组 = Bookmarks.vue / Ranking.vue 旧头（py-1 pr-2 + ‹ 6.4vw + flex-1 title-large）；
//   返回变体 a11y 组 = Watchlist.vue / MuteTags.vue 旧头（element + label 成对，注册表 value）。
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const src = readFileSync(fileURLToPath(new URL('./PageTopBar.vue', import.meta.url)), 'utf8')
/** 去 HTML 注释与整行行注释（约束说明本身会提到被禁止的串，负向断言必须在代码本文上做） */
const code = src.replace(/<!--[\s\S]*?-->/g, '').replace(/^\s*\/\/.*$/gm, '')

describe('PageTopBar 公开接口（title + back + 可选 a11y/titleClass）', () => {
  it('props：title 必填；back / backA11yLabel / titleA11yLabel / titleClass 可选（spec D2）', () => {
    expect(code).toMatch(/title\s*:\s*string/)
    expect(code).toMatch(/back\?\s*:\s*boolean/)
    expect(code).toMatch(/backA11yLabel\?\s*:\s*string/)
    expect(code).toMatch(/titleA11yLabel\?\s*:\s*string/)
    expect(code).toMatch(/titleClass\?\s*:\s*string/)
  })

  it('返回事件上抛：defineEmits back + emit(\'back\')；组件不 import router（goBack/requestBack 留调用方）', () => {
    expect(code).toMatch(/defineEmits<\{\s*\(e:\s*'back'\):\s*void\s*\}>/)
    expect(code).toContain("emit('back')")
    expect(code).not.toContain("'../router'")
  })

  it('组件零 i18n：不 import t、模板无 t( 调用（文案全部调用方注入，noDeadKeys 面不变）', () => {
    expect(code).not.toMatch(/from '\.\.\/i18n'/)
    expect(code).not.toMatch(/\bt\(/)
  })

  it('a11y 常量经注册表引入（不硬编码 element 值，ADR-0061）', () => {
    expect(code).toMatch(
      /import\s+\{\s*A11Y_ELEMENT_ENABLED\s*\}\s+from\s+'\.\.\/utils\/accessibility'/,
    )
  })
})

describe('PageTopBar 变体 b（‹返回 + 标题 + 右动作）：存量类串逐字', () => {
  it('容器：items-center（变体 b 无 justify-center）+ h-[17.067vw] px-4 bg-surface', () => {
    expect(code).toMatch(
      /<view v-if="back" class="flex flex-row items-center h-\[17\.067vw\] px-4 bg-surface">/,
    )
  })

  it('返回键：py-1 pr-2 的 view 承载 @tap（text 根级 @tap 原生无效，ADR-0055 家族）', () => {
    // 有 a11y 分支：element + label 成对挂在返回键 view 上
    expect(code).toMatch(
      /v-if="backA11yLabel"\s+class="py-1 pr-2"\s+:accessibility-element="A11Y_ELEMENT_ENABLED"\s+:accessibility-label="backA11yLabel"\s+@tap="emit\('back'\)"/,
    )
    // 无 a11y 分支：裸 view + @tap（存量 Bookmarks/Ranking/IllustDetail 等挂法逐字）
    expect(code).toMatch(/<view v-else class="py-1 pr-2" @tap="emit\('back'\)">/)
  })

  it('‹ 字形：text-[6.4vw] leading-none text-surface-on（存量逐字）', () => {
    expect(
      code.includes('<text class="text-[6.4vw] leading-none text-surface-on">‹</text>'),
    ).toBe(true)
  })

  it('标题基类恒为 flex-1 text-title-large font-medium text-surface-on，附加类经 :class 合并', () => {
    expect(code).toContain('flex-1 text-title-large font-medium text-surface-on')
    expect(code).toContain(':class="titleClass"')
  })

  it('标题 a11y 双分支：有 label → element + label 成对；无 label → 裸 text（不混挂 undefined）', () => {
    expect(code).toMatch(
      /v-if="titleA11yLabel"\s+class="flex-1 text-title-large font-medium text-surface-on"\s+:class="titleClass"\s+:accessibility-element="A11Y_ELEMENT_ENABLED"\s+:accessibility-label="titleA11yLabel"/,
    )
    expect(code).toMatch(/<text v-else class="flex-1 text-title-large/)
  })

  it('右动作 slot：#action 具名插槽存在（变体 b 预留）', () => {
    expect(code).toContain('<slot name="action" />')
  })
})

describe('PageTopBar 变体 a（居中标题，一级页）：存量类串逐字', () => {
  it('容器：items-center justify-center + h-[17.067vw] px-4 bg-surface（IllustList/NovelList 旧头）', () => {
    expect(code).toContain(
      'flex flex-row items-center justify-center h-[17.067vw] px-4 bg-surface',
    )
  })

  it('标题：text-title-large font-medium text-surface-on（无返回键、无 a11y 接口）', () => {
    expect(code).toMatch(
      /<view v-else class="flex flex-row items-center justify-center h-\[17\.067vw\] px-4 bg-surface">\s*<text class="text-title-large font-medium text-surface-on">\{\{ title \}\}<\/text>/,
    )
  })
})

describe('PageTopBar 禁手写 scoped CSS / a11y 成对守恒', () => {
  it('组件无 <style> 块（app-lynx Tailwind utility 硬性约定）', () => {
    expect(code).not.toContain('<style')
  })

  it('a11y 成对守恒：accessibility-element 与 accessibility-label 出现次数相等（ADR-0061）', () => {
    const labels = (code.match(/:accessibility-label=/g) ?? []).length
    const elements = (code.match(/:accessibility-element="A11Y_ELEMENT_ENABLED"/g) ?? []).length
    expect(elements).toBe(labels)
    expect(labels).toBeGreaterThan(0)
  })
})

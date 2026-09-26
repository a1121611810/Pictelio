// ─── SubTabBar.vue 结构契约（ADR-0194 / T1 #748；先例 M3SegmentedButton.template.test.ts）───
// 仓库无 vue-lynx 渲染器（vitest node 环境）——沿用「模板源码断言」约定。
// 本文件锁**外部行为与平台约束**：受控接口（items + modelValue + change）、
// 选中态指示条类串逐字（真机验证过的写法，spec D3 红线）、组件零 i18n 文案。
//
// 期望值出处（Oracle 溯源）：迁移前存量手写 tab 条逐 class 快照——
//   IllustList.vue / NovelList.vue / Bookmarks.vue / UserHome.vue 四页同构：
//   容器 border-b-[1px] border-b-outline-variant + bg-surface-container-lowest；
//   段 flex-1 h-[12.8vw]；选中 text-primary border-b-[0.8vw] border-b-primary；未选 text-outline。
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const src = readFileSync(fileURLToPath(new URL('./SubTabBar.vue', import.meta.url)), 'utf8')
/** 去 HTML 注释与行/块注释（约束说明本身会提到被禁止的串，负向断言必须在代码本文上做） */
const code = src
  .replace(/<!--[\s\S]*?-->/g, '')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '')

describe('SubTabBar 公开接口（items + modelValue + change 三件套，spec D3）', () => {
  it('SFC 泛型签名 generic="K extends string"（key 枚举类型安全，M3SegmentedButton 同范式）', () => {
    expect(code).toContain('generic="K extends string"')
  })

  it('SubTabItem 契约两字段（key / label）；导出经独立 script 块（script-setup 禁 export，ADR-0116）', () => {
    expect(code).toMatch(/export interface SubTabItem<K extends string>/)
    expect(code).toMatch(/key\s*:\s*K/)
    expect(code).toMatch(/label\s*:\s*string/)
    // setup 块内不得出现 export（接口定义在独立 <script lang="ts"> 块）
    const setupBlock = /<script setup[^>]*>([\s\S]*?)<\/script>/.exec(src)![1]!
    expect(setupBlock).not.toMatch(/export\s/)
  })

  it('受控：modelValue 为 prop（不持有选中态）；change 事件上抛 key（非 defineModel 自写回）', () => {
    expect(code).toMatch(/modelValue\s*:\s*K/)
    expect(code).toMatch(/defineEmits<\{\s*\(e:\s*'change',\s*key:\s*K\):\s*void\s*\}>/)
    expect(code).not.toContain('defineModel')
  })

  it('组件零 i18n：不 import t、模板无 t( 调用（文案全部调用方注入）', () => {
    expect(code).not.toMatch(/from '\.\.\/i18n'/)
    expect(code).not.toMatch(/\bt\(/)
  })
})

describe('SubTabBar 选中态指示条类串（真机验证写法逐字保留，spec D3 红线）', () => {
  it('选中段类串精确 = text-primary border-b-[0.8vw] border-b-primary（0.8vw 指示条）', () => {
    expect(code).toMatch(
      /props\.modelValue === item\.key \? 'text-primary border-b-\[0\.8vw\] border-b-primary' : 'text-outline'/,
    )
  })

  it('未选段类串精确 = text-outline', () => {
    expect(code).toContain(": 'text-outline'")
  })

  it('容器：border-b-[1px] border-b-outline-variant + bg-surface-container-lowest（存量逐字）', () => {
    expect(code).toContain(
      'flex flex-row border-b-[1px] border-b-outline-variant bg-surface-container-lowest',
    )
  })

  it('段：flex-1 h-[12.8vw] flex items-center justify-center（40dp 段高）', () => {
    expect(code).toContain('flex-1 h-[12.8vw] flex items-center justify-center')
  })

  it('段标签 text-title-small font-medium；段 @tap 经 select(item.key) 上抛（事件绑 view 不绑 text）', () => {
    expect(code).toContain('<text class="text-title-small font-medium">{{ item.label }}</text>')
    expect(code).toContain('@tap="select(item.key)"')
  })

  it('v-for :key 绑枚举值 item.key（段与 key 一一对应）', () => {
    expect(code).toMatch(/:key="item\.key"/)
  })
})

describe('SubTabBar 禁手写 scoped CSS / 无多余接口（防 characterization 漂移）', () => {
  it('组件无 <style> 块（app-lynx Tailwind utility 硬性约定）', () => {
    expect(code).not.toContain('<style')
  })

  it('不导出 disabled / icon 等未声明 prop（四页存量均无此形态，YAGNI 防 drift）', () => {
    expect(code).not.toMatch(/\bdisabled\?\s*:/)
    expect(code).not.toMatch(/\bicon\b\s*:/)
  })
})

// Me 页「小说先进介绍页」开关行模板结构测试（ticket #714 / T3，spec docs/specs/lynx-novel-intro-toggle.md §设置 UI）
// oracle：spec「设置 UI」条目（内容组新行 + 行级 @tap 翻转 + M3Switch + a11y 注册表 + 双语 i18n 键）与 ADR-0183。
// lynx 惯例：模板结构用源码断言（meWebdavTemplate.test.ts / src/pages/*.template.test.ts 同模式 readFileSync+toContain），
// 行为语义（store setter / 入口缝隙）由 settingsStore 与 novelIntroEntryGuards 测试覆盖，不在本文件重复。
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { ME_A11Y_LABELS } from '../src/utils/accessibility'
import zhPages from '../src/i18n/locales/zh-CN/pages'
import enPages from '../src/i18n/locales/en/pages'

const src = (p: string) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), 'utf8')
const meVue = src('../src/pages/Me.vue')
const accessibility = src('../src/utils/accessibility.ts')
const zhPagesSource = src('../src/i18n/locales/zh-CN/pages.ts')
const enPagesSource = src('../src/i18n/locales/en/pages.ts')

/** 双语字典值逐字快照（ticket #714 文案定稿，渲染产物 oracle） */
const ZH = {
  'me.content.novelIntroFirst': '小说先进介绍页',
  'me.content.novelIntroFirstDesc': '关闭后，点击小说将直接进入正文',
} as const
const EN = {
  'me.content.novelIntroFirst': 'Show novel intro first',
  'me.content.novelIntroFirstDesc': 'When off, tapping a novel goes straight to the text',
} as const

describe('Me 页「小说先进介绍页」开关行（spec §设置 UI / ADR-0183）', () => {
  it('storeToRefs 解构 + 翻转函数接线（settings.setNovelIntroFirst 单点持久化）', () => {
    expect(meVue).toMatch(/const \{[^}]*\bnovelIntroFirst\b[^}]*\} = storeToRefs\(settings\)/)
    expect(meVue).toContain('function toggleNovelIntroFirst()')
    expect(meVue).toContain('settings.setNovelIntroFirst(!novelIntroFirst.value)')
  })

  it('内容组开关行：行级 @tap + a11y 标注 + M3Switch（ADR-0179 组件）+ 标题/描述两行式', () => {
    expect(meVue).toContain(':accessibility-label="ME_A11Y_LABELS.novelIntroFirstToggle"')
    expect(meVue).toContain('@tap="toggleNovelIntroFirst"')
    expect(meVue).toMatch(/<M3Switch\s+:checked="novelIntroFirst"/)
    expect(meVue).toContain("t('me.content.novelIntroFirst')")
    expect(meVue).toContain("t('me.content.novelIntroFirstDesc')")
  })

  it('a11y 注册表登记 novelIntroFirstToggle 且被 Me.vue 消费（注册表完整性约定）', () => {
    expect(ME_A11Y_LABELS.novelIntroFirstToggle).toBe('小说先进介绍页开关')
    expect(accessibility).toContain('novelIntroFirstToggle')
    expect(meVue).toContain('ME_A11Y_LABELS.novelIntroFirstToggle')
  })

  it('i18n 双语落盘：zh-CN 与 en 均含标题 + 描述两键（字典导入断言值，源码断言键在盘）', () => {
    expect(zhPages['me.content.novelIntroFirst']).toBe(ZH['me.content.novelIntroFirst'])
    expect(zhPages['me.content.novelIntroFirstDesc']).toBe(ZH['me.content.novelIntroFirstDesc'])
    expect(enPages['me.content.novelIntroFirst']).toBe(EN['me.content.novelIntroFirst'])
    expect(enPages['me.content.novelIntroFirstDesc']).toBe(EN['me.content.novelIntroFirstDesc'])
    expect(zhPagesSource).toContain('"me.content.novelIntroFirst"')
    expect(zhPagesSource).toContain('"me.content.novelIntroFirstDesc"')
    expect(enPagesSource).toContain('"me.content.novelIntroFirst"')
    expect(enPagesSource).toContain('"me.content.novelIntroFirstDesc"')
  })
})

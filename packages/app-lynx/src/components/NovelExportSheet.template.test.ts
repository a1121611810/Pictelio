// ─── NovelExportSheet.vue 结构契约（spec docs/specs/novel-export.md §3.1/§7.2）───
// 期望值出处（Oracle 溯源）：
// - 9 种格式白名单 + 标签 = spec §3.1 的真实字面量（下方 SPEC_FORMATS 手写 oracle，
//   与共享包 NOVEL_EXPORT_FORMATS 交叉比对，不从被测模板反推）；
// - 面板语义 = app 端 ExportSheet.tsx（双端同语义差分对齐，spec §7.1/§7.2）；
// - 挂载契约 = CommentOverlay.vue（遮罩 + absolute 面板 + modalStack 注册）。
// 防线性质：仓库无 vue-lynx 渲染器（vitest node 环境），本文件是**源级守卫**——锚定
// 「不该被静默改掉的形状」：9 格式全量迭代、选中态 M3 chip 类、确认 emit 选中格式、
// 打开时重置默认格式、modalStack 挂载/注销、无 scoped CSS / 无 rem。
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  NOVEL_EXPORT_FORMATS,
  NOVEL_EXPORT_FORMAT_LABELS,
  type NovelExportFormat,
} from '@pictelio/novel-export'
import zhMisc from '../i18n/locales/zh-CN/misc'

const src = readFileSync(fileURLToPath(new URL('./NovelExportSheet.vue', import.meta.url)), 'utf8')
/** 去 HTML 注释与行注释后的代码本文（负向断言对象：约束说明本身会提到目标串） */
const code = src.replace(/<!--[\s\S]*?-->/g, '').replace(/^\s*\/\/.*$/gm, '')

/** 9 格式真实字面量（spec §3.1，独立于被测实现的手写 oracle） */
const SPEC_FORMATS = ['txt', 'html', 'md', 'docx', 'pdf', 'epub', 'rtf', 'json', 'fb2'] as const

describe('NovelExportSheet.vue 结构契约（spec §3.1/§7.2）', () => {
  it('格式白名单 = spec §3.1 的 9 个字面量且与共享包一致（oracle 溯源）', () => {
    expect([...NOVEL_EXPORT_FORMATS]).toEqual([...SPEC_FORMATS])
    for (const fmt of SPEC_FORMATS) {
      expect(NOVEL_EXPORT_FORMAT_LABELS[fmt as NovelExportFormat]).toBeTruthy()
    }
  })

  it('格式 chip 迭代全部 9 种格式 + 标签取共享注册表（不硬编码子集）', () => {
    expect(src).toContain('v-for="fmt in NOVEL_EXPORT_FORMATS"')
    expect(src).toContain('NOVEL_EXPORT_FORMAT_LABELS[fmt]')
  })

  it('选中态用 M3 chip 类（同 Me.vue 导出格式）：secondary-container vs surface-container-lowest', () => {
    expect(src).toContain(
      "selected === fmt ? 'bg-secondary-container border-secondary-container' : 'bg-surface-container-lowest border-outline'",
    )
  })

  it('确认按钮 emit 本次选中格式（临时覆盖，不写回全局）', () => {
    expect(src).toContain("emit('export', selected.value)")
    expect(src).toContain("emit('close')")
  })

  it('每次打开重置为设置页默认格式', () => {
    expect(src).toContain('selected.value = props.defaultFormat')
  })

  it('遮罩 + 面板 + modalStack 挂载契约（CommentOverlay 同款，返回键优先关面板）', () => {
    expect(src).toContain('absolute inset-0 bg-scrim')
    expect(src).toContain('@tap.stop')
    expect(src).toContain('useModalStack().registerModal')
    expect(src).toContain('unregisterModal?.()')
  })

  it('内容摘要为只读（不调用设置 setter）+ 提示在设置页修改', () => {
    // #511 补抽：摘要行走 computed + contentSummary key（{{metadata}}/{{cover}}/{{inlineImages}} 插值），
    // 开/关走 stateOn/stateOff；zh 字典值 = 存量文案逐字快照（渲染产物不变，oracle：迁移前模板字面量）
    expect(zhMisc['novelExportSheet.contentSummary']).toBe(
      '正文（必含） · 元数据 {{metadata}} · 封面 {{cover}} · 正文插图 {{inlineImages}}',
    )
    expect(zhMisc['novelExportSheet.stateOn']).toBe('开')
    expect(zhMisc['novelExportSheet.stateOff']).toBe('关')
    expect(src).toContain("t('novelExportSheet.contentSummary'")
    expect(src).toContain('t(\'novelExportSheet.stateOn\') : t(\'novelExportSheet.stateOff\')')
    expect(src).toContain('{{ contentSummary }}')
    // 设置页指引：t(key) 调用形态 + zh 值逐字节不变
    expect(zhMisc['novelExportSheet.contentHint']).toBe('内容开关在设置页「导出」中修改')
    expect(src).toContain("t('novelExportSheet.contentHint')")
    expect(code).not.toContain('setNovelExport')
  })

  it('无 scoped CSS、无 rem 单位（web-core 约束）', () => {
    expect(code).not.toContain('<style')
    expect(code).not.toMatch(/\b\d*\.?\d+rem\b/)
  })

  it('每处 accessibility-label 都配套 accessibility-element（ADR-0061）', () => {
    const labels = (code.match(/accessibility-label=/g) ?? []).length
    const elements = (code.match(/accessibility-element=/g) ?? []).length
    expect(labels).toBeGreaterThanOrEqual(3)
    expect(elements).toBe(labels)
  })
})

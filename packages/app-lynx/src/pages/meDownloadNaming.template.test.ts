// Me 页下载命名区块模板结构测试（ADR-0192 D9 / spec docs/specs/lynx-download-naming.md D6/D9；T5 #750）
// oracle：spec D9 字段清单（模板输入行 + 预览回显 + 一键恢复默认 + 作者目录开关行）
// + D6「非法输入回落默认 + 可见提示（禁静默回落）」。
// lynx 惯例：模板结构用源码断言（meWebdavTemplate.test.ts 同模式），行为语义由
// galleryDownload 纯函数矩阵与 settingsStore 单测覆盖。
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { ME_A11Y_LABELS } from '../utils/accessibility'
import {
  buildSaveFileNameFromTemplate,
  DEFAULT_DOWNLOAD_TEMPLATE,
  normalizeDownloadTemplate,
} from '../utils/galleryDownload'
import zhPages from '../i18n/locales/zh-CN/pages'

const meVue = readFileSync(fileURLToPath(new URL('./Me.vue', import.meta.url)), 'utf8')

/** zh 字典值 = 本批新增文案快照（渲染产物 oracle；后续改写须显式更新此处并说明） */
const NAMING_ZH: Record<string, string> = {
  'me.download.templateLabel': '命名模板',
  'me.download.templateHint': '占位符：{id} 作品ID、{title} 标题、{author} 作者、{p} 多页页号（单页不出现）',
  'me.download.templatePlaceholder': 'Pictelio_{id}',
  'me.download.templatePreview': '示例：{{value}}',
  'me.download.templateReset': '恢复默认',
  'me.download.templateFallbackHint': '模板为空或非法，已恢复默认命名',
  'me.download.authorDir': '按作者建目录',
  'me.download.authorDirDesc': '开启后保存的图片按作者名归入子目录',
}

describe('Me 页下载命名区块（spec D9）', () => {
  it('文案 i18n：zh 字典值逐字快照（防静默改写）', () => {
    for (const [key, legacy] of Object.entries(NAMING_ZH)) {
      expect(zhPages[key as keyof typeof zhPages], key).toBe(legacy)
    }
  })

  it('模板输入行：i18n 键、净化预览回显、一键恢复默认齐备', () => {
    expect(meVue).toContain("t('me.download.templateLabel')")
    expect(meVue).toContain("t('me.download.templateHint')")
    expect(meVue).toContain(`:placeholder="t('me.download.templatePlaceholder')"`)
    // 预览回显：t('me.download.templatePreview', { value: templatePreview })
    expect(meVue).toContain("t('me.download.templatePreview', { value: templatePreview })")
    expect(meVue).toContain('resetTemplate')
  })

  it('提交双通道：@input 逐键持久化（不回写）+ @confirm 键盘确认回写净化值', () => {
    expect(meVue).toContain('@input="commitTemplate(false)"')
    expect(meVue).toContain('@confirm="commitTemplate(true)"')
    // 净化持久化走 settingsStore setter（v-model 直改 ref 不落盘防线，M1 同款）
    expect(meVue).toContain('settings.setDownloadFileTemplate(templateInput.value)')
  })

  it('D6 非法输入回落默认 + 可见提示（禁静默回落）：fallback 提示行受 templateFallbackHint 控制', () => {
    expect(meVue).toContain('templateFallbackHint.value = settings.setDownloadFileTemplate')
    expect(meVue).toContain("v-if=\"templateFallbackHint\"")
    expect(meVue).toContain("t('me.download.templateFallbackHint')")
  })

  it('作者目录开关行：M3Switch + 设备级 setter（ADR-0179 范式）', () => {
    expect(meVue).toContain("t('me.download.authorDir')")
    expect(meVue).toContain("t('me.download.authorDirDesc')")
    expect(meVue).toContain(':checked="downloadByAuthorDir"')
    expect(meVue).toContain('settings.setDownloadByAuthorDir(!downloadByAuthorDir.value)')
  })

  it('a11y：两个新交互元素经 ME_A11Y_LABELS 注册表消费（unit.test.ts 完整性守卫的本地锚）', () => {
    expect(ME_A11Y_LABELS.downloadTemplateReset).toBe('恢复命名模板默认值')
    expect(ME_A11Y_LABELS.downloadAuthorDirToggle).toBe('按作者建目录开关')
    expect(meVue).toContain(':accessibility-label="ME_A11Y_LABELS.downloadTemplateReset"')
    expect(meVue).toContain(':accessibility-label="ME_A11Y_LABELS.downloadAuthorDirToggle"')
  })

  it('预览样例行为：默认模板展开 = Pictelio_12345678.jpg（spec D6 示例，逐字节）', () => {
    // Me.vue 内 TEMPLATE_PREVIEW_CTX 的同构样例（单页、样例 id 12345678）
    const preview = buildSaveFileNameFromTemplate(
      normalizeDownloadTemplate(DEFAULT_DOWNLOAD_TEMPLATE).value,
      { id: 12345678, title: 'Sample', author: 'Author', page: 0, pageCount: 1 },
      'https://i.pximg.net/img-original/12345678_p0.jpg',
    )
    expect(preview).toBe('Pictelio_12345678.jpg')
    expect(meVue).toContain("id: 12345678, title: 'Sample', author: 'Author', page: 0, pageCount: 1")
  })

  it('预览样例零硬编码 CDN URL（AGENTS.md 红线：HTML/CSS/JS 禁 i.pximg.net）：中性示例串 + 显式扩展名', () => {
    // 预览 URL 仅用于 extForUrl 扩展名推断，中性 'sample.jpg' 即可（ext 推断 = jpg），
    // 展开结果与真实 URL 形状逐字节一致
    expect(meVue).not.toContain('i.pximg.net')
    expect(meVue).toContain("const TEMPLATE_PREVIEW_URL = 'sample.jpg'")
  })
})

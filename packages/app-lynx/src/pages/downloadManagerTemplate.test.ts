// ─── DownloadManager.vue 模板 a11y 标注完整性（spec docs/specs/download-manager.md §7.2）───
// 期望值来源（Oracle 溯源）：DOWNLOAD_A11Y_LABELS 注册表 + 仓库 a11y 契约（ADR-0061：
// 可点 view 需 accessibility-element + accessibility-label 才进 Lynx accessibility 树）。
// 防线性质：源级守卫（防「登记了 label 却漏标注 / 绕过注册表硬编码 label」回归）。
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve, dirname } from 'node:path'
import { DOWNLOAD_A11Y_LABELS } from '../utils/accessibility'

const src = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), 'DownloadManager.vue'),
  'utf-8',
)

describe('DownloadManager.vue a11y 标注完整性', () => {
  it('注册表 label 非空且唯一', () => {
    const labels = Object.values(DOWNLOAD_A11Y_LABELS)
    expect(labels.length).toBeGreaterThan(0)
    for (const l of labels) expect(l.length).toBeGreaterThan(0)
    expect(new Set(labels).size).toBe(labels.length)
  })

  it('每个注册表 key 都被模板消费', () => {
    for (const key of Object.keys(DOWNLOAD_A11Y_LABELS)) {
      expect(src).toContain(`:accessibility-label="DOWNLOAD_A11Y_LABELS.${key}"`)
    }
  })

  it('label 与 element 数量守恒（view 默认不进 a11y 树）', () => {
    const labels = (src.match(/:accessibility-label=/g) ?? []).length
    const elements = (src.match(/:accessibility-element="A11Y_ELEMENT_ENABLED"/g) ?? []).length
    expect(elements).toBe(labels)
  })

  it('危险操作与确认文案字面锚定', () => {
    expect(DOWNLOAD_A11Y_LABELS.pageTitle).toBe('下载管理')
    expect(DOWNLOAD_A11Y_LABELS.confirmDeleteFiles).toBe('删除文件与记录')
    expect(DOWNLOAD_A11Y_LABELS.confirmDeleteRecords).toBe('仅清空记录')
  })
})

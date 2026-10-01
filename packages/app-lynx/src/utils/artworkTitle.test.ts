// 作品标题归一化（#893）
//
// 期望值出处（测试硬约束 #6，oracle 独立溯源）：
// - 占位文案 = i18n 词典的 `artworkTitle.untitled` 键值，**不在此抄副本**
//   （抄副本即同义反复：断言 A==B 而 B 是 A 的抄本）。另单独断言该键**非空**，
//   否则「返回空串」也能让相等断言通过。
// - 哨兵串 = Pixiv API 的逐字返回「no title」，依据见 issue #893 的真机取证。
import { describe, it, expect } from 'vitest'
import { artworkTitle } from './artworkTitle'
import { t } from '../i18n'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const PLACEHOLDER = t('artworkTitle.untitled')

describe('作品标题归一化（#893）', () => {
  it('占位文案取自 i18n 词典且非空（防止「返回空串」骗过相等断言）', () => {
    expect(PLACEHOLDER.length).toBeGreaterThan(0)
    const zh = readFileSync(
      fileURLToPath(new URL('../i18n/locales/zh-CN/misc.ts', import.meta.url)),
      'utf8',
    )
    const en = readFileSync(
      fileURLToPath(new URL('../i18n/locales/en/misc.ts', import.meta.url)),
      'utf8',
    )
    // 两语种都必须真的登记了这个键（en 侧另有 satisfies 编译期配平，这里补运行时可见性）
    expect(zh).toContain('"artworkTitle.untitled"')
    expect(en).toContain('"artworkTitle.untitled"')
  })

  it('API 哨兵串 "no title" ⇒ 本地化占位（本票要修的那一条）', () => {
    expect(artworkTitle('no title')).toBe(PLACEHOLDER)
  })

  it('空 / 全空白 / null / undefined ⇒ 本地化占位', () => {
    for (const raw of ['', '   ', '\n\t ', null, undefined]) {
      expect(artworkTitle(raw)).toBe(PLACEHOLDER)
    }
  })

  it('真实标题原样返回（仅去首尾空白）', () => {
    expect(artworkTitle('葬送的芙莉莲')).toBe('葬送的芙莉莲')
    expect(artworkTitle('  2026光古戦場  ')).toBe('2026光古戦場')
    expect(artworkTitle('no title but longer')).toBe('no title but longer')
  })

  it('大小写敏感是刻意的：用户自己的 "No Title" 不得被误判为占位', () => {
    // 反向判据：若哪天有人把匹配改成小写折叠，这条会红。
    // 理由：把**有标题**的作品显示成「无标题」比漏掉一个哨兵更坏。
    expect(artworkTitle('No Title')).toBe('No Title')
    expect(artworkTitle('NO TITLE')).toBe('NO TITLE')
    // 阳性对照：证明「小写折叠」这个更宽松的判据确实会误伤 —— 说明本用例不是恒真
    const loose = (s: string) => s.trim().toLowerCase() === 'no title'
    expect(loose('No Title')).toBe(true) // 宽松判据误伤
    expect(artworkTitle('No Title')).not.toBe(PLACEHOLDER) // 本实现不误伤
  })
})

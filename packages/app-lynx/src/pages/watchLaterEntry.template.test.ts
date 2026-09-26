// 稍后看（WatchLater）双入口接线契约（ADR-0191 D5 / #751 T3；源级守卫，对齐
// IllustDetail.template.test.ts / novelIntro.template.test.ts 模式——.vue 不经
// vitest 渲染，模板接线以源级断言做机器防线，仓库「模板/源码断言」约定）。
// 期望值出处（Oracle 溯源）：
// - toggle + 已加入态高亮 + 快照零新增请求 = ADR-0191 D5 / spec D6
// - @tap.stop 防卡片导航误触 = #751 T3 验收行（TagPressChip 防冒泡同款惯例）
// - 时钟字形 VS15（U+FE0E 强制 text presentation）= ADR-0112 平台事实（裸 ♥ 实证）
// - i18n 键前缀 later.* + 双字典消费 = spec D9（术语红线：禁 watchlist 词根）
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const illustSrc = readFileSync(fileURLToPath(new URL('./IllustDetail.vue', import.meta.url)), 'utf8')
const introSrc = readFileSync(fileURLToPath(new URL('./NovelIntro.vue', import.meta.url)), 'utf8')
/** 去 HTML 注释与整行行注释（约束说明会提到目标串，断言须落在代码本文上） */
const strip = (s: string) => s.replace(/<!--[\s\S]*?-->/g, '').replace(/^\s*\/\/.*$/gm, '')
const illust = strip(illustSrc)
const intro = strip(introSrc)

describe('IllustDetail 稍后看入口（ADR-0191 D5）', () => {
  it('消费 useWatchLaterStore + toIllustSnapshot（快照从已有 illust 构造，零新增请求）', () => {
    expect(illust).toContain('useWatchLaterStore()')
    const fn = illust.match(/function toggleWatchLater\(\): void \{[\s\S]*?\n\}/)?.[0] ?? ''
    expect(fn).toContain('const i = illust.value')
    expect(fn).toContain('watchLater.toggle(toIllustSnapshot(i))')
    // toggle 路径零网络请求（不触发详情/ugoira 元数据加载）
    expect(fn).not.toContain('loadDetail')
    expect(fn).not.toContain('loadUgoiraMetadata')
  })

  it('已加入态高亮跟随 has()：text-tertiary ↔ text-outline 随 laterAdded 翻转', () => {
    expect(illust).toContain("watchLater.has('illust', illustId.value)")
    expect(illust).toMatch(/:class="laterAdded \? 'text-tertiary' : 'text-outline'"/)
    expect((illust.match(/laterAdded \? 'text-tertiary' : 'text-outline'/g) ?? []).length).toBe(2) // 字形 + 文字标签
  })

  it('点击 toggle 生效且 @tap.stop 防冒泡（防卡片导航误触）', () => {
    expect(illust).toContain('@tap.stop="toggleWatchLater"')
  })

  it('文案走 later.* 双态键（added / add）', () => {
    expect(illust).toContain("t('later.action.added')")
    expect(illust).toContain("t('later.action.add')")
  })

  it('时钟字形带 VS15（U+FE0E 强制 text presentation，ADR-0112 平台事实）', () => {
    // 字形单一事实源经 utils/watchLaterGlyph 导入（VS15 依据由 watchLaterGlyph 单测钉住）
    expect(illust).toContain("import { LATER_ICON } from '../utils/watchLaterGlyph'")
    expect(illust).toContain('{{ LATER_ICON }}')
  })
})

describe('NovelIntro 稍后看入口（ADR-0191 D5：动作行第五动作）', () => {
  /** 锚定 @tap.stop 包裹块内的第五动作（避免跨 sibling 组件的松散 span 断言） */
  const laterBlock = intro.match(/<view class="flex-1 min-w-0" @tap\.stop>[\s\S]*?<\/view>/)?.[0] ?? ''

  it('第五动作存在：ActionButton + LATER_ICON + toggle 接线', () => {
    expect(laterBlock).toContain('<ActionButton')
    expect(laterBlock).toContain(':icon="LATER_ICON"')
    expect(laterBlock).toContain('@tap="toggleWatchLater"')
  })

  it('已加入态高亮跟随 has()（active → text-tertiary，与追更/已下载同范式）', () => {
    expect(intro).toContain("watchLater.has('novel', novelId.value)")
    expect(laterBlock).toContain(':active="laterAdded"')
  })

  it('@tap.stop 挂包裹 view（裸修饰符）：ActionButton 无载荷 emit 不能承载 .stop', () => {
    expect(laterBlock).toContain('<view class="flex-1 min-w-0" @tap.stop>')
  })

  it('masked 与同行动作一致置灰（ADR-0189 受限态矩阵）', () => {
    expect(laterBlock).toContain(':disabled="masked"')
  })

  it('快照从已有 novel 构造（零新增请求）', () => {
    const fn = intro.match(/function toggleWatchLater\(\): void \{[\s\S]*?\n\}/)?.[0] ?? ''
    expect(fn).toContain('const n = novel.value')
    expect(fn).toContain('watchLater.toggle(toNovelSnapshot(n))')
    expect(fn).not.toContain('loadNovelDetail')
  })

  it('文案走 later.* 双态键（added / add）', () => {
    expect(laterBlock).toContain("t('later.action.added')")
    expect(laterBlock).toContain("t('later.action.add')")
  })

  it('时钟字形带 VS15（U+FE0E 强制 text presentation，ADR-0112 平台事实）', () => {
    // 字形单一事实源经 utils/watchLaterGlyph 导入（VS15 依据由 watchLaterGlyph 单测钉住）
    expect(intro).toContain("import { LATER_ICON } from '../utils/watchLaterGlyph'")
  })
})

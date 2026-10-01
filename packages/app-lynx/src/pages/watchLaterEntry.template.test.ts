// 稍后看（WatchLater）双入口接线契约（ADR-0191 D5 / #751 T3；源级守卫，对齐
// IllustDetail.template.test.ts / novelIntro.template.test.ts 模式——.vue 不经
// vitest 渲染，模板接线以源级断言做机器防线，仓库「模板/源码断言」约定）。
// 期望值出处（Oracle 溯源）：
// - toggle + 已加入态高亮 + 快照零新增请求 = ADR-0191 D5 / spec D6
// - @tap.stop 防卡片导航误触 = #751 T3 验收行（TagPressChip 防冒泡同款惯例）
// - i18n 键前缀 later.* + 双字典消费 = spec D9（术语红线：禁 watchlist 词根）
// - 图标消费契约（IconName 经 AppIcon / ActionButton prop）= ADR-0208 决策 3；
//   「值是图标名而非字形」这一条由 utils/watchLaterGlyph.test.ts 独立钉住，本文件只守接线形态
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

  it('LATER_ICON 经 <AppIcon> 渲染图标名，不作裸文本插值（ADR-0208 决策 3）', () => {
    // T12 收口：LATER_ICON 的值是 **图标名**（'schedule'，IconName），不是字形。
    // 裸 `<text>{{ LATER_ICON }}</text>` 会把字符串 "schedule" 当正文渲染出来——
    // vue-tsc 抓不到（IconName ⊂ string），是纯静默视觉损坏（本仓「禁静默降级」）。
    // Oracle 溯源：ADR-0208 决策 3（图标位一律经 AppIcon）+ utils/watchLaterGlyph.test.ts
    // （钉 LATER_ICON === 'schedule' 且 !/^\u/ —— 「不是字形」由该单测独立承担）。
    expect(illust).toContain("import { LATER_ICON } from '../utils/watchLaterGlyph'")
    expect(illust).toContain('<AppIcon :name="LATER_ICON"')
    // 反向断言：裸插值一旦回流立刻判红（不做减法式放宽）
    expect(illust).not.toContain('{{ LATER_ICON }}')
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

  it('LATER_ICON 经 ActionButton 的 icon prop 传递（IconName，非字形串）', () => {
    // T12 收口：ActionButton.icon 契约已收窄为 IconName，内部走 <AppIcon>；故此处
    // prop 直传即正确消费方式，与 IllustDetail 的裸插值 bug 相对。
    // Oracle：ADR-0208 决策 3 + utils/watchLaterGlyph.test.ts（值是 'schedule'）。
    // 反向断言覆盖**两种绑定写法**（`:icon="'⏱'"` 模板绑定 / `icon: '⏱'` render fn），
    // 只判其一会漏（实测：只写 icon: 形式时模板绑定回流不转红）。
    expect(intro).toContain("import { LATER_ICON } from '../utils/watchLaterGlyph'")
    expect(intro).not.toMatch(/(?::icon|:icon)=?["']["']?\s*[:=]\s*["'][⏱]/)
    expect(intro).not.toContain("'⏱'")
  })
})

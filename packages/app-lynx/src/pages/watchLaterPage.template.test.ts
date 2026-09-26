// 稍后看列表页模板接线契约（ADR-0191 D5 / #753 T4；源级守卫，对齐
// watchLaterEntry.template.test.ts 模式——.vue 不经 vitest 渲染，模板接线以源级断言做机器防线，
// 仓库「模板/源码断言」约定）。
// 期望值出处（Oracle 溯源）：
// - 本地全量渲染、无分页无列表尾 = ADR-0191 D5 / spec D7（列表数据是本地同步快照，零网络依赖）
// - 点击进实时详情：插画 `/illust/:id`（Bookmarks/IllustList 同款惯例）、小说走 openNovel seam
//   （novel_intro_first 设置生效，spec D7）
// - 快照卡不渲染 RestrictOverlay = ADR-0191 D5（快照无完整作品数据，不可靠判定受限态）
// - 时钟字形 VS15（U+FE0E 强制 text presentation）= ADR-0112 平台事实（与详情入口同字形）
// - a11y 注册表成对消费 = unit.test.ts WATCHLIST 守卫同款（ADR-0061 element + label 成对）
// - 术语红线（glossary 易混辨析 #1）：全链路 later / watchLater 命名，禁 watchlist 词根
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const pageSrc = readFileSync(fileURLToPath(new URL('./WatchLater.vue', import.meta.url)), 'utf8')
const routerSrc = readFileSync(fileURLToPath(new URL('../router.ts', import.meta.url)), 'utf8')
const a11ySrc = readFileSync(fileURLToPath(new URL('../utils/accessibility.ts', import.meta.url)), 'utf8')

/** 去 HTML 注释与整行行注释（约束说明会提到目标串，断言须落在代码本文上） */
const strip = (s: string) => s.replace(/<!--[\s\S]*?-->/g, '').replace(/^\s*\/\/.*$/gm, '')
const page = strip(pageSrc)

describe('WatchLater.vue 列表页骨架（ADR-0191 D5 / spec D7）', () => {
  it('组件名 watchLater（KeepAlive name 匹配约定；本页无缓存语义，不入 include）', () => {
    expect(pageSrc).toContain("defineOptions({ name: 'watchLater' })")
  })

  it('消费 useWatchLaterStore，列表渲染 store.items（本地快照，零网络请求函数）', () => {
    expect(page).toContain('useWatchLaterStore()')
    // 全量渲染 items：v-for 数据源是 store 本身
    expect(page).toMatch(/v-for="\w+ in (store\.)?items"/)
    // 零网络依赖：页面不 import 任何 api 模块（快照列表决策，spec US12/US13）
    expect(page).not.toMatch(/from '\.\.\/api\//)
  })

  it('本地全量渲染：无分页（scrolltolower / loadMore）且不引入 FeedListFooter（ADR-0191 D5）', () => {
    expect(page).not.toContain('FeedListFooter')
    expect(page).not.toContain('scrolltolower')
    expect(page).not.toContain('loadMore')
  })

  it('PageTopBar 返回变体：title = later.title，返回/标题 a11y 注册表标注，@back = goBack', () => {
    expect(page).toContain('<PageTopBar')
    expect(page).toContain('back')
    expect(page).toContain(`:title="t('later.title')"`)
    expect(page).toContain(':back-a11y-label="WATCH_LATER_A11Y_LABELS.back"')
    expect(page).toContain(':title-a11y-label="WATCH_LATER_A11Y_LABELS.pageTitle"')
    expect(page).toContain('@back="goBack"')
    expect(page).toMatch(/import \{[^}]*goBack[^}]*\} from '\.\.\/router'/)
  })

  it('空态：EmptyState + 时钟字形 VS15（U+FE0E）+ later.empty.* 文案', () => {
    expect(page).toContain('<EmptyState')
    expect(page).toContain("const LATER_ICON = '\\u23F1\\uFE0E'")
    expect(page).toContain(':icon="LATER_ICON"')
    expect(page).toContain(`:title="t('later.empty.title')"`)
    expect(page).toContain(`:hint="t('later.empty.hint')"`)
  })
})

describe('WatchLater.vue 快照卡（行卡字段与交互，spec US5/US10/US6）', () => {
  it('封面：SkeletonImage（列表卡惯例）消费 proxyImageUrl(coverUrl) + 懒加载', () => {
    expect(page).toContain('<SkeletonImage')
    expect(page).toMatch(/:src="proxyImageUrl\(\w+\.coverUrl\)"/)
    expect(page).toContain('lazy-load')
    expect(page).toContain("import { proxyImageUrl } from '../utils/imageUrl'")
  })

  it('标题 [max-line:2] + 作者名渲染', () => {
    expect(page).toMatch(/\[max-line:2\]/)
    expect(page).toMatch(/\{\{ \w+\.title \}\}/)
    expect(page).toMatch(/\{\{ \w+\.userName \}\}/)
  })

  it('WorkKind 徽标：kind 分支消费 later.badge.illust / later.badge.novel 文本 chip', () => {
    expect(page).toContain(`t('later.badge.illust')`)
    expect(page).toContain(`t('later.badge.novel')`)
    expect(page).toMatch(/kind === 'illust'/)
  })

  it('删除按钮存在，@tap.stop 调 store.remove(kind, id)（防卡片导航误触）', () => {
    expect(page).toMatch(/@tap\.stop="store\.remove\(\w+\.kind, \w+\.id\)"/)
    expect(page).toContain(`t('later.remove')`)
  })

  it('行点击导航按 kind 分派：illust → /illust/:id；novel → openNovel（novel_intro_first seam）', () => {
    expect(page).toContain("import { openNovel } from '../utils/novelNavigation'")
    const fn = page.match(/function openItem\(\w+: WatchLaterItem\): void \{[\s\S]*?\n\}/)?.[0] ?? ''
    expect(fn).not.toBe('')
    expect(fn).toMatch(/navigate\(`\/illust\/\$\{\w+\.id\}`\)/)
    expect(fn).toContain('openNovel(')
    expect(fn).toMatch(/kind === 'illust'/)
  })

  it('事件绑内层 view（ADR-0055 家族）：行卡 @tap 在 view 上、非 list-item 根', () => {
    expect(page).toMatch(/<view[^>]*@tap="openItem\(item\)"/)
    // list-item 根只承载 key，不承载事件
    const listItem = page.match(/<list-item[^>]*>/)?.[0] ?? ''
    expect(listItem).not.toContain('@tap')
  })

  it('快照卡零 RestrictOverlay（ADR-0191 D5 裁定）且头注释注明依据', () => {
    expect(page).not.toContain('RestrictOverlay')
    // 头注释（含注释原文）必须注明 ADR-0191 D5 裁定，防未来"补上遮罩"的回潮
    expect(pageSrc).toMatch(/RestrictOverlay[\s\S]{0,120}ADR-0191 D5|ADR-0191 D5[\s\S]{0,120}RestrictOverlay/)
  })
})

describe('WatchLater a11y 注册表（ADR-0061 element + label 成对；unit.test 守卫同款）', () => {
  const registry = /WATCH_LATER_A11Y_LABELS = \{([^}]*)\}/.exec(a11ySrc)?.[1] ?? ''

  it('注册表登记于 accessibility.ts（pageTitle/back/openItem/remove 四键，值非空）', () => {
    expect(registry).not.toBe('')
    for (const key of ['pageTitle', 'back', 'openItem', 'remove']) {
      expect(registry).toContain(key)
    }
    const labels = [...registry.matchAll(/'([^']*)'/g)].map((m) => m[1]!)
    for (const label of labels) expect(label.length).toBeGreaterThan(0)
  })

  it('四键全部被 WatchLater.vue 消费且模板内 element/label 数量配对', () => {
    for (const key of ['pageTitle', 'back', 'openItem', 'remove']) {
      expect(page).toContain(`WATCH_LATER_A11Y_LABELS.${key}`)
    }
    // pageTitle/back 经 PageTopBar a11y prop 消费（组件内部成对），页面直绑的是行卡/删除键
    const labelCount = (page.match(/:accessibility-label="WATCH_LATER_A11Y_LABELS\.\w+"/g) ?? []).length
    const elementCount = (page.match(/:accessibility-element="A11Y_ELEMENT_ENABLED"/g) ?? []).length
    expect(labelCount).toBe(2)
    expect(elementCount).toBe(labelCount)
  })
})

describe('术语红线与路由接线（glossary 易混辨析 #1 / ADR-0191 D6 / ADR-0136）', () => {
  it('WatchLater.vue 全文零 watchlist 词根（大小写不敏感）', () => {
    expect(/watchlist/i.test(pageSrc)).toBe(false)
  })

  it('路由 /later 注册：name watchLater + meta.requiresAuth（真实语义由 router-shim-integration 守卫）', () => {
    const route = routerSrc.match(/\{ path: '\/later'[^}]*\}/)?.[0] ?? ''
    expect(route).toContain("name: 'watchLater'")
    expect(route).toContain('requiresAuth: true')
  })

  it('benchNav 场景 later 注册：pictelioBenchNavLater → /later（ADR-0136 深链验证通道）', () => {
    expect(routerSrc).toContain("pictelioBenchNavLater: '/later'")
  })
})

// 好P友列表页模板接线契约（ADR-0193 D2/D3 / spec docs/specs/lynx-mypixiv.md / #754 T7；
// 源级守卫，对齐 watchLaterPage.template.test.ts 模式——.vue 不经 vitest 渲染，模板接线以
// 源级断言做机器防线，仓库「模板/源码断言」约定）。
// 期望值出处（Oracle 溯源）：
// - 页面 = PageTopBar 返回变体 + RefreshableList + UserRow + FeedListFooter 三态 + EmptyState
//   + deriveFirstLoadView = ADR-0193 D2 / spec D2
// - is_followed 真值渲染不播种（无 FollowList following 列表播种特判）= spec D2
// - toggleFollow 单飞锁 + 服务端成功后翻转 + 失败内联错误条 = spec D2（FollowList 同款）
// - 行点击 → /user/:id、命中区域分离 = spec D2 / 用例矩阵 #6
// - generation 竞态防护（在飞旧响应落地即作废）= spec D3（工作区硬约束）
// - KeepAlive name mypixiv 进白名单（返回不重挂载不重发首载）= spec D3
// - 分页去重 + 双防抖 + 列表尾重试 = spec D3 / US5 / US6（FollowList/Ranking 同款）
// - i18n mypixiv.* 前缀 + 按钮文案共用 followList.* = spec D6；benchNav mypixiv = spec D5
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const pageSrc = readFileSync(fileURLToPath(new URL('./MyPixiv.vue', import.meta.url)), 'utf8')
const routerSrc = readFileSync(fileURLToPath(new URL('../router.ts', import.meta.url)), 'utf8')
const appSrc = readFileSync(fileURLToPath(new URL('../App.vue', import.meta.url)), 'utf8')

/** 去 HTML 注释与块注释与行注释（含行尾 // 注释；约束说明会提到目标串，断言须落在代码本文上） */
const strip = (s: string) =>
  s
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '')
const page = strip(pageSrc)

describe('MyPixiv.vue 页面骨架（ADR-0193 D2 / spec D2/D3）', () => {
  it('组件名 mypixiv 且进 KeepAlive 白名单（返回不重挂载、不重发首载，spec D3）', () => {
    expect(pageSrc).toContain("defineOptions({ name: 'mypixiv' })")
    expect(appSrc).toContain("'mypixiv'")
  })

  it('数据源 getMyPixivUsers + 自账 id 取 authStore.currentUser（userId 来源，spec D3）', () => {
    expect(page).toContain("import { getMyPixivUsers, loadUserListNext" )
    expect(page).toContain('useAuthStore()')
    expect(page).toMatch(/auth\.currentUser\?\.id/)
  })

  it('generation 竞态防护：首载会话代 seq 比对，在飞旧响应落地即作废（spec D3 硬约束）', () => {
    const fn = page.match(/async function fetchFirstPage\(\): Promise<void> \{[\s\S]*?\n\}/)?.[0] ?? ''
    expect(fn).not.toBe('')
    expect(fn).toMatch(/\+\+\w+/) // 每次刷新/重试递增会话代
    expect(fn).toMatch(/seq !== \w+/) // 响应落地时会话代失效检查
  })

  it('is_followed 真值渲染不播种：无 following 列表 undefined→true 播种特判（spec D2）', () => {
    expect(page).toContain(':is-followed="!!item.user.is_followed"')
    // 负向：禁止播种特判（FollowList 对 following 列表的 `is_followed === undefined` 归一
    // 不适用于好P友——双向关系按服务端真值渲染；toggleFollow 的成功后翻转是另一回事）
    expect(page).not.toMatch(/is_followed === undefined/)
    expect(page).not.toMatch(/=== undefined\)[\s\S]{0,40}is_followed = true/)
  })

  it('is_muted 保留透传不过滤（ADR-0193 已否决本地过滤）', () => {
    expect(page).not.toMatch(/is_muted[^\n]*filter|filter[^\n]*is_muted/)
  })

  it('PageTopBar 返回变体：title = mypixiv.title，@back = goBack', () => {
    expect(page).toContain('<PageTopBar')
    expect(page).toContain('back')
    expect(page).toContain(`:title="t('mypixiv.title')"`)
    expect(page).toContain('@back="goBack"')
    expect(page).toMatch(/import \{[^}]*goBack[^}]*\} from '\.\.\/router'/)
  })

  it('首载三态 deriveFirstLoadView：骨架 / 错误重试 / 空态 EmptyState / 内容互斥单链（ADR-0150）', () => {
    expect(page).toContain("import { deriveFirstLoadView } from '../utils/firstLoadView'")
    expect(page).toContain('deriveFirstLoadView(')
    const conditions = page.split('\n').filter((l) => /v-(if|else-if)=/.test(l))
    for (const branch of ["'skeleton'", "'error'", "'empty'"]) {
      expect(conditions.some((l) => l.includes(branch))).toBe(true)
    }
    // 错误态保留重试入口（非 tab 页无全局刷新 FAB，FollowList 同款）
    expect(page).toContain('@tap="fetchFirstPage"')
    // 空态：EmptyState + mypixiv.empty.*（互相关注即可成为好P友提示，spec US9）
    expect(page).toContain('<EmptyState')
    expect(page).toContain(`:title="t('mypixiv.empty.title')"`)
    expect(page).toContain(`:hint="t('mypixiv.empty.hint')"`)
  })

  it('RefreshableList 下拉刷新：幂等 fetchFirstPage + 回顶 epoch 重建（FollowList 同款）', () => {
    expect(page).toContain(':refresh="fetchFirstPage"')
    expect(page).toMatch(/@back-to-top="\w+\+\+"/)
    expect(page).toContain('refreshEpoch')
  })
})

describe('UserRow 行（复用 ADR-0194 组件 / spec D2）', () => {
  it('UserRow 消费：busy 单飞锁传导 + 关注/取关文案共用 followList.*（不另起同义键，spec D6）', () => {
    expect(page).toContain('<UserRow')
    expect(page).toContain(':busy="busyId !== null"')
    expect(page).toContain(`:follow-label="t('followList.follow')"`)
    expect(page).toContain(`:followed-label="t('followList.following')"`)
  })

  it('行导航：头像/昵称区 @row-tap → openUser → /user/:id（与 FollowList 同导航语义）', () => {
    expect(page).toMatch(/@row-tap="openUser\(item\.user\.id\)"/)
    const fn = page.match(/function openUser\(\w+: number\): void \{[\s\S]*?\n\}/)?.[0] ?? ''
    expect(fn).toContain('navigate(`/user/${id}`)')
  })

  it('toggleFollow 单飞锁：busy 互斥防重入 + 服务端成功后翻转（非乐观）+ 失败内联错误条', () => {
    const fn = page.match(/async function toggleFollow\(\w+: PixivUserPreview\): Promise<void> \{[\s\S]*?\n\}/)?.[0] ?? ''
    expect(fn).not.toBe('')
    expect(fn).toContain('if (busyId.value !== null) return')
    expect(fn).toContain('await unfollowUser(user.user.id)')
    expect(fn).toContain('await followUser(user.user.id)')
    // 翻转在 await 之后（服务端成功才翻转，失败状态从未翻转即天然回滚）
    expect(fn.indexOf('await unfollowUser')).toBeLessThan(fn.indexOf('is_followed = false'))
    expect(fn.indexOf('await followUser')).toBeLessThan(fn.indexOf('is_followed = true'))
    expect(fn).toContain("pageErrorMsg.value = t('mypixiv.actionFailed')")
  })

  it('关注/取关失败走顶部内联错误条（pageErrorMsg 槽，不写入三态 errorMsg 静默吞错）', () => {
    const conditions = page.split('\n').filter((l) => /v-if="pageErrorMsg"/.test(l))
    expect(conditions.length).toBe(1)
  })
})

describe('分页（spec US5/US6：滚动加载 + 列表尾重试）', () => {
  it('loadMore：在飞锁 + 双防抖 + 按 user id 去重合并（FollowList 同款）', () => {
    const fn = page.match(/async function loadMore\(\): Promise<void> \{[\s\S]*?\n\}/)?.[0] ?? ''
    expect(fn).not.toBe('')
    expect(fn).toContain('if (!nextUrl.value || loadingMore.value) return')
    expect(fn).toMatch(/lastLoadMoreAt/)
    expect(fn).toMatch(/lastLoadEndedAt/)
    expect(fn).toMatch(/new Set\(\w+\.value\.map\(\(u\) => u\.user\.id\)\)/)
    expect(fn).toMatch(/filter\(\(u\) => !\w+\.has\(u\.user\.id\)\)/)
  })

  it('FeedListFooter 三态：loading / 分页错误重试（retry-text + @retry）/ 到底（Ranking 形态）', () => {
    expect(page).toContain('<FeedListFooter')
    expect(page).toContain(':loading="loadingMore"')
    expect(page).toContain(':error="footerError"')
    expect(page).toContain(':end="endOfFeed"')
    expect(page).toContain(`:retry-text="t('mypixiv.retry')"`)
    expect(page).toContain('@retry="loadMore"')
    // 分页失败写 footerError 槽（列表尾内联，与顶部 pageErrorMsg 分流，spec D3 槽位分离）
    const fn = page.match(/async function loadMore\(\): Promise<void> \{[\s\S]*?\n\}/)?.[0] ?? ''
    expect(fn).toMatch(/footerError\.value = presentError\(/)
  })

  it('事件绑内层 view/组件：list-item 根只承载 key，不承载事件（ADR-0055 家族）', () => {
    const listItem = page.match(/<list-item[^>]*>/)?.[0] ?? ''
    expect(listItem).not.toContain('@tap')
  })
})

describe('i18n 与路由接线（spec D5/D6）', () => {
  it('页面文案全走 mypixiv.* 键（零硬编码 CJK）', () => {
    expect(page).toContain(`t('mypixiv.loadMoreFailed')`)
    expect(page).toContain(`t('mypixiv.footer.loading')`)
    expect(page).toContain(`t('mypixiv.footer.end')`)
    // 零硬编码 CJK（页面源码不含 CJK 字符——文案进双字典；console.warn 诊断串豁免，
    // 与仓库 hardcode-gate.test.ts 的 console.* 豁免同口径）
    const noConsole = page.replace(/console\.\w+\([^\n]*/g, '')
    expect(/[\u4e00-\u9fff\u3040-\u30ff]/.test(noConsole)).toBe(false)
  })

  it('路由 /mypixiv 注册：name mypixiv + meta.requiresAuth（真实语义由 router-shim-integration 守卫）', () => {
    const route = routerSrc.match(/\{ path: '\/mypixiv'[^}]*\}/)?.[0] ?? ''
    expect(route).toContain("name: 'mypixiv'")
    expect(route).toContain('requiresAuth: true')
    expect(route).toContain('MyPixiv')
  })

  it('benchNav 场景 mypixiv 注册：pictelioBenchNavMyPixiv → /mypixiv（ADR-0136 深链验证通道）', () => {
    expect(routerSrc).toContain("pictelioBenchNavMyPixiv: '/mypixiv'")
  })
})

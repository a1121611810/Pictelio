// ─── B 变体 · bleed 路径的行为级测试（#906 / #907）───
//
// 配套 `vitest.bleed.config.ts`（把 `__HOME_BLEED_HEADER__` 翻成 true）。
// 主配置下本文件**不执行** —— 那里宏为 false，bleed 分支是死代码，CI 覆盖不到。
//
// ## 为什么 import 路由表，而不是读源码文本
//
// 第一轮这套用例 7 条里 5 条是 `readFileSync` 文本判据、2 条调与宏无关的纯函数。
// 结果：把宏强制回 false，**6 条照样绿** —— 宏对被执行的代码零影响，
// 「bleed 分支在 CI 跑过」成了**名义覆盖**。第二轮 code-review 判其未达成，正是这条。
//
// 故改为**真正 import 路由表**：`router.ts` 在模块顶层求值
// `__HOME_BLEED_HEADER__ ? 'bleed' : 'self'`，import 即**真实执行**该分支；
// 宏翻回 false 时本文件立刻转红 ⇒ 是行为断言，不是文本断言。
//
// 页面组件用 `vi.mock` 打桩（路由只需 component 引用，不渲染）——
// `tests/router-shim-integration.test.ts` 的既有手法：vitest 未装 vue 插件，
// 真实 `.vue` 无法被解析。⚠️ `vi.mock` 会被提升到模块顶层，**不能写在循环里**。
import { describe, expect, it, vi } from 'vitest'

// ⚠️ 这套 mock 与 `tests/router-shim-integration.test.ts` **同款**（同一份路由表的既有测试手法），
// 少一个导出会直接抛 `No "x" export is defined on the mock`。
vi.mock('../api/client', () => ({
  isNativeMode: () => false,
  getNativeModules: () => undefined,
}))
vi.mock('../stores/authStore', () => ({
  useAuthStore: () => ({
    isLoggedIn: true,
    restoreToken: async () => true,
    registerUnauthorizedHandler: () => {},
    currentUser: null,
    logout: () => {},
  }),
}))
vi.mock('../stores/settingsStore', () => ({
  useSettingsStore: () => ({ loadSettings: async () => {} }),
}))
vi.mock('../stores/watchLaterStore', () => ({
  useWatchLaterStore: () => ({ hydrate: async () => {} }),
}))
vi.mock('../stores/modalStack', () => ({
  useModalStack: () => ({
    hasOpenModal: () => false,
    closeTopModal: () => {},
    registerModal: () => () => {},
  }),
}))
vi.mock('../utils/errorPresentation', () => ({ registerSessionErrorHandler: () => {} }))

vi.mock('../pages/Login.vue', () => ({ default: {} }))
vi.mock('../pages/Recommended.vue', () => ({ default: {} }))
vi.mock('../pages/IllustList.vue', () => ({ default: {} }))
vi.mock('../pages/IllustDetail.vue', () => ({ default: {} }))
vi.mock('../pages/NovelList.vue', () => ({ default: {} }))
vi.mock('../pages/NovelDetail.vue', () => ({ default: {} }))
vi.mock('../pages/NovelIntro.vue', () => ({ default: {} }))
vi.mock('../pages/UserHome.vue', () => ({ default: {} }))
vi.mock('../pages/FollowList.vue', () => ({ default: {} }))
vi.mock('../pages/Following.vue', () => ({ default: {} }))
vi.mock('../pages/Bookmarks.vue', () => ({ default: {} }))
vi.mock('../pages/Me.vue', () => ({ default: {} }))
vi.mock('../pages/Watchlist.vue', () => ({ default: {} }))
vi.mock('../pages/WatchLater.vue', () => ({ default: {} }))
vi.mock('../pages/Notifications.vue', () => ({ default: {} }))
vi.mock('../pages/MyPixiv.vue', () => ({ default: {} }))
vi.mock('../pages/MuteTags.vue', () => ({ default: {} }))
vi.mock('../pages/TagNeighbors.vue', () => ({ default: {} }))
vi.mock('../pages/Ranking.vue', () => ({ default: {} }))
vi.mock('../pages/DownloadManager.vue', () => ({ default: {} }))
vi.mock('../pages/UpdatePage.vue', () => ({ default: {} }))
vi.mock('../pages/ErrorPage.vue', () => ({ default: {} }))
vi.mock('../pages/NetworkCheck.vue', () => ({ default: {} }))
vi.mock('../pages/PlatformCheck.vue', () => ({ default: {} }))

const { routes } = await import('../router')
const { resolveTopInsetOwnership } = await import('./topInset')

/** 平台真值推出的标称安全高度（逻辑 px）：dumpsys 72 物理 px ÷ density 3.0 */
const NATIVE_INSET = 24

describe('B 变体 · bleed 路径（宏 = true，本配置下真实执行该分支）', () => {
  it('自检：本配置下宏确实为 true', () => {
    // 若误用主配置跑本文件，这条立刻转红 —— 避免「覆盖是假的」静默通过。
    expect(__HOME_BLEED_HEADER__).toBe(true)
  })

  it('【真实执行分支】首页路由表里 topInset 被求值为 bleed', () => {
    // import 路由表时**真的**跑过 `__HOME_BLEED_HEADER__ ? 'bleed' : 'self'`。
    // 宏翻成 false 时本条转红 ⇒ 行为断言，不是文本断言。
    expect(routes.find((r) => r.name === 'recommended')?.meta?.topInset).toBe('bleed')
  })

  it('其余 24 条路由仍是 self（bleed 只作用于首页一处）', () => {
    const others = routes.filter((r) => r.name !== 'recommended')
    expect(others).toHaveLength(24)
    for (const r of others) expect(r.meta?.topInset, String(r.name) + ' 不应是 bleed').toBe('self')
  })

  it('bleed 模式两侧都不让位（根容器已不压 + 页面无 spacer ⇒ 让位恰为 0）', () => {
    expect(resolveTopInsetOwnership('bleed', NATIVE_INSET).barSpacerHeight).toBe(0)
  })

  it('bleed 与 self 数值上确实不同（否则两模式退化成一个）', () => {
    expect(resolveTopInsetOwnership('bleed', NATIVE_INSET).barSpacerHeight).not.toBe(
      resolveTopInsetOwnership('self', NATIVE_INSET).barSpacerHeight,
    )
  })

  it('安全区为 0（web-core 预览 / 无原生）时 bleed 仍安全：让位为 0', () => {
    expect(resolveTopInsetOwnership('bleed', 0).barSpacerHeight).toBe(0)
  })
})

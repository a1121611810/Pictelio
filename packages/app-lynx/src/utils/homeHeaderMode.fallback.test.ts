// ─── 首页顶栏 · 回退阀路径（票 #906 / #907）───
// ⚠️ [票 #920] 原标题写「旧顶栏回退路径」——实体 64dp 顶栏已随四根页去 header 删除；
//   回退阀现只回退**让位口径**（ADR-0216 §2.1）。下方断言验的是 `meta.topInset`，未失效。
//
// 跑在 `vitest.fallback.config.ts` 下（`__HOME_BLEED_HEADER__` = false = `PICTELIO_HOME_BLEED=0`）。
//
// ## 为什么逃生阀也要有 CI 覆盖
//
// 新顶栏缺省开启后，这条路径是**回退阀**。但「平时没人走」不等于「坏了没人发现」：
// 真出问题时它正是唯一的逃生通道，却恰好最容易被改坏且最晚被跑到。
//
// ## 与 bleed 用例的关系
//
// 两者用**同一套 vi.mock 打桩**并同样 **import 真实路由表** ⇒ 都真实执行
// `router.ts` 模块顶层的 `__HOME_BLEED_HEADER__ ? \'bleed\' : \'self\'` 条件。
// 差别只在宏的取值：主配置 true / 本配置 false。
import { describe, expect, it, vi } from 'vitest'

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
vi.mock('../stores/settingsStore', () => ({ useSettingsStore: () => ({ loadSettings: async () => {} }) }))
vi.mock('../stores/watchLaterStore', () => ({ useWatchLaterStore: () => ({ hydrate: async () => {} }) }))
vi.mock('../stores/modalStack', () => ({
  useModalStack: () => ({
    hasOpenModal: () => false,
    closeTopModal: () => {},
    registerModal: () => () => {},
  }),
}))
vi.mock('../utils/errorPresentation', () => ({ registerSessionErrorHandler: () => {} }))

// ⚠️ vi.mock 会被提升到模块顶层，**不能写在循环里**（vitest 直接抛错），故逐条展开。
const stub = { default: {} }
vi.mock('../pages/Login.vue', () => stub)
vi.mock('../pages/Recommended.vue', () => stub)
vi.mock('../pages/IllustList.vue', () => stub)
vi.mock('../pages/IllustDetail.vue', () => stub)
vi.mock('../pages/NovelList.vue', () => stub)
vi.mock('../pages/NovelDetail.vue', () => stub)
vi.mock('../pages/NovelIntro.vue', () => stub)
vi.mock('../pages/UserHome.vue', () => stub)
vi.mock('../pages/FollowList.vue', () => stub)
vi.mock('../pages/Following.vue', () => stub)
vi.mock('../pages/Bookmarks.vue', () => stub)
vi.mock('../pages/Me.vue', () => stub)
vi.mock('../pages/Watchlist.vue', () => stub)
vi.mock('../pages/WatchLater.vue', () => stub)
vi.mock('../pages/Notifications.vue', () => stub)
vi.mock('../pages/MyPixiv.vue', () => stub)
vi.mock('../pages/MuteTags.vue', () => stub)
vi.mock('../pages/TagNeighbors.vue', () => stub)
vi.mock('../pages/Ranking.vue', () => stub)
vi.mock('../pages/DownloadManager.vue', () => stub)
vi.mock('../pages/UpdatePage.vue', () => stub)
vi.mock('../pages/ErrorPage.vue', () => stub)
vi.mock('../pages/NetworkCheck.vue', () => stub)
vi.mock('../pages/PlatformCheck.vue', () => stub)

const { routes } = await import('../router')

describe('首页顶栏 · 旧顶栏回退路径（宏 = false，非生产缺省）', () => {
  it('自检：本配置下宏确实为 false（否则两条路径当同一条测了）', () => {
    // ⚠️ 同 bleed 侧那条：这是 **characterization**（夹具自证），回读的是本配置
    // define 里的字面量 `'false'`，与生产表达式无引用关系，不能当作「生产缺省是 false」
    // 的证据。生产极性由 `tests/homeBleedHeaderFlag.test.ts` 钉住。
    expect(__HOME_BLEED_HEADER__).toBe(false)
  })

  it('【真实执行条件分支】首页 topInset 被求值为 self（而非 bleed）', () => {
    expect(routes.find((r) => r.name === 'recommended')?.meta?.topInset).toBe('self')
  })

  it('回退时 25 条路由全是 self —— 没有任何页面处于 bleed', () => {
    expect(routes).toHaveLength(25)
    for (const r of routes) {
      expect(r.meta?.topInset, `${String(r.name)} 在回退路径下应是 self`).toBe('self')
    }
  })
})

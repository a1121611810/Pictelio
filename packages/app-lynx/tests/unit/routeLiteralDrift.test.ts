// 路由字面量漂移门禁（[维度重构 2026-10-03] 引入，review S-1 阻塞项的机器防线）。
//
// 【缺陷来源】把 `RECOMMENDED_PATH='/recommended'` 改名 `DISCOVER_PATH='/discover'` 时，
//   diff 内 12 处调用点全同步了，但 `pages/Login.vue` 那一处**漏改**，且它不在 diff 的
//   肉眼可及范围之外——是 grep 补查才发现的。后果：登录成功 → navigate('/recommended')
//   → `router.ts` 无匹配兜底 → 弹回 /login ⇒ **新用户登录后 App 不可用**。
//   单测 / 类型 / lint / 门禁全绿；模拟器上也测不到（既有会话不走登录流程）。
//
// 【为什么是门禁而不是一次性断言】ADR-0097：无机器防线 = 审计不完备。
//   本文件把「改名/删路由」这类接口收窄的最易漏环节固化成持续检查：
//   扫全仓生产源码的 `navigate('<字面量>')`，逐个断言它在路由表里真实存在。
//
// 【抽取器自检（ArchUnit failOnEmptyShould 教训）】见「抽取器不得静默空转」用例：
//   正则若因改写而失配，本门禁会**自己报红**，而不是恒真放行。
import { describe, it, expect, vi } from "vitest"
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

// ⚠️ 本仓 vitest 配置**未装 @vitejs/plugin-vue**，任何 .vue 直接 import 都会在收集期
//   解析失败（"Failed to parse source for import analysis"）。故必须给 router.ts 的
//   **全部**页面 import 打桩——漏一个即整文件收集失败（不是"少测一个"，是"测不了"）。
//   桩列表由 `grep -oE "from './pages/[A-Za-z]+\.vue'" src/router.ts` 机械生成。
vi.mock("../../src/api/client", () => ({
  setAccessToken: () => {},
  getAccessToken: () => null,
  setOnUnauthorized: () => {},
  setAuthPermanentFailure: () => {},
  setRateLimitBackoffConfig: () => {},
  setAuthReadyProvider: () => {},
  extractPixivErrorMessage: () => "",
  isOAuthTokenErrorResponse: () => false,
  classifyError: () => ({ kind: "unknown", message: "" }),
  isNativeMode: () => undefined,
  getNativeModules: () => ({}),
  rewriteUrl: (p: string) => p,
  shouldAttachAuth: () => true,
  isTrustedPixivHost: () => true,
}))
vi.mock("../../src/stores/authStore", () => ({
  useAuthStore: () => ({ isLoggedIn: true, restoreToken: async () => true }),
}))
vi.mock("../../src/stores/settingsStore", () => ({
  useSettingsStore: () => ({ isRestricted: () => false }),
}))
vi.mock("../../src/stores/watchLaterStore", () => ({
  useWatchLaterStore: () => ({ items: [], count: 0, has: () => false }),
}))
vi.mock("../../src/stores/modalStack", () => ({
  useModalStack: () => ({ hasOpenModal: () => false, registerModal: () => {}, unregister: () => {} }),
}))
vi.mock("../../src/utils/errorPresentation", () => ({
  registerSessionErrorHandler: () => {},
}))
vi.mock('../../src/pages/Login.vue', () => ({ default: {} }))
vi.mock('../../src/pages/Recommended.vue', () => ({ default: {} }))
vi.mock('../../src/pages/Updates.vue', () => ({ default: {} }))
vi.mock('../../src/pages/Shelf.vue', () => ({ default: {} }))
vi.mock('../../src/pages/AdvancedSettings.vue', () => ({ default: {} }))
vi.mock('../../src/pages/IllustList.vue', () => ({ default: {} }))
vi.mock('../../src/pages/IllustDetail.vue', () => ({ default: {} }))
vi.mock('../../src/pages/NovelList.vue', () => ({ default: {} }))
vi.mock('../../src/pages/NovelDetail.vue', () => ({ default: {} }))
vi.mock('../../src/pages/NovelIntro.vue', () => ({ default: {} }))
vi.mock('../../src/pages/Me.vue', () => ({ default: {} }))
vi.mock('../../src/pages/UserHome.vue', () => ({ default: {} }))
vi.mock('../../src/pages/Following.vue', () => ({ default: {} }))
vi.mock('../../src/pages/Bookmarks.vue', () => ({ default: {} }))
vi.mock('../../src/pages/FollowList.vue', () => ({ default: {} }))
vi.mock('../../src/pages/UpdatePage.vue', () => ({ default: {} }))
vi.mock('../../src/pages/ErrorPage.vue', () => ({ default: {} }))
vi.mock('../../src/pages/Watchlist.vue', () => ({ default: {} }))
vi.mock('../../src/pages/WatchLater.vue', () => ({ default: {} }))
vi.mock('../../src/pages/MyPixiv.vue', () => ({ default: {} }))
vi.mock('../../src/pages/Notifications.vue', () => ({ default: {} }))
vi.mock('../../src/pages/MuteTags.vue', () => ({ default: {} }))
vi.mock('../../src/pages/TagNeighbors.vue', () => ({ default: {} }))
vi.mock('../../src/pages/DownloadManager.vue', () => ({ default: {} }))
vi.mock('../../src/pages/NetworkCheck.vue', () => ({ default: {} }))
vi.mock('../../src/pages/Ranking.vue', () => ({ default: {} }))
vi.mock('../../src/pages/PlatformCheck.vue', () => ({ default: {} }))

import { routes, DISCOVER_PATH } from "../../src/router"

const SRC = fileURLToPath(new URL("../../src", import.meta.url))

/** 递归列出 src 下全部 .ts / .vue（跳过测试与目录） */
function sourceFiles(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const abs = join(dir, name)
    if (statSync(abs).isDirectory()) {
      out.push(...sourceFiles(abs))
    } else if (/\.(ts|vue)$/.test(name) && !/\.test\.ts$/.test(name)) {
      out.push(abs)
    }
  }
  return out
}

/** 路由表里真实存在的静态 path 集合 */
const ROUTE_PATHS = new Set(routes.map((r) => r.path))

/**
 * 扫出 `navigate(<字面量>)` / `replace(<字面量>)` 的目标路径。
 *
 * ⚠️ 第二轮 review 发现的**活盲区**：初版正则只认**单引号**，而本仓 oxfmt 配置为
 *   `quoteStyle: "double"`（vite.config.ts）⇒ 真实调用点 `stores/updateStore.ts:109`
 *   的 `navigate("/update", …)` 对本门禁**完全不可见**，而自检下界照样满足 ⇒ 门禁报绿却漏项。
 *   ⇒ 改为**单双引号都收**。加 `bothQuotes` 断言：门禁自己先证明两种形态都能命中，
 *   防止将来有人把某一支删掉后又变成半盲（这正是"抽取器自检"存在的意义）。
 *
 * ⚠️ 第三轮 review 补第三支：**反引号**。`nav(\`/recommended\`)` 曾实测漏检。
 *   纯模板串 `` `/illust/${id}` `` 不匹配（`$` 不在字符类里）⇒ 动态拼接天然排除。
 */
const NAV_LITERAL = /(?:navigate|replace)\(\s*(['"`])(\/[a-z0-9\-\/:]*)\1/g

/**
 * 剥注释（行注释 + 块注释），保留行数不变以便报错的行号仍指向原文。
 *
 * ⚠️ 行注释用 `(^|\s)\/\/` 而不是 `//`：`https://…` 的 `//` 前面是 `:`，不会被误剥；
 *   而 `code(); // 注释` 前面是空格，会被剥掉。剥除时**不吞换行**，行号才不会漂。
 */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/(^|\s)\/\/[^\n]*/g, (m) => m.replace(/[^\n]/g, " "))
}

interface Offense {
  file: string
  line: number
  target: string
}

function collectOffenses(): Offense[] {
  const found: Offense[] = []
  for (const abs of sourceFiles(SRC)) {
    // ⚠️ 先剥注释再逐行扫：注释里写「历史上曾 navigate("/recommended-old")」是**说明**，
    //   不是活代码。不剥会让门禁对纯注释报红（实测假红）—— 假红会诱发「改门禁让它过」，
    //   那正是门禁冻结线 #1 要防的下场。剥法与 usageMetricsReadPoints.test.ts 保持一致。
    const text = stripComments(readFileSync(abs, "utf8"))
    const lines = text.split("\n")
    lines.forEach((lineText, i) => {
      for (const m of lineText.matchAll(NAV_LITERAL)) {
        const target = m[2]!
        // 动态拼接（`/illust/${id}`）不在此正则的静态字面量范围；此处只管静态串。
        if (!ROUTE_PATHS.has(target)) {
          found.push({ file: abs.slice(SRC.length + 1), line: i + 1, target })
        }
      }
    })
  }
  return found
}

describe("路由字面量漂移门禁（S-1 机器防线）", () => {
  it("抽取器不得静默空转（ArchUnit failOnEmptyShould 教训）", () => {
    // 本仓确有静态字面量导航。若这个下界不满足，说明正则失配 ⇒ 门禁恒真。
    let literalCount = 0
    for (const abs of sourceFiles(SRC)) {
      literalCount += [...readFileSync(abs, "utf8").matchAll(NAV_LITERAL)].length
    }
    expect(literalCount, "静态 navigate/replace 字面量数量异常 —— 抽取器可能已失配").toBeGreaterThanOrEqual(10)
  })

  it("全仓静态导航字面量必须命中真实路由（否则运行时被兜底弹回 /login）", () => {
    const offenses = collectOffenses()
    expect(
      offenses.map((o) => `${o.file}:${o.line} → '${o.target}' 不在路由表`),
      "发现指向不存在路由的静态导航 —— 运行时 navigate() 会兜底 replace 到 /login",
    ).toEqual([])
  })

  it("抽取器同时吃单引号、双引号与反引号（活盲区回归防线）", () => {
    // 本仓 oxfmt = quoteStyle:"double"；若正则退回只认单引号，双引号调用点会静默漏检。
    // 反引号：纯模板串 `` `/illust/${id}` `` 因含 `$` 不匹配，天然排除在静态字面量外。
    for (const q of ["'", '"', '`']) {
      const probe = `navigate(${q}/discover${q}, { replace: true })`
      expect([...probe.matchAll(NAV_LITERAL)].map((m) => m[2]), `未命中 ${q} 引号形态`).toEqual(["/discover"])
    }
    const dynamic = "navigate(`/illust/${id}`, { replace: true })"
    expect([...dynamic.matchAll(NAV_LITERAL)], "动态模板串不应被当成静态字面量").toEqual([])
  })

  it("注释里的历史路径不得报红（第三轮 review 的假红回归防线）", () => {
    // 假红会诱发「改门禁让它过」，正是门禁冻结线 #1 要防的下场。
    const src = ['navigate("/discover", { replace: true })', '// 历史遗留：曾 navigate("/recommended-old")'].join(
      "\n",
    )
    const off = [...stripComments(src).matchAll(NAV_LITERAL)].map((m) => m[2])
    expect(off, "注释里的路径被当成了活代码").toEqual(["/discover"])
  })

  it("剥注释不得误伤 URL 里的 //，也不得改变行号（否则报错行号会指错地方）", () => {
    expect(stripComments('const u = "https://x.dev/a"'), "URL 的 // 被误剥").toContain("https://x.dev/a")
    const three = 'a\n// c\nb'
    expect(stripComments(three).split("\n").length, "剥注释吞了换行 ⇒ 报错行号会漂").toBe(3)
    expect([...stripComments(three).matchAll(/b/g)].length).toBe(1)
  })

  it("关注段空态引导出口的两个路径必须真实存在（spec §7；出口在数据表里，本门禁的 NAV_LITERAL 看不见）", () => {
    // 关注段空态的两个出口写在 Updates.vue 的 FOLLOWING_EMPTY_ACTIONS 数据表里，
    // 不是内联 `navigate('/…')` ⇒ 上面那条漂移门禁扫不到它们。此处补上，
    // 否则删掉 /ranking 路由后空态按钮会静默变成「点了没反应」。
    for (const p of ["/following", "/ranking"]) {
      expect(ROUTE_PATHS.has(p), `引导出口 ${p} 不在路由表`).toBe(true)
    }
    // 出口表必须与本门禁认定的路径一致（防止数据表里写错成别处）
    const updatesVue = readFileSync(join(SRC, "pages/Updates.vue"), "utf8")
    for (const p of ["/following", "/ranking"]) {
      expect(updatesVue, `Updates.vue 的引导出口表缺少 ${p}`).toContain(`to: '${p}'`)
    }
  })

  it("登录成功落点必须是 /discover（本次改名的直接受害者，单独钉住）", () => {
    const loginVue = readFileSync(join(SRC, "pages/Login.vue"), "utf8")
    // 期望值来源：router.ts 的 DISCOVER_PATH 事实源，不是从 Login.vue 反推。
    expect(DISCOVER_PATH).toBe("/discover")
    expect(ROUTE_PATHS.has(DISCOVER_PATH)).toBe(true)
    expect(loginVue).toMatch(/navigate\(\s*DISCOVER_PATH\s*,\s*\{\s*replace:\s*true\s*\}\s*\)/)
    expect(loginVue).not.toMatch(/navigate\(\s*'\/recommended'/)
  })
})

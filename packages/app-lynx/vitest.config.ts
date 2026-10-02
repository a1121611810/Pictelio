import { configDefaults, defineConfig } from 'vitest/config'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

// 与 lynx.config.ts 同源：APK 版本号从本包 package.json 读取（不自己维护）。
// ADR-0203 决策 3：版本号事实源已迁到 pictelio-app-lynx，不再跨包读取。
const _root = dirname(fileURLToPath(import.meta.url))
const _appPkg = JSON.parse(readFileSync(resolve(_root, 'package.json'), 'utf-8')) as {
  version: string
}

// 编译期常量与 lynx.config.ts 同源（测试环境注入，生产由 rspeedy define 注入）
export default defineConfig({
  define: {
    __DEV__: 'true',
    __APP_VERSION__: JSON.stringify(_appPkg.version),
    // 测试环境默认走原逻辑（开关 false）；开关 true 分支由单测显式断言
    __DISABLE_UPDATE_CHECK__: 'false',
    // 首页顶栏形态。**与生产缺省一致**（true，票 #906 产品裁定 2026-10-02）。
    // ⚠️ 必须显式注入，不能只在 rspeedy 里 define：本宏在 **router.ts 模块顶层**被求值
    // （路由表的 topInset 字段），任何 import 到路由表的测试都会在 import 期就 ReferenceError。
    // 这与 __BENCH_NAV__ 不同 —— 后者只在函数体内读，import 期不求值，所以一直不需要注入。
    // 取 true = 与生产缺省一致，故主配置跑的是「默认形态」这条真实路径。
    // 旧顶栏那条回退路径由 vitest.fallback.config.ts 覆盖（宏 = false）。
    __HOME_BLEED_HEADER__: 'true',
    __PUBLIC_CONFIG__: JSON.stringify({
      userAgent: 'PixivIOSApp/7.18.3 (iOS 18.5; iPhone15,4)',
      referer: 'https://app-api.pixiv.net/',
      contentType: 'application/x-www-form-urlencoded',
      apiBaseUrl: 'https://app-api.pixiv.net',
      authUrl: 'https://oauth.secure.pixiv.net/auth/token',
    }),
    __CREDENTIALS__: JSON.stringify({
      clientId: 'test-client-id',
      clientSecret: 'test-client-secret',
      hashSecret: 'test-hash-secret',
      appOs: 'ios',
      appOsVersion: '18.5',
    }),
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts', 'src/**/*.test.ts'],
    // *.bleed.test.ts 只属于 vitest.bleed.config.ts（那里宏为 true）。
    // *.fallback.test.ts 只属于 vitest.fallback.config.ts（那里宏为 false，验旧顶栏那条路径）。
    // 排除而非改文件名：那边用例含「宏必须为 false」的自检，误跑会立刻转红，
    // 不会静默把两条路径当同一条测。
    exclude: [...configDefaults.exclude, '**/*.fallback.test.ts'],
    // i18n locale 钉源语言：Node ≥22 暴露 navigator.language（en-US），跟随系统探测会被带偏
    setupFiles: ['tests/setup/i18n-locale.ts'],
  },
})

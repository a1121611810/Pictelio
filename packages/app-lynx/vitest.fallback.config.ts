import { defineConfig } from 'vitest/config'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/**
 * 首页顶栏的**回退路径**测试环境：构建宏 `__HOME_BLEED_HEADER__` = **false**，
 * 即 `PICTELIO_HOME_BLEED=0` 时走的那条路（票 #906 / #907）。
 *
 * ⚠️ **[票 #920 订正] 「旧 64dp 实体顶栏」已不存在**：票 #920 裁定四个根页一律去 header，
 *   回退阀现在**只回退让位口径**（meta 'bleed' → 'self'），不再画顶栏行
 *   （见 ADR-0216 §2.1）。本配置验的仍是 `meta.topInset === 'self'` 这一条，断言未失效；
 *   失效的只是「旧顶栏」这个**描述**。ADR-0214:48/179「回退阀 = 旧的 64dp 顶栏」的承诺
 *   已由 ADR-0216 显式订正。
 *
 * 缺省开启新顶栏后，这条路径是**逃生阀**，但逃生阀同样需要被 CI 覆盖 ——
 * 「平时没人走」不等于「坏了没人发现」。
 *
 * ## 为什么必须单独一套
 *
 * `__HOME_BLEED_HEADER__` 是**构建期**宏，一个取值只能在一套 vitest 配置里成立。
 * 缺省是新顶栏（主配置跑），于是「显式 `=0` 的旧顶栏」在主配置里**一次都不会执行** ——
 * 它只被人在模拟器上看过。逃生阀不被 CI 覆盖 = 阀门锈死的那天没人知道。
 *
 * 主配置跑「缺省 = 新顶栏」，本配置跑「显式 0 = 旧顶栏」。
 * **两条路径都要绿** —— 缺任何一条都说明另一半未验证。
 * ⚠️ 本配置**刻意不 merge** 主配置 —— merge 后会丢掉 .vue 解析能力
 * （本仓的模板守卫是**读 .vue 源文本**而非挂载组件）。故此处自包含必要项。
 */
const _root = fileURLToPath(new URL('.', import.meta.url))
const _appPkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as {
  version: string
}

export default defineConfig({
  define: {
    __DEV__: 'true',
    __APP_VERSION__: JSON.stringify(_appPkg.version),
    __DISABLE_UPDATE_CHECK__: 'false',
    // ← 本配置的唯一目的：把首页顶栏开关翻成「旧顶栏」那条回退路径
    __HOME_BLEED_HEADER__: 'false',
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
    // ⚠️ 只收 `*.fallback.test.ts` 一种形态，**刻意不**把模板守卫
    // `recommendedBleedHeader.template.test.ts` 也列进来。
    // 那个守卫只 `readFileSync` 读 `.vue`/`.ts` 源文本，从不把宏当值用 ——
    // 在两套配置下各跑一次的**分支覆盖增量是 0**。而它留在 include 里会撑住
    // 「本配置至少跑了一个文件」这件事，于是删掉 `homeHeaderMode.fallback.test.ts`
    // 后本配置仍有 1 个文件，`passWithNoTests: false` 不触发，**逃生阀可以无声消失而 CI 仍绿**。
    // （code-review 第 4 轮 B1；此处为实测，非推演。）
    // 模板守卫的唯一归属是**主配置** —— 它的断言与宏取值无关，两边跑纯属重复劳动。
    include: ['src/**/*.fallback.test.ts'],
    setupFiles: ['tests/setup/i18n-locale.ts'],
  },
})

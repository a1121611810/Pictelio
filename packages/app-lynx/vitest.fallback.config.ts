import { defineConfig } from 'vitest/config'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/**
 * 首页顶栏的**回退路径**测试环境：构建宏 `__HOME_BLEED_HEADER__` = **false**，
 * 即 `PICTELIO_HOME_BLEED=0` 时走的「旧 64dp 顶栏」那条路（票 #906 / #907）。
 *
 * 缺省开启新顶栏后，这条路径是**逃生阀**，但逃生阀同样需要被 CI 覆盖 ——
 * 「平时没人走」不等于「坏了没人发现」。
 *
 * ## 为什么必须单独一套
 *
 * `__HOME_BLEED_HEADER__` 是**构建期**宏：主配置里恒为 `'false'`。
 * 于是首页的 bleed 分支（取消实体顶栏、封面出血、悬浮通知按钮、2s 淡出标题胶囊、
 * 顶部状态栏遮罩）在 CI 里**一次都不会执行** —— 它只被人在模拟器上看过。
 *
 * 「默认关的开关」天然带来这个盲区：CI 跑的那条路径恰好是**旧路径**，
 * 新代码在 CI 中是纯死代码，任何回归都不会被发现。（code-review 独立指出，判定为阻塞项。）
 *
 * 主配置跑「缺省 = 新顶栏」，本配置跑「显式 0 = 旧顶栏」。
 * **两条路径都要绿** —— 缺任何一条都说明另一半未验证。
 * ⚠️ 本配置**刻意不 merge** 主配置 —— merge 后会丢掉 .vue 解析能力
 * （本仓的模板守卫是**读 .vue 源文本**而非挂载组件）。故此处自包含必要项。
 *
 * 注：本配置刻意**不 merge** 主配置 —— merge 后会丢掉 .vue 解析能力
 * （而本仓的模板守卫是读 .vue 源文本的）。故此处自包含必要项。
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
    // bleed 专属用例 + 模板源级守卫（后者在两套配置下各跑一次 ⇒ 两个分支都被覆盖）
    include: ['src/**/*.fallback.test.ts', 'src/pages/recommendedBleedHeader.template.test.ts'],
    setupFiles: ['tests/setup/i18n-locale.ts'],
  },
})

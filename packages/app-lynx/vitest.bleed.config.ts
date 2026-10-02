import { defineConfig } from 'vitest/config'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/**
 * B 变体（首页沉浸悬浮顶栏）的**第二套测试环境**（#906 / #907）。
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
 * 本配置把宏翻成 `'true'`，让 bleed 分支在 CI 里真正跑一遍。
 * **两条路径都要绿** —— 缺任何一条都说明另一半未验证。
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
    // ← 本配置的唯一目的：把 B 变体开关翻成开
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
    // bleed 专属用例 + 模板源级守卫（后者在两套配置下各跑一次 ⇒ 两个分支都被覆盖）
    include: ['src/**/*.bleed.test.ts', 'src/pages/recommendedBleedHeader.template.test.ts'],
    setupFiles: ['tests/setup/i18n-locale.ts'],
  },
})

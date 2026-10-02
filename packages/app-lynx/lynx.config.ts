import { defineConfig } from '@lynx-js/rspeedy'
import { pluginVueLynx } from 'vue-lynx/plugin'
import { pluginTailwindCSS } from 'rsbuild-plugin-tailwindcss'
import { HttpsProxyAgent } from 'https-proxy-agent'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import JSON5 from 'json5'
import { HOME_BLEED_ENV_KEY, resolveHomeBleedHeaderFlag } from './homeBleedHeaderFlag.ts'

const _root = dirname(fileURLToPath(import.meta.url))

// ─── 读取单一事实源 credentials.json5（包内，不跨包） ────────────────────
// ADR-0203 决策 3「事实源迁移」：WebView 客户端源码删除后，凭证归属唯一客户端
// pictelio-app-lynx（同步 JS 注入与 Java 侧 OAuthConfig 生成）。
const _credsPath = resolve(_root, 'credentials.json5')
const credentials = JSON5.parse(readFileSync(_credsPath, 'utf-8'))

// ─── 版本号注入（检查更新用，与 APK 版本单一事实源一致） ───
// 版本号不自己维护：直接读本包（pictelio-app-lynx）package.json 的 version——
// APK versionCode/versionName 由 scripts/sync-android-version.mjs 从本包同步，
// lynx bundle 属于同一 APK，两者必然同源。
const _appPkg = JSON.parse(readFileSync(resolve(_root, 'package.json'), 'utf-8')) as {
  version: string
}
const __APP_VERSION__ = JSON.stringify(_appPkg.version)

// ─── 凭证注入决策（配置期 fail-closed） ───
// __DEV__ 必须同时满足「非生产构建」AND「显式 PICTELIO_LYNX_DEV=1」。
// __DEV__ 为 false 时，__CREDENTIALS__ 定义为占位符（不含任何机密）——
// 不依赖 minifier DCE 来保证生产 bundle 无凭证。
const _isDev = process.env.NODE_ENV !== 'production' && process.env.PICTELIO_LYNX_DEV === '1'
const __CREDENTIALS__ = _isDev
  ? JSON.stringify(credentials)
  : JSON.stringify({ clientId: '', clientSecret: '', hashSecret: '', appOs: '', appOsVersion: '' })
// __PUBLIC_CONFIG__ 仅 B–F 非敏感配置（端点/UA/Referer/超时），
// 顶层常量可安全内联进生产 bundle。
const { clientId: _a, clientSecret: _b, hashSecret: _c, ..._pub } = credentials
const __PUBLIC_CONFIG__ = JSON.stringify(_pub)

// 系统代理（中国大陆需要代理访问 Pixiv），与 app 包同策略
const proxyUrl =
  process.env.https_proxy ||
  process.env.HTTPS_PROXY ||
  process.env.http_proxy ||
  process.env.HTTP_PROXY ||
  'http://127.0.0.1:7897'

// ─── 启动更新检查开关（.env PICTELIO_DISABLE_UPDATE_CHECK） ───
// 仅 dev 调试生效：true → 强制跳过启动更新检查（不走 checkForUpdate，不进强制更新页）。
// 生产构建（build）恒为 false——更新检查是生产 APK 的正常功能，不受 .env 开关影响。
// 注意：rspeedy 先执行本配置文件（loadConfig）再 createRsbuild({ loadEnv })，即
// .env 变量此时尚未写入 process.env——必须手动读取 .env（与下方 credentials.json5 同款）。
const _disableUpdateCheck = _isDev
  ? (() => {
      const _envRaw = (() => {
        try {
          return readFileSync(resolve(_root, '.env'), 'utf-8')
        } catch {
          return ''
        }
      })()
      const _envMap: Record<string, string> = {}
      for (const line of _envRaw.split('\n')) {
        const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/u.exec(line)
        if (m && !line.trim().startsWith('#')) _envMap[m[1]] = m[2]
      }
      return ['true', '1', 'yes'].includes(
        String(_envMap.PICTELIO_DISABLE_UPDATE_CHECK ?? '').trim().toLowerCase(),
      )
    })()
  : false
// 脱敏：代理 URL 可能含 user:pass 凭据（含 scheme-less / protocol-relative 格式），
// 日志只打印主机部分。逻辑与 src/utils/proxyRedact.ts 的 redactProxyUrl 一致（有单测覆盖）。
const _redactProxyUrl = (url: string): string => {
  try {
    const normalized = url.includes('://') ? url : `http://${url}`
    const u = new URL(normalized)
    if (u.hostname) return `${u.protocol}//${u.host}`
  } catch {
    /* fallthrough */
  }
  const atIdx = url.lastIndexOf('@')
  return atIdx !== -1 ? url.slice(atIdx + 1) : url
}
console.log(`[lynx] 🔧 使用代理: ${_redactProxyUrl(proxyUrl)}`)
const proxyAgent = new HttpsProxyAgent(proxyUrl) as unknown

export default defineConfig({
  environments: {
    lynx: {},
    // web 预览多入口（仅 dev）：主入口 + 页面独立预览（error-preview / login-preview）。
    // 生产（_isDev=false）web 环境只保留 main 单入口；lynx 环境恒为默认单入口（src/index.ts），
    // APK 生产 bundle 不受影响。
    web: {
      source: {
        entry: _isDev
          ? {
              main: './src/index.ts',
              'error-preview': './src/errorPreview.ts',
              'login-preview': './src/loginPreview.ts',
            }
          : { main: './src/index.ts' },
      },
    },
  },
  source: {
    define: {
      __CREDENTIALS__,
      __PUBLIC_CONFIG__,
      __APP_VERSION__,
      __DEV__: JSON.stringify(_isDev),
      __DISABLE_UPDATE_CHECK__: JSON.stringify(_disableUpdateCheck),
      // bench 导航钩子（ADR-0136）：显式 BENCH_NAV=1 才注入 true——与 __DEV__ 不同：
      // debug APK 构建是 NODE_ENV=production，__DEV__ 恒 false 会误杀钩子；
      // 原生侧 BuildConfig.DEBUG 是 debug/release 的真实开关，双保险由它+本宏构成。
      __BENCH_NAV__: JSON.stringify(process.env.BENCH_NAV === '1'),
      // 首页沉浸悬浮顶栏开关（#900 T2 / 票 #906）：同样**不用 __DEV__**——
      // APK 构建恒为 NODE_ENV=production，用 __DEV__ 会让本宏在真机上恒 false，
      // 而真机是本变体唯一可信的验收介质（web-core 预览不解析令牌、布局引擎也不同）。
      // ⚠️ 缺省**开启**（产品裁定 2026-10-02）。**回退阀**：`PICTELIO_HOME_BLEED=0`
      // 显式关掉 ⇒ 回到旧的 64dp 顶栏（meta 变 'self'、模板走 spacer 分支，
      // 布局与本改动落地前逐像素一致）。刻意用 `!== '0'` 而非 `=== '1'`：
      // 默认值该由「关掉需要显式动作」表达，漏传 env 不该悄悄退回旧顶栏。
      //
      // 极性**不在此内联**：走 `resolveHomeBleedHeaderFlag`（唯一事实源 + 真值表门禁）。
      // 内联过一次，且零机器防线 —— 极性翻回 `=== '1'` 时 CI 全绿而 APK 静默交付旧顶栏。
      __HOME_BLEED_HEADER__: JSON.stringify(
        resolveHomeBleedHeaderFlag(process.env[HOME_BLEED_ENV_KEY]),
      ),
    },
  },
  server: {
    // 安全：仅绑定本机回环，避免把含 OAuth 凭证的 dev bundle 暴露到局域网
    host: '127.0.0.1',
    // rspeedy 的 proxy 仅支持数组形式（http-proxy-middleware ProxyOptions[]）
    proxy: [
      {
        context: ['/pixiv-img'],
        target: credentials.imageCdnUrl,
        changeOrigin: true,
        pathRewrite: { '^/pixiv-img': '' },
        headers: {
          Referer: credentials.referer,
          'User-Agent': credentials.userAgent,
        },
        agent: proxyAgent,
      },
      {
        context: ['/pixiv-api'],
        target: credentials.apiBaseUrl,
        changeOrigin: true,
        pathRewrite: { '^/pixiv-api': '' },
        headers: {
          'User-Agent': credentials.userAgent,
          Referer: credentials.referer,
        },
        agent: proxyAgent,
      },
      {
        context: ['/pixiv-oauth'],
        target: credentials.authUrl.replace(/\/auth\/token$/u, ''),
        changeOrigin: true,
        pathRewrite: { '^/pixiv-oauth': '' },
        headers: {
          'User-Agent': credentials.userAgent,
        },
        agent: proxyAgent,
      },
    ],
  },
  plugins: [
    pluginVueLynx({
      optionsApi: false,
      enableCSSInlineVariables: true,
      enableCSSInheritance: true,
      // [lynx:fix] 启用 CSS 类选择器：web-core 预览下编译产物元素 l-css-id 恒为 0，
      // 与 scoped 规则（[l-css-id="哈希"]...）不匹配 → 全部样式失效（只剩默认文本）。
      // enableCSSSelector 让选择器保留原始类名（.cls），web-core 按类名匹配即可应用。
      enableCSSSelector: true,
      // 首屏直出（ADR-0134 定稿：用户拍板保留——首屏视觉收益；非交互杠杆）
      enableIFR: true,
    }),
    pluginTailwindCSS({
      config: 'tailwind.config.ts',
      exclude: [/[\\/]node_modules[\\/]/],
    }),
  ],
})

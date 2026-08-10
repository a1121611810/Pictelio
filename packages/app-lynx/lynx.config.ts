import { defineConfig } from '@lynx-js/rspeedy'
import { pluginVueLynx } from 'vue-lynx/plugin'
import { pluginTailwindCSS } from 'rsbuild-plugin-tailwindcss'
import { HttpsProxyAgent } from 'https-proxy-agent'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import JSON5 from 'json5'

const _root = dirname(fileURLToPath(import.meta.url))

// ─── 从 app 包读取单一事实源 credentials.json5 ────────────────────
// 与 packages/app/vite.config.ts 同源，避免双份凭证漂移。
const _credsPath = resolve(_root, '../app/credentials.json5')
const credentials = JSON5.parse(readFileSync(_credsPath, 'utf-8'))

// ─── 版本号注入（检查更新用，与 APK 版本单一事实源一致） ───
// 版本号不自己维护：直接读 app 包（pictelio-app）的 version——
// APK versionCode/versionName 由 scripts/sync-android-version.mjs 从 app 包同步，
// lynx bundle 属于同一 APK，必须与 app 包版本比较（用 lynx 自身 0.1.0 会永远提示有更新）。
const _appPkg = JSON.parse(readFileSync(resolve(_root, '../app/package.json'), 'utf-8')) as {
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
  'http://127.0.0.1:10808'
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
    }),
    pluginTailwindCSS({
      config: 'tailwind.config.ts',
      exclude: [/[\\/]node_modules[\\/]/],
    }),
  ],
})

import { defineConfig } from '@lynx-js/rspeedy'
import { pluginQRCode } from '@lynx-js/qrcode-rsbuild-plugin'
import { pluginVueLynx } from 'vue-lynx/plugin'
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
// __CREDENTIALS__ 含 A 类机密（clientId/clientSecret/hashSecret），
// 代码中仅在 __DEV__ 分支引用，生产构建由 minifier 整块消除。
const __CREDENTIALS__ = JSON.stringify(credentials)
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
console.log(`[lynx] 🔧 使用代理: ${proxyUrl}`)
const proxyAgent = new HttpsProxyAgent(proxyUrl) as unknown

export default defineConfig({
  environments: {
    lynx: {},
    web: {},
  },
  source: {
    define: {
      __CREDENTIALS__,
      __PUBLIC_CONFIG__,
      // __DEV__ 语义与 Vite 一致：非生产构建为 true。
      // rspeedy build 默认 NODE_ENV=production 会把 OAuth 分支消除——但 dev server 与
      // MVP web 调试需要登录能力。提供 PICTELIO_LYNX_DEV=1 显式开启（仅开发用）。
      __DEV__: JSON.stringify(
        process.env.PICTELIO_LYNX_DEV === '1' || process.env.NODE_ENV !== 'production',
      ),
    },
  },
  server: {
    host: '0.0.0.0',
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
    pluginQRCode({
      schema(url) {
        return `${url}?fullscreen=true`
      },
    }),
    pluginVueLynx({
      optionsApi: false,
      enableCSSInlineVariables: true,
      enableCSSInheritance: true,
    }),
  ],
})

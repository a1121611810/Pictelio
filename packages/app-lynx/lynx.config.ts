import { defineConfig } from '@lynx-js/rspeedy'
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
      // 安全：__DEV__ 必须同时满足「非生产构建」AND「显式 PICTELIO_LYNX_DEV=1」。
      // 仅在显式开启的本地开发构建中内联 OAuth 凭证；任何生产/CI 构建
      // （即使 NODE_ENV 非 production）都不会把 clientId/secret 打进 bundle。
      __DEV__: JSON.stringify(
        process.env.NODE_ENV !== 'production' && process.env.PICTELIO_LYNX_DEV === '1',
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
    }),
  ],
})

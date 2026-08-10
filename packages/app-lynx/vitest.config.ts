import { defineConfig } from 'vitest/config'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

// 与 lynx.config.ts 同源：APK 版本号从 app 包 package.json 读取（不自己维护）
const _root = dirname(fileURLToPath(import.meta.url))
const _appPkg = JSON.parse(readFileSync(resolve(_root, '../app/package.json'), 'utf-8')) as {
  version: string
}

// 编译期常量与 lynx.config.ts 同源（测试环境注入，生产由 rspeedy define 注入）
export default defineConfig({
  define: {
    __DEV__: 'true',
    __APP_VERSION__: JSON.stringify(_appPkg.version),
    // 测试环境默认走原逻辑（开关 false）；开关 true 分支由单测显式断言
    __DISABLE_UPDATE_CHECK__: 'false',
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
  },
})

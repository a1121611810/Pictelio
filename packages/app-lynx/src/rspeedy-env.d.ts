/// <reference types="@lynx-js/rspeedy/client" />

// ─── 编译期注入常量（lynx.config.ts source.define） ───
// 注意：此文件为模块（含 export），全局常量需放入 declare global。
declare global {
  const __CREDENTIALS__: {
    clientId: string
    clientSecret: string
    hashSecret: string
    appOs: string
    appOsVersion: string
  }
  const __PUBLIC_CONFIG__: {
    userAgent: string
    referer: string
    contentType: string
    apiBaseUrl: string
    authUrl: string
    loginUrl: string
    redirectUri: string
    imageCdnUrl: string
  }
  const __DEV__: boolean
}

declare module '@lynx-js/types' {
  interface GlobalProps {
    /**
     * Define your global properties in this interface.
     * These types will be accessible through `lynx.__globalProps`.
     */
  }
}

export {}

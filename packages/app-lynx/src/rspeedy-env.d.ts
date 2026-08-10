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
  /**
   * APK 版本号（lynx.config.ts 从 app 包 package.json 注入，检查更新用；
   * 与 APK versionCode/versionName 单一事实源一致，不自己维护）
   */
  const __APP_VERSION__: string
  const __DEV__: boolean
  /**
   * 启动更新检查开关（lynx.config.ts 从 .env PICTELIO_DISABLE_UPDATE_CHECK 注入）：
   * true = 强制跳过启动更新检查（dev 调试，避免误进强制更新页）；false = 按原逻辑走。
   */
  const __DISABLE_UPDATE_CHECK__: boolean
  /**
   * Lynx runtime 内置全局对象（ADR-0066 系统返回桥）。
   * getJSModule('GlobalEventEmitter') 监听 native 侧 sendGlobalEvent 事件；
   * web-core 预览环境可能不存在或 getJSModule 不可用，引用前必须可选链探测。
   */
  interface LynxGlobalEventEmitter {
    addListener(event: string, handler: (...args: unknown[]) => void): void
  }
  interface LynxGlobal {
    getJSModule(name: 'GlobalEventEmitter'): LynxGlobalEventEmitter | undefined
  }
  const lynx: LynxGlobal | undefined
  /**
   * Lynx runtime 内置全局对象 —— 原生 Native Modules 访问点（#52）。
   * web-core 环境可能不存在或为空对象；引用前必须可选链探测。
   */
  const NativeModules: {
    PictelioSecureStorage: {
      getItem(key: string, callback: (value: string | null, err: string | null) => void): void
      setItem(key: string, data: string, callback: (err: string | null) => void): void
      removeItem(key: string, callback: (err: string | null) => void): void
    }
    PictelioApp: {
      setClientKind(kind: string, callback: (err: string | null) => void): void
      getClientKind(callback: (kind: string | null, err: string | null) => void): void
      restart(callback: (err: string | null) => void): void
      /** 关闭 Lynx 宿主 Activity；lynx NativeModule 约定 Callback 必传（模拟器实测） */
      exitApp(callback: (err: string | null) => void): void
      /** 检查更新：用系统浏览器强制打开 release 页（独立 task，无法返回 app 内） */
      openUrl(url: string, callback?: (err: string | null) => void): void
      /** 检查更新：通用 HTTP GET（原生 lynx 无 fetch 时的网络桥；cb(status, body)，2xx 成功） */
      httpGet(url: string, callback: (status: number, body: string) => void): void
    }
    PictelioAuth: {
      loginWithRefreshToken(token: string, callback: (userInfo: string, err: string) => void): void
      setAccessToken(token: string): void
      clearTokens(callback: (arg1: string, arg2: string) => void): void
    }
    PictelioApi: {
      request(
        method: string,
        path: string,
        body: string,
        callback: (status: number, data: string, rotatedRefreshToken: string) => void,
      ): void
    }
  } | undefined
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

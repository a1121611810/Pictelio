// app-lynx dev livereload 插件（spec: docs/specs/app-lynx-dev-livereload.md）
// 背景：vue-lynx 插件在 web 环境硬禁用 HMR/liveReload（!isWeb 短路），
// 导致 lynx dev 在浏览器中保存后无任何自动刷新机制。
// 本插件在 web 环境 entry 前注入 live-reload client，连接 rspeedy dev server 的 ws 通道，
// 收到编译完成信号后执行 window.location.reload()。
//
// 平台约束：ADR-0123 hit-testing —— 本插件只在构建期生效，不涉及运行时 pointer-events

// 类型从 @lynx-js/rspeedy 取，而非直接引 @rsbuild/core：后者只是本包的**传递**依赖，
// pnpm 严格布局（node-linker=isolated）下不会提升到本包 node_modules，
// 直接 import 类型会报 TS2307（票 #912）。rspeedy 公开入口已 re-export 该类型，
// 取自已声明的 devDependency 才是稳定解析。
import type { RsbuildPlugin } from '@lynx-js/rspeedy'

export const pluginLivereload = (): RsbuildPlugin => ({
  name: 'pictelio-livereload',
  setup(api) {
    api.modifyBundlerChain((chain, { isDev, environment }) => {
      // 只在 dev + web 环境注入。
      //
      // ⚠️ 票 #912 揭出的真实 bug：原写法 `const { isDev, isWeb } = utils` 里，
      // `isWeb` **从来不是** ModifyBundlerChainUtils 的字段（rsbuild 只给
      // isDev / isProd / target / isServer / isWebWorker / environment / …）。
      // rspeedy 自身插件也不解构 isWeb，而是用 environment.name 判 web。
      // 于是 `isWeb === undefined` ⇒ `!isWeb` 恒真 ⇒ **整个插件恒早退**，
      // live-reload client 从未被注入（该功能此前是静默 no-op）。
      // 这里按 rspeedy 的同款判法补回本来的意图。
      const envName = typeof environment === 'string' ? environment : environment.name
      const isWeb = envName === 'web' || envName.startsWith('web-')
      if (!isDev || !isWeb) return

      // 在 entry 前注入 live-reload client（路径相对于 src/）
      const entries = chain.entryPoints.values()
      for (const entry of entries) {
        entry.prepend({ import: './src/livereload-client' })
      }
    })
  },
})

// app-lynx dev livereload 插件（spec: docs/specs/app-lynx-dev-livereload.md）
// 背景：vue-lynx 插件在 web 环境硬禁用 HMR/liveReload（!isWeb 短路），
// 导致 lynx dev 在浏览器中保存后无任何自动刷新机制。
// 本插件在 web 环境 entry 前注入 live-reload client，连接 rspeedy dev server 的 ws 通道，
// 收到编译完成信号后执行 window.location.reload()。
//
// 平台约束：ADR-0123 hit-testing —— 本插件只在构建期生效，不涉及运行时 pointer-events

import type { RsbuildPlugin } from '@rsbuild/core'

export const pluginLivereload = (): RsbuildPlugin => ({
  name: 'pictelio-livereload',
  setup(api) {
    api.modifyBundlerChain((chain, { isDev, isWeb }) => {
      // 只在 dev + web 环境注入
      if (!isDev || !isWeb) return

      // 在 entry 前注入 live-reload client（路径相对于 src/）
      const entries = chain.entryPoints.values()
      for (const entry of entries) {
        entry.prepend({ import: './src/livereload-client' })
      }
    })
  },
})

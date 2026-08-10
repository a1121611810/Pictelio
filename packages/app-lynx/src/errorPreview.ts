// ─── 错误页预览入口（仅 web 开发预览用） ───
// 访问：http://127.0.0.1:<port>/__web_preview?casename=error-preview.web.bundle
// 预填样例「会话失效」错误，渲染错误页（方案 C）内联样式预览版。
// 说明：web-core 预览下 Fluent 令牌色（var()）不解析 → 正式 ErrorPage（令牌版）在预览
// 会退化为白底；此处用内联色值版展示设计效果，生产 ErrorPage.vue 仍为令牌版（真机正常）。
// 生产（lynx 环境）不构建此入口——仅 environments.web 配置了该 entry。
import { createApp } from 'vue-lynx'
import { defineComponent, h } from 'vue'
import ErrorPagePreview from './errorPrototype/ErrorPagePreview.vue'
import { fatalError } from './utils/errorPresentation'
import { ApiErrorType } from './api/types'

// 样例数据：模拟「登录已过期 (HTTP 401)」会话失效（与真实触发链 reportSessionError 写入的形态一致）。
fatalError.value = { type: ApiErrorType.UNAUTHORIZED, message: '登录已过期 (HTTP 401)', status: 401 }

const PreviewApp = defineComponent({
  render: () => h(ErrorPagePreview, { error: fatalError.value }),
})

createApp(PreviewApp).mount()

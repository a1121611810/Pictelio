// dev 构建门禁的 .ts 出口。
// 坑（实测 2026-09-13）：`__DEV__` 标识符无论写在 .vue 还是它 import 的 .ts 里，只要处于
// IllustList 这类页面模块的 vue-lynx worklet loader 链上，就会被改写为
// `process.env.NODE_ENV !== 'production'`（用户 define 被绕过），而 web-core 预览运行时
// 没有 process 全局量 → ReferenceError 整页白屏。用 import.meta.env.DEV（rsbuild 标准
// 静态替换）绕开该改写；引用方 .vue 一律 import { DEV }，不要直接写 __DEV__。
export const DEV = import.meta.env.DEV

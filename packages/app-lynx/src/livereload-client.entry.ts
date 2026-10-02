// live-reload client 的**注入入口**（票 #912 的第二层静默 no-op）
//
// ## 为什么需要这个文件
//
// `livereload-client.ts` 导出 `init()` 却**刻意不在模块加载时自动连接**
// ——注释写「避免 module-level 副作用在 happy-dom 下崩」。于是它必须**由注入方显式调用**。
//
// 而 `rspeedy-plugin-livereload.ts` 原来只做了：
//
//     entry.prepend({ import: './src/livereload-client' })
//
// ——**只 import 了模块，从没调用 `init()`**。于是：
//   · WebSocket 从未打开；
//   · 页面保存后不会自动刷新；
//   · 而 `livereload-client.test.ts` 的每个用例都**显式调 `init()`**，
//     所以门禁全绿 —— 它证明了「函数能用」，而生产里**没有人用它**。
//
// 注入前后实测（emulator-5554 无关，dev server + 浏览器）：
//   插件修复前：web 产物里 client 0 处（插件恒早退）
//   插件修复后：web 产物里 client 6 处（注入成功）—— 但页面**依然不刷新**
//   本文件落地后：页面在源文件 touch 后**自动刷新** ✅
//
// 本文件是唯一带 module-level 副作用的地方，而它**只进 web bundle、从不被测试 import**，
// 所以「happy-dom 下崩」的原顾虑不成立。
import { init } from './livereload-client'

init()

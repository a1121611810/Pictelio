# ADR-0066：app-lynx 系统返回 native→JS 事件桥（返回决策权在 JS）

## 背景

app-lynx（Lynx 客户端）的 [LynxActivity.java](/Users/lilianda/develop/pixivizer/packages/app/android/app/src/lynx/java/io/pictelio/app/LynxActivity.java:33) 未处理系统返回：manifest 开启 `enableOnBackInvokedCallback` 后，侧滑返回/返回键默认 predictive back → 直接 `finish()` 退出整个应用，而不是返回路由上一页。webview client 通过 Capacitor `backButton` 监听完成「关浮层 → 非根返回 → 根路由双击退出」的完整语义（[backGestureService.ts](/Users/lilianda/develop/pixivizer/packages/app/src/services/backGestureService.ts)），lynx 刻意不带 Capacitor bridge，该链路缺失。

## 决定

**系统返回由原生拦截后单向转发给 JS，路由行为由 JS 决定，原生不自行退出（bundle 未就绪时除外）。**

- Native：`LynxActivity` 注册 `OnBackPressedDispatcher` callback（androidx，API 21+，33+ 预测性返回自动适配）。bundle 加载成功前 → 原生直接 `finish()`（JS 侧无监听者，无法消费）；加载成功后 → `lynxView.sendGlobalEvent("pictelioBack", ...)` 转发事件，不做任何退出决策。
- JS：`router.ts` 监听 `pictelioBack` 全局事件（仅原生模式、注册一次）：路由历史栈非空 → `goBack()`；根路由（`recommended` / `login`）→ 显示「再按一次退出应用」提示，2 秒内第二次返回 → 调用新增的 `PictelioApp.exitApp()` 退出 Activity。
- 根路由双击退出语义与 webview client 对齐（`EXIT_DOUBLE_TAP_MS = 2000` + exitHint toast，见 [backGestureService.ts](/Users/lilianda/develop/pixivizer/packages/app/src/services/backGestureService.ts)）。

## Considered Options

- **原生直接处理（现状）**：默认 predictive back 退出 Activity，即用户报告的缺陷；否决。
- **原生询问 JS「可否返回」再决定（双向握手）**：Lynx NativeModule 调用为异步 callback，每次返回都要往返 + 状态同步，复杂度高；单向事件流 + JS 决策更简单、无竞态。
- **JS 主动上报路由深度/根路由标志给原生**：原生需维护 JS 路由状态副本，重复造轮子；事件桥方案路由状态单一来源保持在 JS。
- **根路由单次退出**：简单但与其他 client 不一致；用户明确选择双击退出对齐 webview client。
- **预测性返回预览动画**：ADR-0005 已移除（复杂度高、收益有限）；本次只做标准转发，不重做预览动画。

## Consequences

- `LynxActivity` 增加返回拦截；`PictelioAppModule` 新增 `exitApp`（主线程 finish，静态弱引用，onDestroy 清理）；`router.ts` 增加 GlobalEventEmitter 监听与双击计时；App.vue 增加退出提示条。
- 返回行为语义与 webview client 对齐：非根返回上一页、根路由提示 + 双击退出。
- 事件名 `pictelioBack` 为 native↔JS 契约；JS 侧仅在原生模式注册，web-core 预览不受影响。
- bundle 未就绪时的返回仍由原生兜底退出，避免「事件无人消费」卡死。
- 相关：[ADR-0005](/Users/lilianda/develop/pixivizer/docs/adr/0005-remove-predictive-back.md)（预览动画移除）、[ADR-0055](/Users/lilianda/develop/pixivizer/docs/adr/ADR-0055-lynx-native-render-compat.md)（原生渲染兼容）、[spec](/Users/lilianda/develop/pixivizer/docs/specs/app-lynx-illust-detail-and-system-back.md)

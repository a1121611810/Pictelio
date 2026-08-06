# app-lynx 插画详情比例 / 列表交互 / 小说空白 / 系统返回 —— 功能规格

> 来源：grill-with-docs 会话（2026-08-06，用户逐项拍板）；文档先行，用户 review 通过后再实现
> 状态：ready-for-agent（待 review）

## Problem Statement

app-lynx（Lynx 客户端）真机存在 4 组问题：

1. **插画详情图片不按比例显示**：[IllustDetail.vue](/Users/lilianda/develop/pixivizer/packages/app-lynx/src/pages/IllustDetail.vue:125) 图片容器固定 `h-[100vw]`（正方形）+ `aspectFill` 裁切。根因：原生 LynxView 在 scroll-view 内不支持动态 `aspect-ratio` style（[ADR-0055 §2](/Users/lilianda/develop/pixivizer/docs/adr/ADR-0055-lynx-native-render-compat.md)），当时 workaround 是固定高度容器；且详情大图用裸 `<image>`，加载期无骨架屏。
2. **插画列表图片区不可点击进详情**：4 个列表页（推荐/关注/收藏/用户作品）图片外层 `@tap.stop="swallowRestricted"` **无条件吞掉全部点击**（如 [Recommended.vue](/Users/lilianda/develop/pixivizer/packages/app-lynx/src/pages/Recommended.vue:187)）——本意是受限条目不跳转（issue #91），误伤所有正常图片；卡片文字区可点，仅图片区不可点。
3. **小说列表骨架屏消失后空白**：[NovelList.vue](/Users/lilianda/develop/pixivizer/packages/app-lynx/src/pages/NovelList.vue:142) 是**全包唯一**一处 `:item-key="item.id"` 传数字的 list-item——违反 [ADR-0055 §4](/Users/lilianda/develop/pixivizer/docs/adr/ADR-0055-lynx-native-render-compat.md)（item-key 必须 String，数字 → lynx 报 220201 illegal item-key → 列表条目不渲染）。推荐/关注共用模板故两个 tab 均空白；`lynx-flow-check.sh` 仅 grep 220201 计数且不断言小说列表内容，故未拦截。
4. **系统侧滑返回直接退出整个应用**：[LynxActivity.java](/Users/lilianda/develop/pixivizer/packages/app/android/app/src/lynx/java/io/pictelio/app/LynxActivity.java:33) 无返回处理（注释自述 MVP 默认 predictive back → 退出 Activity）；webview client 走 Capacitor `backButton` 监听（[backGestureService.ts](/Users/lilianda/develop/pixivizer/packages/app/src/services/backGestureService.ts)），lynx 刻意不带 Capacitor，该链路缺失。

## Decisions（用户已逐项确认）

| # | 决策 | 确认 |
|---|------|------|
| D1 | 详情图按比例显示，**不封顶**（与 webview client 一致，webview 端无 max-height） | ✅ A |
| D2 | 详情图加载期显示**图片级骨架屏**（复用 SkeletonImage 的 shimmer/失败态） | ✅ |
| D3 | 列表图片区恢复点击：`.stop` 保留（防受限遮罩穿透），handler 内按受限态分流 | ✅ |
| D4 | 小说列表修 `item-key` + 三项加固（15s 超时 / 响应形状防御 / 推荐空态） | ✅ B |
| D5 | 系统返回走 native→JS 事件桥，决策权在 JS；根路由**双击退出**（2s + 「再按一次退出应用」提示，与 webview client 对齐） | ✅ B |

## Implementation Decisions

### 1+3. 详情比例 + 图片级骨架（IllustDetail.vue / UgoiraViewer.vue / 新增 utils/imageLayout.ts）

- 新增纯函数 `detailImageHeightVw(width, height, fallbackVw = 100)`：返回 `(height / width) * 100 + 'vw'`；`width`/`height` 缺失、非正数、非有限值时回退 `fallbackVw`。采用**显式 vw 高度**而非 aspect-ratio style——原生显式高度模式已验证可用（issue #138 的 `height="48.4vw"` 先例）。
- 容器 `h-[100vw]` 改为 `:style="{ height: detailImageHeightVw(illust.width, illust.height) }"`；多页作品共用同一比例（Pixiv 各页尺寸一致）。
- 裸 `<image>` 换成 `<SkeletonImage :src="currentImage" :height="..." />`：@load 前 shimmer、@error 显示「图片加载失败」，不启用 lazy-load。
- 数据加载期整页骨架屏（`loading` 分支）保留不动。
- UgoiraViewer 新增 `height-vw` prop，shimmer/图片容器改用显式高度替代 `aspect-[1/1]`，避免与新比例容器错位。

### 2. 列表图片区点击（Recommended / Following / Bookmarks / UserHome）

- `@tap.stop="swallowRestricted"` → `@tap.stop="onImageTap(item)"`；`onImageTap` 内 `if (!isRestricted(item)) openDetail(item.id)`。
- `.stop` 继续保证受限遮罩点击不穿透；RestrictOverlay 自身的 `@tap="swallow"` 保留为双保险。
- 受限条目（R18/R18G 且开关关闭）图片区仍不可点击、不可穿透。

### 4. 小说列表空白（NovelList.vue）

- 修复：`:item-key="item.id"` → `:item-key="String(item.id)"`（消除 220201）。
- 加固 1：`fetchFirstPage` 请求包 `withTimeout(..., 15000)`（与 Recommended 的 issue #128 兜底对齐，小说页目前缺失）。
- 加固 2：响应形状防御——`Array.isArray(res.novels)` 否则置错误「数据格式异常」，避免 `res.novels` 缺失时 `novels.length` 崩溃/静默空白。
- 加固 3：推荐 tab 补空态文案「暂无推荐小说」（与关注 tab 空态对齐，杜绝「无数据 → 纯空白」）。

### 5. 系统返回桥（LynxActivity / PictelioAppModule / router.ts / App.vue / rspeedy-env.d.ts）

- **Native**：LynxActivity 注册 `OnBackPressedDispatcher` callback（androidx，API 21+，33+ 预测性返回自动适配）：bundle 未就绪 → 原生直接 `finish()`；就绪 → `lynxView.sendGlobalEvent("pictelioBack", new JavaOnlyArray())`，**不自行退出**（决策权在 JS）。
- **JS**：`router.ts` 注册 `lynx.getJSModule('GlobalEventEmitter').addListener('pictelioBack', ...)`（仅原生模式 `isNativeMode()`、只注册一次，防重复监听）：
  - `_history.length > 0` → `goBack()`；
  - 根路由（`recommended` / `login`）→ 首次显示「再按一次退出应用」提示（2s 自动消失），2s 内第二次 → `NativeModules.PictelioApp.exitApp()`。
- **Native Module**：`PictelioAppModule` 新增 `@LynxMethod exitApp(callback)`——主线程 `finish()` 当前 LynxActivity（LynxActivity 维护静态弱引用，onDestroy 清理；callback 契约同现有模块「第二参为错误」）。
- **UI**：App.vue 增加退出提示条（顶部浮层，复用 Fluent 视觉 token，2s 定时隐藏，与 webview client 的 exitHint toast 语义一致）。
- 不重做 ADR-0005 移除的预测性返回预览动画。

## Testing Decisions

- 新增纯函数单测 `src/utils/imageLayout.test.ts`：正常比例 / 0 宽高 / NaN / 字段缺失 / 极端长图（不封顶断言）。
- `pnpm check:app-lynx` + `pnpm test:app-lynx` 全绿。
- 真机验证（lynx flavor APK，OPPO R11s）：
  - 详情页横图/竖图/长图按比例显示；慢网/断网时图片区 shimmer → 「图片加载失败」
  - 列表图片区点击进详情；受限条目点击无反应、不穿透
  - 小说推荐/关注列表均有内容；logcat 无 220201
  - 详情/列表页系统侧滑返回 → 前一页；推荐页第一次返回出提示、2s 内第二次退出；登录页同理
- 可选：扩展 `lynx-flow-check.sh` 小说步骤断言「列表内容非空」+「220201 计数为 0」。

## Out of Scope

- 主包 `packages/app`（SolidJS webview client）不动
- 预测性返回预览动画（ADR-0005 已移除，不重做）
- 插画详情页受限遮罩（issue #91 明确不覆盖插画详情）
- 详情图高度封顶（用户明确选择不封顶）

# Lynx 4.0.1 insets 消费通道与 e2e/全屏支撑能力调研（#593）

> 地图 #591（lynx 系统栏模式选型）research 产出。双来源实证：官方文档/仓库（标「文档」）+ 本仓 Gradle 缓存 AAR 反编译 / node_modules 源码（标「实证」）。
> 锚点事实：lynx SDK `org.lynxsdk.lynx:lynx:4.0.1`（AAR 已解包取证）；前端 vue-lynx（packages/app-lynx，web-core 0.23.1）；`targetSdkVersion = 36`、`minSdkVersion = 28`（`variables.gradle`）。

## 0. 结论速览（TL;DR）

1. **SystemInfo 不含任何 insets 字段**（官方文档字段表 + liblynx.so 字符串双重证实）。
2. **`env(safe-area-inset-*)` 在 lynx CSS 语法层支持，但在 Android 上恒为 0**——引擎的全局静态 `SAFE_AREA_INSET_*` 缺省 0，只有 iOS（darwin）/harmony/embedder 侧有写入者，**Android 平台代码零写入者、全仓无 `onApplyWindowInsets`**。它不是可用的 insets 通道。
3. 官方认可的自定义通道是 **原生容器注入 `__globalProps`**（维护者口径：`status_bar_height` / `bottom_area_height`）或 **NativeModule 回调 / GlobalEvent**——两者在 4.0.1 均可用，且 `getViewportSize`（ADR-0131）已是同构先例。
4. **JS 侧无任何状态栏/全屏控制 API**（无 `<status-bar>` 元素、SDK NativeModules 无此类、LynxView/LynxViewBuilder 无 fullscreen/cutout 方法）。系统栏一切行为由原生容器负责（LynxExplorer 即此模式）。
5. **本项目 targetSdk=36 → Android 15+ 设备上 edge-to-edge 已被系统强制**（`windowOptOutEdgeToEdgeEnforcement` 在 targetSdk 36 被忽略，`setStatusBarColor`/legacy flags 在 API 35+ 废弃/失效）。当前 LynxActivity 零 insets 代码 → **Android 15+ 真机上 lynx 客户端此刻已处于「内容顶到系统栏底下、零补偿」状态**；方案 A（着色）在该批设备上不可实现。这把「选 B」从审美偏好变成正确性补课。

---

## 1. 能力清单（逐条来源标注）

### 1.1 SystemInfo 全局对象

**文档**（[lynxjs.org SystemInfo](https://lynxjs.org/api/lynx-api/global/system-info)）全部字段：

| 字段 | 说明 |
| --- | --- |
| `engineVersion` | Lynx 引擎版本 |
| `lynxSdkVersion` | 同上（已废弃，指向 engineVersion） |
| `osVersion` | 操作系统版本 |
| `pixelWidth` / `pixelHeight` | 设备物理像素宽/高 |
| `pixelRatio` | 主屏物理像素比 |
| `platform` | `'Android' \| 'iOS' \| 'macOS' \| 'windows' \| 'headless'` |
| `runtimeType` | `'v8' \| 'jsc' \| 'quickjs'` |

**无 `statusBarHeight` / `navigationBarHeight` / `safeArea` / 任何 inset、cutout 字段。**

**实证**（liblynx.so 字符串，`~/.gradle/caches/.../lynx-4.0.1.aar` → `jni/arm64-v8a/liblynx.so`）：
- 命中：`SystemInfo`、`SystemInfo.pixelRatio`、`SystemInfo.pixelRatio=%f`、`_GetSystemInfo`；键 `pixelWidth`/`pixelHeight`/`pixelRatio`/`platform`/`lynxSdkVersion`/`osVersion`/`locale`/`language`/`theme`。
- **零命中**：`statusBarHeight`、`navigationBarHeight`、`safeArea`、`safe_area`（大小写不敏感）。
- `classes.jar` 无 SystemInfo 组装类（组装在 native C++ 侧），与文档字段表一致。

**本仓现状**：`packages/app-lynx/src/rspeedy-env.d.ts:76` 仅声明 `{ pixelWidth, pixelRatio }`；`src/utils/viewportGeometry.ts`、`GlobalFab.vue`、`CarouselSwiper.vue` 在用（ADR-0131：SystemInfo = 全屏物理尺寸，不含 inset 概念）。

### 1.2 CSS 通道：`env(safe-area-inset-*)`

- **语法层支持（文档）**：lynx 官方 AI 文档 `ai/skills/lynx-api-docs/skills/using-lynx-api-docs/css/values-and-units.md`（lynx-family/lynx 仓库 main 分支）「Environment variables」节明确给出 `padding-top: env(safe-area-inset-top)` 示例；calc() 仅限 length 类属性。公开 CSS 属性索引页（lynxjs.org/api/css/properties/）**没有** env() 专页——文档站位弱。
- **引擎层支持（实证）**：liblynx.so 含 `safe-area-inset-top/right/bottom/left` 四个 token 字符串（CSS 解析器识别）。
- **运行时取值（实证，关键）**：取值来自引擎全局静态 `starlight::ComputedCSSStyle::SAFE_AREA_INSET_{TOP,BOTTOM,LEFT,RIGHT}_`（`core/renderer/css/computed_css_style.cc:677-680`，**缺省 0**）。写入者全集：
  - iOS：`platform/darwin/common/lynx/LynxEnv.mm` `setKeyWindowAndStatusBar`（`keyWindow.safeAreaInsets`）；
  - embedder 示例：`platform/embedder/core/lynx_template_renderer.cc` 显式写 0；
  - harmony：自己的 renderer。
  - **Android 平台代码：无任何写入者；全仓库（含 Java/Kotlin）`onApplyWindowInsets` 零命中。**
- **结论：lynx 4.0.1 Android 上 `env(safe-area-inset-*)` 恒解析为 0px。CSS 通道不可用。**（解析不报错但永远拿 0——比「不支持」更隐蔽，是典型假绿面，见 §4。）

**官方认可的替代通道（文档=维护者口径）**：GitHub [Discussion #165「Safe Area Support」](https://github.com/lynx-family/lynx/discussions/165)维护者 MoonfaceX：
> "native containers inject status_bar_height and bottom_area_height via __globalProps like CSS does"
> "We will seriously consider providing a built-in element like <SafeAreaView> does."（SafeAreaView 类组件仅「考虑中」，4.0.1 无）

[Issue #292](https://github.com/lynx-family/lynx/issues/292)（"How to show the Status Bar?"）社区结论一致：系统栏行为是**原生容器**的事；offset 经 `lynx.__globalProps` 注入后 JS 自行 padding；无 `<statusbar>` 元素（有人试过，不存在）。

### 1.3 自研通道的现成 API（实证：LynxView 4.0.1 `classes.jar`）

`com/lynx/tasm/LynxView.class` 字符串命中：`setGlobalProps`、`updateGlobalProps`、`sendGlobalEvent`、`sendGlobalEventToLepus`、`updateViewport`、`updateScreenMetrics`、`getKeyboardEvent`。即：

- **初始注入**：`lynxView.setGlobalProps(map)`（须在 `renderTemplateUrl` 前调）→ JS 侧 `lynx.__globalProps` 可读；
- **动态更新**：`lynxView.updateGlobalProps(map)` 或 `lynxView.sendGlobalEvent("evt", JavaOnlyArray)` → JS 侧 `getJSModule('GlobalEventEmitter').addListener(...)`（ADR-0066 `pictelioBack` 已在用同通道，可靠性已被本仓真机验证）。

### 1.4 键盘（keyboard insets）——原生有完整机制

实证（classes.jar，`com/lynx/tasm/behavior/KeyboardEvent*`）：
- `KeyboardMonitor`（读 `android.R.dimen.status_bar_height` + displayFrame 估算键盘高度，legacy 启发式）、`KeyboardEvent$KeyboardAvoidingContext`、`KeyboardEvent$KeyboardInsetsAnimationDispatcher`（**`WindowInsetsAnimation.Callback`**，API 30+ 平滑键盘动画）、`avoidKeyboard` + `spacing` 属性（挂在 UIBody）。
- 即：<input>/<textarea> 聚焦时键盘遮挡有 SDK 内建回避机制（需 UIBody 参与语义）；e2e 下键盘 insets 是 SDK 自己监听的（唯一在 Android 上动 WindowInsetsAnimation 的地方），不依赖容器。
- 佐证：`KeyboardMonitor.java` 与 `LynxOverlayDialog.kt` 是 Android 平台仅有的两处 `status_bar_height` 引用，都是 legacy dimen 启发式而非 WindowInsets API。

### 1.5 e2e 渲染正确性（问题 4）

- **未发现 LynxView 在 edge-to-edge 窗口下的已知渲染缺陷**（裁剪/触摸偏移）。issue 检索（edge-to-edge / cutout / WindowInsets / statusBar / safe area / keyboard avoid）无命中此类问题；LynxView 是普通 Android ViewGroup，渲染/触摸走标准 View 体系，落点是「容器给什么 bounds 就画哪」。
- 反例即官方示例：LynxExplorer 主页默认 `fullscreen=true`（`explorer/android/.../LynxViewShellActivity.java` `setStatusBarAppearance()`：`LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES` + `SYSTEM_UI_FLAG_FULLSCREEN|LAYOUT_FULLSCREEN` + `WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE`）——**官方自己的容器就是全屏/沉浸跑 LynxView**，未见相关反馈。
- 非全屏模式下官方容器用 `getWindow().setStatusBarColor(color)` 着色（API 35+ 已废弃但 ≤14 仍生效）。
- 相邻已知 bug（与 insets 无关）：`<textarea>` Android 15+ CJK 顶部裁剪 [#8485](https://github.com/lynx-family/lynx/issues/8485)（已修复）；iOS 刘海 SafeArea [#887](https://github.com/lynx-family/lynx/issues/887)（iOS 侧，已修）。

### 1.6 全屏 API（问题 5）

- **JS 侧无官方模块**：无 RN `StatusBar` 等价物；LynxView/LynxViewBuilder 字符串零命中 fullscreen/statusbar/immersive/cutout；SDK 提供的 NativeModules 表无此类模块；`<status-bar>` 元素不存在（#292 社区实测）。
- **ReactLynx 同构**：引擎层同源，无 StatusBar 组件；官方 [lynx-examples](https://github.com/lynx-family/lynx-examples) 唯一的 SafeArea 组件（`examples/swiper/src/Components/SafeArea/`）= iOS 硬编码 `padding-bottom: 20px`、Android 0——官方示例在 Android 上**根本没做**真 insets 处理。
- 结论：系统栏控制唯一正统路径 = 原生容器（Activity/Window API），JS 需要控制权时自建 NativeModule 桥。

### 1.7 本仓先例（自研通道成本锚点）

- `packages/app/android/app/src/lynx/java/io/pictelio/app/LynxActivity.java`：AppCompatActivity + `setContentView(lynxView)`，零 WindowInsets 代码；`addOnLayoutChangeListener` 记录内容区静态尺寸（ADR-0131）。
- `packages/app/android/app/src/lynx/java/io/pictelio/app/PictelioAppModule.java`：`getViewportSize(cb)`（cb(-1,-1) 哨兵契约）≈ 30 行；JS 侧 `viewportSizeBridge.ts` 消费（哨兵→回退 SystemInfo，no-op 降级显式）。
- JS 事件通道先例：`pictelioBack`（ADR-0066，`sendGlobalEvent` → `GlobalEventEmitter`）；benchNav 载荷通道（#542，数值载荷实测存活，**lynx 4.0.1 无 JavaOnlyString，字符串载荷不可走**——insets 载荷用 4 个数值即可，无此坑）。

---

## 2. 三候选方案改造面成本估算

> 共同背景：targetSdk 36 → Android 15+ 设备已强制 e2e（`windowOptOutEdgeToEdgeEnforcement` 对 targetSdk 36 忽略；`setStatusBarColor`、legacy `SYSTEM_UI_FLAG_*` 在 API 35+ 废弃/失效——[官方行为变更](https://developer.android.com/about/versions/15/behavior-changes-15)）。方案 A 只在 Android ≤14 设备有意义；Android 15+ 上三方案实际都落在 B/C 的世界里，差别只是「要不要补 insets 补偿」。

### 方案 A：状态栏着色（保持非 e2e 拟合，只染色）

| 层 | 改动 | 规模 |
| --- | --- | --- |
| 原生 | `LynxActivity.onCreate` 加 `WindowCompat.getInsetsController(...).setAppearanceLightStatusBars(...)` + `window.setStatusBarColor(主题色)`；亮暗主题跟随需读设置（settings KV 已有 PictelioPrefs 通道） | ~20-40 行 Java，1 文件 |
| JS | 零（布局不变，无需 insets 补偿）；若要求「按页面动态换色」才需加 JS→原生桥（PictelioAppModule 加 `setStatusBarStyle`，~30 行 + JS 调用点） | 0 或 ~40 行 |

- 限制：**Android 15+ 设备上 `setStatusBarColor` 失效**——着色在该批设备不可实现（系统栏半透明压在内容上）；效果 = 「短一截」的旧式布局。
- 风险：极低。预览无假绿面（浏览器无系统栏概念，两边都比不了）。

### 方案 B：边到边 + insets 补偿（推荐基线）

| 层 | 改动 | 规模 |
| --- | --- | --- |
| 原生 | ① `LynxActivity`：`setOnApplyWindowInsetsListener`（API 30 `WindowInsets.Type.systemBars()+displayCutout()`；API 28/29 走 deprecated `getSystemWindowInset*` 降级——minSdk 28 必须写）→ px→dp 换算（lynx CSS `px` = dp 等效，文档 [length](https://lynxjs.org/api/css/data-type/length)）→ 初始 `setGlobalProps`（`renderTemplateUrl` 前注入）+ 变化时 `sendGlobalEvent("pictelioInsetsChanged", [top,right,bottom,left])`；② 扩展 `PictelioAppModule.getSafeAreaInsets(cb)`（同 `getViewportSize` 契约风格，cb(-1,-1,-1,-1) 哨兵） | ~100-150 行 Java，2 文件 |
| JS | ① `rspeedy-env.d.ts`：GlobalProps 增 `status_bar_height`/`bottom_area_height` 等键 + 新事件/NativeModules 类型；② `src/utils/insetsStore.ts`（或扩展 viewportSizeBridge）：初始读 `lynx.__globalProps` → 订阅 GlobalEvent → 哨兵校验 + `console.warn` 降级；③ 消费点接线：顶部 TopBar/NavBar padding-top、底部 TabBar/FAB（ADR-0131 家族）padding-bottom；键盘已有原生 avoid 机制不重复做；④ 单测（纯函数几何 + 契约哨兵） | ~80-120 行 TS + 测试，3-6 文件 |

- 动态性：`onApplyWindowInsets` 在旋转/折叠屏重布局时由系统重新分发（现 `OnLayoutChangeListener` 同窗口触发），`sendGlobalEvent` 通道真机已验证——**旋转/折叠动态通知可行且及时**。
- e2e 正确性：无已知 LynxView 缺陷（§1.5）；LynxActivity 需补 `LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES`（P+，对齐 LynxExplorer 写法）。
- 收益：Android 15+ 强制 e2e 的正确性补课 + 沉浸式视觉一次达成；`__globalProps` 键名与官方维护者口径（`status_bar_height`/`bottom_area_height`）对齐，跨端合同可演进。

### 方案 C：全局全屏（隐藏状态栏，LynxExplorer homepage 模式）

| 层 | 改动 | 规模 |
| --- | --- | --- |
| 原生 | `WindowInsetsControllerCompat.hide(statusBars)` + `BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE` + cutout SHORT_EDGES（API 35+ legacy flags 无效，必须用 Controller） | ~30-50 行 Java，1 文件 |
| JS | 理论零补偿（系统栏消失）；但 transient 状态栏滑出时仍会遮顶——严格做仍需方案 B 的 insets 通道兜底；下拉手势与 app 内下拉刷新（webview 侧 pull-to-refresh 语义对齐件）存在手势冲突需实测 | 0 或等同 B |

- 限制：浏览类 app 隐藏状态栏 UX 存疑（时间/电量/信号不可见，媒体型应用才常规）；**web-core 预览完全无法模拟**（浏览器无此概念），纯真机验证面。
- 成本表面最小，但 UX 决策成本最高、手势冲突未知数最大。

**一句话对比**：A 在 Android 15+ 失效（不完整方案）；C 最小改动但 UX/手势风险最大、预览零覆盖；B 是唯一同时满足「Android 15+ 正确性」+「预览可部分模拟」的方案，成本 ≈ A+C 之和但全部落在已验证的通道上（getViewportSize 先例 + GlobalEventEmitter 先例）。

---

## 3. web-core 预览（0.23.1）差异清单（问题 6，逐条假绿/假红标注）

| 能力 | web-core 预览行为 | 风险 |
| --- | --- | --- |
| SystemInfo | **存在**（与旧注释「无此对象」不符的细节：`dist/client/background/index.js` 首个 onmessage 时 `globalThis.SystemInfo = message.systemInfo`；值 = `createSystemInfo()` = `{platform:'web', lynxSdkVersion:'3.0', pixelRatio, pixelWidth, pixelHeight}`，pixel* 来自 `window.screen.avail*×dpr`——`dist/client/mainthread/LynxViewInstance.js:28`）。字段集合与原生同构（无 insets），但 `avail*` 语义 ≠ 设备物理尺寸 | 假绿面小：数值不同但字段形状一致；本仓可选链探测契约（可能首条消息前读 → undefined）已是正确防御，保持 |
| `env(safe-area-inset-*)` | css-serializer 白名单原样透传 env()（`removeFunctionWhiteSpace.js`）→ **浏览器解析**：桌面预览恒 0；移动浏览器 + `viewport-fit=cover` 时非 0 | **最大假绿面**：Android 原生恒 0 vs 桌面预览 0 —— 现状一致是巧合；若误信 env() 通道，桌面预览绿、真机布局错。**禁止用 env() 通道，改用 __globalProps 通道后此风险消除**（见下条） |
| `lynx.__globalProps` 注入 | rspeedy `__web_preview` 查看器（web-rsbuild-server-middleware `www/static/js/index.js`）暴露 `setGlobalProps(obj)` console API（localStorage 持久化，动态重渲染） | **合同可模拟**：`setGlobalProps({status_bar_height:44, bottom_area_height:24})` 即可在预览端到端演练注入→消费链路。假绿面=手工 mock 值与真机不符（数值口径错），靠契约测试 + 真机抽查收敛 |
| NativeModules（getSafeAreaInsets 等） | 预览无原生模块；`viewportSizeBridge` 的 no-op 降级契约已存在并测试 | 假红面小：预览里 insets 永远走回退路径——回退是否可见需人工判断，不会假绿 |
| GlobalEvent（pictelioInsetsChanged 类） | web-core 无原生侧事件源；监听器注册无害、永不触发 | 假红面：预览无法验证动态更新，只能真机 |
| 状态栏/全屏控制 | 浏览器无系统栏概念 | 无假绿面（不做 JS 控制则无关） |
| 键盘回避 | web-core `dist/` 零 keyboard 代码（grep 证实）——预览键盘行为=浏览器原生 visualViewport，与真机 KeyboardMonitor/WindowInsetsAnimation 机制完全不同 | 假绿/假红都有：输入法相关交互必须真机验证（与 placeholder-color / custom-context-menu 家族同性质：预览能力≠原生能力） |

---

## 4. 关键陷阱汇总（给后续 spec/ticket）

1. **env() 陷阱**：Android 原生恒 0 且无报错——任何「用 env(safe-area-inset-*) 写 padding」的方案在真机静默失效；桌面预览恰好也 0，单看预览永远发现不了。
2. **字符串载荷陷阱**：lynx 4.0.1 `JavaOnlyArray` 无 String（#542 实测）——insets 事件载荷必须用数值数组 `[top,right,bottom,left]`。
3. **单位口径**：`SystemInfo.pixel*` 是物理像素；lynx CSS `px` 是 dp 等效（`ppx` 才是物理像素）——原生 insets px 必须除以 density 再发给 JS。
4. **API 28/29 降级**：`WindowInsets.Type.*` 是 API 30+；minSdk 28 必须写 deprecated 分支 + IO 边界测试（成功/降级双路径，测试硬约束 #1）。
5. **双 Activity 一致性**：MainActivity（webview 宿主）同样零 insets 代码——若走方案 B，webview 侧（CSS env() 在 WebView 里真值可用，与 lynx 不同）的对称处理是另一张票，勿混。
6. **Android 15+ 现状即裸奔**：targetSdk 36 下 e2e 已强制，当前真机（Android 15+）上系统栏直接压内容。任何「维持现状」的方案都要先回答「现状 = 已 e2e 零补偿」这一点。

## 参考来源

- 文档：[SystemInfo](https://lynxjs.org/api/lynx-api/global/system-info)、[CSS length 单位](https://lynxjs.org/api/css/data-type/length)、[Discussion #165](https://github.com/lynx-family/lynx/discussions/165)、[Issue #292](https://github.com/lynx-family/lynx/issues/292)、[Issue #299](https://github.com/lynx-family/lynx/issues/299)、[Android 15 行为变更](https://developer.android.com/about/versions/15/behavior-changes-15)、[edge-to-edge 指南](https://developer.android.com/develop/ui/views/layout/edge-to-edge)
- 仓库源码：`lynx-family/lynx`：`core/renderer/css/computed_css_style.cc`（SAFE_AREA_INSET_* 缺省 0）、`platform/darwin/common/lynx/LynxEnv.mm`（iOS 写入者）、`platform/embedder/core/lynx_template_renderer.cc`、`explorer/android/.../LynxViewShellActivity.java`（官方容器系统栏模式）、`ai/skills/lynx-api-docs/.../css/values-and-units.md`；`lynx-family/lynx-examples`：`examples/swiper/src/Components/SafeArea/`
- 本地实证：`~/.gradle/caches/modules-2/files-2.1/org.lynxsdk.lynx/lynx/4.0.1/`（liblynx.so 字符串 + classes.jar 反编译）；`packages/app-lynx/node_modules/@lynx-js/web-core@0.23.1`（createSystemInfo / background 注入 / LynxViewElement globalProps）；`packages/app/android/app/src/lynx/java/io/pictelio/app/{LynxActivity,PictelioAppModule}.java`；`packages/app/android/variables.gradle`（targetSdk 36）

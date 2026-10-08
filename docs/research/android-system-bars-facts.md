# Android 系统栏三方案平台事实调研（targetSdk 36）

> 票 [#592](https://github.com/a1121611810/Pictelio/issues/592)（父地图 [#591](https://github.com/a1121611810/Pictelio/issues/591)：lynx 系统栏模式选型）。调研日期：2026-09-18。来源以 developer.android.com 官方文档与 androidx 官方源码（android.googlesource.com）为准，二手来源仅一处且已标注。
>
> 本项目锚点：targetSdkVersion=36、compileSdk=36、minSdk=28、androidx.activity 1.11.0 / androidx.core 1.17.0 / core-splashscreen 1.2.0、宿主 Activity=AppCompatActivity（AppCompat DayNight 主题，无 statusBarColor 定制）、LynxActivity 无 WindowInsets 代码、AndroidX SplashScreen 启动屏。

---

## 一、平台事实清单

### 1. 强制 edge-to-edge 时序

**F1.1 强制语义 = 双重门控（targetSdk ≥ 35 **且** 设备 ≥ Android 15）**

- 引文（官方 e2e 指南）："Once you target SDK 35 or higher on a device running Android 15 or higher, your app is displayed edge-to-edge. The window spans the entire width and height of the display by drawing behind the system bars." 以及 "Important: Edge-to-edge is enforced on Android 15 (API level 35) and higher once your app targets SDK 35."
- 引文（behavior-changes-15）："Apps are edge-to-edge by default on devices running Android 15 if the app is targeting Android 15 (API level 35)."
- 适用范围：Android 15+ 设备 × targetSdk 35+ 应用。两个条件缺一不可。
- 来源：https://developer.android.com/develop/ui/views/layout/edge-to-edge ；https://developer.android.com/about/versions/15/behavior-changes-15

**F1.2 `windowOptOutEdgeToEdgeEnforcement` 生命周期（设备门控，精确到组合）**

- Android 15（targetSdk 35）："Android 15 enforced edge-to-edge for apps targeting Android 15 (API level 35), but your app could opt-out by setting R.attr#windowOptOutEdgeToEdgeEnforcement to true."
- Android 16（targetSdk 36）："For apps targeting Android 16 (API level 36), R.attr#windowOptOutEdgeToEdgeEnforcement is deprecated and disabled, and your app can't opt-out of going edge-to-edge."
- **设备门控细节（关键，常被误读为「targetSdk 36 就全禁」）**：
  - "If your app targets Android 16 (API level 36) and is running on an Android 15 device, R.attr#windowOptOutEdgeToEdgeEnforcement **continues to work**."
  - "If your app targets Android 16 (API level 36) and is running on an Android 16 device, R.attr#windowOptOutEdgeToEdgeEnforcement **is disabled**."
- 即：opt-out 属性是否有效取决于**运行设备的 API 级别**（15 上有效、16 上禁用），而「是否强制」取决于 targetSdk ≥ 35 + 设备 ≥ 15（F1.1）。Android 16 起官方不再提供任何 opt-out 路径。
- 来源：https://developer.android.com/about/versions/16/behavior-changes-16

**F1.3 e2e 强制下的系统栏形态**

- 状态栏：透明默认；手势导航栏：透明默认；**三键导航栏：80% 不透明度默认，颜色默认取窗口背景**（"Opacity set to 80% by default, with color possibly matching the window background"）。
- 显示 cutout："layoutInDisplayCutoutMode of non-floating windows must be LAYOUT_IN_DISPLAY_CUTOUT_MODE_ALWAYS. SHORT_EDGES, NEVER, and DEFAULT are interpreted as ALWAYS"——非 floating 窗口的 cutout 模式一律按 ALWAYS 解释。
- 来源：https://developer.android.com/about/versions/15/behavior-changes-15

**F1.4 e2e 强制带来的配置与测量变化（API 35 起）**

- Configuration 不再排除系统栏区域（`screenWidthDp`/`screenHeightDp`/`smallestScreenWidthDp`/`orientation`/`Display.getSize()` 均含系统栏）；官方要求改用 WindowInsets / WindowMetrics。
- 来源：https://developer.android.com/about/versions/15/behavior-changes-15

**F1.5 SplashScreen 启动崩溃修复路径**

- 原文："If your app crashes on launch, this might be due to your splashscreen. You can either upgrade the core splashscreen dependency to 1.2.0-alpha01 or later or set window.attributes.layoutInDisplayCutoutMode = WindowManager.LayoutInDisplayCutoutMode.always."
- 本项目 core-splashscreen **1.2.0 stable ≥ 1.2.0-alpha01**，已含修复，无启动崩溃风险。
- 来源：https://developer.android.com/about/versions/15/behavior-changes-15

### 2. `setStatusBarColor` / `setNavigationBarColor` 语义

**F2.1 弃用后行为 = 静默透明（无异常）**

- `Window.setStatusBarColor(int)`："This method was deprecated in API level 35. Draw proper background behind WindowInsets.Type.statusBars() instead."
- **targetSdk 门控原文**："If the app targets VANILLA_ICE_CREAM or above, the color will be transparent and cannot be changed."（VANILLA_ICE_CREAM = API 35）
- `setNavigationBarColor` / 对应 XML attr（`android:statusBarColor`、`android:navigationBarColor`）同款语义。行为是**静默忽略**（颜色变透明且不可改），**不抛异常**。
- 来源：https://developer.android.com/reference/android/view/Window#setStatusBarColor(int) （同页 setNavigationBarColor / setDecorFitsSystemWindows 各节）

**F2.2 着色方案在各 API 级别的真实存活面**

| 场景 | 状态栏着色 | 依据 |
| --- | --- | --- |
| targetSdk ≥ 35 应用 × Android 15/16+ 设备 | **死**（静默透明） | F2.1 原文 |
| targetSdk ≥ 35 应用 × Android ≤ 14 设备 | **活** | 「transparent and cannot be changed」的 gate 位于 Android 15 框架实现；Android ≤14 框架无此 gate（高置信推导，非文档原句） |
| targetSdk ≤ 34 应用 × 任意设备 | **活**（需 `FLAG_DRAWS_SYSTEM_BAR_BACKGROUNDS` 已设且 `FLAG_TRANSLUCENT_STATUS` 未设） | Window reference 原文条件 |

- 前置条件原文："For this to take effect, the window must be drawing the system bar backgrounds with WindowManager.LayoutParams.FLAG_DRAWS_SYSTEM_BAR_BACKGROUNDS and WindowManager.LayoutParams.FLAG_TRANSLUCENT_STATUS must not be set."

**F2.3 导航栏颜色的唯一特例（三键导航）**

- behavior-changes-15 的 deprecated-but-not-disabled 清单含 "Window#setNavigationBarColor (for 3-button navigation, with 80% alpha)"；deprecated-and-disabled 清单含 "Window#setNavigationBarColor (for gesture navigation)"。
- 即 targetSdk 35+ 下导航栏着色仅在**三键导航**设备仍部分生效（叠加 80% alpha）；手势导航下无效。
- **状态栏颜色没有任何存活特例**——targetSdk 35+ 全场景透明。
- 来源：https://developer.android.com/about/versions/15/behavior-changes-15

**F2.4 对比度 scrim（过渡期仍有效）**

- "setStatusBarContrastEnforced and statusBarContrastEnforced are deprecated but still have an effect on Android 15."（状态栏）；三键导航栏 `setNavigationBarContrastEnforced` 默认 true → 80% scrim。
- 来源：https://developer.android.com/about/versions/15/behavior-changes-15

### 3. 全局全屏 immersive（`WindowInsetsController.hide`）

**F3.1 API 可用性与 compat 要求（minSdk 28 强相关）**

- 平台 `WindowInsetsController` 为 API 30+。minSdk 28 → 必须用 `WindowInsetsControllerCompat`：
  "For SDKs >= 30, this class is a simple wrapper around WindowInsetsController. For lower SDKs, this class aims to behave as close as possible to the original implementation."
- androidx 内部分层（源码）：Impl23（API 23-25，legacy systemUiVisibility flags）/ Impl26 / Impl30 / Impl35。
- 来源：https://developer.android.com/reference/android/view/WindowInsetsController ；androidx 源码 https://android.googlesource.com/platform/frameworks/support/+/refs/heads/androidx-main/core/core/src/main/java/androidx/core/view/WindowInsetsControllerCompat.java

**F3.2 `hide()` 的窗口作用域与重设时机**

- 原文："Note that if the window currently doesn't have control over a certain type, it will apply the change as soon as the window gains control."
- 语义：隐藏请求挂在**窗口**上；窗口短暂失去控制（如下拉通知栏）后框架会重新应用。但 **Activity 重建 = 新 Window = 默认全显状态**，必须在 onCreate（或 onResume）重新调用 hide。文档未承诺跨重建保留。
- 来源：WindowInsetsController.hide() / WindowInsetsControllerCompat.hide()（同 F3.1 来源）

**F3.3 transient bars 行为（手势唤出）**

- `BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE`："When system bars are hidden in this mode, they can be revealed temporarily with system gestures, such as swiping from the edge of the screen where the bar is hidden from. These transient system bars will overlay app's content, may have some degree of transparency, and will automatically hide after a short timeout."
- `BEHAVIOR_DEFAULT` 同样支持边缘唤出，且："When the gesture navigation is enabled, the system gestures can be triggered regardless the visibility of system bars."——**手势导航的系统手势（含返回）在系统栏隐藏状态下照常触发**。
- 来源：https://developer.android.com/reference/android/view/WindowInsetsController （同 F3.1 androidx 源码）

**F3.4 遗留行为常量已废弃**

- `BEHAVIOR_SHOW_BARS_BY_TOUCH`："This constant was deprecated in API level 31. This is not supported on Android Build.VERSION_CODES.S and later."
- `BEHAVIOR_SHOW_BARS_BY_SWIPE`：API 30 加入、API 31 弃用。
- 唯一非弃用选项：`BEHAVIOR_DEFAULT` 与 `BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE`。
- 来源：https://developer.android.com/reference/android/view/WindowInsetsController

**F3.5 遗留 `systemUiVisibility` 混用坑**

- androidx KDoc 原文（`setAppearanceLightStatusBars` / `isAppearanceLightStatusBars`）："Once this method is called, modifying `systemUiVisibility` directly to change the appearance is undefined behavior."
- 推论：一旦走 insets controller 路径，**禁止**再读写 `View.getSystemUiVisibility/setSystemUiVisibility`（该 API 本身在 API 30 弃用）——旧 flag 与新 controller 混用是未定义行为，这是从旧代码迁移时最常见的坑。
- 来源：androidx WindowInsetsControllerCompat 源码（F3.1）；https://developer.android.com/reference/android/view/View#setSystemUiVisibility(int)

**F3.6 手势导航边缘手势与 immersive 的关系（图片查看器冲突面）**

- back 手势定义："The new system gesture for back is an inward swipe from either the left or the right edge of the screen. This might interfere with app navigation elements in those areas."
- 结合 F3.3：**immersive（隐藏系统栏）既不消除、也不缓解左右边缘的 back 手势冲突**——它与系统栏可见性无关。
- 缓解手段 = `View.setSystemGestureExclusionRects`（API 29+，ViewCompat 同样支持），仅可豁免 back 手势；底部 home/quick-switch 手势不可豁免："Apps can't opt out of these gestures as they can with the back gesture."
- **排除限额**（官方 Android Devs 博客，非 reference 正文）：系统对每条边的排除区有约 **200dp** 上限，超出部分静默忽略——见 Chris Banes《Gesture navigation: handling gesture conflicts (III)》 https://medium.com/androiddevelopers/gesture-navigation-handling-gesture-conflicts-8ee9c2665c69 （二手但 Google 官方博客；reference 正文只说"selectively opt out"未给数值）。
- 官方对 immersive 的定位原文（gesturenav 页）："If a game requires the user to swipe near the home gesture area, the app can request to be laid out in immersive mode. This disables the system gestures while the user is interacting with the game, but lets the user re-enable the system gestures by swiping from the bottom of the screen."——官方语境中 immersive 是**游戏/媒体局部场景**手段，且隐藏导航栏期间会**禁用**系统手势（以底部滑动唤回为代价）。
- 来源：https://developer.android.com/develop/ui/views/touch-and-input/gestures/gesturenav ；https://developer.android.com/training/gestures/edge-to-edge （system gesture insets："System gesture insets represent the areas of the window where system gestures take priority over your app."）

**F3.7 预测性返回（Android 16 / targetSdk 36 默认开启）**

- 原文（behavior-changes-16）："For apps targeting Android 16 (API level 36) or higher and running on an Android 16 or higher device, the predictive back system animations (back-to-home, cross-task, and cross-activity) are enabled by default. Additionally, `onBackPressed` is not called and `KeyEvent.KEYCODE_BACK` is not dispatched anymore."
- 临时退出：`android:enableOnBackInvokedCallback="false"`；官方要求迁移到 `OnBackPressedDispatcher` / `OnBackInvokedCallback`。
- 与 immersive 的关系：预测性返回动画由左右边缘 back 手势驱动（F3.6），隐藏系统栏不影响其触发。冲突面在**应用内边缘横滑 UI（如图片查看器左右翻页）与 back/预测动画的手势争夺**，immersive 无法缓解，只能靠 exclusion rects 部分缓解。
- 来源：https://developer.android.com/about/versions/16/behavior-changes-16

**F3.8 三键导航设备**

- 文档未记录 transient reveal 在两种导航模式下的差异（hide/transient 语义通用）；实际差异在**非隐藏状态**下的 e2e 形态（F1.3：三键导航 80% scrim）。immersive + 三键导航无文档级障碍。
- 来源：https://developer.android.com/reference/android/view/WindowInsetsController （transient 语义通用表述）

**F3.9 immersive 与 e2e 强制的关系（正交维度）**

- e2e 强制约束的是**布局**（内容绘制到系统栏下）；immersive 约束的是**系统栏可见性**。`hide()` 不豁免 F1.1 的布局强制 → 选 C 仍需完整 insets 处理（cutout、transient bars 短暂出现时的避让），布局工作量与方案 B 完全相同。
- 来源：F1.1 与 F3.2 引文的直接组合推论。

### 4. 配套事实

**F4.1 状态栏图标深浅切换（`setAppearanceLightStatusBars`）**

- KDoc："If true, changes the foreground color of the status bars to light so that the items on the bar can be read clearly. If false, reverts to the default appearance."
- API 级别分层（androidx 源码）：API 23-29 走 `View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR`（自动设 `FLAG_DRAWS_SYSTEM_BAR_BACKGROUNDS`、去 `FLAG_TRANSLUCENT_STATUS`）；API 30+ 走 `WindowInsetsController.setSystemBarsAppearance`；API 35+ 有专用 Impl35。`isAppearanceLightNavigationBars` 需 API 26+（Impl26 起）。**minSdk 28 全覆盖可用**。
- getter 注意："If this value is being set in the theme (via android.R.attr#windowLightStatusBar), then the correct value will only be returned once attached to the window."
- 两种模式下的可用性：e2e 透明模式下它是控制图标颜色的**唯一正规途径**（官方指南："You can use the WindowInsetsControllerCompat API instead of theme.xml to control the status bar's content color"，指南示例 `isAppearanceLightStatusBars = false`）；着色模式（Android ≤14）下也可独立使用（控制前景色，与背景着色不冲突）。
- 来源：androidx WindowInsetsControllerCompat 源码（F3.1）；https://developer.android.com/develop/ui/views/layout/edge-to-edge ；https://developer.android.com/develop/ui/views/layout/edge-to-edge-manually

**F4.2 `enableEdgeToEdge` / `WindowCompat.setDecorFitsSystemWindows`**

- 官方推荐路径："If your app targets SDK 35 or later, edge-to-edge is automatically enabled for Android 15 devices or later. To enable edge-to-edge on previous Android versions, manually call enableEdgeToEdge in onCreate of your Activity."
- 默认行为："By default, enableEdgeToEdge() makes the system bars transparent, except on 3-button navigation mode where the navigation bar gets a translucent scrim. The colors of the system icons and the scrim are adjusted based on the system light or dark theme." 三键 scrim 如需全透明："set Window.setNavigationBarContrastEnforced to false otherwise there will be a translucent scrim applied."
- 当前官方文档示例为 `WindowCompat.enableEdgeToEdge(window)`（androidx.core 1.16+ 提供，本项目 core 1.17.0 可用）；`ComponentActivity.enableEdgeToEdge()`（androidx.activity 1.8.0+，本项目 1.11.0 可用）在 androidx-main HEAD 已标记 deprecated 并指向 core 变体，功能不变。
- **内部实现（androidx 源码，EdgeToEdge.kt）**：Api35 分支执行 `WindowCompat.setDecorFitsSystemWindows(window, false)` + 透明 bar 色；API 28+ 分支自动调 `window.attributes.layoutInDisplayCutoutMode = LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES`（Api28 基类）→ 调用 enableEdgeToEdge 即自动免除 F1.5 的 cutout 崩溃面。Api30 分支还统一设置 `isAppearanceLightStatusBars/isAppearanceLightNavigationBars`（按暗色模式）。
- `Window.setDecorFitsSystemWindows`："This method was deprecated in API level 35." 且 "If the app targets VANILLA_ICE_CREAM or above, the behavior will be like setting this to false, and cannot be changed." → **targetSdk 36 下无法用它「关掉」e2e**；manual 手动路径仅服务于 Android ≤14。
- 手动路径三步（manual 页，明确 "not recommended"）：`WindowCompat.setDecorFitsSystemWindows(window, false)` + themes.xml 透明系统栏（values-v29 示例，可配 `android:enforceNavigationBarContrast`/`android:enforceStatusBarContrast=false` 关自动 scrim）+ insets 处理。已知坑：Android ≤14 上手动路径三步缺一会出现半截 e2e（部分页面遮挡/黑条）；且 `setDecorFitsSystemWindows(true)` 路径会检视已弃用的 `SYSTEM_UI_LAYOUT_FLAGS` 与 `SOFT_INPUT_ADJUST_RESIZE`（Window reference 原文），IME 行为与旧 flag 强耦合——手动路径的 IME 联动（adjustResize 失效）是 Google Issue Tracker 广泛报告的坑，非本文档原句断言。
- 来源：https://developer.android.com/develop/ui/views/layout/edge-to-edge ；https://developer.android.com/develop/ui/views/layout/edge-to-edge-manually ；androidx 源码 https://android.googlesource.com/platform/frameworks/support/+/refs/heads/androidx-main/activity/activity/src/main/java/androidx/activity/EdgeToEdge.kt ；Window reference（F2.1 同页）

**F4.3 AndroidX SplashScreen 衔接**

- 调用顺序硬要求："Call installSplashScreen in the starting activity before calling super.onCreate()."
- Android 12+ 由平台接管启动屏，compat 库统一各版本观感（"the compat library uses the SplashScreen API, enables backward-compatibility, and creates a consistent look and feel"）。
- 与三种窗口模式的衔接点即 F1.3（cutout 强制 ALWAYS）+ F1.5（崩溃修复，本项目 1.2.0 已含）+ F4.2（enableEdgeToEdge 自动调 cutout mode）。文档未记录 SplashScreen 与三种窗口模式的其他直接冲突——即三种方案对 SplashScreen 均无额外改造需求，只要启动链路保留 `installSplashScreen()` 前置于 `super.onCreate()`。
- 来源：https://developer.android.com/develop/ui/views/launch/splash-screen/migrate ；https://developer.android.com/about/versions/15/behavior-changes-15

---

## 二、三方案平台顺应度评级

### 方案 A：状态栏着色（保留非 e2e 布局 + 着色状态栏）

**评级：逆行**

- targetSdk 36 × Android 15/16 设备：**完全不可行**——着色被静默透明（F2.1），且 Android 16 设备连 opt-out 属性都禁用（F1.2）。
- 仅 Android ≤14 设备存活（F2.2）→ 实际交付物必然是「15+ 强制透明 e2e + ≤14 着色」的**永久双形态分裂**，方案 A 作为统一策略并不真正存在。
- 平台无任何恢复路径：无 opt-out、无新 API 支持着色；与 Android 15 起的既定方向正面相悖。

### 方案 B：边到边（enableEdgeToEdge + insets 消费）

**评级：顺应（唯一长期可行）**

- 平台自 Android 15 起的缺省与强制方向（F1.1）；本项目 targetSdk 36 在 15+ 设备上**现在就已经是 e2e**，选 B 只是把 Android ≤14 设备拉齐到同一形态，消灭双形态分裂。
- 官方 API 齐备且向后兼容由 compat 层封装：`WindowCompat.enableEdgeToEdge(window)` / `enableEdgeToEdge()` 一行调用自动处理透明、深浅图标、三键 scrim、cutout mode（F4.2）；三键导航 80% scrim 可按需关闭。
- minSdk 28 全兼容（F4.1/F4.2 分层实现）；`windowOptOutEdgeToEdgeEnforcement` 及任何 theme 级 hack 均不需要也不应该用。

### 方案 C：全局全屏 immersive（隐藏系统栏 + transient 唤出）

**评级：过渡（技术上存活，作为全局默认逆平台惯例；限局部场景可接受）**

- 技术上完全可用且平台不禁止（官方 insets API，F3.x）；transient bars 机制官方支持。
- 但官方语境中 immersive 定位为**游戏/媒体等局部场景**（F3.6 引文），作为全局默认模式与平台假设相悖。
- 冲突面（手势导航设备，本项目主场景）：
  - 左右边缘 back 手势在系统栏隐藏状态下照常触发（F3.3），图片查看器左右翻页的边缘滑动与 back/预测性返回动画直接争夺手势；immersive 不缓解（F3.6/F3.7），只能 `setSystemGestureExclusionRects` 部分缓解且受 200dp/边限额。
  - 底部 home 手势不可豁免（F3.6）；transient bars 会 overlay 应用内容，翻页手势可能连带唤出系统栏（F3.3）。
  - Activity 重建后必须重设 hide（新 Window 默认全显，F3.2）。
- **不豁免 e2e 布局强制**（F3.9）→ insets 工程量与方案 B 相同，净收益仅「默认看不见系统栏」。
- minSdk 28 → 必须走 `WindowInsetsControllerCompat`（F3.1）；迁移后禁止混用 `systemUiVisibility`（F3.5）。

---

## 三、对本项目的直接推论

1. **targetSdk 36 在 Android 15/16 真机上现在就已经强制 e2e**（F1.1/F1.2）——不是「将来会」，是「已生效」。LynxActivity/MainActivity 目前无任何 insets 代码 → 15+ 设备上内容已绘制在系统栏下，顶部/底部元素存在被遮挡风险；且在 Android 16 设备上不存在任何合法 opt-out。
2. **Android 14 模拟器不受强制**（F1.1 设备门控）：行为仍是非 e2e、`statusBarColor` 可用。用 Android 14 模拟器验证系统栏行为会得出与真机相反的结论；**测试矩阵必须以 Android 15/16 设备为基准**。
3. 方案 A 在本项目已死一半：只能作为 ≤14 设备的遗留分支存在；选 A 的实际交付物是「A(≤14) + B(15+)」双形态，成本更高且随设备升级持续恶化。
4. 若选 B：`WindowCompat.enableEdgeToEdge(window)`（或 `ComponentActivity.enableEdgeToEdge()`）在宿主 Activity onCreate 调用即可统一 API 28-34 与 35+ 行为；图标深浅统一走 `WindowInsetsControllerCompat.isAppearanceLightStatusBars`（随 DayNight 主题切换）；三键导航 scrim 如需全透明须 `setNavigationBarContrastEnforced(false)`。剩余工程量在 insets 消费（Lynx 容器/WebView 页面避让 padding）。
5. 若选 C：必须在每个宿主 Activity onCreate 调 `WindowInsetsControllerCompat(window, decorView).hide(WindowInsetsCompat.Type.systemBars())` + `setSystemBarsBehavior(BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE)`，并在重建后重设；insets 布局处理照做（F3.9）；图片查看器翻页区域如需对抗 back 手势，用 `setSystemGestureExclusionRects`（≤200dp/边，仅手势导航设备有意义）。作为全局默认的 UX/平台摩擦大，仅建议限局部场景（如 ImageViewer 全屏态）。
6. 附带风险旗标（超出本票范围，建议单开票验证）：targetSdk 36 + Android 16 设备上 `onBackPressed` 不再被调用、`KEYCODE_BACK` 不再派发（F3.7）——Capacitor backButton 事件链路（`@capacitor/app`）与本项目 `backGestureStore`/双击退出链路是否依赖旧路径需要实测；官方迁移路径为 `OnBackPressedDispatcher`。

---

## 四、来源清单

| # | 来源 | 类型 |
| --- | --- | --- |
| 1 | https://developer.android.com/about/versions/15/behavior-changes-15 | 官方（F1.1/F1.3/F1.4/F1.5/F2.3/F2.4） |
| 2 | https://developer.android.com/about/versions/16/behavior-changes-16 | 官方（F1.2/F3.7） |
| 3 | https://developer.android.com/develop/ui/views/layout/edge-to-edge | 官方指南（F1.1/F4.1/F4.2） |
| 4 | https://developer.android.com/develop/ui/views/layout/edge-to-edge-manually | 官方指南（F4.2） |
| 5 | https://developer.android.com/reference/android/view/Window | 官方 API 参考（F2.1/F2.2/F4.2） |
| 6 | https://developer.android.com/reference/android/view/WindowInsetsController | 官方 API 参考（F3.1-F3.4/F3.8） |
| 7 | androidx 源码：https://android.googlesource.com/platform/frameworks/support/+/refs/heads/androidx-main/core/core/src/main/java/androidx/core/view/WindowInsetsControllerCompat.java | 官方源码（F3.1/F3.2/F3.5/F4.1） |
| 8 | androidx 源码：https://android.googlesource.com/platform/frameworks/support/+/refs/heads/androidx-main/activity/activity/src/main/java/androidx/activity/EdgeToEdge.kt | 官方源码（F4.2） |
| 9 | https://developer.android.com/develop/ui/views/touch-and-input/gestures/gesturenav | 官方指南（F3.6） |
| 10 | https://developer.android.com/training/gestures/edge-to-edge | 官方培训（F3.6 system gesture insets） |
| 11 | https://developer.android.com/develop/ui/views/launch/splash-screen/migrate | 官方指南（F4.3） |
| 12 | https://medium.com/androiddevelopers/gesture-navigation-handling-gesture-conflicts-8ee9c2665c69 | Google 官方博客（二手，仅 200dp 排除限额一处） |

# 平台兼容性

## 最低要求

| 层级 | 最低版本 | 检测方式 | 不满足时的行为 |
|---|---|---|---|
| **Android OS** | **9.0**（API 28） | `minSdkVersion = 28`（`variables.gradle`） | 系统拒绝安装（安装包层面拦截） |
| **WebView** | **Chrome 85**（主版本号 ≥ 85） | 启动时经 `WebViewAvailability`（`WebView.getCurrentWebViewPackage()`）获取主版本号 | **缺省引擎为 Lynx（ADR-0164）**：Lynx 可用时缺省以 Lynx 启动，WebView 版本是降级目标的门槛；Lynx 也不可用时显示静态 HTML 双失败升级页。webview / lynx 单引擎包维持原行为 |

## 决定依据

基于 `f7ba9e3d`（v3.5.4）代码基线的逐层分析：

### 硬崩溃项（不满足必定闪退或白屏）

| # | 层 | 制约项 | 最低要求 | 说明 |
|---|---|---|---|---|
| 1 | JS 语法 | `?.`（117 处）+ `??`（160 处）— `build.target: "esnext"` 不转译 | Chrome 80 | 语法解析阶段直接抛 `SyntaxError` → 白屏 |
| 2 | Fluent UI | `document.adoptedStyleSheets.push()` — Chrome 73–79 返回冻结数组 | Chrome 80 | `setTheme()` 注入令牌时抛 `TypeError` → Bootstrap 失败 |
| 3 | Fluent UI | `this.attachInternals()` — 表单关联组件构造函数 | Chrome 77（已被 #2 覆盖） | Fluent 组件构造失败 |
| 4 | Web API | `Promise.any()` — `imageLoader.ts` 图片加载核心路径 | Chrome 85 | 任何图片加载触发 `TypeError` |

综合最小值由 #4 `Promise.any` 决定：**Chrome 85**。

> **已知债务（ADR-0145 review 记录）**：ES2023 `Array.prototype.toSorted`（Chrome 110+）已在既有代码（`SideNavShell.tsx`、`NovelDetail.tsx`、`imageHostStore.ts`、`utils/searchMerger.ts`）与 2026-09 保存功能（`PagePickerSheet.tsx`）使用。Chrome 85–109 的 WebView 上触及相应代码路径会抛 `TypeError`。既有行为，未提升 `MIN_WEBVIEW_MAJOR_VERSION`；提升前应在升级验证批次中一并评估。

### 软降级项（布局/视觉缺陷，不闪退）

| # | 项 | 最低要求 | 说明 |
|---|---|---|---|
| A | `gap` 在 flex 容器（80+ 处） | Chrome 84 | 元素间距丢失，粘在一起 |
| B | `aspect-ratio`（11 处） | Chrome 88 | 图片容器高度为 0 |
| C | `clamp()`（4 处 hero 字号） | Chrome 79 | 标题字号回退为默认值 |

## 实现细节

### 安装拦截（Android OS）

`variables.gradle` 中 `minSdkVersion = 28` 在编译时写入 APK 的 `AndroidManifest.xml`。安装时 Android 系统的 `PackageManagerService` 校验该值，低于 28 的设备直接拒绝，显示系统标准提示。

### 引擎决策与双向降级（应用内，ADR-0164）

**缺省引擎为 Lynx**（`pictelio_client_kind` 缺省语义翻转，仅 full 包可感知）。启动决策收敛在 `io.pictelio.app.engine.EngineRouting`（单一决策模块，`PictelioApp` 预热与 `MainActivity` 路由共用同一 `resolve`）：

- **WebView 探测**：`WebViewAvailability`（framework API）取主版本号，阈值 `OAuthConfig.MIN_WEBVIEW_VERSION`（85）；无法获取版本号（-1）**放行**（fail-open，避免误杀非标准 WebView 实现）——口径与历史版本一致
- **Lynx 探测**：`LynxRuntimeInitializer.isAvailable()`（包能力含 lynx ∧ 初始化不抛异常 ∧ `LynxEnv.isNativeLibraryLoaded()`）
- **双向降级**：首选 Lynx 而预检不可用 → 本次以 WebView 生效（写生效状态快照，**不改写首选**）；首选 WebView 而 WebView 过低且 Lynx 可用 → 本次以 Lynx 生效（ADR-0153 保持）
- **运行时硬错误**（bundle 加载失败 / 致命渲染错误 9902·990200·InstantiationException）：自动回退 WebView 一次并写**失败记忆**（versionCode 精确匹配，应用升级自动遗忘）；**10s 加载超时不自动跳**（手动错误页）。设备级开关 `pictelio_engine_auto_fallback`（缺省开）控制运行时自动跳
- **无障碍回退**：系统无障碍服务启用 ∧ 两引擎均可用 → 以 WebView 生效；WebView 不可用时仍以 Lynx 兜底
- **双失败**（Lynx 不可用 ∧ WebView < 85）：静态升级页 `res/raw/upgrade.html?reason=no_engine`（纯静态、零外部资源、ES5 JS，兼容 Chrome 30+；不初始化 Capacitor Bridge / 插件 / JS 运行时）
- `webview` / `lynx` 单引擎包不参与引擎决策降级（维持原行为）

### 版本阈值更新

若需调整最低 WebView 版本，只需修改 `config/OAuthConfig.java` 中的常量：

```java
public static final int MIN_WEBVIEW_VERSION = 85;
```

## 不支持的场景

以下场景即使 Android 9+ 也无法运行：

- **无 Google Play 服务的设备**（如部分华为鸿蒙、Amazon Fire）：无法获取 WebView 更新，系统 WebView 版本可能停留在出厂版本。建议通过 APK 侧载最新 Chrome 或 Android System WebView。
- **Android 9 以下设备**：安装阶段即被拦截，无任何应用内提示。如需支持，需继续降低 `minSdkVersion`，并处理 Java API 差异（如 `Set.of`/`List.of` 等集合工厂方法需替代）、`build.target` 降级、及多个 polyfill。

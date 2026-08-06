# 平台兼容性

## 最低要求

| 层级 | 最低版本 | 检测方式 | 不满足时的行为 |
|---|---|---|---|
| **Android OS** | **9.0**（API 28） | `minSdkVersion = 28`（`variables.gradle`） | 系统拒绝安装（安装包层面拦截） |
| **WebView** | **Chrome 85**（主版本号 ≥ 85） | `MainActivity.onCreate()` 中通过 `WebView.getCurrentWebViewPackage()` 获取主版本号 | 显示静态 HTML 升级提示页，不启动应用主体 |

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

### 软降级项（布局/视觉缺陷，不闪退）

| # | 项 | 最低要求 | 说明 |
|---|---|---|---|
| A | `gap` 在 flex 容器（80+ 处） | Chrome 84 | 元素间距丢失，粘在一起 |
| B | `aspect-ratio`（11 处） | Chrome 88 | 图片容器高度为 0 |
| C | `clamp()`（4 处 hero 字号） | Chrome 79 | 标题字号回退为默认值 |

## 实现细节

### 安装拦截（Android OS）

`variables.gradle` 中 `minSdkVersion = 28` 在编译时写入 APK 的 `AndroidManifest.xml`。安装时 Android 系统的 `PackageManagerService` 校验该值，低于 28 的设备直接拒绝，显示系统标准提示。

### WebView 版本检测（应用内）

`MainActivity.onCreate()` 在最早期（`registerPlugin()` 和 `super.onCreate()` 之前）执行检测：

```java
private static final int MIN_WEBVIEW_MAJOR_VERSION = 85;

private static int getWebViewMajorVersion() {
    PackageInfo pi = WebView.getCurrentWebViewPackage();
    if (pi == null || pi.versionName == null) return -1;
    int dotIdx = pi.versionName.indexOf('.');
    return dotIdx > 0 ? Integer.parseInt(pi.versionName.substring(0, dotIdx)) : -1;
}

private boolean isWebViewVersionOk() {
    int major = getWebViewMajorVersion();
    if (major < 0) return true;   // 检测失败保守放行
    return major >= MIN_WEBVIEW_MAJOR_VERSION;
}
```

- 无法获取版本号时（返回 -1）**放行**，避免误杀非标准 WebView 实现
- 降级页面为纯静态 HTML（`res/raw/upgrade.html`），零外部资源，ES5 JS，兼容 Chrome 30+
- 不初始化 Capacitor Bridge、任何插件、JS 运行时，最小化内存占用

### 版本阈值更新

若需调整最低 WebView 版本，只需修改 `MainActivity.java` 中的常量：

```java
private static final int MIN_WEBVIEW_MAJOR_VERSION = 85;
```

## 不支持的场景

以下场景即使 Android 9+ 也无法运行：

- **无 Google Play 服务的设备**（如部分华为鸿蒙、Amazon Fire）：无法获取 WebView 更新，系统 WebView 版本可能停留在出厂版本。建议通过 APK 侧载最新 Chrome 或 Android System WebView。
- **Android 9 以下设备**：安装阶段即被拦截，无任何应用内提示。如需支持，需继续降低 `minSdkVersion`，并处理 Java API 差异（如 `Set.of`/`List.of` 等集合工厂方法需替代）、`build.target` 降级、及多个 polyfill。

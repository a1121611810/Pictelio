# 客户端切换（引擎切换）— 术语表

> 范围：`pictelio-app`（webview 客户端）与 `app-lynx`（Lynx 客户端）双端共有的引擎切换机制、UI 入口与错误处理概念。配套 ADR：[ADR-0062-single-engine-client-switch-hiding.md](./ADR-0062-single-engine-client-switch-hiding.md)、[ADR-0064-engine-switch-experience-fix.md](./ADR-0064-engine-switch-experience-fix.md)。

## 核心术语

| 术语 | 定义 |
|------|------|
| **客户端（Client）** | 可独立运行的渲染客户端，二者之一：**WebView 客户端**（pictelio-app，Capacitor 桥）与 **Lynx 客户端**（app-lynx，原生 LynxView）。full 包同时包含两者；webview / lynx 独立包仅其一。 |
| **渲染引擎（Render engine）** | 客户端背后的渲染技术：Chromium WebView 或 Lynx 原生渲染。"切换引擎"即切换客户端。 |
| **切换渲染引擎入口（Switch entry）** | 设置页"切换渲染引擎"行（webview 侧）/ Lynx 客户端个人中心切换行（lynx 侧）。ADR-0062 起仅 full 包渲染该入口。 |
| **client 能力列表（Client kinds / `CLIENT_KINDS`）** | 当前包支持的客户端集合：full=`["webview","lynx"]`、webview=`["webview"]`、lynx=`["lynx"]`。Gradle 按 flavor 注入 `BuildConfig.CLIENT_KINDS`，运行时经 `ClientInfoPlugin.getClientKinds`（webview）/ `PictelioAppModule.getClientKinds`（lynx）暴露。是"包能力"的单一事实来源。 |
| **client kind 开关（Client kind switch）** | `SharedPreferences("CapacitorStorage")` 的键 `pictelio_client_kind`，取值 `"webview" \| "lynx"`。双端读写同一键同一文件，是引擎切换的单一事实来源；缺省为 `"webview"`。 |
| **切换深模块（clientSwitch 深模块）** | webview 侧 `clientSwitch` 模块：小接口（`readClientKind` / `switchClient` / `supportsClientSwitch`）+ 内部编排（in-flight 锁、5s 写入超时、原生 restart、Web `exitApp` fallback），错误模式经 `SwitchOutcome` 显式声明。lynx 侧对称实现为 `clientSwitchStore`（`PictelioAppModule.setClientKind` + restart）。 |
| **说明页（Client switch page）** | 切换确认从弹窗改为独立页面（webview 侧路由 `/client-switch`）：展示当前引擎、能力列表、引擎差异、实验性警告、切回路径与"确认切换"操作。 |
| **即时反馈（Immediate feedback）** | 点击"确认切换"后**同步**（先于任何 await）渲染的全屏加载遮罩（spinner + "正在切换引擎…"）；切换失败时关闭遮罩并按 reason 映射错误提示。 |
| **错误兜底页（Error fallback）** | LynxActivity 在渲染错误时展示的错误页（错误信息 + "返回 WebView"按钮，仅 full 包显示按钮），替代白屏。已有原子防重（首次错误才展示）。 |
| **入口路由分发（Entry routing）** | `MainActivity.onCreate` 读 client kind 开关分发：`"lynx"` → 跳转 `LynxActivity`（双 Activity 架构，issue #51）；否则走 Capacitor WebView 路径。 |

## 双端对称契约速查

| 能力 | webview 侧（pictelio-app） | lynx 侧（app-lynx） |
|------|---------------------------|---------------------|
| 读能力列表 | `ClientInfoPlugin.getClientKinds()` | `PictelioAppModule.getClientKinds(cb)` |
| 读当前开关 | `readClientKind()`（`@capacitor/preferences` 直读） | `PictelioAppModule.getClientKind(cb)` |
| 写开关 + 重启 | `switchClient(kind)`（写 + `ClientInfoPlugin.restart()`，进程保留） | `clientSwitchStore.switchClient(kind)`（`setClientKind` + `restart`） |
| 入口路由 | `MainActivity`（full）/ `MainActivityWebview`（webview 包无分发） | `LynxActivity` |
| 持久化键 | `pictelio_client_kind` @ `SharedPreferences("CapacitorStorage")` | 同左（Java 侧 `PictelioAppModule` 落盘同键） |

## 易混淆概念辨析

- **"切换引擎"与"切换客户端"同义**：客户端=渲染引擎承载者，切换动作是写 `pictelio_client_kind` 开关后重启 Activity 分发。不涉及运行时热切换——切换总是重启后生效。
- **能力列表 ≠ 开关值**：能力列表描述"当前包能切到什么"（`CLIENT_KINDS`，构建期决定）；开关值描述"当前生效的客户端"（运行时持久化）。独立包能力列表不含目标引擎 → 前端隐藏入口（ADR-0062）。
- **深模块与 UI 层职责分离**：`switchClient` 深模块不触碰 UI（错误经 `SwitchOutcome` 返回）；说明页（UI adapter）负责即时反馈与错误呈现。即时反馈是 UI 层职责，不泄漏进深模块。

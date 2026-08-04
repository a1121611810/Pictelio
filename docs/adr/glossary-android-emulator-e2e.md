# Android 模拟器 E2E 门禁 — 术语表

> 范围：`pnpm test:android:e2e` 流程中涉及的工具、概念与项目特定约定。配套 ADR：[ADR-0061-android-emulator-e2e-gate.md](./ADR-0061-android-emulator-e2e-gate.md)。

## 核心术语

| 术语 | 定义 |
|------|------|
| **门禁（gate）** | 质量关卡：特定代码改动必须通过指定测试才允许合入/发版。本项目为「本地手动跑 + PR 人工核查」模式，非 CI 强制。 |
| **双向闭环断言** | 模拟器 E2E 的验证深度：WebView → Lynx → 切回 WebView，两侧页面都完整渲染断言，不允许"启动即过"。 |
| **路径触发** | 门禁触发方式之一：git diff 涉及预设文件清单（6 个 fluent-dialog 文件 + clientSwitch.ts + MainActivity.java + Me.vue）时，开发者必须本地跑通模拟器 E2E。 |
| **PR 标签触发** | 门禁触发方式之二：涉及 SharedPreferences / 原生桥 / 入口路由的 PR 打 `needs-android-e2e` 标签，reviewer 人工核查测试证据。 |
| **AVD** | Android Virtual Device，模拟器实例。本地固定复用两个：`pictelio_low`（android-28，低版本兼容）、`pictelio_ui`（android-34，UI 验证）。 |
| **Appium** | 开源移动端 UI 自动化框架，基于 WebDriver 协议。本项目用 UiAutomator2 driver 驱动 Android 原生视图，用 Chromedriver 驱动 WebView 内 DOM。 |
| **WebdriverIO** | Node.js 的 WebDriver 客户端库，Appium 的主流前端。提供 `waitUntil` 显式等待、`executeScript` 等 API。 |
| **UiAutomator2** | Google 官方 Android UI 测试框架，Appium 的底层 driver 之一。通过 Accessibility 树定位原生视图（含 Lynx 暴露的节点）。 |
| **Chromedriver** | WebView 内的 Chrome 实例驱动。Appium 通过它把 WebDriver 命令转发到 WebView 的 DevTools 协议，实现 CSS/XPath 定位。版本必须与 WebView 匹配。 |
| **context（Appium）** | Appium 的视图上下文：`NATIVE_APP`（原生视图树）或 `WEBVIEW_...`（WebView DOM）。跨 Activity 时需切换 context。 |
| **accessibility 树** | Android 无障碍服务暴露的视图层级。Lynx 通过 `LynxAccessibilityDelegate`/`LynxNodeProvider` 把虚拟节点映射到此树，是 Appium/Maestro 定位 Lynx 元素的唯一通道。 |
| **accessibility-element / accessibility-label** | Lynx 元素属性，控制是否暴露到 accessibility 树及暴露的文本。本项目 Lynx 侧需补标注才能被 E2E 定位。 |
| **SharedPreferences("CapacitorStorage")** | Capacitor Preferences 插件的默认存储文件。`pictelio_client_kind` 键存于此，是 WebView ↔ Lynx 切换的原生侧契约。 |
| **入口路由（MainActivity）** | `MainActivity.onCreate` 读取 `pictelio_client_kind`，决定加载 WebView 主界面还是跳转到 `LynxActivity`。是切换链路的原生分发点。 |
| **LynxActivity** | 独立的 Activity，加载 Lynx 引擎渲染 `packages/app-lynx` 的 bundle。切到 Lynx 后由 MainActivity 启动。 |
| **agent-browser** | 项目现有 E2E 方案（桌面 Chrome + AI 断言），**不覆盖 Android 原生段**，与本流程互补不替代。 |

## 项目特定约定

| 约定 | 说明 |
|------|------|
| `pnpm test:android:e2e` | 待新建的根目录脚本，委托到 `packages/app` 执行 Appium 测试。遵循 ADR-0059 根脚本委托约定。 |
| `needs-android-e2e` | PR 标签，标识该 PR 涉及原生桥/入口路由/SharedPreferences，需人工核查模拟器测试证据。 |
| 本地 AVD 复用 | 不新建/删除 AVD，测试脚本自动检测 `pictelio_low` / `pictelio_ui` 是否存在并启动。 |
| 失败证据 | 测试失败时自动收集：当前 Activity 名、截屏、logcat 尾部 200 行，输出到 `test-results/android-e2e/`。 |

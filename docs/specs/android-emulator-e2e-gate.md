# Android 模拟器 E2E 门禁 —— 「切换渲染引擎」链路真机验证 —— 功能规格

> 来源：grill-with-docs 会话（2026-08-04）；ADR：[ADR-0061-android-emulator-e2e-gate.md](../adr/ADR-0061-android-emulator-e2e-gate.md)；术语表：[glossary-android-emulator-e2e.md](../adr/glossary-android-emulator-e2e.md)；调研：[android-e2e-framework-selection.md](../research/android-e2e-framework-selection.md)
> 状态：ready-for-agent

## Problem Statement

「切换渲染引擎」功能（WebView ↔ Lynx）横跨 WebView JS → Capacitor 桥 → SharedPreferences → MainActivity 入口路由 → LynxActivity 五段。2026-08-04 修复的「点击切换渲染引擎没反应」bug（fluent-dialog `open` 属性无效）暴露了测试盲区：Web 单测/E2E 只能验证到对话框弹出（JS 层状态变化），**无法验证原生段**——SharedPreferences 是否真写入、MainActivity 是否正确分发、LynxActivity 是否真启动。现有 E2E（agent-browser）全在桌面 Chrome，不覆盖 Capacitor 原生桥与 Activity 跳转。

开发者/维护者需要一个能在 Android 模拟器上真实跑通完整切换链路的自动化测试，并在改动相关代码时强制验证，防止原生段回归。

## Solution

建立基于 Appium (UiAutomator2) + WebdriverIO 的 Android 模拟器 E2E 测试，覆盖「切换渲染引擎」双向闭环：WebView 设置页点击切换 → 应用退出 → 重启进入 LynxActivity → Lynx Me 页完整渲染 + 「切回 WebView」可点 → 切回 → WebView 主页完整渲染。测试纳入质量门禁：改动对话框/切换链路相关代码（路径匹配）或涉及原生桥/入口路由（PR 标签）时，开发者本地必须跑通，PR 附测试证据由 reviewer 人工核查。

## User Stories

1. 作为开发者，我想在改动「切换渲染引擎」相关代码后在本地一键跑通模拟器 E2E，以便确认原生段没有回归
2. 作为开发者，我想测试自动检测并启动本地固定 AVD（pictelio_low / pictelio_ui），以便不用手动管理模拟器
3. 作为开发者，我想测试自动编译并安装最新 debug APK，以便验证的是当前代码而非旧包
4. 作为开发者，我想测试在 WebView 设置页真实点击「切换渲染引擎」，以便覆盖用户真实操作路径
5. 作为开发者，我想测试断言 SharedPreferences 的 pictelio_client_kind 被正确写入，以便秒级区分「写入问题」与「分发问题」
6. 作为开发者，我想测试断言应用退出后重启进入 LynxActivity（通过当前 Activity 名），以便确认 MainActivity 入口路由正确
7. 作为开发者，我想测试断言 Lynx Me 页完整渲染且「切回 WebView」可见可点，以便确认 Lynx 侧真的可用而非仅启动
8. 作为开发者，我想测试完整双向闭环（切到 Lynx 再切回 WebView），以便确认两个方向都不回归
9. 作为开发者，我想测试在两个 AVD（android-28 / android-34）上都跑通，以便覆盖 WebView 版本兼容性
10. 作为开发者，我想测试失败时自动收集当前 Activity 名 + 截屏 + logcat 尾部，以便快速定位失败原因
11. 作为开发者，我想用显式等待而非固定 sleep，以便测试稳定且尽可能快
12. 作为开发者，我想 Lynx 侧关键元素有 accessibility 标注，以便 Appium 能定位它们
13. 作为 reviewer，我想涉及原生桥/入口路由的 PR 带 needs-android-e2e 标签并附测试证据，以便人工核查门禁
14. 作为维护者，我想门禁触发范围最小化（仅相关文件改动时），以便日常 PR 不被拖累
15. 作为维护者，我想测试脚本遵循根目录委托约定（pnpm test:android:e2e），以便与现有命令体系一致
16. 作为维护者，我想新流程有 ADR 与术语表沉淀，以便后续开发者理解设计意图

## Implementation Decisions

### 技术栈与框架

- **Appium (UiAutomator2 driver) + WebdriverIO**：WebView 侧用 CSS/XPath/executeScript 精确 DOM 定位；Lynx 侧通过 accessibility 树断言（LynxAccessibilityDelegate 暴露虚拟节点）；跨 Activity 通过 Appium context 切换（NATIVE_APP ↔ WEBVIEW）。
- **决策依据**：见调研文档，对比 Maestro 后选择——WebView 内 DOM 级选择器是决定性优势，Lynx 侧两者能力等价。

### 模块划分

- **测试配置模块**：Appium server 启动/连接配置、capabilities（AVD 名、包名、Activity）、Chromedriver 版本匹配。
- **AVD 管理模块**：检测 `pictelio_low` / `pictelio_ui` 是否存在，未运行则启动，等待 boot 完成。
- **构建安装模块**：复用现有 debug APK 编译流程，adb install 到目标模拟器。
- **WebView 驱动模块**：切到 WEBVIEW context，用 CSS 选择器定位设置页元素，执行点击切换。
- **原生断言模块**：切到 NATIVE_APP context，断言当前 Activity、读取 SharedPreferences、定位 Lynx accessibility 元素。
- **Lynx 标注模块**（被测侧）：`packages/app-lynx` 关键交互元素补 `accessibility-element="true"` + `accessibility-label`。
- **根脚本**：新增 `test:android:e2e`，遵循 ADR-0059 根目录委托约定。

### 关键接口/契约

- **SharedPreferences 契约**：文件 `CapacitorStorage`，键 `pictelio_client_kind`，值 `webview` | `lynx`。这是 WebView 侧写入、MainActivity 侧读取的跨进程契约，测试必须双向验证。
- **MainActivity 入口路由**：读 `pictelio_client_kind`，`lynx` → `startActivity(LynxActivity)` 并 finish 自身；否则正常初始化 Capacitor WebView。
- **Lynx 切回入口**：`Me.vue` 提供「切回 WebView」交互，写 `pictelio_client_kind=webview` 后退出。

### 前置条件（实现前必须满足）

- Lynx 侧 `Me.vue`（切回 WebView 按钮）及相关页面补 accessibility 标注（当前 `packages/app-lynx/src` 0 处使用）。
- 确认 WebView `setWebContentsDebuggingEnabled(true)` 已开启（MainActivity 108 行已确认）。
- Appium Chromedriver 版本与两个 AVD 的 WebView 版本匹配。

### 环境约束

- 复用本地固定 AVD：`pictelio_low`（android-28）、`pictelio_ui`（android-34），不新建/删除。
- 本地手动执行，不引入 CI 模拟器。

## Testing Decisions

### 什么是好测试

只测**外部可感知行为**，不测实现细节：断言「SharedPreferences 真被写入」「当前 Activity 是 LynxActivity」「Lynx Me 页渲染完成」「WebView 主页渲染完成」，而非「某个函数被调用」。允许跨进程（adb 读文件系统）验证数据契约。

### 测试接缝（2 个，均为最高层、无 mock）

**S1 — SharedPreferences 契约层**：点击切换后通过 adb shell 读 `CapacitorStorage.xml`，断言 `pictelio_client_kind` 真被写入；重启后断言 MainActivity 读到正确值。**价值**：秒级区分「写入问题」与「分发问题」。

**S2 — UI/Activity 行为层（双向闭环主断言）**：
- WebView context：设置页 CSS 定位「切换渲染引擎」→ 点击 → 确认对话框确认
- 断言应用退出 → 重启 → native context 断言 `currentActivity` 为 LynxActivity
- Lynx Me 页渲染断言 + 「切回 WebView」按钮可见可点（accessibility 树）
- 点击切回 → 断言回到 WebView 主页完整渲染
- 两个 AVD 都跑 S2，覆盖 WebView 版本兼容性

### 覆盖模块

- 被测：`SettingsDialogs`（切换客户端对话框）、`clientSwitch`（写 SharedPreferences）、`MainActivity`（入口路由）、`LynxActivity`、`app-lynx Me.vue`（切回入口）
- 测试基建自身：AVD 管理、构建安装、context 切换、失败证据收集

### 既有先例（prior art）

- Web 端 E2E：`tests/agent-browser/`（agent-browser driver + vitest），本流程沿用「driver 封装 + vitest 断言」模式，但 driver 换成 Appium。
- 原生契约测试：`tests/unit/api/ssrfWhitelistContract.test.ts` 从源码提取常量比对——S1 的 SharedPreferences 契约测试沿用「真实数据源比对」原则（读真实 shared_prefs 文件而非 mock）。

### 稳定性与可观测性

- 全部用 WebdriverIO `waitUntil` 显式等待，禁止固定 sleep（允许 boot 等系统级等待）。
- 失败自动收集：当前 Activity 名、截屏、logcat 尾部 200 行，输出到 `test-results/android-e2e/`。

## Out of Scope

- **不覆盖**设置页其他对话框的完整交互（清除数据/删除账号/R18 确认等）——本次只验证「切换渲染引擎」链路，其他 fluent-dialog 用法的修复已由 Web 单测（FluentDialog.test / SettingsSwitchClient.test）覆盖。
- **不引入 CI 模拟器**——仅本地固定 AVD，本地手动跑 + PR 人工核查。
- **不做 pre-push hook 强制**——避免阻塞紧急修复。
- **不覆盖 Lynx 侧其他页面**——只断言 Me 页（切回入口所在页）渲染。
- **不改造 agent-browser 现有 E2E**——桌面 Chrome 流程与本流程互补，不替代。
- **不新建/管理 AVD 生命周期**——复用现有两个 AVD，不提供创建/删除脚本。

## Further Notes

- 首版只覆盖「切换渲染引擎」主链路，追求稳定而非广度，后续可按同样模式扩展其他原生链路。
- Lynx 侧 accessibility 标注是一次性工作，但需建立约定：新增关键交互元素时必须标注，否则 E2E 无法定位。
- Chromedriver 与 WebView 版本匹配是已知坑，配置模块需做版本探测与清晰报错。
- 术语统一遵循 `glossary-android-emulator-e2e.md`（门禁、双向闭环、context、AVD 等）。

# ADR-0064：引擎切换体验修复（说明页确认 + 即时反馈 + R8 白屏根治）

## 背景

full 包用户从设置页"切换渲染引擎"切入 Lynx 客户端时，存在两个确定性缺陷（issue #132，2026-08-06 真机 adb 实证）：

1. **确认流程无交互反馈**：设置页点击"切换渲染引擎"→ 确认弹窗 → 点击确认后长时间无任何 UI 反应（静默等待写开关 + Activity 重建 + Lynx 初始化），成功 toast 在 `await restart()` 之后才设置，而 restart 立即 `CLEAR_TASK` 销毁 Activity——toast 永远来不及显示。
2. **切换后白屏卡死无出口**：Release 构建下 R8 optimize 移除了 Lynx 注解生成类 `$$PropsSetter`/`$$PropsHolder`（SDK 4.0.1 共 38 个）的**无参构造器**——这些类靠反射 `Class.newInstance()` 实例化更新 UI 属性。SDK 自带 consumer 规则（`-keep class * implements Settable/LynxUISetter`）匹配不到纯继承链的 `$$PropsSetter`，且 R8 语义下 `-keep class X` 只保留类名不保留成员。运行时每帧抛 `InstantiationException`（error 990200）→ 首帧渲染中断 → 白屏。该错误走 `TASMCallback.onErrorOccurred` 而非 `onLoadFailed`，现有 10s 超时/错误兜底与"返回 WebView"出口均不触发。

## 决策

### 1. 切换确认从弹窗改为说明页

设置页"切换渲染引擎"入口行为从打开确认弹窗改为跳转独立说明页（路由 `/client-switch`）；删除原确认弹窗及其状态管理。

说明页展示：当前引擎（读 `readClientKind`）、当前包支持的引擎能力列表（读 `ClientInfoPlugin.getClientKinds`，ADR-0062 seam）、两引擎差异说明、实验性警告、切回路径指引；底部"确认切换"按钮（接通现有 `switchClient` 深模块）+ 返回操作。视觉遵循 Fluent Design System 2 令牌。

### 2. 即时反馈契约（硬性）

点击"确认切换"必须**同步**渲染全屏加载遮罩（spinner + "正在切换引擎…"），渲染发生在任何 `await` 之前。切换结果（`SwitchOutcome`）失败时关闭遮罩并按 reason 映射错误提示：`timeout` → "切换超时，请重试"、`write-failed` → "切换失败，请重试"、`restart-failed` → "切换失败，请重试"、`busy`（已有切换在途）静默忽略。防连点双保险：加载遮罩阻断二次点击 + 深模块既有 in-flight 锁。

### 3. R8 keep Lynx PropsSetter 构造器（白屏根治）+ 构建期断言

`proguard-rules.pro` 追加通配 keep 规则，保留 Lynx 注解生成类 `*$$PropsSetter` / `*$$PropsHolder` 的无参构造器与成员：

```
-keepclasseswithmembers class *$$PropsSetter { <init>; <methods>; }
-keepclasseswithmembers class *$$PropsHolder { <init>; <methods>; }
```

- 通配覆盖 SDK 全部 38 个生成类，SDK 升级新增组件类自动覆盖；
- 只保留生成类构造器与成员，不关闭 R8 整体优化，不扩大 keep 面；
- 构建期断言：`minifyReleaseWithR8` 后校验 mapping 中 `$$PropsSetter` 类含 `<init>()`，缺失即失败，纳入发布校验流程防规则回退。

### 4. Lynx 渲染错误兜底页

`LynxActivity` 监听渲染错误回调（`LynxViewClient` 错误回调系），首次错误即复用现有 `showErrorFallback` 错误兜底页（错误信息 + "返回 WebView"按钮，仅 full 包显示；已有原子防重）。作用：对决策 3 的兜底保险——未来任何渲染错误都展示错误页而非白屏，用户可一键切回 WebView。

## Considered Options

- **弹窗确认 vs 说明页（选说明页）**：弹窗空间小、信息密度低，无法承载引擎差异说明与实验性警告；说明页是整页信息承载 + 明确操作位，且"跳转页面"路径符合设置页导航惯例。弹窗方案对"确认即重启"这类破坏性操作反馈不足。
- **说明页确认按钮直接写开关 vs 复用深模块（选复用深模块）**：直接调 `Preferences.set` + restart 会绕过 in-flight 锁与超时编排，错误模式无法统一；复用 `switchClient` 深模块保持单一编排入口（深模块是既有 seam，issue #120/#123 已定型，不改其接口）。
- **全量 keep Lynx SDK vs 精确 keep 生成类（选精确）**：全量 `-keep class com.lynx.tasm.** { *; }` 会使 SDK 全部类不混淆不优化，包体积与启动性能受损；`*$$PropsSetter` 通配只保 38 个生成类的构造器与 `setProperty`，收益点唯一（反射实例化），损失最小。
- **兜底挂钩 onLoadFailed vs 渲染错误回调（选后者补充）**：`onLoadFailed` 只覆盖 bundle 加载失败，本缺陷走渲染期错误回调；两者互补——`onLoadFailed` 既有逻辑保留，新增渲染错误回调挂钩，合并构成完整兜底。
- **运行时反射探测 vs 构建期断言（选构建期断言）**：运行时无法探测"构造器是否被 R8 移除"（崩溃即探测）；构建期检查 mapping 是确定性断言，直接验证 R8 输出。

## Consequences

- 设置页交互变更：弹窗 → 说明页；`SettingsClient` 入口改为导航跳转；说明页成为"确认切换"唯一入口。
- 白屏根因在发布构建层面被根治；即使未来回归，错误兜底页保证有出口（可切回 WebView）。
- 发布流程新增构建期断言（mapping 含 `<init>`），防 R8 规则回退。
- 双端契约（`pictelio_client_kind` 开关、`ClientInfoPlugin` seam、`MainActivity` 入口路由分发、lynx 侧 `clientSwitchStore`）均不改变。
- 术语参见 [glossary-client-switch.md](./glossary-client-switch.md)。

## 关联

- Issue：[#132](https://github.com/a1121611810/Pictelio/issues/132)（spec）、[#133](https://github.com/a1121611810/Pictelio/issues/133)（T1 R8 修复）、[#134](https://github.com/a1121611810/Pictelio/issues/134)（T2 说明页）、[#135](https://github.com/a1121611810/Pictelio/issues/135)（T4 兜底页）、[#136](https://github.com/a1121611810/Pictelio/issues/136)（T3 即时反馈）
- 前序：ADR-0062（能力隐藏与 ClientInfoPlugin seam）、issue #123/#124/#126（深模块、重启对齐、token 白屏）

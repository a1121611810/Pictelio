# 前后台与任务恢复统一术语文档（glossary-android-lifecycle-restore）

> 状态：已定稿（app-lynx 缩小恢复修复 initiative 的共享词汇基准，配合 ADR-0102）。
> 本文档**不改变任何代码**，只统一说话方式。
> 覆盖范围：`packages/app`（webview 客户端）、`packages/app-lynx`（lynx 客户端）与 `packages/app/android`（Android 原生宿主，双 client 共用）之间的 Android 前后台 / task 恢复语义。
> 已阅读基线：`CONTEXT-MAP.md`、`packages/app-lynx/CONTEXT.md`、`packages/app/CONTEXT.md`、`docs/adr/glossary-cross-engine.md`、ADR-0049/0051/0066/0102。

## 范围与目的

「应用缩小再打开应该回到原页面」是 Android **系统级基础能力**（task 恢复契约），不是 App 特性。但当 App 破坏该契约时（ADR-0102 实证：full 包双 Activity 路由壳每次 `finish()`，导致 launcher 重投递永远命中不了存活实例），就会出现「无论之前在哪，缩小再打开必回推荐页」的确定性缺陷。

本领域术语在代码注释、issue 标题、测试名、PR 描述中反复出现，但此前没有统一词汇——「缩小」「回到推荐页」「前台/后台」「重建」等说法混用。本文档给出规范术语，配合 ADR-0102 落地。

术语选用惯例沿用 `CONTEXT.md`：中文定义 + 英文标识符；`_Avoid_` 标注禁用词。

## 术语表

### 前后台与任务

**前台（Foreground）**：
App 可见且用户可交互的状态。对应宿主 Activity 的 `onResume`。
_Avoid_: 前面（有歧义）

**后台（Background）**：
App 不可见的状态（被桌面或其它应用覆盖）。对应宿主 Activity 的 `onPause`/`onStop`。
_Avoid_: 背面

**退后台（Backgrounding）**：
用户通过 Home 手势/按键（上滑回桌面）使 App 进入后台。task 与 Activity 实例**全部保留**。
_Avoid_: 缩小（用户口语，规范术语用「退后台」）、最小化（桌面窗口语境）

**回前台（Foreground return）**：
从后台重新进入 App。有两条路径：**点桌面图标**（launcher 重投递）与**从最近任务进入**（最近任务恢复）。

**任务（Task）**：
Android task——最近任务（recents）里的卡片，承载宿主 Activity 栈。full 包双 client 共用同一 task（客户端切换经 `FLAG_ACTIVITY_CLEAR_TASK` 清空重建，不产生第二个 task）。

**最近任务（Recents）**：
系统任务切换器。从最近任务进入 App 直接唤起 task 顶层实例，不经过路由壳 Activity。

### 恢复语义

**任务恢复契约（Task restore contract）**：
系统级保证——task 存活且宿主 Activity 未被销毁时，回前台恢复原页面状态（页面、历史栈、滚动位置），App 无需自行实现。App 的职责是**不破坏**该契约（如保持 singleTask 根实例存活、不无限堆叠实例）。
_Avoid_: 状态恢复（本仓库「滚动恢复」已有专属语义，见 app CONTEXT.md）

**launcher 重投递（Launcher re-delivery）**：
点桌面图标时 launcher 发送 `MAIN/LAUNCHER` intent；对 `singleTask` 活动，系统按 affinity 找到既有 task 并投递给**存活的目标实例**（`onNewIntent`），不新建实例。目标实例不存在时系统只能重建，且重建位置压在既有 task 之上（非根）。
_Avoid_: 重新启动（与冷启动混淆）

**路由壳 Activity（Routing shell activity）**：
MainActivity 在 lynx 模式下的角色——launcher 入口 + 读取 client 开关 + 路由到 LynxActivity + 立即 `finish()` 自杀。路由壳**永远没有存活实例**，是 launcher 重投递永远命中不了的目标。
_Avoid_: 中转页、launcher 页（与「launcher Activity」混淆）

**宿主 Activity（Host activity）**：
承载客户端渲染的 Activity——webview 模式为 MainActivity（Capacitor Bridge + WebView），lynx 模式为 LynxActivity（LynxView）。宿主实例存活 = 引擎会话存活。

**根 Activity（Task root activity）**：
task 栈底（首个）Activity。`Activity.isTaskRoot()` 判断当前实例是否为 task 根——「缩小后点图标」场景下重建的路由壳**不是根**（下面压着存活的旧宿主），冷启动/客户端切换（CLEAR_TASK）下**是根**。这是 ADR-0102 修复的判别信号。

**实例堆叠（Instance stacking）**：
路由壳每次重建都新开一个宿主实例叠在旧实例之上，task 逐层累积；每层是一个完整 JS runtime（内存泄漏级）。ADR-0102 修复前每次「缩小→点图标」堆叠一层（实测 2 次操作叠 3 层）。
_Avoid_: 栈堆积（与路由历史栈混淆）

**会话重置（Session reset）**：
宿主实例被重建 → 全新 JS 上下文 → 内存路由 `_state` 归零为初始值 → 落在首路由（推荐页）。用户感知为「回到推荐页」。
_Avoid_: 回到推荐页（描述现象而非概念）

**进程死亡（Process death）**：
系统回收 App 进程（后台内存压力）；task 记录保留但宿主实例全部销毁。进程死亡后回前台 = 宿主实例重建 = 会话重置（系统无能为力，只能由 JS 层持久化兜底，ADR-0102 明确不在本次范围）。

**引擎会话（Engine session）**：
一个宿主 Activity 实例存活期间的前端状态（路由、登录态、页面数据）。实例存活时前后台切换不重置引擎会话；实例重建必然重置。
_Avoid_: 会话（与「登录会话」/「会话失效」混淆，见 app-lynx CONTEXT.md）

### 组件与生命周期

**launcher Activity**：
Manifest 声明为 `MAIN/LAUNCHER` 的入口 Activity（full/webview 包为 MainActivity，lynx-only 包为 LynxActivity），`singleTask`。
_Avoid_: 启动页（指 splash）

**前台生命周期转发（Lifecycle forwarding）**：
LynxActivity 把 `onResume`/`onPause` 转发为 `lynxView.onEnterForeground`/`onEnterBackground`（LynxView 无自带生命周期）。Lynx SDK 4.0.1 实测：转发只做 UI 动画恢复 + JS 页面 onShow/onHide 事件（vue-lynx 不消费），**不重跑 bundle、不重置 JS 状态**——宿主实例存活时前后台切换天然保留引擎会话。

**首路由（Initial route）**：
app-lynx 内存路由 `_state` 的初始值 `/recommended`（首帧内容化决策）。引擎会话重建后必落首路由。

## 对照表

| 场景 | 路径 | 宿主实例 | 引擎会话 | 用户感知 |
|---|---|---|---|---|
| 缩小→从最近任务进入 | 最近任务恢复 | 存活 | 保留 | 原页面 ✓ |
| 缩小→点桌面图标（修复前） | launcher 重投递（路由壳重建） | **新建堆叠** | **重置** | 推荐页 ✗ |
| 缩小→点桌面图标（ADR-0102 修复后） | launcher 重投递（路由壳自杀让位） | 存活 | 保留 | 原页面 ✓ |
| 进程死亡→回前台 | 宿主重建 | 新建 | 重置 | 推荐页（JS 持久化兜底，不在本次） |
| 客户端切换 | CLEAR_TASK 清空重建 | 新建 | 重置（预期） | 新引擎首路由 ✓ |

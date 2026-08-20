# ADR 0102：app-lynx 缩小恢复——full 包路由壳破坏 task 恢复契约，isTaskRoot 守卫修复

**状态**：已批准
**日期**：2026-08（双轴 code-review 通过：Standards + Spec，0 blocker）
**决策者**：团队成员（经 grill-with-docs / domain-modeling 会话收敛）
**背景**：app-lynx 用户在 full 包实测：无论当前在哪个页面，应用退后台后点桌面图标重开，**必回推荐页**。根因在 Android task 层（非 JS 层），本 ADR 拍板原生修复方案。

---

## 背景

Pictelio full 包支持 webview / lynx 双 client 切换（ADR-0062）。入口 `MainActivity` 是 `singleTask` 路由壳：`onCreate` 读取 `pictelio_client_kind`，为 `"lynx"` 时 `startActivity(LynxActivity)` 后立即 `finish()` 自杀（双 Activity 分发，ADR-0051）。

「缩小再打开应回原页面」是 Android 系统级 task 恢复契约，App 无需自行实现。但本架构使该契约**结构性失效**，表现为确定性缺陷：无论之前在哪个页面，退后台后点桌面图标必回推荐页。

## 问题描述

### 因果链（模拟器逐环实证，Lynx SDK 4.0.1 字节码 + 真机行为）

1. **launcher 重投递永远命中不了存活实例**：`MainActivity` 每次路由后 `finish()`，永远没有存活实例可收 singleTask 的 `onNewIntent` → 系统只能重建 `MainActivity`，且重建位置压在既有 task 之上（**非根**，实测 `isTaskRoot()==false`）。
2. **每次点图标都新开宿主实例**：重建的 `MainActivity` 再次路由 → 新建 `LynxActivity` + 全新 Lynx runtime（logcat 实测 `onRuntimeReady`）→ 全新 JS 上下文 → 内存路由 `_state` 归零为 `/recommended`（首帧内容化决策）→ 落在推荐页。
3. **实例无限堆叠（内存泄漏级）**：旧 `LynxActivity`（页面状态完好）被埋在新实例之下，task 每点一次图标叠一层；实测 2 次操作后 task 内 3 个 `LynxActivity` 实例（每层一个完整 Lynx runtime，~百 MB 级）。
4. **JS 层无责任**：宿主实例存活时，`LynxActivity.onResume → lynxView.onEnterForeground` 仅做 UI 动画恢复 + JS onShow 事件（vue-lynx 不消费），实测同一进程、同一 LynxView 实例、无 bundle 重跑——引擎会话天然保留。**问题 100% 在原生 task 层**。

### 对照（为什么只有 full 包受影响）

| 形态 | launcher Activity | 宿主实例常驻 | 点图标行为 |
|---|---|---|---|
| webview 包 | MainActivity（宿主本体） | 是（从不 finish） | onNewIntent → 恢复 ✓ |
| lynx-only 包 | LynxActivity（宿主本体） | 是 | onNewIntent → 恢复 ✓ |
| **full 包** | MainActivity（路由壳，每路由必 finish） | **否** | 重建路由壳 → 新开宿主 ✗ |

## 决策

1. **`MainActivity.onCreate` lynx 分支加 `isTaskRoot()` 守卫**：重建进来时若本 Activity **不是 task 根**（= launcher 重投递到既有 task，下面压着存活的旧 LynxActivity）→ **不新开宿主，直接 `finish()` 让位**，由系统恢复下面的旧实例——页面、历史栈、滚动位置原样保留，把 task 恢复契约交还给系统。
2. **冷启动 / 客户端切换行为不变**：冷启动 task 根是 MainActivity（`isTaskRoot()==true`）→ 正常路由；客户端切换 `restart()` 用 `FLAG_ACTIVITY_CLEAR_TASK`（PictelioAppModule 实证）→ MainActivity 恒为 task 根 → 正常路由，不误伤"切换后全新会话"语义。
3. **不引入 JS 层路由持久化**：本次问题根因在原生层，JS 持久化是给"每次被系统重建"打补丁（治标不治本，且不解决实例堆叠/内存泄漏）。**进程死亡**场景（系统回收进程后回前台仍会会话重置）由 JS 持久化兜底，但明确**不在本次范围**，待原生修复后观察复现率再评估。
4. **存量堆叠残留接受**：旧版本已堆叠的实例（task=[Lynx#0,#1,#2]）修复后恢复最上层（= 最新页面），下层残留直到下次客户端切换（CLEAR_TASK 清空整个 task）才清除。一次性残留，不主动清理。
5. **逻辑形态**：守卫为单行 + 机制注释（含实证依据），不抽模块——`isTaskRoot()` 是系统为"重投递到既有 task"设计的规范语义，接口即系统 API，删除测试（deletion test）成立：删掉它，复杂度不会消失而是散布回每次点图标的用户面前。

## 替代方案评估

| 方案 | 评估 |
|---|---|
| **isTaskRoot() 守卫（选定）** | 一行系统 API，语义精确匹配"重投递到既有 task"；Robolectric/真机稳定；冷启动与客户端切换天然区分（CLEAR_TASK 恒为根） |
| `ActivityManager.getRunningTasks(1)` 查 baseActivity | deprecated API；需要 taskId 比对 + 两次判空，接口比实现还复杂（浅模块）；Robolectric `setTasks` 可测但收益低于 E2E |
| `LynxActivity.current()` 静态弱引用判活 | 语义错位（表示"最近创建的 LynxActivity"，非"我 task 下面那个"）；进程死亡时在死实例上叠僵尸记录；单元测试依赖静态状态 |
| 保留 MainActivity 不 finish（常驻根） | singleTask 根常驻虽符合契约，但 BridgeActivity.onCreate 无条件初始化 Capacitor bridge + WebView（ADR-0051 拆分动机），后台常驻 webview 客户端（启动/认证/更新检查全跑），内存与行为双重代价 |
| JS 层路由持久化 + 恢复 | 只解决"全新 JS 上下文"的恢复；**不解决实例堆叠与内存泄漏**（task 仍越叠越深）；与用户"这不该 App 自己实现"的直觉相悖；仅进程死亡场景需要 |

## 影响范围

| 文件 | 改动 |
|---|---|
| `packages/app/android/app/src/full/java/io/pictelio/app/MainActivity.java` | lynx 分支 `super.onCreate` 后、`startActivity` 前插入 `if (!isTaskRoot()) { finish(); return; }` + 机制注释（实证依据） |
| `packages/app/tests/android-e2e/specs/background-resume.spec.ts` | **新增** Appium E2E：lynx 客户端导航到非推荐页 → `driver.background()`（模拟 Home）→ `driver.activateApp()`（模拟点图标）→ 断言仍在该页 / Activity 未被重建 |
| `docs/adr/glossary-android-lifecycle-restore.md` | 新增统一术语文档（前后台 / task 恢复契约 / launcher 重投递 / 实例堆叠 / 会话重置等） |
| `packages/app-lynx/CONTEXT.md` | 新增「前后台与任务恢复」术语节 |

注：webview 包 / lynx-only 包无此缺陷（宿主即 launcher，实例常驻），不改动。

## 风险与缓解

| 风险 | 缓解 |
|---|---|
| `isTaskRoot()` 在进程死亡场景返回 false（task 根是已死 LynxActivity 记录）→ finish 让位后系统重建该实例 | 结果与修复前一致（会话重置、单实例），无回归且更干净（不堆叠）；配合 JS 持久化兜底（未来）可恢复页面 |
| 客户端切换（CLEAR_TASK）行为被误伤 | 实证 `PictelioAppModule.restart()` 带 `FLAG_ACTIVITY_CLEAR_TASK` → MainActivity 恒为 task 根 → `isTaskRoot()==true` 正常路由；E2E 既有 switch-client 套件回归验证 |
| 多窗口/分屏边界 | 系统在容器内创建新 task，MainActivity 恒为根 → 正常路由；无回归面 |
| 恢复瞬间闪屏 | lynx 分支不装 Splash（installSplashScreen 仅在非 lynx 分支），finish 让位后旧宿主窗口直接显现；与冷启动现有行为同级 |
| 旧版堆叠残留内存 | 接受一次性残留（下次客户端切换清空）；不引入主动清理复杂度 |

## 后果

- full 包 lynx 模式「缩小→点图标」恢复系统级 task 恢复契约：原页面、历史栈、滚动位置原样保留。
- 实例堆叠（内存泄漏）终止；task 深度恒为 1。
- 冷启动、客户端切换、最近任务进入行为均不变（E2E 既有套件守护）。
- **进程死亡**后回前台仍会话重置（系统无能为力）——留待 JS 持久化兜底专项评估，明确不在本次范围。

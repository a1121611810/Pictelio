# ADR 0061: Android 模拟器 E2E 测试纳入门禁——「切换渲染引擎」链路真机验证

## 状态

已采纳（待 `/to-spec` → `/to-tickets` → `/implement` 落地）

## 分类

技术决策 / 测试基建 / 质量门禁

## 日期

2026-08-04

## 背景

「切换渲染引擎」功能（WebView ↔ Lynx）的完整链路为：

```
WebView JS (Settings.tsx)
  → setClientKind("lynx") 写 SharedPreferences("CapacitorStorage").pictelio_client_kind
  → App.exitApp()
  → 用户重启
  → MainActivity 入口路由读取 pictelio_client_kind
  → 分发到 LynxActivity（或留在 WebView）
```

2026-08-04 修复的「点击切换渲染引擎没反应」bug（fluent-dialog `open` 属性无效）暴露了测试盲区：

- **Web 单测/E2E 只能验证到对话框弹出**（JS 层状态变化）
- **无法验证原生段**：SharedPreferences 写入是否成功、MainActivity 入口路由是否正确分发、LynxActivity 是否真正启动
- 现有 E2E（agent-browser）全在桌面 Chrome，不覆盖 Capacitor 原生桥与 Activity 跳转

结论：必须建立 Android 模拟器真机 E2E，并纳入质量门禁。

## 决策

### 1. 技术栈：Appium (UiAutomator2) + WebdriverIO

**选型理由**（详见 `docs/research/android-e2e-framework-selection.md`）：

| 维度 | Appium + WebdriverIO | Maestro |
|------|---------------------|---------|
| WebView 内 DOM 定位 | CSS/XPath/executeScript，精确 | 仅可见文本/label 级 |
| Lynx 原生视图断言 | accessibility 树（LynxAccessibilityDelegate 暴露） | 同左（两者等价） |
| 跨 Activity（WebView→LynxActivity） | native context 天然覆盖 | 屏幕层级模型支持 |
| 与现有工具链 | Node 生态，与 Vitest 同构 | 独立 YAML 流 |

**关键前提**：
- Lynx 侧元素需补 `accessibility-element="true"` + `accessibility-label`（当前 `packages/app-lynx/src` 0 处使用）
- WebView 需 `setWebContentsDebuggingEnabled(true)`（Capacitor debug 包默认开启）
- Appium Chromedriver 与模拟器 WebView 版本匹配

### 2. 门禁触发：路径匹配 + PR 标签双通道

**路径触发**（改动以下任一文件时，开发者本地必须跑通模拟器 E2E）：

- `packages/app/src/components/settings/SettingsDialogs.tsx`
- `packages/app/src/components/settings/SettingsImage.tsx`
- `packages/app/src/components/settings/SettingsTranslate.tsx`
- `packages/app/src/components/AgeGate.tsx`
- `packages/app/src/routes/NovelDetail.tsx`（仅 fluent-dialog 段）
- `packages/app/src/utils/clientSwitch.ts`
- `packages/app/android/**/MainActivity.java`
- `packages/app-lynx/src/pages/Me.vue`（切回 WebView 入口）

**PR 标签触发**：任何涉及 SharedPreferences / 原生桥 / 入口路由 / Activity 分发的 PR，打 `needs-android-e2e` 标签，强制人工核查模拟器测试证据。

### 3. 测试环境：本地固定 AVD

复用开发者本地已建 AVD：`pictelio_low`（android-28）、`pictelio_ui`（android-34）。不引入 CI 模拟器（环境不可控 + 运行成本高）。

### 4. 执行主体：本地手动跑 + PR 人工核查

- 开发者本地执行 `pnpm test:android:e2e`（待新建脚本）
- PR 中附模拟器测试通过证据（日志/截图），reviewer 人工核查
- 不做 pre-push hook 强制（避免阻塞紧急修复）

### 5. 断言深度：双向闭环

完整链路双向验证：

```
WebView 主页 → 设置页 → 点击「切换渲染引擎」→ 确认对话框
  → 应用退出 → 重启 → LynxActivity 启动
  → Me 页完整渲染断言 + 「切回 WebView」可见可点
  → 点击切回 → 应用退出 → 重启 → WebView 主页完整渲染断言
```

每一环都需真实断言，不允许"启动即过"。

## 后果

### 正面

- 切换链路全段（JS → 原生桥 → SharedPreferences → Activity 分发）有真实回归防护
- 同类 fluent-dialog 用法（6 个文件）的交互路径被覆盖
- 门禁触发范围最小化，日常 PR 不受影响

### 负面 / 成本

- 需新增 Appium + WebdriverIO 依赖与配置
- Lynx 侧需补 accessibility 标注（一次性工作）
- 本地模拟器测试运行成本高（分钟级），需控制触发频率
- 测试稳定性风险：模拟器时序、WebView 版本、Lynx 引擎版本均可能引入 flake

### 风险缓解

- 断言用显式等待（WebdriverIO `waitUntil`），不用固定 sleep
- 失败时自动截屏 + dump 当前 Activity + logcat 尾部，便于定位
- 首版只覆盖「切换渲染引擎」主链路，不追求全设置页覆盖

## 关联

- 调研报告：`docs/research/android-e2e-framework-selection.md`
- 本次修复：`SettingsDialogs.tsx` / `FluentDialog.tsx`（fluent-dialog open 无效 bug）
- 既有约定：ADR-0059（根目录脚本委托），新增 `test:android:e2e` 遵循同一约定

## 实施后补充（2026-08-05，issue #103-#108 完成）

### Lynx 侧 UI 自动化的 SDK 限制

实测 Lynx 4.0.1：accessibility 树**只暴露表单元素**（input/EditText），view/text 容器节点不暴露（即使标注 `accessibility-element` + `accessibility-label`）。因此 Lynx 登录按钮、导航入口、Me 页「切回 WebView」均无法被 Appium 定位。**双向闭环的 Lynx 侧完整 UI 操作在当前 SDK 下不可自动化**，反向切回用 S1 契约层等价验证（写 `pictelio_client_kind` → 重启 → 断言分发）。留待 Lynx 升级或无障碍暴露修复后补全。

### Lynx accessibility 依赖系统无障碍服务

LynxAccessibilityWrapper 要求 `mTouchExplorationEnable=true`——**需启用 TalkBack**（`settings put secure enabled_accessibility_services ...`）。启用后 Android 弹「允许通知」权限询问阻塞 Activity 分发，需预授权 `POST_NOTIFICATIONS`。

### 双 AVD 约束

- `pictelio_ui`（android-34，WebView 113）：完整双向闭环。
- `pictelio_low`（android-28，WebView 66）：WebView < 85 → 切回停升级页（版本防护）；Lynx 侧可达但渲染慢（40s+）。**两个 AVD 不能同时在线**（ensureEmulator 检测到非目标在线即报错）。
- chromedriver 版本随 WebView：113（arm64）vs 66（cd 2.40，mac64 fallback——老版无 arm64 构建）。

### E2E 钩子构建隔离

`window.pictelioE2e.confirmSwitchClient` 仅 `--mode e2e` 构建保留（`__E2E__` define），production 消除。`build:android:e2e` 脚本用于门禁构建；`build:android` 无钩子（安全）。

### 工具层实测踩坑（已修复）

- `currentTopActivity` dumpsys 正则：android-30+ `topResumedActivity` / android-28 `mResumedActivity`；**前缀必选**（否则匹配历史条目）；`ActivityRecord{<hash> u0 <comp>}` 需跳过 u0。
- `forceStopApp` 不做 pidof 等待（避免旧进程复用）。
- AVD 名属性：pictelio_ui 在 `ro.boot.qemu.avd_name`、pictelio_low 在 `ro.kernel.qemu.avd_name`，两者都查。

# lynx 夜间模式（明暗外观）—— 功能规格

> 来源：wayfinder 地图 [#682](https://github.com/a1121611810/Pictelio/issues/682)；研究 [#683](https://github.com/a1121611810/Pictelio/issues/683)（Lynx 运行时系统暗色检测）/ [#684](https://github.com/a1121611810/Pictelio/issues/684)（splash 深色化）；访谈 [#685](https://github.com/a1121611810/Pictelio/issues/685)（入口交互）；父 spec [#686](https://github.com/a1121611810/Pictelio/issues/686)。
>
> ADR 落点：新 ADR（含 ADR-0168 状态栏钉死修订）由 T5 提交；本文件为 T1/T2/T3/T4 实施期 spec oracle。
> 状态：**T1–T5 全部实施并关闭（2026-09-21）**；ADR 已合并为 [ADR-0180](../adr/ADR-0180-lynx-dark-mode.md)。遗留：D7 splash 兜底轨的**手动模式**覆盖未接线（当前仅系统跟随生效），列 follow-up [#692](https://github.com/a1121611810/Pictelio/issues/692)。

## 1. Problem Statement

lynx 客户端（缺省引擎）只有亮色界面：夜间/弱光环境刺眼；系统切暗后应用不跟随，与系统其它应用观感割裂。ADR-0152 做主题色时明确将「暗色/亮暗跟随」另行立项——本 spec 即该立项。webview 客户端已有明暗主题但**不投任何对齐/互通**（webview 按计划将弃用，已记入 AGENTS.md 注意事项）。

## 2. Solution

为 lynx 客户端建设完整明暗外观：

- 外观设置提供 **亮色 / 暗色 / 跟随系统** 三态，默认跟随系统，设备级持久化，切换即时生效
- 6 个主题色全部拥有 M3 dark scheme（12 套静态色板，构建期生成，零运行时算色）
- 「跟随系统」经原生通道检测（与 ADR-0168 insets 管线同构），web-core 预览走 `matchMedia` 兜底
- 原生层联动：状态栏图标色随外观即时切换（T3）；splash 双轨深色化（`values-night` 主轨 + API 31+ 持久化主题兜底，T3——**兜底轨手动模式覆盖现状见 §4.7 / follow-up #692**）
- 设置入口落在「我的」页外观卡片顶部（主题色上方），M3 segmented button 三格（T2）

## 3. 票分（T1-T5）

| 票 | 范围 | 当前状态 |
|---|---|---|
| **T1** | 状态核心 + 系统检测通道（基础层，无可见 UI） | ✅ closed（`67b8300d` + `b26178f`） |
| T2 | 12 色板 + 根类绑定 + segmented 入口 + 色块联动 + i18n/a11y | ✅ closed（`33eaee4b` + `78cf676d`） |
| T3 | 状态栏图标动态切换 + splash 双轨 + IconBackground plate | ✅ closed（`2133233f`；splash 手动模式覆盖 → follow-up #692） |
| T4 | 硬编码浅色值审计与修复 | ✅ closed（`f1480620` + `48286393`） |
| T5 | 新 ADR（含 ADR-0168 修订）+ CONTEXT.md 词条 + map 收官 | ✅ closed（ADR-0180 + 词条 + map #682 收官） |

T2 / T3 可并行（T2 依赖 `resolvedDark`、T3 依赖 `resolvedDark`，互不依赖对方）。

## 4. T1 实施规格

### 4.1 状态模型

- 三态值域：`light | dark | system`，默认 `system`
- 设备级持久化键：`settings_dark_mode`（沿用 PrefsStorage seam，native 走 PictelioPrefs、dev 走 idbKV，与 `settings_theme_color` 同模式）
- 单一事实源：`packages/app-lynx/src/utils/darkMode.ts` 的 `DARK_MODE_OPTIONS` / `DARK_MODE_IDS` / `DEFAULT_DARK_MODE`（与 themeColor.ts 同模式）
- 派生 `resolvedDark: Ref<'light' | 'dark'>`：手动 light/dark 直接映射；system 模式订阅暗色哑桥源（settingsStore 内 `computed`）

### 4.2 非法值规则

- 持久化值非法 → `console.warn("[settingsStore.darkMode] 暗色外观值非法")` + 维持默认（**禁静默降级**，对齐 themeColor 模块行为）
- IO 异常（prefs 读/写失败）→ `console.warn("[settingsStore.darkMode] 暗色外观加载失败/写入失败")`

### 4.3 系统检测通道（哑桥双路径）

**契约锚点**（与 ADR-0168 insets 管线同构）：

| 元素 | JS 侧 | Java 侧 | 契约测试钉死文件 |
|---|---|---|---|
| 事件名 | `pictelioDarkMode` | `EVENT_DARK_MODE = "pictelioDarkMode"` | `darkModeJavaContract.test.ts:26` |
| 拉取方法 | `PictelioApp.getDarkMode(cb)` | `@LynxMethod getDarkMode(Callback)` | `darkModeJavaContract.test.ts:31` |
| 载荷 | `JSON.stringify({mode: 'light' \| 'dark'})`（标准）+ 裸字符串兼容（保守兜底，详见 §4.4） | `JavaOnlyArray.of(JSON.stringify({mode: currentDarkMode(uiMode)}))` | `darkModeJavaContract.test.ts:36` |
| 初值拉取时机 | `ensureInit()` 在 `getDarkMode` / `subscribeDarkMode` 首次调用时触发（订阅后拉） | 同上 | `darkMode.test.ts:194` |
| 推变化源 | `setOnApplyWindowInsetsListener` 同款 — `onConfigurationChanged` 读 `Configuration.uiMode` 与 `UI_MODE_NIGHT_MASK`（manifest 已声明 `uiMode` configChanges，免 Activity 重建） | `sendGlobalEvent` via `GlobalEventEmitter` | `LynxDarkModeTest.java:151`（`onConfigurationChanged + UI_MODE_NIGHT_MASK` 字面量断言） |
| 后台兜底 | — | `onResume` 比对缓存 `sLastUiMode`，变化则补发（防后台期间系统翻转） | `LynxDarkModeTest.java:174`（`onResume 兜底补发` 字面量） |

**通道分流（JS 侧 `packages/app-lynx/src/utils/darkMode.ts` `ensureInit`）**：

- native 路径（lynx 环境，存在 `NativeModules.PictelioApp`）：
  1. 注册 `pictelioDarkMode` 全局事件监听（订阅先于拉取，防首帧事件丢失）
  2. 调 `PictelioApp.getDarkMode(cb)` 拉初值（cb 由原生异步触发）
  3. **降级路径（IO 边界强制覆盖）**：
     - `emitter.addListener` 不可用 → `console.warn("[darkMode] GlobalEventEmitter 不可用，pictelioDarkMode 事件订阅失败")` + pull 仍照常
     - `PictelioApp.getDarkMode` 不可用 → `console.warn("[darkMode] NativeModules.PictelioApp.getDarkMode 不可用，系统暗色恒 light")` + 退出 native 路径
- web-core 预览路径（不存在 `NativeModules.PictelioApp`）：
  - `matchMedia("(prefers-color-scheme: dark)")` 拉初值 + `change` 监听
  - `matchMedia` 不可用 → `console.warn("[darkMode] matchMedia 不可用，系统暗色恒 light（web-core 预览属预期）")`
  - 兼容 Safari < 14：fallback 到 `addListener`

### 4.4 载荷兼容策略

`parseNativePayload` 容忍两种格式：

1. **标准**：`JSON.stringify({mode: 'light' | 'dark'})`（spec 决定，Java 端 `currentDarkMode` 函数只产这一种）
2. **兼容**：裸字符串 `'light' | 'dark'`（早期调试期 / 跨端复用余地——Java `currentDarkMode` 函数也曾产裸字符串早期版本；JS 侧保留为单边容忍，避免历史遗留数据丢失真值）

**为何不是隐式契约**：JS 单边容忍裸字符串不等于 Java 端允许未来切换；如果 Java 端某日改用其它载荷格式，必须**先升 spec**。当前 Java 端只走 JSON 一条路径（`JavaOnlyArray.of(JSON.stringify(...))`），JS 双路径并存是**过渡期契约**而非长期设计。

### 4.5 测试矩阵

| 维度 | 测试文件 | 用例数 |
|---|---|---|
| 三态清单与校验 | `darkMode.test.ts` §三态清单 | 4 |
| web-core matchMedia 成功路径 | `darkMode.test.ts` §web-core 预览 | 3 |
| web-core matchMedia 不可用降级 | `darkMode.test.ts` §web-core 预览 | 1 |
| matchMedia change 触发订阅 | `darkMode.test.ts` §web-core 预览 | 1 |
| native pull 拉初值 | `darkMode.test.ts` §native 路径 | 2 |
| pictelioDarkMode 事件标准 JSON 载荷 | `darkMode.test.ts` §native 路径 | 1 |
| pictelioDarkMode 裸字符串兼容 | `darkMode.test.ts` §native 路径 | 1 |
| pictelioDarkMode 非法载荷 warn | `darkMode.test.ts` §native 路径 | 1 |
| 原生 pull 非法值 warn | `darkMode.test.ts` §native 路径 | 1 |
| **native emitter 不可用 warn**（IO 边界 #a） | `darkMode.test.ts` §native 路径 | 1 |
| **native getDarkMode 不可用 warn**（IO 边界 #b） | `darkMode.test.ts` §native 路径 | 1 |
| 订阅者回调异常隔离 | `darkMode.test.ts` §native 路径 | 1 |
| subscribeDarkMode 仅订阅 | `darkMode.test.ts` §native 路径 | 1 |
| unsubscribeDarkMode 退订对称 | `darkMode.test.ts` §native 路径 | 1 |
| currentDarkMode 初始 light + reactive | `darkMode.test.ts` §currentDarkMode | 2 |
| JS↔Java 契约钉死（6 项字面量） | `darkModeJavaContract.test.ts` | 6 |
| settingsStore 暗色 14 例 | `settingsStore.test.ts` | 14 |
| Robolectric 16 例（含 `currentDarkMode` 纯函数 + 防抖 + 兜底 + SDK 行为） | `LynxDarkModeTest.java` | 16 |
| **总计** | | **57** |

### 4.6 设备级键 + 备份域完整性守卫

- `BACKUP_DEVICE_KEYS` 注册 `settings_dark_mode`（settingsStore.ts:110）
- `applyRawKey` switch case 处理 `settings_dark_mode`（settingsStore.ts:937）
- 双向守卫测试：`settingsStore.test.ts:936-941`（所有 `*_KEY` ⊆ `BACKUP_DEVICE_KEYS`）+ `:944-948`（`BACKUP_DEVICE_KEYS` 每项均有 `applyRawKey` 分支）

### 4.7 设计约束

- 6 主题 × 亮暗全做（12 套静态色板，tokens.css +~300 行）—— T2 实施 ✅
- 暗色类挂根 `<page>`，与 `.theme-*` 正交组合；页面零改动 —— T2 ✅
- 状态栏 `isAppearanceLightStatusBars` 随 `resolvedDark` 动态（解 ADR-0168 D4 钉死）—— T3 ✅
- splash `values-night` 主轨（系统跟随全 API 覆盖）✅ + API 31+ `setSplashScreenTheme` 兜底（**手动模式接线 → follow-up [#692](https://github.com/a1121611810/Pictelio/issues/692)**）—— T3
- 全 app 硬编码浅色值审计（图片查看器 / R18 遮罩 / 小说正文 / skeleton）—— T4 ✅

## 5. Out of Scope

- webview 客户端任何改动（已记入 AGENTS.md「按计划将弃用」）
- 跨引擎设置共享 / 数据迁移
- 账号级外观偏好
- 定时/地理位置自动切换
- 暗色下图片**内容**本身处理
- ~~API 28–30 手动模式 splash 最早帧残留浅色窗口（平台无解，已接受）~~ **（修订 2026-09-21）**：当前实现下手动模式 splash 在所有 API 级别均未覆盖（读系统 uiMode）；`setSplashScreenTheme`（API 31+）接线后，API 28–30 残留早浅色帧平台无解、已接受——整体列 follow-up [#692](https://github.com/a1121611810/Pictelio/issues/692)

## 6. 进一步说明

- **真机/模拟器探针**：T1 是基础层，无可见 UI 变化（仅 JS 内部 ref 变化）；设备级探针在 T3 splash 联动一并做（Lynx 原生 `<list>` 结构 + 系统栏视觉变化点）。T1 单元层 contract 钉死（`darkModeJavaContract.test.ts`）作为 oracle 证据。
- **happy-dom 不当模拟**：vitest environment: node（vitest.config.ts:35）；测试通过 `globalThis.matchMedia` 注入 mock，不依赖 window/happy-dom；Lynx 行为靠 Robolectric + 真实 Configuration fixture 钉死。
- **错误模型不破坏调用方**：所有降级路径 warn + 维持兜底，不抛异常、不改变外部接口签名。
- **主题色 vs 暗色模块同源**：themeColor.ts 与 darkMode.ts 是 ADR-0152 立项时的孪生兄弟，统一走「清单单一事实源 + is*Id + 非法 warn + 回退默认」模式；暗色模块新增未引入新模式或绕过既有约定。
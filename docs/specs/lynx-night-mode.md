# lynx 夜间模式（明暗外观）—— 功能规格

> 来源：wayfinder 地图 [#682](https://github.com/a1121611810/Pictelio/issues/682)；研究 [#683](https://github.com/a1121611810/Pictelio/issues/683)（Lynx 运行时系统暗色检测）/ [#684](https://github.com/a1121611810/Pictelio/issues/684)（splash 深色化）；访谈 [#685](https://github.com/a1121611810/Pictelio/issues/685)（入口交互）；父 spec [#686](https://github.com/a1121611810/Pictelio/issues/686)。
>
> ADR 落点：[ADR-0180](../adr/ADR-0180-lynx-dark-mode.md)（D6 含 ADR-0168 状态栏钉死修订）；本文件为 T1/T2/T3/T4 实施期 spec oracle，已按交付现状修订。
> 状态：**T1–T5 全部实施并关闭（2026-09-21）**。同日 **review 修复轮**把原 follow-up #692 的「手动模式接线」落回代码（读点 / `ID_NULL` / 主题名双定义 / plate / 状态栏即时重设，终态见 §4.8）。遗留 = **真机走查 gate**（矩阵 [lynx-night-mode-walkthrough.md](./lynx-night-mode-walkthrough.md) + [#692](https://github.com/a1121611810/Pictelio/issues/692)）与暗色 placeholder 对比度（[#693](https://github.com/a1121611810/Pictelio/issues/693)）。

## 1. Problem Statement

lynx 客户端（缺省引擎）只有亮色界面：夜间/弱光环境刺眼；系统切暗后应用不跟随，与系统其它应用观感割裂。ADR-0152 做主题色时明确将「暗色/亮暗跟随」另行立项——本 spec 即该立项。webview 客户端已有明暗主题但**不投任何对齐/互通**（webview 按计划将弃用，已记入 AGENTS.md 注意事项）。

## 2. Solution

为 lynx 客户端建设完整明暗外观：

- 外观设置提供 **亮色 / 暗色 / 跟随系统** 三态，默认跟随系统，设备级持久化，切换即时生效
- 6 个主题色全部拥有 M3 dark scheme（12 套静态色板，构建期生成，零运行时算色）
- 「跟随系统」经原生通道检测（与 ADR-0168 insets 管线同构），web-core 预览走 `matchMedia` 兜底
- 原生层联动：状态栏图标色随外观即时切换（T3）；splash 双轨深色化（`values-night` 主轨 + API 31+ 持久化主题兜底，T3——兜底轨输入源 = `settings_dark_mode` 三态，接线终态见 §4.8）
- 设置入口落在「我的」页外观卡片顶部（主题色上方），M3 segmented button 三格（T2）

## 3. 票分（T1-T5）

| 票 | 范围 | 当前状态 |
|---|---|---|
| **T1** | 状态核心 + 系统检测通道（基础层，无可见 UI） | ✅ closed（`67b8300d` + `b26178f`） |
| T2 | 12 色板 + 根类绑定 + segmented 入口 + 色块联动 + i18n/a11y | ✅ closed（`33eaee4b` + `78cf676d`） |
| T3 | 状态栏图标动态切换 + splash 双轨 + IconBackground plate | ✅ closed（`2133233f`；手动模式接线在 review 修复轮补完，见 §4.8） |
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

**契约锚点**（与 ADR-0168 insets 管线同构；本表引用一律以**符号名 / 用例名**锚定，不写行号——与 §4.6 同纪律）：

| 元素 | JS 侧 | Java 侧 | 契约锚点（用例名 / 符号名） |
|---|---|---|---|
| 事件名 | `pictelioDarkMode` | `EVENT_DARK_MODE = "pictelioDarkMode"` | 用例「事件名 pictelioDarkMode：Java 发送 ⇄ JS 订阅」（`darkModeJavaContract.test.ts`） |
| 拉取方法 | `PictelioApp.getDarkMode(cb)` | `@LynxMethod getDarkMode(Callback)` | 用例「拉取方法 getDarkMode：Java 提供 ⇄ JS 调用」（同文件） |
| 载荷 | `JSON.stringify({mode: 'light' \| 'dark'})`（标准）+ 裸字符串兼容（保守兜底，详见 §4.4） | `JavaOnlyArray.of(JSON.stringify({mode: currentDarkMode(uiMode)}))` | 用例「载荷契约：Java JSON 字符串（{"mode":...}）⇄ JS 双路径解析」（同文件；钉 Java **转义引号形态** `"{\"mode\":\""`——防断言被 Javadoc 注释满足） |
| 初值拉取时机 | `ensureDarkModeInit()`（模块内 `ensureInit`）在 `getDarkMode` / `subscribeDarkMode` 首次调用时触发（订阅后拉） | 同上 | 用例「`ensureDarkModeInit`：native 侧订阅已注册 + pull 已发起（无回调消费方也能取到系统态）」+「`getDarkMode` 重复调用：幂等（ensureInit 一次）」（`darkMode.test.ts`） |
| 推变化源 | 冷启动订阅后由原生推送；JS 侧不轮询 | `onConfigurationChanged` 读 `Configuration.uiMode` 与 `UI_MODE_NIGHT_MASK`（manifest 已声明 `uiMode` configChanges，免 Activity 重建）；判定收敛到纯函数 `shouldEmitDarkEvent`，命中后 `sendDarkModeEvent()` → `sendGlobalEvent` via `GlobalEventEmitter` | ① 纯函数矩阵：用例「`shouldEmitDarkEvent_fullMatrix_matchesSpecDecisionTable`」（`LynxDarkModeTest`，Robolectric）；② 调用点源级断言：用例「a) onConfigurationChanged：`shouldEmitDarkEvent` 判定后 200 字符内 `sendDarkModeEvent()`」（`darkModeJavaContract.test.ts`——**JS 侧扫 Java 源 + 剥注释**）。**`onConfigurationChanged + UI_MODE_NIGHT_MASK` 字面量断言归 `darkModeJavaContract.test.ts`**（用例「配置变化回调 onConfigurationChanged 钉字面量：与 manifest configChanges 一致」），**不在 `LynxDarkModeTest`** |
| 后台兜底 | — | `onResume` 走**同一判定** `shouldEmitDarkEvent`（比对缓存 `sLastUiMode`，变化则补发，防后台期间系统翻转） | ① 用例「b) onResume：同组合（后台期间系统翻转未走 configChanges 的兜底补发）」（`darkModeJavaContract.test.ts`，剥注释）；② 纯函数矩阵 `shouldEmitDarkEvent`（同 `LynxDarkModeTest`） |

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

### 4.5 测试矩阵（T1 快照）

> **口径**：本表是 **T1 交付时点（commit `67b8300d` + `b26178f`）的快照**，用于记录「T1 该钉住哪些行为」，**不是当前用例计数**——T3/T4 与 #692 review 修复轮追加的防线不在本表内：
> - `darkModeJavaContract.test.ts` 后续扩展了「三态设置键原生读点」「`Resources.ID_NULL` 复位哨兵」「`syncStatusBarHidden` 单一写点」「`applyDarkModePreference` 下发」「splash 主题名跨配置稳定 + plate 接线」「跨语言色值（tokens.css ⇄ values-night）」等 describe 块；
> - Robolectric 侧新增 `LynxStatusBarLatchTest` / `LynxSplashThemeResourcesTest` / `LynxSplashThemeResourcesNightTest` 等文件；
> - Vitest 侧新增 `tests/palettes-drift.test.ts`（产物漂移）。
>
> **权威计数以各测试文件实际用例为准**（本文不维护第二份计数，避免陈旧）。

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

**合计口径**：上表行值逐行相加 = **58**；原文「**总计 57**」与本表行值不符，**已删除总计行**——本表不维护去重总数（避免第二份计数陈旧，与本节抬头「权威计数以各测试文件实际用例为准」同口径）。行值只表示「该维度在 T1 时点该钉住几条行为」，不等于当前用例数。

### 4.6 设备级键 + 备份域完整性守卫

> **引用口径**：本节按**符号名**锚定，不写行号——`settingsStore.ts` / `settingsStore.test.ts` 在 #692 实施轮持续增长，行号锚点在交付当天即失准（守卫测试从 `:940` 漂到 `:10xx` 只用了一次实施）。检索请用符号名 / 用例名。

- `BACKUP_DEVICE_KEYS` 注册 `settings_dark_mode`（`settingsStore.ts` 的 `DARK_MODE_KEY` 常量进 `BACKUP_DEVICE_KEYS` 清单）
- `applyRawKey` 的 switch case 处理 `settings_dark_mode`（`settingsStore.ts`）
- 双向守卫测试（`settingsStore.test.ts`，两条 source-scan 守卫，用例名即锚点）：
  - 「`settingsStore.ts` 内所有 `*_KEY` 字面量 ⊆ `BACKUP_DEVICE_KEYS`（设备级键完整性守卫）」
  - 「`BACKUP_DEVICE_KEYS` 每项均有 `applyRawKey` 分支（导入侧完整性守卫）」

### 4.7 设计约束（终态）

- 6 主题 × 亮暗全做（12 套静态色板，tokens.css +~300 行）—— T2 ✅
- 暗色类挂根 `<page>`，与 `.theme-*` 正交组合；页面零改动 —— T2 ✅
- 状态栏 `isAppearanceLightStatusBars` 随 `resolvedDark` 动态（解 ADR-0168 D4 钉死）—— T3 ✅；原生输入源接线 + 即时重设见 §4.8
- splash 双轨：`values-night` 主轨（system 跟随全 API 覆盖）✅ + API 31+ `setSplashScreenTheme` 兜底轨（输入 = `settings_dark_mode` 三态；手动 light/dark 显式覆盖、system 经 `Resources.ID_NULL` 交还主轨）—— T3 ✅（review 修复轮接线，见 §4.8）
- 全 app 硬编码浅色值审计（图片查看器 / R18 遮罩 / 小说正文 / skeleton / 滚动指示条）—— T4 ✅；设备端确认归发版前走查（[walkthrough](./lynx-night-mode-walkthrough.md) §4）

### 4.8 原生接线与机器防线（#692 review 修复轮终态）

**原生输入源接线**（`packages/app/android/app/src/lynx/java/io/pictelio/app/LynxActivity.java`）：

| 项 | 终态 |
|---|---|
| 读点 | 读 `SharedPreferences("CapacitorStorage")` 的 `settings_dark_mode`（`KEY_DARK_MODE` 常量；与 JS 写入侧同文件同键） |
| 决策纯函数 | `resolveIsDark(三态, uiMode)`：`light`/`dark` 手动映射；`system` 及未识别值跟随 `Configuration.uiMode & UI_MODE_NIGHT_MASK`（fail-safe）；非法值 `Log.w` + 回退 `system` |
| splash 兜底轨 | `dark` → `Theme.SplashScreen.Dark` / `light` → `Theme.SplashScreen.Light` / `system` → `Resources.ID_NULL`（复位 manifest 默认主题，禁兜底到任一手动主题）；平台门槛 API 31+（低版本 = §5 接受项） |
| 主题名稳定性 | 两支主题在 `values/` 与 `values-night/` **双配置双定义**（同名集合一致——反配置下手动档仍可解析） |
| plate 接线 | 两支主题父主题 = `Theme.SplashScreen.IconBackground`（缺该父链时 plate 色对系统 splash 无效）；暗面板 `#1C2024` ≠ 暗面 `#101418`，亮面板 == 亮底（有意） |
| 状态栏即时重设 | JS 切换后经 `PictelioAppModule.applyDarkModePreference`（`@LynxMethod`，主线程转交）重下发；`onResume` 兜底走**同一判定** `shouldEmitDarkEvent`（无独立 `shouldBackfillDark`——两触发源共用一函数） |
| 全屏交互 | 状态栏隐藏态经单一写点 `syncStatusBarHidden`（修旧实现「仅 onCreate 写一次 → 退出全屏后外观不重设」的闩锁）；全屏分支 `resolveStatusBarAppearance` 返回 null 跳过外观下发 |

**机器防线（四类契约测试）**：

| 类别 | 文件 | 断言要点 |
|---|---|---|
| 读点存在性 + 键名同源 | `darkModeJavaContract.test.ts` | Java 读点字面量（`settings_dark_mode` / `Resources.ID_NULL` / `syncStatusBarHidden`）+ JS 写入侧常量逐字一致 + `applyDarkModePreference` 两侧成对 |
| 跨语言色值 | `darkModeJavaContract.test.ts` | `values-night` 暗面 ≡ `.theme-sky.dark --md-surface`；暗 plate ≠ 暗面（离底有差 → 前景圆盘可见） |
| 产物漂移 / 锚点一致性 | `tests/palettes-drift.test.ts` | tokens.css 自动生成段 ≡ 生成脚本 `--stdout`（逐字节，行尾空白归一）+ `--stdout` 只读（运行前后 tokens.css 不变）；脚本内 **`lightPrimaryAnchor` ≡ 亮色 `--md-primary` 6/6 对等** |
| 豁免与覆盖面空集防护 | `tests/hardcodeColorGate.test.ts` | 白名单非空 + 条目路径存在 + 理由非空；`walk(src)` 文件数下界 + 关键文件在集内（防遍历失效恒真） |

> **防线边界（重要）**：源级断言证明的是「读点 / 调用点**存在**（剥注释后仍成立）」与组合**形态**成形（如 `resolveIsDark(normalizeDarkMode(readDarkModeRaw(this)))` 逐字成形）；它**不含运行期值流粘合**——`settings_dark_mode` 写入 → 读点取到新值 → 决策 → 状态栏/splash 实际按新值下发这条端到端链路不在单测射程内，由**人工过查**（review 修复轮的 M 项）**+ 设备走查 T3 矩阵**覆盖。**不得把「读点存在」读成「值流已验证」。**

> **术语（防「seed」一词两义）**：生成脚本清单字段 `lightPrimaryAnchor` = **亮色 primary 锚点**（双职责：亮色主色值 + 暗色派生 M3 `SchemeTonalSpot` 的 seed 输入）。[app-lynx-theme-color.md](./app-lynx-theme-color.md) 早期「列出的 hex 是 seed 输入、生成后 `--md-primary` 是派生 tone-40」属**历史口径差异**（那批 #6750a4 等是亮色板生成时的输入，与产物 primary #65558f 不等）——暗色色板与本 spec **以「`lightPrimaryAnchor` ≡ 亮色 `--md-primary`」为准**（`tests/palettes-drift.test.ts` 文件头同口径）。

**走查 gate**：上述防线只证明「读点存在 + 键名/色值同源」，**证明不了设备可见行为**（Lynx 样式引擎解析、平台 splash 语义、厂商 ROM 差异）——发版前按 [lynx-night-mode-walkthrough.md](./lynx-night-mode-walkthrough.md) 的 T2/T3/T4 矩阵执行（发版侧钩子见 [release-checklist.md](../release-checklist.md) §发版前 QA 防线），结果落档后关闭 [#692](https://github.com/a1121611810/Pictelio/issues/692)。

## 5. Out of Scope

- webview 客户端任何改动（已记入 AGENTS.md「按计划将弃用」）
- 跨引擎设置共享 / 数据迁移
- 账号级外观偏好
- 定时/地理位置自动切换
- 暗色下图片**内容**本身处理
- **API 28–30 手动模式 splash 残留**（接受项，终态边界）：`setSplashScreenTheme` 是 API 31+ 平台通道——API 28–30 上手动 light/dark 与系统 uiMode 相反时，splash 最早帧仍按 `values-night` 主轨（系统 uiMode）解析，与手动选择相反；平台无解、已接受（走查 T3-5 记录即可，不修）。

## 6. 进一步说明

- **真机/模拟器探针**：T1 是基础层，无可见 UI 变化（仅 JS 内部 ref 变化）；设备级探针随 T3 splash 联动一并做（Lynx 原生 `<list>` 结构 + 系统栏视觉变化点）。T1 单元层 contract 钉死（`darkModeJavaContract.test.ts`）作为 oracle 证据。**设备可见行为的最终口径 = 发版前走查矩阵**（[lynx-night-mode-walkthrough.md](./lynx-night-mode-walkthrough.md)，gate 见 §4.8）。
- **happy-dom 不当模拟**：vitest `test.environment: 'node'`（`packages/app-lynx/vitest.config.ts`）；测试通过 `globalThis.matchMedia` 注入 mock，不依赖 window/happy-dom；Lynx 行为靠 Robolectric + 真实 Configuration fixture 钉死。
- **错误模型不破坏调用方**：所有降级路径 warn + 维持兜底，不抛异常、不改变外部接口签名。
- **主题色 vs 暗色模块同源**：themeColor.ts 与 darkMode.ts 是 ADR-0152 立项时的孪生兄弟，统一走「清单单一事实源 + is*Id + 非法 warn + 回退默认」模式；暗色模块新增未引入新模式或绕过既有约定。

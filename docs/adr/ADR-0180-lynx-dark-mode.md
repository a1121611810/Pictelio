# ADR-0180: lynx 夜间模式——三态明暗外观 + 自建暗色检测通道 + 双轨 splash

- 状态: Accepted（2026-09-21，T1–T4 全部验收通过并合并；真机走查为发版前动作）
- 日期: 2026-09-21
- 关联: wayfinder 地图 [#682](https://github.com/a1121611810/Pictelio/issues/682)；spec [docs/specs/lynx-night-mode.md](../specs/lynx-night-mode.md)（[#686](https://github.com/a1121611810/Pictelio/issues/686)）；审计 [docs/specs/lynx-night-mode-audit.md](../specs/lynx-night-mode-audit.md)；研究 [#683](https://github.com/a1121611810/Pictelio/issues/683)（检测通道）/ [#684](https://github.com/a1121611810/Pictelio/issues/684)（splash 双轨）；访谈 [#685](https://github.com/a1121611810/Pictelio/issues/685)（入口交互）；实施 [#687](https://github.com/a1121611810/Pictelio/issues/687) / [#688](https://github.com/a1121611810/Pictelio/issues/688) / [#689](https://github.com/a1121611810/Pictelio/issues/689) / [#690](https://github.com/a1121611810/Pictelio/issues/690) / [#691](https://github.com/a1121611810/Pictelio/issues/691)
- **修订**: ADR-0168 D4（状态栏图标色恒真钉死 → 随 resolvedDark 动态）
- **延续**: ADR-0152（主题色静态 M3 色板；其「暗色/亮暗跟随一并做……另行立项」即本决策）
- 关联: ADR-0164（lynx 缺省引擎）/ ADR-0172（Lynx 运行时 web API 约束）

## 背景

lynx 客户端（缺省引擎，ADR-0164）此前只有亮色界面：夜间/弱光环境刺眼，系统切暗后应用不跟随，与系统其它应用观感割裂。ADR-0152 做主题色时明确将「暗色/亮暗跟随一并做」列为范围外、另行立项——本决策即该立项的落地记录。webview 客户端已有明暗主题，但按计划将弃用（已记入 AGENTS.md 注意事项）——**不做任何对齐与设置互通**。

## 决策

**D1 · 三态与持久化**：值域 `light | dark | system`，默认 `system`；设备级持久化键 `settings_dark_mode`（native 走 `PictelioPrefs` 共享 SharedPreferences，dev 走 idbKV，与 `settings_theme_color` 同模式）；非法值 `console.warn` 子前缀 `[settingsStore.darkMode]` + 维持默认（禁静默降级）；清单单一事实源 `src/utils/darkMode.ts`（themeColor 同模式）。

**D2 · 检测通道 = 自建原生通道**（研究的核心结论）：`PictelioAppModule.getDarkMode(cb)` 订阅后拉初值 + `pictelioDarkMode` 全局事件推变化（ADR-0168 insets subscribe-then-pull 同构，含 `onResume` 比对补发兜底后台翻转）；Android 侧 `onConfigurationChanged` 读 `Configuration.uiMode`（manifest 已声明 `uiMode` configChanges，原地回调免重建）；web-core 预览 `matchMedia` 兜底。JS 落点 = `utils/darkMode.ts` 哑桥（镜像 `safeArea.ts`）+ `settingsStore.resolvedDark` 派生。

**D3 · 12 套静态色板**：6 主题 × 亮暗，暗色为 `.theme-X.dark` 复合选择器（特异性 (0,2,0) > 单类 (0,1,0)，CSS 级覆盖亮色版同名变量）；每套覆盖与亮色同构的完整 M3 角色集；由 `scripts/generate-theme-palettes.mjs` 从 seed 经 M3 `SchemeTonalSpot` 构建期生成——零运行时算色（ADR-0152 决策延续）。

**D4 · 归一输出与根类绑定**：`settingsStore.resolvedDark`（`light | dark`）是三态与系统订阅的唯一归一输出，所有消费方只读它；根 `<page>` 类 = `appearanceClasses(themeColorId, resolvedDark)` 纯函数输出（`[.theme-X] + [.dark]`），页面零改动。

**D5 · 入口交互**：Me.vue 外观卡片内、主题色上方新增「外观模式」M3 segmented button 三格（亮色/暗色/跟随系统），点击即写 store + 持久化 + 即时生效；主题色预览色块挂同一 `appearanceClasses`，暗色下显示真实 dark primary（所见即所得）。

**D6 · 状态栏图标色（修订 ADR-0168 D4）**：ADR-0168 D4 的 `isAppearanceLightStatusBars = true`（当时依据「app-lynx 无暗色 UI」）改为**随 `resolvedDark` 动态**（亮→深图标 / 暗→浅图标）；全屏模式（状态栏隐藏）跳过该设置；决策纯函数 `isAppearanceLightStatusBarsFor` / `resolveStatusBarAppearance` 单测钉死。

**D7 · splash 双轨**：「最早帧由系统在应用代码运行前按 manifest 主题 + 系统 uiMode 绘制，运行时不可改写」是平台事实——主轨 = `values-night` 限定资源（`system` 模式全 API 零风险）；兜底轨 = API 31+ `Activity.getSplashScreen().setSplashScreenTheme`（经 PackageManager 持久化）覆盖手动模式的下一次冷启动；splash 图标用 `windowSplashScreenIconBackgroundColor` 明暗双 plate（保留现有浅色系图标资产）。**API 28–30 手动模式残留限浅色最早帧为平台无解，已接受**。

**D8 · 硬编码色审计与机器防线**：全 app 审计（tokens.css 暗色补档 `--md-error*` / `--md-scrim*` / `--md-state-pressed-error` / `--md-shape-*` / `--md-elevation-*` / `--md-scroll-indicator`；新增 `--colorOverlayForeground` 修复 AiOverlay 引未定义变量）；机器防线 `tests/hardcodeColorGate.test.ts`（扫描 src 硬编码色 + 注释豁免 + 白名单登记，防回潮）。

## 否决的替代方案

- **官方宿主通道（`__globalProps` / `LynxView.updateColorScheme`）**：宿主侧设施在 lynx-4.0.1 AAR 实证存在（`LynxColorScheme` 枚举 / `updateColorScheme`），但 vue-lynx@0.5.1 对 `__globalProps` **零接线**——JS 侧收不到；且官方通道无法表达三态手动覆盖（它服务系统跟随单一语义）。否决。
- **Lynx JS 运行时 `matchMedia`**：官方 API 清单无此项（`GlobalFab.vue` 早已按不可用守卫）——运行时不存在。否决。
- **CSS `@media (prefers-color-scheme)`**：项目 `lynx.config.ts` 未开 `enableCSSRule`；且三态手动覆盖（force dark/light）本就无法纯 CSS 表达（须 JS 状态参与）。否决。
- **跨引擎设置共享（复用 webview `theme` 键）**：webview 按计划弃用，不做互通；lynx 独立键 `settings_dark_mode`（外观是设备级偏好，与 `settings_theme_color` 同级）。否决。
- **运行时 M3 算色 / 动态写 CSS 变量**：ADR-0152 已否决（Lynx 动态样式支持面窄、双端不可靠、bundle 增大）——延续。否决。
- **只做 on/off 开关（无跟随系统）**：M3 规范里暗色是完整 scheme；跟随系统是 Android 用户基线预期；事后补三态须改持久化值域。否决。
- **只做默认 sky 的暗色**：会出现「pink + 暗色」的半吊子状态（禁用选项交互复杂 / 降级观感廉价）；色板是构建期静态值，+~300 行体积可接受。否决。
- **暗色下只覆盖 brand 令牌**：secondary-container / surface 中性色 / outline / state layer 不同步会串色（ADR-0152 同款论据）。否决。

## 后果

- **正面**：完整明暗外观（三态 + 6 主题 × 亮暗 12 套色板）；系统跟随经自建通道双端可用（含后台翻转补发）；splash/状态栏原生层同步；一次接线覆盖全部页面（根类 CSS 变量继承，页面零改动）；色板构建期静态值零运行时开销；硬编码色机器防线（gate test）防回潮。
- **代价 / 风险**：`tokens.css` +~300 行（暗色 6 套）；`pictelioDarkMode` 通道为新增永久契约面（事件名/载荷/方法名由 `darkModeJavaContract.test.ts` 双向钉死）；**API 28–30 手动模式 splash 最早帧残留浅色**（平台无解）；暗色模式下 Lynx 平台属性 `placeholder-color` 不解析 `var()`（对比度受限，巡检期议题）；`--md-state-pressed-error` 派生暂偏离 M3 spec（零消费方，巡检期修订）。
- **排除面**：webview 任何改动与设置互通（弃用计划）；账号级外观偏好；定时/地理位置自动切换；暗色下图片内容本身处理；API 28–30 splash 残留修复。

## 实施记录

| 票 | 内容 | 交付 |
|---|---|---|
| [#687](https://github.com/a1121611810/Pictelio/issues/687) | T1 状态核心与检测通道 | `67b8300d` + `b26178f`（Vitest +41 / Robolectric +16） |
| [#688](https://github.com/a1121611810/Pictelio/issues/688) | T2 手动暗色端到端（色板/绑定/入口） | `33eaee4b` + `78cf676d`（Vitest +19） |
| [#689](https://github.com/a1121611810/Pictelio/issues/689) | T3 原生系统栏联动（状态栏/splash） | `2133233f`（Robolectric +11） |
| [#690](https://github.com/a1121611810/Pictelio/issues/690) | T4 硬编码色审计与机器防线 | `f1480620` + `48286393`（Vitest +6 + 审计文档） |

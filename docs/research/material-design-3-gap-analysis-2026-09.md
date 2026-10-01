# MD3 官方规范 vs `packages/app-lynx` 实际实现 —— 差距分析

> 调研日期：**2026-09-30**
> 调研对象：`packages/app-lynx`（vue-lynx + Lynx 4.0.1 + Vue 3.5 + Tailwind CSS 3.4，Android 构建）
> 基线：**Material Design 3**（**不**使用 AGENTS.md「Fluent Design 规范」章——该章为已删除 WebView 客户端的历史存档，ADR-0203）
> 方法：规范侧取官方一手来源（AndroidX Material3 令牌源、material-web 令牌文件、W3C WCAG 2.2）；项目侧逐文件读码取证（CodeGraph 索引健康：16,155 节点 / 54,007 边）
> **图例**：✅ 符合 ｜ 🟡 部分符合 ｜ ❌ 不符合 ｜ ⛔ 引擎受限（平台限制，非项目缺陷）
>
> ⚠️ **本报告是差距调研，不是实施方案。** 所有「静态推断，未真机验证」标记见 §7。

---

## 1. 摘要

**一句话结论：项目的「色彩系统」高度合规（20/20 对比度抽查全过、导航栏/形状/时长档位都对得上 M3），但「排版系统」与「交互状态层」是系统性缺口——MD3 type scale 只落地了字号、丢了行高与字距；状态层只做了 pressed、丢了 hover/focus/disabled 的 alpha 层语义。**

| 严重度 | 条数 | 集中域 |
|---|---|---|
| 🔴 阻断 | 2 | 排版行高/字距缺失、动态色缺失 |
| 🟠 高 | 6 | 状态层四态不全、hover/focus 零覆盖、图标非 Material Symbols、触控目标下限低于 M3 建议、tonal elevation 缺失、text field 形态 |
| 🟡 中 | 8 | 遗留 Fluent 兼容别名、display 档位缺失、字重、旧档位别名塌陷、shape scale 未注册进 `borderRadius`（见 §2 #19 + 复核记录）、GlassCard 越界曲线、动效 token 硬编码、reduced-motion 覆盖不足 |
| ⚪ 低 | 3 | 文档口径、scroll indicator 口径（已决策）、errorPrototype 原型 |
| **合计** | **19** | — |

> **需要纠正任务简报的一处口径**：简报写「WCAG 2.2 触控目标 48dp」。经核对 [W3C WCAG 2.2 SC 2.5.8](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html)，**WCAG 2.2 的最小值是 24×24 CSS px**（AA 级），48dp 是 Android/Material 平台的**建议值**且属 WCAG 2.1 AAA SC 2.5.5 体系（44×44 CSS px）的加强。本报告按「MD3/平台建议 48dp」与「WCAG 2.2 AA 24px」双口径分别判定。

---

## 2. 总差距表（主表，按严重度降序）

| # | 差距项 | MD3 官方要求（URL） | 项目现状（文件:行号） | 严重度 | 影响面 | 建议修法 | 量 |
|---|---|---|---|---|---|---|---|
| 1 | **排版行高/字距完全未落地** | type scale 每档含 size+line-height+weight+tracking 四元组，例：body-large 16sp/24sp 行高/400 字重/0.5px 字距（[material-web v0.192 `_md-sys-typescale.scss`](https://github.com/material-components/material-web/blob/main/tokens/versions/v0_192/_md-sys-typescale.scss)） | `tailwind.config.ts:44-74` 的 `fontSize` 档位**只有 size 字符串**（`'label-small': '22rpx'`），无 `lineHeight`/`letterSpacing` 键；全仓自选行高 **27 处**（`leading-snug`×16 + `leading-[…]`×10 + `leading-relaxed`×1；另有 `leading-none` 45 处属刻意收紧排版、不在整改面内），且为**各组件自选**（`CommentItem.vue:83` `leading-[1.4]`、`WatchlistPromptDialog.vue:84` `leading-snug`），与 M3 档位无映射关系 | 🔴 阻断 | 全部 75 个 `.vue` 的文字排版 | 在 `tailwind.config.ts` 的 `fontSize` 改为 `['22rpx', { lineHeight: '32rpx', letterSpacing: '0.5rpx' }]` 数组形式（Tailwind 3 原生支持），按 material-web 15 档逐一填官方值；再逐组件删除自选 `leading-*` | L |
| 2 | **无动态色 / 壁纸取色** | 动态色是 M3 核心能力，由 tonal palette 从设备壁纸/种子色实时派生（[developer.android.com M3 in Compose — Dynamic color](https://developer.android.com/develop/ui/compose/designsystems/material3)） | 仅 7 个**构建期静态**色板类（`utils/themeColor.ts:8-17`：sky/violet/pink/green/orange/teal/bili），色值为预生成 CSS 变量（`tokens.css:11-480`），运行时不取壁纸色 | 🔴 阻断 | 全局观感；M3 平台一致性 | 二选一：(a) 引入 `@material/material-color-utilities` 的 `SchemeTonalSpot` 在宿主侧算色后经原生模块下发（重）；(b) 接受现状并**在 AGENTS.md 显式声明「有意不做动态色」**（轻，见路线图第一批） | L / S |
| 3 | **交互状态层只做了 pressed** | state layer 为 alpha 叠加层，四态 opacity：hover 8% / focus 10% / pressed 10%（按钮）/ 12%（列表）/ drag 16% / disabled 12%·38%（[m3.material.io/styles/state-layers](https://m3.material.io/styles/state-layers)） | `tokens.css:80-83` 仅 4 个 alpha token：pressed-primary/on-surface 12%、disabled-container 12%、disabled-on-surface 38%。**无 hover / focus 层 token**；`active:` 变体在 30 个文件使用（以预计算实色实现，见 `RefreshableList.vue:171` 的 `active:bg-layer-pressed-on-surface`） | 🟠 高 | 所有可交互元素 | 补 `--md-state-layer-hover-*`(8%)、`--md-state-layer-focus-*`(10%) 两个 alpha token（各 4 个语义色 = 8 条），Tailwind `extend.colors.state` 同步登记（`tailwind.config.ts:118-127`） | S |
| 4 | **hover / focus-visible 零覆盖** | 可交互元素须覆盖 hover、pressed、focus-visible 三态；focus 须用 `:focus-visible` 禁裸 `:focus` | 全仓 `.vue` 中 `hover:bg-*` 与 `focus-visible` 命中数 = **0**（grep 结果为空）。仅有 `active:` 与 `opacity-40/50`（13 文件） | 🟠 高 | 所有可交互元素 | 触控端 hover 优先级低可延后；但 `focus-visible` **应立即补**——无障碍关键路径。需先确认 Lynx 是否支持 `:focus-visible`（见 §5 引擎约束清单） | S / M |
| 5 | **图标非 Material Symbols** | M3 以 Material Symbols 为图标集，图标随字号缩放、笔画粗细随状态变化（[m3.material.io/styles/icons](https://m3.material.io/styles/icons/overview)） | 全仓无 `Material Symbols` 字体引用（grep 命中 0）。导航栏用 unicode 字形：`components/navTabs.ts:24-27` 的 `'⌂' '✦' '✎' '◎'`；`ActionButton.vue:11` 注释明写「unicode emoji 或文本符号」；`BottomSheet.vue:121` 关闭按钮用 `'×'` | 🟠 高 | 导航/动作/弹窗等全部图标位 | 接入 Material Symbols 字体（宿主 assets 同步已有脚本 `scripts/sync-android-assets.mjs`），建立 `<AppIcon name="close">` 组件内聚图标映射；逐点替换 unicode 字形 | M |
| 6 | **触控目标下限低于 M3 建议值** | Android/Material 建议最小可点区域 48×48dp；WCAG 2.2 SC 2.5.8 AA 要求 24×24 CSS px（[W3C 2.5.8](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html)） | AGENTS.md 写 40×40px。实测 `NavigationBar.vue:24` 高度 80px、指示器胶囊 64×32dp（`:35`）**合规**；`PageTopBar.vue:44` 64px **合规**。但 `SubTabBar.vue:44` 单项高 48px、`SearchSheet.vue:361` 输入框高 42px（11.2vw）、`:396-449` 多个 chip 40px —— 均 ≥24px（AA 通过）但 <48dp（MD3 建议不通过） | 🟠 高 | 二级 tab、搜索/筛选 chip | 按角色分层：导航类保持 ≥48dp；chip 类维持 40px（MD3 chip 自身 32dp 高，40px 已含 4px 外扩）。**先修 `SubTabBar` 48→56px** 这一处真实不足 | S |
| 7 | **缺 M3 tonal elevation（surface tint）** | M3 elevation 分 0–5 级，**每级由 surface tint（primary 叠加）表达**，而非仅 box-shadow（[m3.material.io/styles/elevation](https://m3.material.io/styles/elevation/overview)） | `tokens.css:144-146` 仅 3 档纯 box-shadow（Android 简化版），**无 level 0/4/5**；`--md-surface-tint` 已定义（`tokens.css:65`）但 `.vue` 中引用数 = **0** | 🟠 高 | 卡片/菜单/弹层的层级感 | 在 tokens.css 补 `--md-elevation-0/4/5`，并为有 `shadow-[var(--md-elevation-N)]` 的容器补 surface-container 背景以模拟 tint 叠加 | M |
| 8 | **Text field 非 M3 filled/outlined 变体** | M3 text field 两种变体（filled / outlined），容器高 56dp，filled 变体顶部下划线 + focus 时变 primary（[m3.material.io/components/text-fields](https://m3.material.io/components/text-fields)） | `SearchSheet.vue:361` 为 `h-[11.2vw]`(42px) + `rounded-[var(--md-shape-full)]` 全圆角胶囊 + `bg-surface-container-highest` —— 是**药丸搜索框**形态，非 M3 filled/outlined text field。6 个文件含 `<input>`（`SettingsEndpoint/SearchSheet/BookmarkPanel/CommentInputBar/Me/Login`） | 🟠 高 | 搜索/设置/评论输入 | 明确取舍：全局搜索框保持药丸形态（业界惯例，可辩护），但在 AGENTS.md 登记为「有意偏离」；评论/设置输入框对齐 M3 filled 56dp | M |
| 9 | **遗留 Fluent 兼容别名仍在 Tailwind 主色板** | M3 语义命名（primary/surface/outline…） | `tailwind.config.ts:134-162` 保留 `background/foreground/stroke/brand/onBrand/danger/warning/success/overlay` 9 组 Fluent 语义名；`tokens.css:100-122` 对应 22 条 `--color*` 别名 | 🟡 中 | 新代码易误用旧名 | 新代码一律用 M3 名（配置注释已写「新代码优先」）。清理需全量替换存量引用，**风险高收益低**，建议只加 lint 规则禁止新增 | M |
| 10 | **MD3 display 档位缺失** | type scale 15 档含 display-L/M/S | `tailwind.config.ts:44-62` 语义档位只到 `headline-large`，**无 display-small/medium/large**；`.vue` 中 `text-display-*` 使用数 = 0 | 🟡 中 | 需大标题的页面 | 补 3 档（display-small 36sp/headline-large 64rpx、display-medium 45sp/90rpx、display-large 57sp/114rpx），消费点可后续再定 | S |
| 11 | **字重未按 M3 分档** | M3：label-* 与 title-small/medium 为 500，body-* 与 headline-* 为 400 | 无 `fontWeight` scale；`.vue` 中 `font-medium` 与 `font-bold` 混用（如 `NavigationBar.vue:44` 用 `font-medium`，符合 label-medium=500；但 `ActionButton.vue` 等处见 `font-bold`） | 🟡 中 | 文字层级观感 | 建立 `fontWeight: { regular:'400', medium:'500' }` 并把 M3 要求 500 的档位绑上去 | S |
| 12 | **旧档位别名值塌陷，多档映射到同一值** | type scale 各档 size 互不相同 | `tailwind.config.ts:64-73`：`base`/`lg`/`xl` 全 = 28rpx，`5xl`/`6xl` 全 = 56rpx —— 存量类名失去层级差 | 🟡 中 | 存量代码视觉一致性 | 已注释说明「对齐 M3 最接近档位」，属**有意决策**。建议补 ADR 记录，不改代码 | S（仅文档） |
| 13 | **GlassCard 使用非 M3 缓动曲线** | M3 曲线（material-web v0.192 `_md-sys-motion.scss`）：`emphasized` `(0.2,0,0,1)`、`standard` `(0.2,0,0,1)`、`emphasized-accelerate` `(0.3,0,0.8,0.15)`、`emphasized-decelerate` `(0.05,0.7,0.1,1)`；`(0.4,0,0.2,1)` 在 v0.192 中是 **`easing-legacy`（MD2 遗留）**，非 standard（[material-web `_md-sys-motion.scss`](https://github.com/material-components/material-web/blob/main/tokens/versions/v0_192/_md-sys-motion.scss)） | `tokens.css:163-166` 四条曲线取值**与官方 v0.192 逐条一致** ✅。`GlassCard.vue:40` 用 `cubic-bezier(0.33, 0, 0.67, 1)` —— 不在 M3 曲线内（该值是 Fluent 的 standard 曲线）。**另**：Tailwind `transition-*` 的默认 timing function 来自 lynx preset，为 `cubic-bezier(0.4,0,0.2,1)`（= MD2 legacy，见构建产物实测） | 🟡 中 | 卡片按压反馈；全站 `transition-*` 默认缓动 | `GlassCard.vue:40` 改为 `var(--motion-emphasized-decelerate)`（`tokens.css:165` 已是官方值）；并在 preset 层把默认 timing function 从 legacy 改为 `var(--motion-emphasized)` | S |
| 14 | **动效 duration 部分硬编码** | M3 duration 档位：short1-4 = 50/100/150/200ms、medium1-4 = 250/300/350/400ms、long1-4 = 450/500/550/600ms | `tokens.css:153-158` 定义了 150/200/300/250/350ms（对齐 short3/short4/medium2/medium1/medium3 ✅）。但 `RefreshableList.vue:246` 硬编码 `200ms`、`:264-271` 硬编码 `250ms` + `60ms/120ms` stagger 延迟；`App.vue:161`、`GlobalFab.vue:152` 亦有硬编码 | 🟡 中 | 刷新/骨架/FAB 动效 | 替换为 `var(--durationNormal)` / `var(--durationMedium1)`；stagger 延迟可留（无 M3 官方值） | S |
| 15 | **`prefers-reduced-motion` 仅 1 组件处理** | 动效应尊重用户减弱动效偏好 | 仅 `GlobalFab.vue:19-27,147,152,160` 通过 `window.matchMedia('(prefers-reduced-motion: reduce)')` 处理；`BookmarkButton.vue`（4 个动画）、`RefreshableList.vue`（5 个动画）、`App.vue`（1 个）**未处理** | 🟡 中 | 前庭障碍用户 | 抽 `useReducedMotion()` composable 统一，各动画组件接入 | M |
| 16 | **scroll indicator 明暗不对称** | M3 未对滚动条色值做强制规定（属平台 affordance） | `tokens.css:84-97` 显式声明：亮色 7 主题共用中性值，暗色各主题按 outline 派生，并注明「**设计选择，非遗漏**」，由 `tests/unit/utils/appearanceClasses.test.ts` 守值 | ⚪ 低 | 无（已决策） | 无需修。已在代码中留痕 | — |
| 17 | **`errorPrototype/` 保留 px 硬编码** | — | `errorPrototype/ErrorPagePreview.vue:16,19,29,33` 用 `padding: 40px` / `font-size: 32px` / `border-radius: 24px` / `color: #1a6fa8` 硬编码。**该文件不在 `router.ts` 中**（grep 确认未注册），为原型预览 | ⚪ 低 | 无（不在生产路由） | 归档到 `docs/` 或删除，避免被误当范例复制 | S |
| 18 | **AGENTS.md 排版章节口径与实现脱节** | — | AGENTS.md「Fluent Design 规范」章为 WebView 客户端存档（ADR-0203），但其中「禁止自定义字体大小（`15px`、`1.2rem`）」等条款**在 MD3 语境下已失效**（Lynx 侧改用 rpx）。Lynx 侧实测无 `text-[Npx]` 类（命中 0）✅，但文档未说明这一点 | ⚪ 低 | 文档准确性 | 补一节「app-lynx 排版约定（MD3 + rpx）」替代存档章 | S |
| 19 | **shape scale 未注册进 `borderRadius`，圆角正确性靠「碰巧」维持** | shape scale 应作为**受保护的语义档位**暴露（M3 6 档：4/8/12/16/28/9999） | `tailwind.config.ts` **无 `borderRadius` 键**，`@lynx-js/tailwind-preset` 也不提供（实测 preset 顶层与 `extend` 均无 `borderRadius`）⇒ `rounded-*` 走 **Tailwind 3 默认 rem 值**。实测构建产物：`rounded-md`=0.375rem(6px)、`rounded-3xl`=1.5rem(24px) —— **均不在 M3 shape scale 上**，且 M3 的 28px `extra-large` 无法用类名表达。好在**存量代码几乎不走默认类**：`rounded-lg/md/xl/2xl/3xl` 实测 **0 处**；274/327 处是 `rounded-[var(--md-shape-*)]`（正确走 token）。残留：14 处方向类 `rounded-t`/`rounded-tr` 静默取 `0.25rem`(4px，数值恰好等于 M3 extra-small 但**不是 token**)，2 处 `TextSelectionToolbar.vue:63,66` 硬编码 `rounded-[0.65vw]`(≈2.4px，低于 M3 最小档 4px) | 🟡 中 | 全部圆角；新增代码的形状一致性 | 在 `tailwind.config.ts` 注册 `borderRadius: { xs: 'var(--md-shape-extra-small)', sm: …, DEFAULT: 'var(--md-shape-medium)', lg: …, xl: …, '2xl': 'var(--md-shape-extra-large)', full: 'var(--md-shape-full)' }`，令任意 token 名写错时**构建期**报错而非静默失效；14 处方向类与 2 处硬编码改走 token | S |

---

## 3. 分域明细

### 3.1 色彩 ✅ 高度合规

| 检查项 | MD3 要求 | 项目现状 | 判定 | 证据 |
|---|---|---|---|---|
| color roles 齐备 | primary/secondary/tertiary/error + on-× + container + on-container | 12 个角色全在 | ✅ | `tailwind.config.ts:78-101`；`tokens.css:14-29` |
| surface 五档容器 | lowest/low/base/high/highest | 5 档全在 | ✅ | `tokens.css:41-45`；`tailwind.config.ts:107-111` |
| on-surface-variant / surface-variant / outline / outline-variant | 4 角色 | 全在 | ✅ | `tokens.css:34-37` |
| inverse 角色 | inverse-surface / inverse-on-surface / inverse-primary | 全在 | ✅ | `tokens.css:46-48` |
| 裸 hex 字面量 | 应用 token，不硬编码 | `.vue` 中 0 处 6 位 hex（9 处命中全为**注释中的 ticket 号**如 `#748`）；`rgba()` 仅 3 处（1 处在 `PagePickerSheet.vue:94-95` 遮罩、1 处在未路由的 errorPrototype） | 🟡 | grep 全量比对；`tokens.css:110-119` 有 4 个字面量（`#2180bd`/`#155b8a`/`#2e7d32`/`#fff`）但属 token 定义处，可接受 |
| 对比度（亮色 sky，11 组） | 正文 4.5:1 / UI 组件 3:1（[WCAG 1.4.3](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html)） | onSurface/surface 16.37、onSurfaceVariant/surface 8.99、onPrimary/primary 5.41、error/surface 6.26、outline/surface 4.29 … | ✅ | 按 WCAG 相对亮度公式（L=0.2126R+0.7152G+0.0722B）逐对计算，全过 |
| 对比度（**复核补测：亮色 20 组 / 暗色 18 组**） | 同上 | 亮色 20 组仅 `outline-variant`/surface = **1.63** < 3；暗色 18 组仅 `outline-variant`/surface = **1.98** < 3。`outline-variant` 在 M3 中即**装饰性分隔线**角色（非控件唯一边界），WCAG 1.4.11 对纯装饰边界有豁免 ⇒ **不判为缺陷**。其余 36 组全部达标（最低 `primary`/surface = 5.18，`on-primary`/primary = 5.41） | ✅ | 复核脚本按 WCAG 2.2 公式计算，取自 `tokens.css:14-48`（亮）与 `tokens.css:490-528`（暗 sky） |
| 对比度（暗色 sky，8 组） | 同上 | onSurface/surface 14.28、onSurfaceVariant/surface 10.89、error/surface 10.89 … | ✅ | 同上 |
| 对比度（bili 板，2 组） | 同上 | onSurfaceVariant/surface 5.79、onSurfaceVariant/surface-container-high 4.58 | ✅ | 同上 |
| 暗色是否用 tonal palette 而非反相 | 暗色为独立 tonal palette 派生 | 7 主题暗色板由 `scripts/generate-theme-palettes.mjs` 经 M3 SchemeTonalSpot `isDark=true` 生成，**非明暗反相** | ✅ | `tokens.css:482-488` 生成段声明 + `tokens.css:490-971` 产物 |
| 亮/暗/跟随系统三态 | — | 支持，`DARK_MODE_OPTIONS` 三态 + 原生哑桥订阅 | ✅ | `utils/darkMode.ts:23-27`、`stores/settingsStore.ts:336-404` |

### 3.2 排版 ❌ 系统性缺口

| 检查项 | MD3 要求 | 项目现状 | 判定 | 证据 |
|---|---|---|---|---|
| type scale 15 档字号 | 15 档 size | 12 档（缺 display×3） | 🟡 | `tailwind.config.ts:44-62` |
| 各档 size 数值 | 见 material-web：body-large 16sp、label-large 14sp、title-large 22sp、headline-large 32sp 等 | 换算 1sp=2rpx@375：label-small 22rpx=11sp ✅、body-medium 28rpx=14sp ✅、title-large 44rpx=22sp ✅、headline-large 64rpx=32sp ✅ —— **档位 size 本身全对** | ✅ | `tailwind.config.ts:51-61` vs material-web `_md-sys-typescale.scss` |
| **行高** | 每档配 line-height（body-large 1.5rem、label-large 1.25rem、headline-large 2.5rem…） | **未定义**；10 处 `leading-*` 均为组件自选值 | ❌ | `tailwind.config.ts` 无 `lineHeight` 键；`CommentItem.vue:83` `leading-[1.4]` vs M3 body-medium 应为 1.25rem |
| **字距** | 每档配 tracking（body-large 0.03125rem=0.5px、label-large 0.00625rem=0.1px、title-medium 0.009375rem=0.15px） | **未定义**；全仓无 `tracking-*` | ❌ | grep `tracking-` 命中 0 |
| 自造字号 | 禁 `15px`/`1.2rem` 类自造值 | `.vue` 中 `text-[Npx|Nrem|Nsp]` 命中 **0** | ✅ | grep 全量 |
| 档位使用分布 | — | label-medium 169 / body-small 86 / label-large 81 / body-medium 57 / title-medium 51 / label-small 32 / title-small 25 / title-large 20 / body-large 14 / headline-small 7 / headline-medium 1 / headline-large 1 | — | grep 统计 |

### 3.3 形状 ✅ 合规

| 检查项 | MD3 要求 | 项目现状 | 判定 | 证据 |
|---|---|---|---|---|
| shape scale | extra-small 4 / small 8 / medium 12 / large 16 / extra-large 28 / full 9999（[material-web `_md-sys-shape.scss`](https://github.com/material-components/material-web/blob/main/tokens/versions/v0_192/_md-sys-shape.scss)） | 6 档全在，dp→vw 换算（4dp=1.067vw … 28dp=7.467vw） | ✅ | `tokens.css:127-132` |
| **shape token 的消费路径** | 语义档位应受保护（写错即构建期失败） | **未注册进 `tailwind.config.ts` 的 `borderRadius`**（preset 亦无）⇒ 默认类走 Tailwind rem 值（6px/24px 越界）。存量 274/327 处走 `rounded-[var(--md-shape-*)]` 正确；`rounded-lg/md/xl/2xl/3xl` 实测 0 处 | 🟡 | 见 §2 #19；构建产物实测 |
| 导航栏指示器形状 | 64×32dp 全圆角胶囊 | `w-[17.067vw] h-[8.533vw] rounded-full` = 64×32dp | ✅ | `NavigationBar.vue:35` |
| 全圆角 token | full = 9999px | `--md-shape-full: 9999px` | ✅ | `tokens.css:132` |

### 3.4 动效 🟡 大体合规、曲线有越界

| 检查项 | MD3 要求 | 项目现状 | 判定 | 证据 |
|---|---|---|---|---|
| 四条曲线 | material-web v0.192：`emphasized` `(0.2,0,0,1)`、`standard` `(0.2,0,0,1)`（与 emphasized 同值）、`emphasized-accelerate` `(0.3,0,0.8,0.15)`、`emphasized-decelerate` `(0.05,0.7,0.1,1)`；`(0.4,0,0.2,1)` 是 **`easing-legacy`（MD2）** | `tokens.css:163-166` 四条**逐条与官方一致** ✅（`standard` 与 `emphasized` 同值是官方事实，非缺陷）。越界项为 `GlassCard.vue:40` 的 `(0.33,0,0.67,1)`（Fluent 值），以及 Tailwind `transition-*` 默认 timing function（preset 给出 `cubic-bezier(0.4,0,0.2,1)` = MD2 legacy，构建产物实测） | 🟡 | 见 §2 #13 |
| duration 档位 | short 50-200 / medium 250-400 / long 450-600ms | 定义 150/200/250/300/350ms，均落在官方档位内 ✅；但有硬编码绕过 | 🟡 | `tokens.css:153-158`；硬编码见 `RefreshableList.vue:246,264-271` |
| 非 M3 曲线 | 禁 M3 未定义缓动 | `GlassCard.vue:40` 用 `(0.33,0,0.67,1)`（Fluent 值） | ❌ | `GlassCard.vue:40` |
| reduced-motion | 应尊重用户偏好 | 仅 GlobalFab 处理 | 🟡 | `GlobalFab.vue:19-27`；其余 3 组件未处理 |

### 3.5 状态与交互 🟡

| 检查项 | MD3 要求 | 项目现状 | 判定 | 证据 |
|---|---|---|---|---|
| state layer 四态 | material-web v0.192 官方 opacity：`hover` 0.08 / `focus` 0.12 / `pressed` 0.12 / `dragged` 0.16（[material-web `_md-sys-state.scss`](https://github.com/material-components/material-web/blob/main/tokens/versions/v0_192/_md-sys-state.scss)） | 只有 pressed（12%）+ disabled（12%/38%），**hover(8%) / focus(12%) / dragged(16%) 层 token 缺失** | 🟡 | `tokens.css:78-83` |
| pressed 用 alpha 层而非预计算实色 | 官方用半透明叠加 | 项目**同时**保留两套：`--md-state-pressed-*`（预计算实色，如 `#155b8a`）与 `--md-state-layer-pressed-*`（正确 alpha）。实际消费多用实色 | 🟡 | `tokens.css:73-83`；`RefreshableList.vue:171` 用 `bg-layer-pressed-on-surface`（alpha ✅）；但 `ActionButton.vue:31` 用 `active:bg-white/10`（实色） |
| hover / focus-visible | 须覆盖 | 0 覆盖 | ❌ | grep 命中 0 |
| disabled 态 | 须表达 | 13 文件用 `opacity-40/50` + `pointer-events-none` | 🟡 | grep 统计 |
| 无障碍标注 | 可交互元素应可被辅助技术识别 | 31/75 文件引入 `A11Y_ELEMENT_ENABLED` | 🟡 | grep 统计（`NavigationBar.vue:27` 等） |

### 3.6 组件形态 ✅/🟡 混合

| 检查项 | MD3 要求 | 项目现状 | 判定 | 证据 |
|---|---|---|---|---|
| 底部导航高度 | 80dp | `h-[21.333vw]` = 80px | ✅ | `NavigationBar.vue:24` |
| 底部导航 active indicator | 64×32dp 胶囊，secondary-container | 完全一致 | ✅ | `NavigationBar.vue:34-36` |
| 底部导航背景 | surface-container 层级 | `bg-surface-container` | ✅ | `NavigationBar.vue:24` |
| Top app bar 高度 | 64dp | `h-[17.067vw]` = 64px | ✅ | `PageTopBar.vue:44,70` |
| Bottom sheet 底部对齐 | MD3 bottom sheet 贴底 | 检查 `BottomSheet.vue` 为贴底形态（非居中弹窗） | ✅ | `BottomSheet.vue:121` 关闭键在右上、内容贴底 |
| Text field 高度/变体 | 56dp，filled/outlined | 42px 药丸搜索框 | 🟡 | `SearchSheet.vue:361` |
| 二级 tab 高度 | 建议 ≥48dp | 48px | 🟡 | `SubTabBar.vue:44` |
| 按钮圆角 | M3 button = full | `ActionButton.vue:29` 用 `rounded-[var(--md-shape-medium)]`（12dp，非 full） | 🟡 | `ActionButton.vue:29` |
| 图标集 | Material Symbols | unicode 字形 | ❌ | `navTabs.ts:24-27`、`BottomSheet.vue:121` |
| loading / 空态 / 错误态 | 应有 MD3 形态 | `EmptyState.vue`（公共层六组件之一）、`RefreshableList.vue` 骨架均有 | ✅ | 组件存在，形态未逐条比对 |

### 3.7 主题与动态色 🟡

| 检查项 | MD3 要求 | 项目现状 | 判定 | 证据 |
|---|---|---|---|---|
| light/dark/system 三态 | 支持 | 支持，含原生哑桥订阅 | ✅ | `utils/darkMode.ts:23-27` |
| tonal palette 派生 | 暗色用 tonal palette 非反相 | 7 主题由 SchemeTonalSpot 派生 | ✅ | `tokens.css:482-488` |
| **动态色 / 壁纸取色** | M3 核心能力 | 7 个静态构建期色板，无壁纸取色 | ❌ | `utils/themeColor.ts:8-17` |
| 主题切换是否有突兀跳变 | — | 亮暗两套独立板，非反相，跳变风险低 | ✅ | `tokens.css:490-971` |

### 3.8 可达性 🟡

| 检查项 | 标准 | 项目现状 | 判定 | 证据 |
|---|---|---|---|---|
| 对比度 | 4.5:1 正文 / 3:1 UI | 20 组抽查全过 | ✅ | §3.1 计算表 |
| 触控目标 | WCAG 2.2 AA ≥24px；MD3 建议 ≥48dp | 导航 80px / 顶栏 64px ✅；chip 40px、SubTabBar 48px 介于两口径之间 | 🟡 | `NavigationBar.vue:24`、`SearchSheet.vue:361,396`、`SubTabBar.vue:44` |
| `prefers-reduced-motion` | 尊重用户偏好 | 1/4 组件 | 🟡 | `GlobalFab.vue:19-27` |
| 辅助技术标注 | — | 31/75 文件 | 🟡 | grep 统计 |

---

## 4. 未验证 / 抽样说明

**抽样规则**（组件/页面共 75 个 `.vue`、79 个组件、40 个页面，未全量逐行读）：
- **全量读取**：`tailwind.config.ts`(168 行)、`tokens.css`(971 行) —— 排版与色彩两域的判定不依赖抽样
- **全量 grep 统计**：裸 hex / rgba、`transition|animation|cubic-bezier`、`leading-*` / `tracking-*`、typography 类分布、`hover:`/`focus-visible`、`w-[Nvw]`/`h-[Nvw]` 全量枚举
- **逐行读取**：色彩/排版/形状/动效 4 域的核心文件
- **定向抽检（按 MD3 组件角色）**：NavigationBar、PageTopBar、SubTabBar、BottomSheet、ActionButton、SearchSheet、M3Switch、GlassCard、GlobalFab、BookmarkButton、RefreshableList、ErrorPagePreview —— 覆盖了 MD3 组件谱系中本项目实际用到的全部角色
- **未抽检**：40 个页面中除上述组件外的页面级布局，以及 `SkeletonNovel` / `FeedListFooter` / `TagChipRow` 等次要组件的具体数值

---

## 5. 引擎约束清单（平台限制，非项目缺陷）

| MD3 要求 | Lynx/rspeedy 下的状况 | 处理建议 |
|---|---|---|
| `box-shadow` 多层阴影 | 需真机确认 LynxView 对 `shadow-[var(--md-elevation-N)]`（多层逗号分隔）的支持度；tokens.css 注释已自述「Android tokens 简化版」 | 保留简化版；若真机不生效，改用 surface-container 层级表达层级 |
| `:focus-visible` 伪类 | 触控端无键盘焦点场景，Lynx 支持度未知 | §2 #4 的修复前须先真机验证 |
| `:hover` 伪类 | 纯触屏无 hover，Lynx 支持度未知 | 可判定为「不适用」而非「不符合」 |
| 阴影 + 动画组合 | `animation` 在 5 个组件中使用，未真机验证是否全部生效 | 需模拟器验证 |
| `rpx` 单位 | Lynx 原生支持（非 CSS 标准），属平台扩展 | 合规使用 |
| M3 完整 motion spring 曲线 | Lynx transition 支持有限（tokens.css:162 自述），Expressive spring 无法表达 | BookmarkButton 已用「近似」方案，标注为引擎受限 |
| MD3 `backdrop-filter`（毛玻璃） | Lynx 支持度未知 | GlassCard 已用纯色替代 |

---

## 6. 修复路线图

### 第一批：零风险、立刻可改（不改设计决策，不改渲染结果）

| 序 | 事项 | 依赖 | 量 |
|---|---|---|---|
| 1 | `GlassCard.vue:40` 曲线改 `var(--motion-emphasized-decelerate)`；preset 层把 `transition-*` 默认 timing function 从 MD2 legacy 换为 M3 emphasized | 无 | S |
| 2 | 补 3 档 display 字号（display-small/medium/large） | 无 | S |
| 3 | `tailwind.config.ts` 注册 `borderRadius` 映射到 `--md-shape-*`（§2 #19），并把 14 处方向类 + `TextSelectionToolbar.vue:63,66` 硬编码改走 token | 无 | S |
| 4 | `tailwind.config.ts` 加 `fontWeight: { regular, medium }` 并绑定 | 无 | S |
| 5 | 硬编码 duration 替换为 `var(--durationNormal)`/`var(--durationMedium1)`（RefreshableList/App.vue/GlobalFab） | 无 | S |
| 6 | 归档 `errorPrototype/ErrorPagePreview.vue` | 无 | S |
| 7 | AGENTS.md 补「app-lynx 排版约定（MD3 + rpx）」，标注 Fluent 章为存档 | 无 | S |

**可独立提交，互不阻塞。** 1–5 各自是单文件改动。**注意**：原第 1 项「修正 `--motion-standard` 为 `(0.4,0,0.2,1)`」已删除 —— 该判断经复核为**错误**，官方 v0.192 的 `easing-standard` 就是 `(0.2,0,0,1)`，详见 §8 复核修正记录。

### 第二批：需设计决策（先拍板再动手）

| 序 | 事项 | 需先决策 | 量 |
|---|---|---|---|
| 8 | 排版行高 + 字距落地（§2 #1） | 是否接受全站行高变化带来的视觉回归；建议分组件灰度 | L |
| 9 | 状态层补 hover/focus token（§2 #3） | Lynx 是否支持 hover/focus 伪类（须真机验证） | S |
| 10 | 图标换 Material Symbols（§2 #5） | 字体体积 vs 观感；需设计确认映射表 | M |
| 11 | tonal elevation 补 0/4/5 档（§2 #7） | 是否引入 surface tint 表达层级 | M |
| 12 | 抽 `useReducedMotion()` 统一 4 个组件（§2 #15） | 无争议，可与第 8 项同批 | M |
| 13 | Text field 对齐 M3 filled 56dp（§2 #8） | 搜索框是否保持药丸形态（需产品判断） | M |
| 14 | 动态色（§2 #2） | 走技术方案还是**显式声明不做** | L / S |
| 15 | SubTabBar 48→56px（§2 #6） | 二级 tab 是否需加大 | S |

**依赖关系**：#8 建议先做 #12（reduced-motion）再改行高，避免动效与排版变更叠加难归因。#9 依赖真机验证结果。#10/#13 需设计先行。

### 第三批：需升级引擎或换方案

| 事项 | 说明 |
|---|---|
| Expressive spring 动效 | Lynx transition 支持不足，需引擎升级或维持近似方案（`BookmarkButton.vue` 现状） |
| 完整 state layer（含 drag/ripple） | 需引擎支持更多伪类与 alpha 合成 |
| `backdrop-filter` 毛玻璃 | 需引擎支持；当前 GlassCard 用纯色替代 |
| 真机/E2E 验证基础设施 | 本报告全部为静态审计；渲染层是否真生效需 `packages/android-host/tests/android-e2e/` 覆盖 |

---

## 7. 本次未能验证的部分（重要）

1. **全部结论均为「静态推断，未真机验证」**。Lynx 的 CSS 支持是子集，代码里有声明 ≠ 真机生效。本报告**没有任何一条结论经过真机或模拟器确认**。
2. **抽样**。组件/页面 75 个 `.vue` 未全量逐行读；抽样规则见 §4。但排版、色彩、形状、动效四域的**配置文件**是全量读的，结论不依赖抽样。
3. **对比度为静态计算**。按 WCAG 2.2 官方相对亮度公式计算 20 组配对，**未在真机上验证实际渲染色值**（如 `.theme-bili` 板在 `errorPrototype` 等未路由场景下的实际叠加）。
4. **`m3.material.io` 页面为 JS 渲染**，直接 fetch 拿不到正文。本报告的 MD3 数值改用 **AndroidX Material3 / material-web 官方令牌源文件**（`Typography.kt`、`_md-sys-typescale.scss`、`_md-sys-motion.scss`、`_md-sys-shape.scss`）与 W3C WCAG 2.2 官方 Understanding 文档，均为一手来源。**未能取到 m3.material.io 上「elevated 0-5 级配方」与「state layer 各组件精确 opacity」的官方数值表** —— §2 #7 的 elevation 补档建议基于 material-web 的 3 档简化值外推，非官方 0-5 全表。
5. **触控目标是代码推算**，用 `w-[Nvw]`/`h-[Nvw]` 类值按 375 设计稿换算成 px，**未在真机上测量实际渲染尺寸**（不同屏宽下 vw 换算结果不同）。
6. **未验证 Lynx 对以下特性的支持度**：`:hover`、`:focus-visible`、多层 `box-shadow`、`animation`、`backdrop-filter`。这些直接决定 §2 #4 / #7 / #13 的修法可行性。
7. **未审计**：`packages/android-host` 宿主侧的系统栏/状态栏配色是否与客户端 surface 层级衔接（`docs/research/lynx-systembars-t4-acceptance.md` 有相关结论但未在本次交叉核对）。
8. **旧 Fluent 兼容别名的实际存量引用数**未统计（只确认了配置层存在），故 §2 #9 的「风险高收益低」判断基于配置面观察，非全量引用分析。

---

## 8. 复核修正记录（父会话二次核验）

本报告初稿由调研 agent 产出，父会话对**结论性判据**逐条回验，发现 1 处事实错误与 1 处重大漏项，已在上文就地修正。此处留痕，供后续读者判断可信度。

### 8.1 已修正：M3 `standard` 缓动的取值判错（事实错误）

| 项 | 内容 |
|---|---|
| 初稿判词 | 「`tokens.css:163` 的 `--motion-standard` 用了 `(0.2,0,0,1)`，与 emphasized 重复；官方 standard 应为 `(0.4,0,0.2,1)`」，并列为路线图第一批第 1 项 |
| 复核证据 | 直接拉取官方 v0.192 生成令牌文件 [`tokens/versions/v0_192/_md-sys-motion.scss`](https://github.com/material-components/material-web/blob/main/tokens/versions/v0_192/_md-sys-motion.scss)：`easing-standard: cubic-bezier(0.2, 0, 0, 1)`、`easing-emphasized: cubic-bezier(0.2, 0, 0, 1)`（**同值是官方事实**）；`cubic-bezier(0.4, 0, 0.2, 1)` 对应的是 **`easing-legacy`（MD2 遗留）** |
| 结论 | **项目取值正确，初稿判词错误。**「standard 与 emphasized 同值」不是缺陷，MD3 就是这么定义的；`(0.4,0,0.2,1)` 才是应当避免的 MD2 值。初稿引用的来源文件本身即证伪了初稿结论 —— 典型的「引了权威来源但没核对来源内容」 |
| 处置 | 删除路线图错误项；§3.4 与 §2 #13 改写为「四条曲线逐条一致 ✅」；**保留并强化了真问题** —— Tailwind `transition-*` 的默认 timing function 恰是 `(0.4,0,0.2,1)`（来自 lynx preset，构建产物实测），这才是全站默认缓动的实际来源 |

### 8.2 已补：shape scale 只验了「令牌表」、没验「消费路径」（重大漏项）

初稿 §3.3 判形状为「✅ 合规」，依据是 `tokens.css:127-132` 的 6 档数值正确。**但这只验了令牌表，没验类名怎么消费它。** 复核发现：

- `tailwind.config.ts` **无 `borderRadius` 键**，`@lynx-js/tailwind-preset` 顶层与 `extend` 亦无（实测 preset 导出仅 `boxShadow`/`zIndex`/`grid*`/`aspectRatio`/`perspective`/`transitionProperty` + `extend{transitionDuration,transitionTimingFunction,grayscale}`）⇒ `rounded-*` 落到 **Tailwind 3 默认 rem 值**：`rounded-md`=0.375rem(6px)、`rounded-3xl`=1.5rem(24px) **均不在 M3 scale 上**，28px `extra-large` 无法用类名表达。
- 但**存量代码基本没踩这个坑**：`rounded-lg/md/xl/2xl/3xl` 实测 **0 处**；274/327 处是 `rounded-[var(--md-shape-*)]`（正确走 token）。残留 14 处方向类 `rounded-t`/`rounded-tr` 静默取 `0.25rem`（数值恰等于 M3 extra-small，但**不受 token 保护**），2 处 `TextSelectionToolbar.vue:63,66` 硬编码 `rounded-[0.65vw]`(≈2.4px) 低于 M3 最小档。
- 由此新增 §2 #19（🟡 中）与路线图第一批第 3 项。**严重度定为「中」而非「高」**：这是「正确性靠巧合 + 缺护栏」的脆弱点，不是当前正在产生错误视觉的缺陷。

### 8.3 复核过程中被自己推翻的两个假设（留档，防止重复踩）

1. **「327 处 `rounded-*` 全部生成 rem，是阻断级问题」——错。** 起因是第一次用 `grep -o "rounded-[a-z0-9\[\].-]*"`（macOS BRE，字符类里的 `\[`/`\]` 行为不可预期）统计，结果只回 1 条 `rounded-tr-`，与实读文件矛盾。改用 ripgrep 重数才发现绝大多数是 `rounded-[var(--md-shape-*)]`。**教训**：计数与实读冲突时，先怀疑工具的匹配语义，再怀疑数据。
2. **「`TextSelectionToolbar.vue:63` 的 `w-[2.8vw] h-[3.2vw]`（≈10×12px）远低于 WCAG 24px 触控下限」——错。** 读上下文后发现那是**手绘「复制」图标的内部描边**（`<view class="relative w-[4.9vw] h-[4.9vw]">` 内两个绝对定位边框），`@tap` 挂在父级 flex 列容器上，**不是触控目标**。**教训**：小尺寸 ≠ 触控目标，判触控合规必须回到事件绑定节点，不能只看尺寸。

### 8.4 已修正：state layer 官方 opacity 口径

初稿写「hover 8% / focus 10% / pressed 10%（按钮）/ 12%（列表）/ drag 16%」（取自 m3.material.io 页面表述）。复核改用官方生成令牌 [`_md-sys-state.scss`](https://github.com/material-components/material-web/blob/main/tokens/versions/v0_192/_md-sys-state.scss)：`hover 0.08 / focus 0.12 / pressed 0.12 / dragged 0.16`，**focus 是 12% 不是 10%**。§2 #3 与 §3.5 已按令牌文件更新（结论不变：hover/focus/dragged 三层 token 确实缺失）。

### 8.5 已修正：两处计数错误（术语文档撰写阶段回查发现）

术语文档撰写时对照代码重数，撞出初稿两个计数错误。**两处都已回改，且都不改变结论方向，但一处改变了工作量估计**：

| 项 | 初稿 | 实测 | 影响 |
|---|---|---|---|
| 自选行高 `leading-*` | 「仅 10 处」 | **27 处**（`leading-snug`×16 + `leading-[…]`×10 + `leading-relaxed`×1）；另有 `leading-none` 45 处属刻意收紧排版 | **工作量被低估 2.7 倍**。初稿只匹配了 `leading-[...]` 形态，漏掉全部具名档位。已回改 §2 #1 与 [ADR-0206](../adr/ADR-0206-typography-type-scale.md) 决策 3 |
| 旧 Fluent `--color*` 别名 | 「23 条」 | **22 条** | 无实质影响（同一处清点），已回改 §2 #9 |

**教训**：正则只匹配了**一种形态**（`leading-[…]`）就下了「全仓仅 N 处」的全称结论，
而具名档位（`leading-snug`）是完全不同的书写形态。**全称断言的抽取器必须覆盖所有形态**，
否则数字偏小会**低估**工作量、让排期失真。

### 8.6 坐标漂移（术语文档撰写阶段回查发现，不影响结论）

术语文档回查时发现初稿若干行号有偏移：`ActionButton.vue` 圆角 `:26`（初稿 `:29`）、
`active:bg-white/10` `:28`（初稿 `:31`）；`GlobalFab.vue` 硬编码 `:154,160`（初稿 `:147,152,160`）；
`darkMode.ts` 三态 `:19-23`（初稿 `:23-27`）；`NavigationBar.vue` a11y `:29-30`（初稿 `:27`）。
偏移量均在 3 行内，**结论与修法不变**；术语文档采用实测行号。

另：`--md-surface-tint` 初稿称「`.vue` 中 0 引用」——实测 `.vue`/`.ts` 确为 0，
但全仓在生成脚本中有 1 处引用（非矛盾，是扫描根口径不同）。

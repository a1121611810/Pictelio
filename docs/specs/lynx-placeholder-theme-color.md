# 输入框 placeholder 主题化（暗色对比度修复）—— 功能规格

> 来源：issue [#693](https://github.com/a1121611810/Pictelio/issues/693)（原「方案 A/B 二选一」在 2026-10-15 改判为方案 A）；
> 平台事实依据 [#537](https://github.com/a1121611810/Pictelio/issues/537) 关闭评论的模拟器像素实证 + 本轮 spike 复验（§7）；
> 关联 [ADR-0180](../adr/ADR-0180-lynx-dark-mode.md)（本票解除其「代价 / 风险」段的一条明示接受）；
> 像素验收归属 [#1014](https://github.com/a1121611810/Pictelio/issues/1014)（真机走查 gate）。
> 状态：**Grill 已收敛（2026-10-15，两轮）→ 本文件为 implement 阶段 spec oracle**。

## 1. Problem Statement

### 1.1 缺陷本体

9 处 `<input>` 的 `placeholder-color` 绑静态常量 `INPUT_PLACEHOLDER_COLOR = '#41474e'`（`src/utils/lynxPlatformColors.ts:15`）。
该常量是**亮色基线**。根因是 Lynx 平台属性不解析 `var()`（FIX-5 实测，见 #537），取不到 `--md-on-surface-variant`，只能承载字面量。

这些输入框的背景是 `bg-surface-container-highest`。暗色下实测：

| 组合 | 对比度 | WCAG AA |
|---|---|---|
| `#41474e` on `.theme-*.light --md-surface-container-highest` | 7.20 ~ 7.32 | ✅ |
| `#41474e` on `.theme-*.dark --md-surface-container-highest` | **1.31 ~ 1.32** | ❌ |

⚠️ **票面历史数字已订正**：#693 正文写「≈1.7:1」，早期口头估算写「1.97:1」，**实测 1.31:1**（1.31 而非 1.97 的原因：底色是 `--md-surface-container-highest`（sky 暗色 `#323539`），不是 `--md-surface`（`#101418`））。

### 1.2 原决策前提被证否

#693 票面的**方案 B 是条件句**：

> **方案 B（接受）**：**若平台属性动态绑定不可行**，则验证后把「暗色 placeholder 对比度受限」写入 ADR-0180 后果段并接受。

2026-10-12 的 triage 决策把「动态绑定是否生效」记为**未验证的未知**，据此采纳 B。该前提**已被本仓既有实证证否**：

- #537 关闭评论第 4 条：模拟器实机像素采样，placeholder 主色 = `(65, 71, 78)`，与 `#41474e` 平方距离 0 ⇒ 「**动态绑定在原生 LynxView 属性通道端到端生效**」。
- 本轮 spike（§7）复验：绑定到 computed 后值翻转，**无 remount 即时反映到原生输入框**。

⇒ B 的唯一触发条件不成立。本 spec 按**方案 A**（实施修复）执行。

## 2. Solution

把「一个绑所有主题的静态常量」换成「按 (主题色 × 明暗) 取值的表」，由一个 composable 提供读点，9 处消费点统一改绑。

**取色口径**：`.theme-*.dark --md-on-surface-variant`。理由：placeholder 在 M3 语义上就是 on-surface 的弱化态，M3 无更贴切角色；新增令牌会把改动面从「一个 ts 文件」扩到「生成脚本 + seed 表 + drift 测试」，与收益不匹配。

## 3. 票分

| 票 | 内容 | 阻塞关系 |
|---|---|---|
| **T1** | 取值表 + 防漂移测试（表 ≡ `tokens.css`） | 无 |
| **T2** | `useInputPlaceholderColor()` composable + 单测 | 依赖 T1 |
| **T3** | 9 处消费点改绑 | 依赖 T2 |
| **T4** | 文档收口（ADR-0180 / 走查矩阵 / 白名单 reason） | 依赖 T3 |

## 4. 实施规格

### 4.1 数据流（声明—读点对照）

```
持久化 settings_theme_color ─┐
                             ├─→ settingsStore.themeColor ─┐
持久化 settings_dark_mode ───┴─→ settingsStore.resolvedDark ┴─→ useInputPlaceholderColor()
                                                                            │
                                                          .theme-{id}.dark ──┘
                                                                            ↓
                                                              INPUT_PLACEHOLDER_COLOR[theme]
                                                                   ↓
                                                    9 处 :placeholder-color 模板绑定
```

| 声明 | 读点证据 | 判定 |
|---|---|---|
| 暗色 placeholder 跟随 `resolvedDark` | `settingsStore.ts:397-402` computed（`light`/`dark` 直接 return 字面量，`system` 读 `currentDarkMode`），`:1552` 导出 | 已接线 |
| placeholder 跟随主题色 | `settingsStore.ts:388` `const themeColor = _themeColor`，写入点 `:981`，加载点 `:489` | 已接线 |
| ⚠️ **禁止读 `currentDarkMode`** | `settingsStore.ts:989` 注释明写手动切换「不动 `currentDarkMode`（哑桥 ref）」→ 手动模式下 stale | 读 `resolvedDark` |

### 4.2 状态变化

| 事件 | 链路 | 有无滞后 |
|---|---|---|
| 用户在设置页切明暗（手动三态） | `_darkMode` → `resolvedDark` computed **当拍重算**（手动分支直接 return 字面量） | 无 |
| 系统跟随翻转 | `LynxActivity.onConfigurationChanged`/`onResume` → `sendDarkModeEvent()` → `pictelioDarkMode` 事件 → `darkMode.ts:127` 监听 → `setMode` 写 `currentDarkMode` → `resolvedDark` 的 `system` 分支 | 无 |
| 切换主题色 | `_themeColor` → `themeColor` → composable computed | 无 |

⚠️ 走查矩阵 `lynx-night-mode-walkthrough.md` 的 T3-4「一次性滞后窗口」滞后的是 **Android 端 splash 持久化主题**，与 JS 侧 placeholder 颜色**无关**。本票不依赖该项。

> **（2026-10-15 订正）** 制定本节初稿时曾把该滞后归因到「手动切换不改 `currentDarkMode`」，那是**误读**——`currentDarkMode` 只在 `system` 分支被 `resolvedDark` 读取，手动分支直接 return 字面量（`settingsStore.ts:397-402`）。滞后在 native 侧 splash 主题持久化，与 JS 读点无关。结论不变（无滞后），但归因必须改正。

### 4.3 取值口径与实测数据

暗色逐主题（7 值，全部达标）：

| 主题 | 值 | 底 `--md-surface-container-highest` | 对比度 |
|---|---|---|---|
| sky | `#c2c7cf` | `#323539` | 7.26 |
| violet | `#cac4cf` | `#36343a` | 7.20 |
| pink | `#d5c2c6` | `#3c3235` | 7.27 |
| green | `#c2c8bd` | `#323630` | 7.20 |
| orange | `#d5c3b5` | `#3c332c` | 7.23 |
| teal | `#bec8c9` | `#303636` | 7.20 |
| bili | `#d6c2c5` | `#3c3234` | 7.29 |

**亮色侧维持单值 `#41474e`（不逐主题）** —— 这是 Grill 结论在实测后的**收窄**，理由必须留档：

`--md-on-surface-variant` 是 M3 对 **`surface`** 定义的，不是对 `surface-container-highest`。逐主题化会让 **bili 亮色**取到 `#61666d`，在 `#d6d9dc` 上仅 **4.08:1**，**低于 AA 4.5**，比现状（`#41474e`，7.32:1）更差。

⇒ 亮色侧「7 套主题的 placeholder 与其 `on-surface-variant` 不符」是一个**已存在的令牌保真问题**，但它**不是** #693 的缺陷，修它需要引入 placeholder 专属令牌（Q1(b) 路线）。本票**只做暗色**，亮色保真问题作为显式排除项登记（§5）。

### 4.4 消费点清单（15 处）

**坐标口径（2026-10 统一）**：一律取该处 `:placeholder` **绑定行** —— 与下方备注「枚举基准 = 全库带 `placeholder` 的 `<input>`」同口径。此前各行锚点取法不一（指向 label 元素、字段块首行、甚至 `return` 语句），随被引用文件改动即失真，且 WebDAV 六个坐标实际落在字段 1/2/3/5/5/6（`webdavDir` 无锚点、`webdavBackupPassword` 重复）⇒ 已按语义锚点整体重取。

| # | 位置（`:placeholder` 绑定行） | 所属 | placeholder 可见性 |
|---|---|---|---|
| 1 | `SearchSheet.vue:513` | 搜索面板 | **空字段直接可见**（无条件下发） |
| 2 | `BookmarkPanel.vue:299` | 收藏面板 | **空字段直接可见**（无条件下发） |
| 3 | `Me.vue:1101` | 下载 · 命名模板 | **空字段直接可见**（无条件下发；该字段按 ADR-0209 决策 6 **不设浮动 label**，字段名由区块上方常驻标题承担） |
| 4-9 | `Me.vue` 1329 / 1357 / 1383 / 1406 / 1428 / 1562 | WebDAV 六字段（url / 用户名 / 密码 / 目录 / 备份密码 / 恢复输入密码） | 浮层 label 覆盖，**聚焦时**才下发 placeholder（`isPlaceholderShown` ≡ `fieldFocus[id] === true`，静止态下发空串） |
| 10-15 | `SettingsEndpoint.vue` 420 / 475 / 490 / 563 / 599 / 632 | LLM 翻译设置**六处绑定**（五个逻辑字段，apiKey 有 password/masked 两个 type 变体） | **静止态下发空串**（`isFloated` ≡ `isFocused ‖ value.length > 0`，静止且为空时为 false）⇒ 原生 placeholder 不出现、由居中 label 占位；**聚焦或有值后**才下发 |

⚠️ **第 10–15 处是首版遗漏的**（2026-10-15 真机走查发现）：首版清单按「谁 import 了
`INPUT_PLACEHOLDER_COLOR`」倒推，而这 6 处**从未绑定过**该属性（只挂了 `placeholder-class="text-outline"`，
实测该 class 在 Lynx 上不生效），于是走平台默认灰。真机实测暗色 **1.06:1**，比 1.31:1 更差。
⇒ 清单枚举基准已从**引用口径**改为**行为口径**（全库带 `placeholder` 的 `<input>`），
并写进 `lynxPlatformColors.test.ts` 的防线（见 §4.6）。

**15 处一律改绑**，不做可见性筛选 —— 改动形状完全相同，筛掉 6 处只会留下一致性债。但可见性差异**必须登记**（上表），因为它决定了像素验收取样时机。

⚠️ 接线注意：`SearchSheet` 已引 `useSettingsStore`（`:30`/`:56`）；**`BookmarkPanel` 未引**（只引 `authStore` / `modalStack`，`:24-25`），需新增。

### 4.5 边界条件

| 条件 | 要求 |
|---|---|
| 持久化值非法（`settings_theme_color` / `settings_dark_mode` 写入非法值） | 走既有校验（`themeColor.ts` 的 `isThemeColorId` + `console.warn`，`settingsStore.loadSettings`）；composable **不得**新增静默降级路径 |
| 主题 id 不在表内 | TypeScript `Record<ThemeColorId, string>` 编译期穷尽；运行时非法值已被 store 拦在门外，**composable 不做兜底分支** |
| `KeepAlive` 缓存的页面（`me` 在 `App.vue:271` 的 include 列表） | computed 订阅 store，切主题时已挂载实例同样更新（composable 在 setup 内订阅） |
| 备份恢复 | `settings_theme_color` / `settings_dark_mode` 均在设备级备份域（`settingsStore.ts:141`），恢复后走同一条 `loadSettings` 链路 |
| 冷启动时系统已是暗色 | `resolvedDark` 在 setup 内即正确求值，首帧不闪亮色 |

### 4.6 机器防线

| 层 | 断言 | oracle 指向 |
|---|---|---|
| **新** · 表 ≡ `tokens.css` | `INPUT_PLACEHOLDER_DARK_COLOR` 逐主题 ≡ `.theme-*.dark --md-on-surface-variant` | **生成产物 `tokens.css`**，非实现反推 |
| **改** · `BookmarkPanel.template.test.ts:202-212` | 模板绑 `@placeholder-color="placeholderColor"`；模板不含 `placeholder-color="#`；常量表逐项一致 | 同上 |
| **已有（不动）** · `hardcodeColorGate.test.ts:177` | `utils/lynxPlatformColors.ts` 文件级豁免，新增 hex 不进 offenders | — |
| **已有（不动）** · `palettes-drift.test.ts` | `tokens.css` 自动生成段 ≡ 脚本 `--stdout` | — |
| **像素（不在 CI）** · #1014 走查矩阵 | 暗色 placeholder 对比度 ≥ 4.5:1，截图留档 | 设备像素 |

新增防线的链路闭环：`generate-theme-palettes.mjs` →（已有 drift 测试）→ `tokens.css` →（**新测试**）→ 常量表。

**为何必须新增**：现状全仓**没有**任何断言「JS 侧 hex 常量 ≡ `tokens.css` 令牌值」的交叉测试。`placeholder-color` 吃不到 `var()` ⇒ 值只能手抄 ⇒ 不加这环就是静默漂移（`palettes-drift` 只锁脚本↔tokens，`mdTokenRefs` 只管 `var()` 引用）。

### 4.7 文档收口清单

| 文件 | 动作 |
|---|---|
| `docs/adr/ADR-0180-lynx-dark-mode.md:54` | 「代价 / 风险」段该条由**明示接受**改为**已解除** |
| 同上 · 实施记录表 | **追加**一行（历史行逐字保留） |
| `docs/specs/lynx-night-mode-walkthrough.md:128` | 由「接受项 / 不判 ❌」改为**判据**：暗色 placeholder 对比度 ≥ 4.5:1 |
| `packages/app-lynx/tests/hardcode-whitelist-colors.json:8` | reason 重写：**删掉「关闭 #693 时同步删本豁免」**（采纳 A 后该承诺作废——常量保留即豁免保留） |
| `docs/specs/lynx-night-mode-audit.md` | 同一行补「本豁免随常量保留」（顺带发现该段「6 条」计数陈旧，实际 8 条，**非本票引入，单独立票**） |

## 5. Out of Scope

- **亮色侧令牌保真**（7 套主题的 placeholder 与其 `on-surface-variant` 不符）—— 修它需新增 placeholder 专属令牌，且 bili 需 clamp，是独立决策（§4.3）—— **已由 [#1015](https://github.com/a1121611810/Pictelio/issues/1015) 承接并实施（2026-10-16）**：亮色取值表逐主题化 + bili clamp `#5a5f66`（spec [`lynx-placeholder-light-token-fidelity.md`](./lynx-placeholder-light-token-fidelity.md)）
- **`Login.vue` / `CommentInputBar.vue`** —— 早已改用 label 承载静止态文案、`placeholder-color` 平台属性一并撤下，天然脱敏
- **新增 android-e2e spec** —— `ADR-0084` 定 e2e 不进 CI；像素验收由 #1014 走查矩阵承载（已是该链路的既有载体，再开 spec 属重复载体而非补覆盖）
- **历史订正的独立记账** —— #693 正文的「≈1.7:1」在 T4 文档收口时一并订正为实测 1.31:1 + 口径说明

## 6. 门禁已知失效面

| 门禁 | 抓不到什么 |
|---|---|
| 表 ≡ `tokens.css`（新） | 只验**字面量一致**；不验「这个角色是语义上正确的选择」—— 口径选错它照样绿 |
| 表 ≡ `tokens.css`（新） | 扫 `.theme-*.dark` 段；若将来 tokens.css 改为运行时注入的 `styles/` 段，抽取器会扫空集 ⇒ 须断言命中数下界（ArchUnit `failOnEmptyShould` 教训） |
| `hardcodeColorGate`（已有） | 文件级豁免 ⇒ `lynxPlatformColors.ts` 内**任何** hex 都不进 offenders，包括手滑写错的颜色 |
| 像素验收（#1014） | 人工走查，非 CI；漏跑 = 无人发现（这正是 `release-checklist.md:233` 把 gate 挂在发版清单上的原因） |

### 平台升级风险（非门禁失效面，但同属「构建绿 ≠ 正确」类）

`placeholder-color` **已不在 Lynx 当前官方文档的 input 属性表里** —— 它是 elements 插件随客户端分发的**遗留属性**，本仓 runtime（LynxView 4.0.1）实测仍接受（#537 结论）。

升级 LynxView / elements 后该属性**可能无声移除**，表现是 placeholder 回落平台默认灰：**无类型报错、无文档预警、构建与单测全绿**。本仓所有防线（`lynxPlatformColors.test.ts` 的两张表、`useInputPlaceholderColor` 的 12 条用例、模板守卫）**全部拦不住**——它们验的是「值算得对不对」，不是「属性还在不在」。

⇒ **唯一防线是走查矩阵 T4-6**（像素对比度判据）。升级 SDK 时必须复跑，不能只看 CI 绿。

## 7. 探针记录（可复现）

**问题**：`placeholder-color` 绑到 computed 后，值翻转是否**不 remount 即刷新**？

**方法**：在 `Me.vue` 的「用户名」输入框打一次性 spike —— 同一个 `ref` 每 3s 翻转，**同时驱动颜色**（`#41474e` ↔ `#ff2fd6`）**与 placeholder 文字**（`甲甲甲` ↔ `乙乙乙`）。文字是**对照组**：没有它，「颜色不变」无法区分「平台不更新」与「探针没跑」。

**环境**：`pictelio_ui` AVD / API 34（`emulator-5554`）· `app-debug.apk` · dev hook 登录 · 聚焦 + 空字段（浮层 label 移开，placeholder 露出）· `adb exec-out screencap -p` 逐秒采样，`pixel.ts` 同款像素取色。

**结果**（8 帧连续，两色干净交替）：

| 相位 | 笔画峰值像素 |
|---|---|
| 翻转关 | `#41474e` |
| 翻转开 | `#ff2fd6`（逐通道精确） |

**结论**：平台属性 `placeholder-color` **接受动态绑定且响应更新，无需 remount**。⇒ 方案 A 可行。

**方法学教训（本轮实际踩到，三次）**：
1. **量错元素** —— 首轮量的是浮层 label（`fieldLabelWrapClass`）而非 placeholder，得出「18 帧零洋红」的假否定结论。Me.vue 的 WebDAV 字段空态时 label 居中盖住 placeholder，必须**聚焦 + 空**才露出来。
2. **bundle 缓存** —— 重装 APK 不生效，Lynx 本地缓存旧 bundle，须 `pm clear`。且校验命令 `grep -o "甲甲甲" x | head -1 && echo ok` **恒为真**（管道退出码来自 `head`）——假绿。
3. **采样窗底色写错** —— 过滤用的背景值是亮色的，应用已落暗色 ⇒ 整窗被当作 ink，中位数等于底色。

⇒ 与本仓门禁纪律一致：**「无变化」型结论在没有对照组时不构成否定证据**。

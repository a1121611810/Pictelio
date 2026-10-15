# 输入框 placeholder 亮色令牌保真 —— 功能规格

> 来源：issue [#1015](https://github.com/a1121611810/Pictelio/issues/1015)（#693 spec §5 显式排除项转独立票，「另开票」承诺的兑现）；
> 前身：[`lynx-placeholder-theme-color.md`](./lynx-placeholder-theme-color.md) §4.3 / §5（亮色单值收窄理由的原始登记处）；
> 关联 [ADR-0180](../adr/ADR-0180-lynx-dark-mode.md)（本票在其「实施记录」表**追加**一行，历史行逐字保留）；
> 像素验收：**本票自立**（3 帧抽样，不挂 #1014 走查矩阵——边界见 §5）；
> 状态：**Grill 已收敛（2026-10-16，两轮）→ 本文件为 implement 阶段 spec oracle**。

## 1. Problem Statement

### 1.1 问题本体（令牌保真 ≠ 对比度）

亮色下 7 档主题的 placeholder 恒取单值 `#41474e`——那是 **sky** 主题亮色 `--md-on-surface-variant` 的值。其余 6 档的亮色令牌分别是 `#49454e` / `#514347` / `#424940` / `#50453a` / `#3f4949` / `#61666d`，全部未被使用。

- **这不是对比度缺陷**：现状 `#41474e` 落在 7 档亮底上 6.63–7.32，全达标。
- 这是**令牌保真问题**：代码承载的值与主题令牌不符。根因是「碰巧 sky 的值在全部亮底上都接近最优」的**巧合**，不是设计。
- **巧合会过期**：未来新增第 8 档主题时，亮色表 + 守值测试会被 tokens.css 抽取下界守卫**强制**提醒改表（守值测试红）；单值方案没有任何防线提醒，靠人肉记忆。

### 1.2 为何 #693 当年不修、现在修

#693 的 Grill 结论在实测后**主动收窄**为「亮色侧维持单值」（其 spec §4.3 留了完整理由），并把亮色保真登记为显式排除项。当时不修的理由至今成立的一部分：

- `--md-on-surface-variant` 是 M3 对 **`surface`** 定义的角色，输入框实际坐在 `surface-container-highest` 上——逐主题化拿到的是**主题令牌对齐**，不是「角色正确」（M3 无 placeholder 官方角色）。
- bili 亮色取令牌值 `#61666d` 在其亮底 `#d6d9dc` 上仅 **4.08:1**，低于 AA 4.5——**不能靠逐主题化解决**，需要 clamp 决策。

现在修的理由（#1015 的 Grill 决策）：语义对齐让值可审计（diff 显示值来自哪档令牌，不再是魔法数）；新增主题时的防线提醒（§1.1）；bili clamp 规则一句话可说完（§4.2）。

## 2. Solution

亮色侧逐主题化，机制与暗色侧完全对称：

1. 新增亮色取值表 `INPUT_PLACEHOLDER_LIGHT_COLOR: Record<ThemeColorId, string>`（7 项；6 档 = 该档亮色 `--md-on-surface-variant`，bili = clamp 值 §4.2）。
2. composable 亮色分支由「返回单值」改为「查亮色表」；**暗色侧零改动**。
3. 旧单值常量 `INPUT_PLACEHOLDER_COLOR` **删除**（其值以 sky 亮色表项的形式存活；属契约面变更，commit message 按测试硬约束 #4 标注）。
4. 机器防线：亮色单值守卫 2 处改造为亮色表守值（oracle = tokens.css 亮段抽取产物）+ bili clamp 值守值 + 抽取下界由 dark 段扩为 dark+light 两段。
5. 像素验收：抽样 3 帧（§4.6）。

**Grill 否决项登记**：placeholder 专属 **CSS 令牌**方案被否——`placeholder-color` 是平台属性、不解析 `var()`（#537 实证），Lynx 无 DOM 计算样式可读，CSS 令牌只是语义摆设；真值载体只能是 JS 字面量表 + 守值测试（与暗色侧现状一致）。

## 3. 票分

| 票 | 内容 | 阻塞关系 |
|---|---|---|
| **T0** | 防线改造（红→绿）：亮色表 + composable 亮色查表 | 无 |
| **T1** | 文档收口（ADR-0180 追加行、#693 spec §5 排除项转已解决） | 依赖 T0 |
| **T2** | 像素验收 3 帧 + 落档 + #1015 关闭 | 依赖 T0、T1 |

## 4. 实施规格

### 4.1 数据流

与 #693 spec §4.1 同一条链路，仅亮色分支末端变化：

```
settingsStore.themeColor ─┐
                          ├─→ useInputPlaceholderColor()
settingsStore.resolvedDark ┘        │
                    dark → INPUT_PLACEHOLDER_DARK_COLOR[theme]   （不动）
                    light → INPUT_PLACEHOLDER_LIGHT_COLOR[theme] （本票：单值 → 查表）
                                    ↓
                          15 处 :placeholder-color 模板绑定        （不动）
```

### 4.2 取值表与 clamp 规则（核心）

亮色表 7 项（对比度为实测实算，底 = 各档亮色 `--md-surface-container-highest`）：

| 主题 | 亮色表值 | 来源 | 现状对比度（#41474e） | 改后对比度 |
|---|---|---|---|---|
| sky | `#41474e` | 令牌值 | 7.32 | 7.32（不变） |
| violet | `#49454e` | 令牌值 | 7.25 | 7.22 |
| pink | `#514347` | 令牌值 | 7.30 | 7.27 |
| green | `#424940` | 令牌值 | 7.28 | 7.21 |
| orange | `#50453a` | 令牌值 | 7.27 | 7.21 |
| teal | `#3f4949` | 令牌值 | 7.28 | 7.20 |
| bili | **`#5a5f66`** | **clamp（见下）** | 6.63 | **4.54** |

**决策依据必须留档**：6 档改后对比度**持平或微降**（`on-surface-variant` 对 `surface` 定义，对 `surface-container-highest` 不保证对比度），但全部留在 AAA（≥7）；视觉差不可辨。本票的交付物是**语义对齐与可审计性**，不是对比度提升——审查时不得把「微降」当缺陷重提。

**bili clamp 规则**（一句话）：**「该档 on-surface-variant 向深色方向加深至对 surface-container-highest ≥ 4.5 的最小步」**。
对 bili：令牌值 `#61666d` = 4.08 ❌ → 沿 `#61666d → #41474e` 线段找 ≥4.5 的最近点 ⇒ **`#5a5f66` = 4.54**。
参考档：`#53585f` = 5.0、`#484d54` = 6.0（仅作升档候选，§4.4）。

该规则以 docstring 形式写在常量表旁（6 档本身是规则的平凡输出——7.2+ 已过线不触发加深，只有 bili 触发）。

### 4.3 消费点：零改动声明

15 处 `<input>` 模板绑定（清单见 #693 spec §4.4）**全部不动**。本票 diff 面 = 常量文件 + composable + 2 个测试文件 + 白名单 reason，零模板改动。

### 4.4 边界条件

| 条件 | 要求 |
|---|---|
| **真机 probe 实测 bili < 4.5**（理论 4.54，余量 0.04） | **升档 `#53585f`（5.0）重测**，不重开决策；若仍 <4.5 再升 `#484d54`（6.0）。落档时记明最终档与实测值 |
| 主题 id 不在表内 | 同 #693：TS `Record<ThemeColorId, string>` 编译期穷尽，composable **不做兜底分支** |
| 暗色侧 | 零改动：暗色表、暗色分支、暗色守值测试全部原样 |
| `resolvedDark` 三态语义 | 不动（#693 已守：`system` 三态 × 7 主题防线保留，仅亮色期望值换表） |
| 新增第 8 档主题时 | tokens.css 加主题 → 抽取下界守卫（命中数 ≥8）红 → 强制想起补两张表 |

### 4.5 机器防线

| 层 | 动作 | oracle 指向 |
|---|---|---|
| `lynxPlatformColors.test.ts` 守值组 | **改**：亮色单值断言（「亮色维持单值 `#41474e`」）→ 亮色表逐项 ≡ tokens.css 亮色段 `--md-on-surface-variant`（6 档）+ **bili clamp 值守值** `#5a5f66`（人工值守例外，注释指向 §4.2 规则）；抽取下界断言由 dark 段扩为 **dark+light 两段**（命中数各 ≥7） | **生成产物 tokens.css** |
| 同上 接线组 | **不动**（15 处绑定、零散写字面量、import 纪律全保留） | — |
| `useInputPlaceholderColor.test.ts` | **改**：「亮色下不应逐主题取色」用例 → 亮色 7 主题逐档取表值；system 组亮色断言同步换表 | 同上 |
| `hardcode-whitelist-colors.json` | **改**：reason 删除「亮色刻意不逐主题化…」旧理由，改写为 clamp 规则摘要 | — |

**新增防线必须自带变异推演**（#693 经验，测试硬约束 #6 配套）：

- 变异 1：亮色分支换回单值 `INPUT_PLACEHOLDER_COLOR` → 亮色逐档断言必红（守的是「亮色查表」）。
- 变异 2：bili clamp 值改回 `#61666d`（纯令牌值）→ clamp 值守必红（守的是「clamp 存在」）。
- 变异 3：抽取器扫空集（亮段选择器写错）→ 命中数下界必红（防 ArchUnit `failOnEmptyShould` 式恒真，#693 已有同构守卫）。

### 4.6 像素验收协议（T2，不在 CI）

- **抽样 3 帧**（#1015 Grill 决策，理由：值正确性已由守值测试锁死，本票像素增量 = 「亮色也查表」分支真机渲染 + bili 新值实测；全主题覆盖留给 #1014 T2 矩阵）：
  - **bili**（clamp 新值 `#5a5f66`，必验）；
  - **sky**（基线对照，应完全不变）；
  - **teal**（变化档代表，理论 7.20）。
- 采样纪律沿用 #693：WebDAV 六字段 placeholder 仅「**聚焦 + 空**」时露出（浮层 label 盖空态）；空字段直接可见的输入框（搜索/收藏/命名模板）可直接采。
- 仪器：`docs/research/placeholder-contrast-probe.py`（跑前必跑其自带自检，无窗口参数 = 只自检）；主题切换走设置页；**亮色态**（`adb shell cmd uimode night no`）。
- 环境坑沿用交接：重装 APK 后必须 `pm clear`；模拟器 `pictelio_ui` / `emulator-5554`。
- 落档：`docs/research/placeholder-light-token-acceptance.md`（帧路径 + 实测对比度 + 与理论值偏差）。

### 4.7 文档收口清单

| 文件 | 动作 |
|---|---|
| `docs/adr/ADR-0180-lynx-dark-mode.md` 实施记录表 | **追加**一行（#1015：亮色表 + clamp + 防线改造；历史行逐字保留） |
| `docs/specs/lynx-placeholder-theme-color.md` §5 | 排除项「亮色侧令牌保真」条目追加「→ 已由 #1015 承接（2026-10-16）」（原文保留） |
| `src/utils/lynxPlatformColors.ts` 文件头 + docstring | 随 T0 代码同步重写（「亮色不逐主题化」旧理由 → clamp 规则；平台升级风险注释**保留**） |
| 本文件 + tickets 文件 | 随 T0 commit `3e008dcd` 首次落库（spec 先行定稿、同 commit 提交） |

## 5. Out of Scope

- **暗色侧任何语义改动**——暗色表 / 暗色分支断言语义不变（守值测试的 describe 合并、变量重命名等结构性适配属 §4.5 授权范围，详见 tickets「review 修复轮」）
- **#1014 走查矩阵的执行**——T2 六主题×亮暗全矩阵归 #1014（发版 gate）；本票 3 帧自立闭环，两票互不阻塞。
- **placeholder 专属 CSS 令牌**——平台属性不解析 `var()`（#537），CSS 令牌无真值载体，Grill 已否决（§2）。
- **`Login.vue` / `CommentInputBar.vue`**——同 #693，早已撤下 placeholder，天然脱敏。
- **模板消费点**——15 处绑定不动（§4.3）。
- **既有不一致的顺手修复**——`BookmarkPanel.template.test.ts` 断言 `@placeholder-color=`（旧写法）与 gate 断言 `:`-前缀口径不一致，归因早于本票，**不在本票顺手改**（避免挂无关变更；同 #693 对 `lynx-night-mode-audit.md` 计数错误的处理）。

## 6. 门禁已知失效面

| 门禁 | 抓不到什么 |
|---|---|
| 亮色表 ≡ tokens.css 亮段（改） | 只验**字面量一致**；同 #693 §6——「这个角色是语义上正确的选择」它不管，口径选错照样绿 |
| bili clamp 值守值（新） | 锁的是**输出值**，不是**规则**——「向深至合规最小步」是人脑规则；将来 bili 底/令牌变了，值守值不会自动跟进（需人工按 §4.2 规则重算） |
| 抽取下界（改） | 只防「扫空集恒真」；抽错段（如抽到暗段当亮段）且两段值恰好相同才漏——7 档两段值无一相同，实际不可达 |
| `hardcodeColorGate` 文件级豁免（已有） | 同 #693 §6：文件内任何 hex 都不进 offenders，包括手滑写错的颜色 |
| 像素验收（T2，不在 CI） | 人工走查；3 帧抽样**不覆盖** violet/pink/green/orange 四档（全主题覆盖归 #1014 T2） |

平台升级风险（`placeholder-color` 遗留属性、升级 SDK 可能无声移除）**不因本票变化**——仍是 #693 spec §6 登记的走查矩阵 T4-6。

## 7. Grill 决策记录（2026-10-16，两轮）

**Round 1 — 修不修**：选项 (a) 修 6 档 + bili clamp / (b) wontfix 登记 / (c) 只修 6 档。用户选 **(a)**。关键呈报数据：逐主题化后 6 档对比度持平或微降（§4.2 表），任务本质是语义对齐而非对比度提升。

**Round 2 — 三问按推荐锁定**：
1. **bili clamp = `#5a5f66`（4.54）**，规则「向深至 ≥4.5 最小步」；边界条件：实测 <4.5 升档 `#53585f` 重测（§4.4）。
2. **像素验收 = 抽样 3 帧**（bili / sky / teal），全主题覆盖留给 #1014 T2。
3. **独立票关闭** = 机器防线全绿 + 3 帧 PASS 落档，不挂 #1014 矩阵。

否决记录：CSS 专属令牌（§2）；wontfix（Round 1 备选未选）；`#41474e` 作 bili clamp 值（破坏全表统一叙事，Round 2 备选未选）。

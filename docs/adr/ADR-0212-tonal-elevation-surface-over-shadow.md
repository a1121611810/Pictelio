# ADR-0212：层级表达以表面色调为主 —— 把 elevation 从「唯一手段」降为「辅助手段」

## 状态

accepted（2026-10-01）

## 背景

> ⛔ **本章（§一–§五）出现的全部消费计数是「整改前 / HEAD 基线」快照，不是现状，不得当现状引用。**
> 现状的唯一权威出处是「决策 3」实施后账目里那行 `measured:` 标记：
> `elevation-1` 现为 **3**（整改前 53）、level-2 **5** / level-3 **10** 不变，余额 **18**。

本 ADR **是 [ADR-0207](./ADR-0207-shape-and-state-layer-guardrails.md) 决策 7 的延续**，不重述该决策。
决策 7 已经拍板两件事，且都已落地：

- **令牌侧**：补齐 `--md-elevation-0/4/5`，`--md-elevation-0..5` 六档在 `tokens.css` 全部在位
- **口径侧**：规定「**层级表达以 surface-container 色调为主、box-shadow 为辅**」

本 ADR **只处理其中「口径」那半边的消费侧**。决策 7 留下的是一个**只写了一半**的决策：
令牌到位了，**消费侧零落地**。

### 一、整改前快照（2026-10-01 诊断时）：六档只用了三档，且全挤在低档

> ⛔ **本节全部数字是「整改前 / HEAD 基线」快照，不是现状，不得当现状引用。**
> 本 ADR 实施后 `elevation-1` 由 **53 → 3**（level-2 5 / level-3 10 不变，余额 18）。
> **现状的唯一权威出处是「决策 3」实施后账目里那行 `measured:` 标记**（本文件内该标记唯一）；
> 本节的 68 / 63 / 53 / 5 处按压反馈一律只作**处置前的账面留痕**。

口径：`packages/app-lynx/src` 下 `*.vue` 全文 grep `md-elevation-[0-5]`
（与 `glossary-md3-alignment.md` §6 同口径，剔除 `.test.` —— `*.vue` glob 天然不含 `.test.ts`）。

```
grep -rhoE 'md-elevation-[0-5]' --include='*.vue' . | sort | uniq -c | sort -rn
```

| 档位 | 消费处数 | 分布 |
|---|---|---|
| `--md-elevation-1` | **53** | 贴面元素 + 骨架屏 + 5 处按压反馈 |
| `--md-elevation-3` | 10 | **全部**是悬浮/高层元素 |
| `--md-elevation-2` | 5 | **全部**是悬浮元素（FAB 环 / 菜单项） |
| `--md-elevation-0` / `-4` / `-5` | **0 / 0 / 0** | 死档 |

**合计 68 处 token 消费，分布在 63 行、29 个 `.vue` 文件。**

> ⚠️ **「类声明行」口径歧义的消除（本 ADR 初稿此处曾误称「63 个**类**声明行」）**。
> 「行」与「处」是两个不同口径，初稿把二者混称，导致复核时出现 62 / 63 两个数。**定义与实测**：
>
> | 口径 | 定义 | 实测 |
> |---|---|---|
> | **消费处数** | `md-elevation-[0-5]` 的**出现次数**（一行写两档算 2 处） | **68** |
> | **类名消费处数** | 上一行减去不走 utility 的 CSS 声明 | **67**（扣掉 `GlassCard.vue` 的 scoped CSS 那 1 处） |
> | **类名声明行数** | 承载上述 67 处类名消费的行 | **62** |
> | **含令牌行数** | 62 行 + `GlassCard.vue` 的 scoped CSS 声明行 | **63** |
>
> 复算入口（三条可互证）：
> ```bash
> # 消费处数 = 68
> grep -rhoE 'md-elevation-[0-5]' --include='*.vue' packages/app-lynx/src | wc -l
> # 含令牌行数 = 63；每行消费数分布 = 58 行×1 + 5 行×2（= 68）
> grep -rnoE 'md-elevation-[0-5]' --include='*.vue' packages/app-lynx/src \
>   | awk -F: '{c[$1":"$2]++} END{for(k in c) print c[k], k}' | sort -rn | head
> # 非类名通道的唯一 1 处（它不在 class 属性里，故不计入 62 行）
> grep -rn 'md-elevation-1' --include='*.vue' packages/app-lynx/src | grep -v 'class='
> ```
> **「68 − 63 = 5」与「67 − 62 = 5」是同一件事**（5 行同时写了静止档与 `active:` 档，见决策 6）。
> 结论：**含令牌行数 63 / 类名声明行数 62，二者都对，差别在是否把那条 scoped CSS 算作「行」。**
> 本 ADR 后续统一用「消费处数」与「含令牌行数」两个词，不再使用「类声明行」这个含混说法。

> ✅ 本次实跑与初始口径给出的「68 处 / 29 文件 / L1=53、L2=5、L3=10、L0/4/5=0」**逐项一致**。

**关键判读**：level-2 与 level-3 的分配**没有问题** —— 5 处 `elevation-2` 全在 `RefreshableList.vue`
的菜单项与 `GlobalFab.vue` 的展开环/回顶环，10 处 `elevation-3` 全在 snackbar、底部弹层、
居中对话框、FAB、文本选择工具条、悬浮条。**问题 100% 集中在 level-1 的 53 处。**

### 二、level-1 的 53 处拆开：混着三种互不相容的语义

```
grep -rn 'md-elevation-' --include='*.vue' src   # 落盘后按「底色 role × 档位」聚合
```

| 类别 | 处数 | 元素 | 语义问题 |
|---|---|---|---|
| **按压反馈** | **5** | `RefreshableList.vue`（菜单项 ×3 + feed FAB）、`GlobalFab.vue`（主 FAB），全部写成 `active:shadow-[var(--md-elevation-1)]` | **不是高度表达**，是「用阴影表达状态」 |
| **骨架屏 placeholder** | **9 个声明点 / 56 个渲染实例** | `Watchlist.vue`(n in 5)、`FollowList.vue`(n in 8)、`Notifications.vue`(n in 6)、`NovelList.vue`(n in 5)、`UserHome.vue`(n in 5)、`Bookmarks.vue`(n in 5)、`MyPixiv.vue`(n in 8)、**`Ranking.vue`(n in 8)**、**`TagNeighbors.vue`(n in 6)** | 加载中的**假数据卡浮着真阴影** |
| **贴面元素** | **37** | 瀑布流 `list-item` 卡（`IllustList.vue` / `Following.vue` / `UserHome.vue` / `Bookmarks.vue`，类名 `bg-surface-container-lowest … flex flex-col overflow-hidden`）、`Me.vue` 的 11 个设置卡、各页列表行（`UserRow.vue` / `NovelList.vue` / `TagNeighbors.vue` …） | 底色已是 `surface-container-lowest`（**贴面档**），MD3 下**应当零阴影** |
| **覆盖层** | **2** | `RestrictedNovelCard.vue` / `AiRestrictedNovelCard.vue` 的限制内容遮罩卡（`bg-[var(--md-scrim)]`，`--md-scrim` = `rgba(0,0,0,0.5)`） | 50% 黑遮罩**本身已提供分离**，阴影是冗余 |
| **小徽标** | **1** | `Recommended.vue` 的 `text-error` 错误 chip（`bg-surface-container-high`） | 已用 `surface-container-high` 做了色调抬升，阴影重复表达 |
| **非 utility 通道** | **1** | `GlassCard.vue` 的 scoped CSS `box-shadow: var(--md-elevation-1)` | 见下方「取证盲区」 |

> **与初始口径的差异（如实登记）**：初始口径称骨架屏「~30 处」、真实贴面「~20 处」。实跑为
> **9 个声明点 / 56 个渲染实例** 与 **37 处**。差异来源有二：① 初始口径按**渲染实例**约数，
> 实跑两者都取**声明点**（可 grep 复算的口径）；② 初始口径把 15 个 `v-for="n in N"` 块中的
> 4 处误当作骨架屏 —— 那 4 处 `bg-surface-container-lowest … flex flex-col overflow-hidden`
> **是真实的瀑布流 `list-item` 插画卡**，不是占位块。
> 真正的站前例在反方向：**`SkeletonCard.vue` 组件本身完全没有 `box-shadow`**
> （其 4 处 `SkeletonCard v-for` 引用点因此天然干净）。**组件化是对的，抄组件的模板写法漏了阴影** ——
> 这正是本 ADR 决策 7 要收的口。

### 三、三条结构性根因

1. **贴面元素被当成了悬浮元素**。`bg-surface-container-lowest` 全仓 87 处消费，是本项目的**贴面主力底色**；
   MD3 里 `surface-container-*` 五档本身就是「用明度分档表达层级」的手段，贴面容器再叠阴影
   = **同一个层级信号被表达两遍**，且第二遍用的是 MD2 的语言。
2. **「阴影 = 高度」与「阴影 = 状态」两种语义混用**（决策 6 收口）。`active:shadow-elevation-1`
   是把 elevation 档位当交互反馈通道用，一旦成立，任何人都会合法地继续这么写。
3. **令牌可用 ≠ 口径可执行**。`--md-elevation-0` 定义为 `none` 却 0 处消费 ——
   「零阴影」在项目里**不是一个可表达的选项**，而它恰恰是 MD3 贴面元素的正确形态。

### 四、色阶中间断了一档（决策 1 之外的附带发现）

```
grep -rhoE 'bg-surface-container(-lowest|-low|-high|-highest)?\b' --include='*.vue' src | sort | uniq -c
```

| 档位 | 消费处数 |
|---|---|
| `bg-surface-container-lowest` | 87 |
| **`bg-surface-container-low`** | **0** |
| `bg-surface-container`（base） | 5 |
| `bg-surface-container-high` | 43 |
| `bg-surface-container-highest` | 28 |

`surface-container-low` 在 `tokens.css` 的 **14 套色板全部有定义**，`tailwind.config.ts` 也已注册
`'container-low'` 键（其唯一间接引用是兼容别名 `--colorNeutralBackground2`，而该别名在 `src` 下
**同样 0 处消费**）⇒ **实为死令牌**。按 ADR-0207 复核判据第 5 条自己立下的原则
（「否则该 token 是死代码，应删而非留着」），这个缺口必须登记，不能装作色阶是完整的。

### 五、取证盲区：门禁只扫类名会漏掉一条通道

68 处里有 **1 处不走 Tailwind utility**：`GlassCard.vue` 在 scoped CSS 里直接写
`box-shadow: var(--md-elevation-1)`。任何「扫 `shadow-[var(--md-elevation-*)]` 类名」的门禁
**对它完全隐形**。登记在此，供后续门禁设计时把扫描面从「类名」扩到「CSS 声明」（见复核判据 3）。

## 决策

### 决策 1：层级表达优先级 —— 表面色调为主，box-shadow 为辅（并给出可执行的档位映射）

承接 ADR-0207 决策 7 的口径不变，本决策把它落成**一张可查的映射表**。
判据只有一条：**这个元素是「贴在页面上」还是「浮在页面上」？** 贴面 → 色调；悬浮 → 色调 + 阴影。

| UI 类别 | 表面色调档 | 允许阴影档 | 站内锚点（现状） |
|---|---|---|---|
| 页面底层 | `surface` | 0 | 205 处 `bg-surface` |
| 顶部导航条 | `surface-container` | 0 | `NavigationBar.vue` 根 `view`（`bg-surface-container`，无阴影）**已是正例** |
| **贴面列表项 / 卡片（静止）** | `surface-container-lowest` | **0** | 44 处现存 level-1（37 真实 + 7 骨架屏）待降档 |
| **骨架屏 placeholder** | `surface-container-lowest` | **0** | 9 个声明点已降档（票 #882 落地） |
| 悬浮卡片（抬起 / 选中态） | `surface-container-high` | 2 | 当前无独立消费点 |
| 菜单（refresh 菜单项） | `surface-container-high` | 2 | `RefreshableList.vue` 菜单项**已符合** |
| 底部弹层（bottom sheet） | `surface-container-high` | 3 | `Watchlist.vue` / `Me.vue` / `WatchlistPromptDialog.vue` / `DownloadManager.vue` **已符合** |
| 居中对话框 | `surface-container-high` | 3 | `WatchlistPromptDialog.vue` **已符合** |
| FAB（主按钮 / 环层） | `primary-container` | 3 / 2 | `GlobalFab.vue` / `RefreshableList.vue` **已符合** |
| snackbar | `inverse-surface` | 3 | `App.vue` **已符合** |
| 悬浮条 | `surface-container-high` | 3 | `App.vue` **已符合** |
| 文本选择工具条 | `surface-container-high` | 3 | `TextSelectionToolbar.vue` **已符合** |
| 小徽标 / chip | `surface-container-high` | **0** | `Recommended.vue` 错误 chip 待降档 |
| 内容限制遮罩 | `scrim` | **0** | `RestrictedNovelCard.vue` / `AiRestrictedNovelCard.vue` 待降档 |

**表读法**：前 9 行中带 ✅ 的是**现状已正确**的档位，本 ADR 不动它们 —— 本决策的价值是
**把「对」的部分钉成规则、把「错」的部分圈出来**，而不是重排全站。

**⚠️ 骨架屏为何不升到 `surface-container-low`**（填坑与不填坑的取舍）：
`surface-container-low` 是死令牌（背景 §四），看起来该拿它补上断档。**但骨架屏的正确形态是
与它将要替换的真实卡片同色调** —— 若骨架用 `low` 而真实卡用 `lowest`，数据落定时会出现一次
**额外的色调跳变**，那是往「粗糙」上再加一刀。因此本决策**明确不这么用**，
色阶断档的处置见决策 5。

### 决策 2：阴影预算 —— 零阴影是一档，贴面元素默认取它

「允许阴影档」列即**上限**，不是目标值。规则：

1. **贴面元素（贴面列表项、贴面卡片、骨架屏、徽标、遮罩）上限 = 0**。
   即 `--md-elevation-0`（`none`）。⚠️ 该档不是「什么都没写」，是**必须显式写**
   —— 显式写 `0` 才有可 grep 的口径（ADR-0207 决策 1 的同一个思路：意图不是减少写法，是让写错能失败）。
2. **悬浮元素按上表取档**，且**不得越档**（`elevation-3` 的元素不许写 `elevation-4`）。
3. **降档时优先删声明，不优先改成 `0`**。`shadow-[var(--md-elevation-0)]` 与不写 `shadow-*`
   渲染等价，但**保留显式 `0` 的场合只有一处**：同一元素有静止档与 `active:` 档的成对表达，
   删掉静止档会让两档塌成同一档（此时写 `0` 才能表达「静止无阴影」这个事实）。

   > ⚠️ **本规则的例外在「删除 `active:` 档」这批数据上不适用（初稿在此处的隐含推论已作废）**。
   > 决策 6 要删的 5 处 `active:shadow-[var(--md-elevation-1)]`，其**同元素的静止档本来就是
   > `elevation-2` / `elevation-3` 且一律保留** ⇒ **不存在「两档塌成同一档」的情形**，
   > 规则 3 的例外**不构成把 `active:` 档降档为 `elevation-0` 的理由**。
   >
   > **禁止**把 `active:shadow-[var(--md-elevation-1)]` 改写成 `active:shadow-[var(--md-elevation-0)]`：
   > ① 那是**「用阴影表达状态」**（只是换了个数值），直接违决策 6 的硬约束；② 复核判据 2
   > （`active:shadow-[var(--md-elevation-*)]` 命中数必须为 0）按**字面**匹配 `elevation-*`，
   > 写成 `-0` 仍然是命中 ⇒ **改写会直接让门禁红**。③ 从渲染看 `active:` 态 `none` 阴影与
   > 「无阴影」在视觉上无差别，属于**用一条无效果的声明换取门禁绿灯**的假合规。
   >
   > **正确做法是删掉该条 `active:shadow-[…]` 声明本身**（同元素的状态层 / `active:opacity-80`
   > 负责按压反馈），而不是降档。

### 决策 3：整改前 53 处 level-1 的降档裁定（实施后余额 3）

| 类别 | 处数 | 处置 | 理由 |
|---|---|---|---|
| 贴面列表项 / 卡片 | **37** | → `0` | MD3 贴面元素零阴影；层级已由 `surface-container-lowest` 表达 |
| 骨架屏 placeholder | **9 声明点**（56 渲染实例） | → `0` | 见决策 7 |
| 内容限制遮罩 | 2 | → `0` | 50% 黑 `scrim` 已提供分离，阴影是**冗余的第二信号** |
| 错误 chip | 1 | → `0` | `surface-container-high` 已完成色调抬升 |
| `GlassCard.vue` scoped CSS | 1 | → 删除该条 `box-shadow` 声明 | 同上；该卡片是贴面卡 |
| **按压反馈** | **5** | → **不是降档，是删除**（换手段） | 见决策 6 |

**全部降档后的目标：level-1 余额 = 0**（⚠️ **未达成，且已按实测改为不再追求归零** —— 见下段账目）。

**📊 实施后账目（2026-10-01 落地，level-1 3 / level-2 5 / level-3 10 ⇒ 当前余额 18）**：

<!-- measured:level-1=3 -->

| 项 | 数 | 说明 |
|---|---|---|
| 起始 | **68** | level-1 53 + level-2 5 + level-3 10 |
| 已处置 | **50** | 骨架屏 9（#882）+ 贴面 37（#883）+ `GlassCard` scoped CSS 1（#884）+ 按压反馈 3（#885：RefreshableList 菜单项 3 处删阴影，因元素已有 `active:bg-layer-pressed-on-surface`，属重复表达）+ 遮罩/徽标 2（#884） |
| 保留 | **18** | level-1 **3** + level-2 5 + level-3 10 |

⚠️ **level-1 余下的 3 处不是贴面**（逐处核对后保留，见 #883 交付报告），按决策 1 属合规消费，**不再追求归零**。原「余额 = 0」的表述已按实测修订 —— 门禁 `tests/adrClaimConsistency.test.ts` 对本行的 level-1 实测值做**双向锁**：实施改动导致数字漂移时立即转红（它在本轮已真实触发过一次）。

> 上表（实施后账目）是**实测现状**；下表是本 ADR 初稿的「规划」账目（假设 53 处全部处置），
> 已与实测脱节，**仅作决策留痕**，不是现状。

| 账目（初稿规划） | 处数 | 构成 |
|---|---|---|
| 规划处置 | **53** | 全部 level-1：37 贴面 + 7 骨架屏声明点 + 2 遮罩 + 1 徽标 + 1 `GlassCard.vue` scoped CSS + 5 按压反馈 |
| 规划保留 | **15** | level-2 **5** 处 + level-3 **10** 处（均为悬浮元素，决策 1 表内已合规，本 ADR 不动） |

> ⚠️ 该规划账目**未落地**：实测余下 level-1 **3** 处、实际保留 **18** 处（见上方实施后账目）。
> 引用「保留 15」时必须带上「规划」二字，否则会被读成现状。

> ⚠️ **本处曾有一个算术差，如实登记**：本 ADR 初稿写「68 处降到 **17** 处」。该值**与其自身同句的
> 构成分解对不上** —— 同句括号里给出的正是「level-2 五处 + level-3 十处」= **15**，而非 17；
> 差额恰为 **2 处**。
> **可验证的部分**：正确值 = **15**（68 − 53 = 15 = 5 + 10，两侧自洽）。
> **不可验证的部分（如实声明）**：初稿那多出的 2 处**从何而来无法从文本复原**（既不等于按压反馈的
> 5 处，也不等于 `GlassCard.vue` 那 1 处，更不等于任何现有分类的处数）⇒ 属**处置侧与保留侧口径
> 串味**，但**具体是哪种串味不臆测、不追认**。此处只登记「17 与其自身构成分解矛盾」这一**已复算的事实**。
> 复算入口：`grep -rhoE 'md-elevation-[0-5]' --include='*.vue' packages/app-lynx/src | sort | uniq -c`
> → **现状（2026-10-01 实施后）**：`L1=3 / L2=5 / L3=10 / L0=L4=L5=0`，合计 18。
> → **HEAD 基线（本 ADR 起草时）**：`L1=53 / L2=5 / L3=10`，L2+L3=15=68−53，三项自洽。
> ⚠️ 同一条命令今天跑出的是**现状**那一行；`53` 只在检出 HEAD 基线时才复现，不得当现状引用。

**净方向是删除 box-shadow，不是新增。**
这个方向性事实是决策 8 全部独立性的来源。

### 决策 4：`--md-elevation-0/4/5` 的消费点 —— 含来源等级登记

| 档位 | 来源等级 | 本 ADR 的消费裁定 |
|---|---|---|
| `--md-elevation-0` = `none` | **官方一手**（MD3 定义 level 0 为无阴影）—— 非外推 | ⚠️ **2026-10-01 订正：不消费**。初稿写「**立即消费**：44 处贴面元素 + 2 遮罩 + 1 徽标 = 47 处显式零阴影」，该裁定与本 ADR 自己的决策 2 规则 3 自相矛盾，落地时按**删声明**执行 ⇒ 实测 **0 处**。理由见下方 4.1 |
| `--md-elevation-4` | ⚠️ **外推**，非官方一手表 | **暂不消费** |
| `--md-elevation-5` | ⚠️ **外推**，非官方一手表 | **暂不消费** |

**「外推」如实登记**：`tokens.css` 的 `--md-elevation-4/5` 两行**行尾带 `/* 外推 */` 注释**，
数值按该文件段首的可复算规则接续而来，**不是 material-web 官方 v0.192 一手表**。
`glossary-md3-alignment.md` §6 已记录同一事实。**引用这两档时必须带上这个来源等级**，
不得当作官方数值转述。

#### 4.1 零阴影为什么是「删声明」而不是「写显式 0」（2026-10-01 订正）

**订正对象**：本决策初稿对 `--md-elevation-0` 的裁定是「**立即消费**……47 处显式零阴影」。
**该裁定已作废**，理由是它与本 ADR 自己的规则直接矛盾：

- **决策 2 规则 3**：「**降档时优先删声明，不优先改成 `0`**」——`shadow-[var(--md-elevation-0)]`
  与不写 `shadow-*` 渲染等价；显式 `0` 只在「同一元素静止档 + `active:` 档成对」这一处有意义。
- **决策 7 落地**（票 #882，2026-10-01）已按**删声明**执行，并在该处留下了同源的订正记录：
  骨架屏 9 个声明点的 `shadow-[var(--md-elevation-1)]` **整条删除**，**不**改写为 `elevation-0`。
- **决策 2 规则 3 的「例外不适用」注释**进一步封死了按压反馈那批数据降档为 `-0` 的路径。

⇒ **落选的是本决策的初稿表述，不是已落地的实现。** 实测（生产 `.vue`，2026-10-01）：

```bash
grep -rhoE 'md-elevation-0\b' --include='*.vue' packages/app-lynx/src | wc -l
# → 0
grep -rhoE 'active:shadow' --include='*.vue' packages/app-lynx/src | wc -l
# → 0（故规则 3 那个「成对」例外在本项目当前不存在）
```

**`elevation-0` 消费 0 处是决策结果，不是缺口、不是「闲置令牌」。** 反向读法：一旦该档出现
消费点，说明有人**违反**了决策 2 规则 3（该删声明却写了显式 0）⇒ 这是**可 grep 的违规信号**，
不是「该档位被用起来了」的好消息。复核判据 5 已据此撤销（见「复核判据」第 5 条）。

**为什么暂不消费，而不是「留着备用」**：

1. **4/5 档在 MD3 里没有对应的组件角色**。MD3 的 elevation 1–5 对应的是
   「有层级的容器」到「对话框级遮蔽」的连续谱；本项目现有的悬浮元素最高只到 3
   （snackbar / 底部弹层 / 对话框），**4/5 档在本项目的 UI 清单里没有落点** ——
   现在消费它就必须新造一个 elevation-4 的组件，那是为了用令牌而用令牌。
2. **外推档 + 零消费 = 事实上的安全状态**。ADR-0207 复核判据第 5 条要求六档「全部定义」，
   本 ADR **不推翻**该条（令牌继续在位），但**明确区分「在位」与「在用」**：
   外推档的定义可以留着当**能力储备**，用它渲染用户可见界面则超出证据支撑。
3. **解封条件**（须同时满足，缺一不解封）：
   - 决策 8 的多层 `box-shadow` 探针**阳性**（证明多层渲染在真机可用）；
   - 出现一个**确实需要高于 level-3 悬浮度**的 UI（须写明它为什么不是 bottom sheet / dialog）；
   - 真机截图对比确认观感可接受。
   届时**先补 `surface-container-highest` 的色调档位**（该档已有 29 处消费，是现成的最高色阶；
   2026-10-01 快照，复算：`grep -rhoE 'surface-container-highest' --include='*.vue' packages/app-lynx/src | wc -l`），
   再开阴影档 —— 仍是「主在前、辅在后」。

### 决策 5：`--md-surface-tint` 的角色边界 —— 它**不承载**层级

**先纠正一个可能的误读**：MD3 官方口径是「elevation 每级主要由 surface tint 表达」。
本项目**不能照字面执行这条**，原因是可复算的：

```
awk '/--md-primary:/{p=$2} /--md-surface-tint:/{if(p!=$2) print "MISMATCH"; else n++} END{print "matched="n}' src/styles/tokens.css
# → matched=14，无 MISMATCH
```

**14 套色板里 `--md-surface-tint` 与 `--md-primary` 逐个取同值。** 两者信息量完全相同 ——
「加 tint」和「加 primary」在本项目是同一个颜色。因此：

- **本项目的「主」= `surface-container-*` 五档明度分档，不是 tint。**
  MD3 之所以能用 tint 表达层级，是因为 tint 强度随 level 递增；本项目的 tint 是**单一值**，
  没有强度阶梯，套上去只会得到「所有层级染同一种蓝」，**表达不出层级差**。
- **`--md-surface-tint` 的职责收窄为「状态层式叠加」**：现存唯一消费
  `PagePickerSheet.vue` 的 `bg-surface-tint opacity-[0.08]`（8% 口径对齐 hover 层）
  正是这个用法，**保留、不动**。
- **禁**把 `bg-surface-tint` 当层级手段用在卡片/弹层上（会用同一种蓝抹平层级，
  与本 ADR 目标相反）。

#### 5.1 与本决策直接矛盾的**现存注释**（登记为独立小票，本轮不改源码）

实跑定位（无行号，按文件 + 符号锚定）：

```bash
grep -rniE "tint.*层级|层级.*tint" --include='*.vue' --include='*.ts' --include='*.css' packages/app-lynx/src
```

| 项 | 实测结果 |
|---|---|
| **文件** | `packages/app-lynx/src/components/PagePickerSheet.vue` |
| **符号 / 元素** | 模板内「色调层」注释块，所注释的子元素为 `class="absolute left-0 top-0 w-full h-[10.667vw] bg-surface-tint opacity-[0.08]"`（该文件**无 `<style>` 块**，注释在 `<template>` 的 `<!-- -->` 内 —— 特此更正：**它不是 scoped CSS 注释**） |
| **注释原文** | 「MD3 表达层级的主要手段是给表面**染上主色**（surface tint），box-shadow 仅为辅。」 |
| **矛盾点** | 本决策已钉死「`--md-surface-tint` 与 `--md-primary` 在 **14 套色板逐个同值、无强度阶梯**」⇒ tint 在本项目**表达不出层级**。该注释把「tonal elevation 的着色层」**归因于 surface tint**，与本决策的裁定直接冲突 |
| **裁定** | **存量错误陈述**，应删除或改写为「本项目的『主』是 `surface-container-*` 五档明度分档，不是 tint；tint 在本项目只作状态层式叠加」 |
| **是否本轮改** | ❌ **否** —— 改源码超出本 ADR 授权范围（写入边界仅限本文件）。**登记为独立小票** |
| **性质** | 该文件的这处**消费本身是合规的**（决策 5 明写「保留、不动」）。要改的**只是注释的错误归因**，不是那 8% 着色层的存在 |

> **为什么这条值得单独登记，而不只是「顺手改个注释」**：它是**复核判据 3「扫描面扩到 CSS 声明」
> 类判据的误报锚点**。任何「剥注释后扫 `box-shadow` / elevation 关键词」的抽取器，都会先命中这句
> **纯注释文本**——「box-shadow 仅为辅」里含 `box-shadow` 字面量，「surface tint」里含 `tint`。
> 误报的**根因是注释文本与被扫关键词撞词**，而不是抽取器有 bug ⇒ 该注释一旦按裁定修掉，
> 这类误报**同时少一个触发源**。这为「判据实现时必须先剥注释」提供了仓内真实存在的实例，
> 而非假想用例。

**顺带处置色阶断档（背景 §四）**：`bg-surface-container-low` 0 消费，本 ADR **不新增消费点**，
只登记两个互斥的候选处置，**均不在本 ADR 范围内**：

- **候选甲**：把 37 处贴面卡从 `lowest` 迁到 `low`（对齐 MD3「卡片用 `low`」的官方落点）——
  属**色调迁移**，会改全站观感，需独立票据 + 截图回归；
- **候选乙**：确认五档只用四档后，**删掉 `--md-surface-container-low`** 及其
  `container-low` 键与 `--colorNeutralBackground2` 别名引用（ADR-0207 复核判据第 5 条原则）。

**本 ADR 不选边** —— 因为两个候选都会改动决策 1 表里已钉住的档位映射，超出「消费口径」的范围。
登记在此以免它被当成不存在。

### 决策 6：按压反馈与阴影分离 —— `active:shadow-elevation-*` 出路（语义收口）

**规则（硬约束）**：**禁写 `active:shadow-[var(--md-elevation-*)]`**。
elevation 档位是**高度**语言，不是**状态**语言。状态反馈走状态层，不走阴影。

按现有元素的底色分三种处置：

| 元素 | 底色 | 现有按压反馈 | 处置 |
|---|---|---|---|
| `RefreshableList.vue` 菜单项 ×3 | `surface-container-high` | 已有 `active:bg-layer-pressed-on-surface` | **仅删除** `active:shadow-…-1`，状态层保留 |
| `RefreshableList.vue` feed FAB | `primary-container` | 已有 `active:bg-layer-pressed-primary` | **仅删除** `active:shadow-…-1` |
| `GlobalFab.vue` 主 FAB | `primary-container` | **无任何状态层** | 改用 `active:opacity-80`（见下） |

**为什么 `GlobalFab.vue` 主 FAB 不能用状态层**：`tokens.css` 注册的状态层 role 实测只有
**`primary` / `on-surface` / `error` / `surface` / `on-primary` 五档**，**`primary-container` 不在其中**。
给不存在的档位硬套一个是最典型的「静默错色」。而 `active:opacity-*` 在本项目**已有 6 处先例**
（`Ranking.vue` / `TagNeighbors.vue` / `NovelIntro.vue` / `RankingEntryCard.vue`），
`GlobalFab.vue` 自身的 busy 态也已经在用 `opacity-60` ⇒ 取站内既有手段，不新造。

> ⚠️ **`primary-container` 档状态层缺失**是令牌层的真实缺口，登记在此。
> 补齐它属于**新增令牌**（要动 `tokens.css` 与 `tailwind.config.ts`），**不在本 ADR 范围**。

**⚠️ 两个待真机验证项（不得跳过）**：

1. **`active:opacity-*` 在 Lynx `:active` 下是否生效**。ADR-0207 决策 5 的探针 C 证实了
   **伪类匹配本身**可用（`active:bg-primary` 真变色），但 `opacity` 属性是否响应 `:active`
   **未单独验证**。探针设计见决策 8 的同批探针（可一并采）。
2. **`active:bg-layer-pressed-primary` 画在 `bg-primary-container` 上的观感**。
   ADR-0207「引擎能力边界」第 1 条已实证：Lynx 的 `background-color` 是**替换**语义，
   alpha 层会替换掉 `primary-container` 底色。该组合**现网已在用**，本 ADR 只删阴影不动它，
   但**其观感未经真机取样** ⇒ 登记为待验证，不在本 ADR 内修改。

### 决策 7：骨架屏专项 —— 9 个声明点 / 56 个渲染实例

**口径**：本项目的骨架屏有**两种形态**，只有一种带阴影：

- ✅ **`SkeletonCard.vue` 组件形态**（推荐列表流，4 处 `SkeletonCard v-for` 引用点）
  —— **组件内无 `box-shadow`，天然合规**。它是本仓现成的**正确先例**。
- ❌ **内联 `v-for="n in N"` 形态**（列表页的假数据行）
  —— 9 个声明点**全部**带 `bg-surface-container-lowest … shadow-[var(--md-elevation-1)]`：

  | 文件 | 渲染实例数 |
  |---|---|
  | `FollowList.vue` | 8 |
  | `MyPixiv.vue` | 8 |
  | `Notifications.vue` | 6 |
  | `Watchlist.vue` | 5 |
  | `NovelList.vue` | 5 |
  | `UserHome.vue` | 5 |
  | `Bookmarks.vue` | 5 |
  | **合计** | **9 声明点 / 56 渲染实例** |

**处置**：

1. 9 个声明点的 `shadow-[var(--md-elevation-1)]` **整条删除**（**不**改写成
   `shadow-[var(--md-elevation-0)]`）。
   > ⚠️ **本条已于 2026-10-01 实施时订正**（票 #882）：初稿写「显式写 0」，与决策 2 规则 3
   > 「降档优先删声明」**自相矛盾**。实施按**删声明**执行 —— 判据若把显式零
   > （`shadow-none` / `shadow-[var(--md-elevation-0)]`）也接受，则「归零」与「漏改」
   > **无法区分**（二者扫描结果都是 0 命中）。为此门禁另配了「登记点台账 + marker 双向对齐」
   > 来区分二者。
2. **底色 `bg-surface-container-lowest` 保持不变**（决策 1 已论证：与真实卡同档，避免色调跳变）。
3. **`SkeletonCard.vue` 不动** —— 它已经是目标形态。
4. **收敛手法**：这 9 处的根因是「内联骨架块逐页各写一遍，抄了列表行的阴影没抄对」。
   短期 7 处机械改写；**长期建议**让内联骨架行也收敛到共享组件（与 `SkeletonCard.vue` 同类），
   但**组件化重构不在本 ADR 范围**（会改渲染树结构，触及 ADR-0150 的三态互斥约束）。

**为什么这条最优先**：56 个渲染实例**同帧同时可见**，是加载态里最刺眼的粗糙来源；
而它的改动是**纯删除**、零新增声明、零跨组件影响。

### 决策 8：多层 `box-shadow` 的引擎约束 —— 探针设计与「主」不依赖它

ADR-0207 决策 7 留了一条**未验证的引擎约束**：

> 「已知引擎约束（需真机确认，记此备查）：Lynx 对多层 `box-shadow` 的支持度未知；
> 若不生效，则层级完全由 surface 色调承担，本决策的『辅』部分自然失效，不影响『主』。」

本决策**正面处理**这条：给出可执行的取证方案，并**明确本 ADR 不建立在这个未验证能力之上**。

#### 8.1 探针设计

`--md-elevation-1/2/3` 的官方配方本身是**双层逗号分隔**。探针必须把
**「多层是否被解析」**与**「CSS 变量是否被解析」**这两个变量**拆开**，否则结论不可归因。
四个色块**同屏同批**：

| 探针 | 声明 | 角色 |
|---|---|---|
| **P1** | `box-shadow: 0 2px 4px rgba(0, 0, 0, 0.5)`（**单层**字面量） | **阳性对照** —— 证明引擎能渲染 box-shadow、证明采样方法有效 |
| **P2** | `box-shadow: 0 1px 2px rgba(0, 0, 0, 0.3), 0 1px 3px 1px rgba(0, 0, 0, 0.15)`（**双层**字面量，等于 elevation-1 配方） | 测「多层」 |
| **P3** | `box-shadow: var(--md-elevation-1)`（**经变量**双层） | 测「多层 × var()」 |
| **P4** | `box-shadow: none`（`--md-elevation-0` 的值） | **阴性对照** —— 证明「无阴影」确实渲染为无 |

**判读表**：

| 观测 | 判读 | 对本决策的影响 |
|---|---|---|
| P1 有影、P2 有影且**第二层轮廓可辨**（投影更宽） | 多层生效 | 「辅」可用，但权重不变，仍以「主」为准 |
| P1 有影、P2 **无影** | 多层被整条丢弃 | 「辅」在真机完全失效，层级 100% 由色调承担 |
| P1 有影、P2 **仅第一层轮廓** | ⚠️ **只取第一层** | **最危险的一种**：元素「看起来有阴影」，但 1/2/3 档的第二层配方静默丢失 ⇒ 档位间差异被压缩，「辅」传递不出可分辨的层级 |
| **P1 也无影** | box-shadow 整体不生效 | 「辅」全站失效 ⇒ **「主」不受影响**（见 8.2） |

**P1 是强制阳性对照**：若 P1 也不亮，则「什么都没发生」无法区分「多层不支持」与
「box-shadow 整体不支持」—— 这正是 ADR-0207 决策 5 首版探针踩过的坑
（「最初的 C 是个没有 `@tap` 处理器的 `<view>`，三个探针全阴 ⇒ 若就此收工会得出错误结论」）。
**判据必须自带阳性对照**，本决策沿用该纪律。

**取证方法（避免 ADR-0207 记录过的取样坑）**：

1. 阴影是**投影**，**不能采元素中心像素**（那是底色）。在每个色块**正下方偏移 `blur + spread`
   处的水平扫描线上取最小亮度** —— 投影最深处即最暗点。
2. **必须同时留截图**作为佐证。ADR-0207 决策 8 曾因「取样点未落在按钮填色区」而记下一条
   **不可信的绝对像素**并撤稿 ⇒ **单点数值只作辅助，截图才是判据**。
3. `light` 与 `dark` **两套色板各跑一次**（暗色下阴影 alpha 的观感不同）。
4. 4 色块**一次采完**，不跨批次（避免设备亮度/环境光差异混入）。

#### 8.2 「主」不依赖该能力（三条独立理由）

1. **「主」= `background-color`**，这是本项目已被反复证实可用的通道
   —— ADR-0207 决策 8 的真机证据里 `bg-*` **每一次都真的改变了颜色**（只是语义是「替换」而非
   「合成」，见「引擎能力边界」第 1 条）。决策 1 的映射表**整张表都是底色**。
2. **本 ADR 净方向是删除 box-shadow，不是新增**（决策 3 规划账目：68 处 → 15 处；实际余额 18）。
   探针无论判「生效」还是「不生效」，决策 3/7/6 的改动**都已经做完了、都不需要回滚**：
   - 若多层**生效** ⇒ 删完之后观感变平，这正是 MD3 的目标形态
     （ADR-0207「后果」章已预告：「在无 box-shadow 渲染的设备上会明显变平」）；
   - 若多层**不生效** ⇒ 删完之后观感**不变**，等于白删但无害。
   两种结果下本 ADR 都成立，**只有「辅」的权重不同**。
3. **唯一可能「新增」box-shadow 的地方（level-4/5）已被决策 4 显式推迟**
   —— 且解封条件的第一条就是本探针阳性 ⇒ **新增路径默认关闭**。

**结论**：本 ADR 不让任何决策悬在未验证的引擎能力上。探针是**为「辅」定量**的，
**不是方案成立的前提**。

## 后果

- **贴面区域的观感会明显变平** —— 这是 MD3 的目标形态（层级改由 `surface-container-*` 明度承担），
  **不是退化**。与 ADR-0206 的排版变更、ADR-0207 决策 6 的缓动变更**叠在同一批 UI 上**，
  三者**必须分批落地、分批回归**，否则无法归因（承接 ADR-0207「后果」章的同一条纪律）。
- **`elevation-1` 的余额曾以「目标 = 0」表述** —— ⚠️ **该目标已于 2026-10-01 按实测修订为不再追求归零**：
  余下 3 处为合规消费（`RestrictedNovelCard.vue` / `AiRestrictedNovelCard.vue` / `Recommended.vue`）。
  权威数值与逐处台账见**决策 3**实施后账目里那行 `measured:` 标记（见下），本条**不再自带数字**。
  > ⚠️ **本条初稿的数字自相矛盾，已整体作废**（code review Spec 轴 F1，2026-10-01 复核）：
  > 初稿在同一段里既写「生产 `.vue` 中 `elevation-1` 仍有 **8 处**」，又写「剩余 **43** 处中
  > 5 处是按压反馈、38 处是静止阴影」——**同一批 53 处不可能既剩 8 又剩 43**，且 38 + 5 与
  > 同句给出的「本轮净减 45」分解也对不上。两个数字**均为中途快照**，
  > 且 `elevation-0` 一句同样作废（零阴影在本项目是**删声明**达成的，见决策 4.1）。
  > **处置**：作废数字已从本条删除，**不在此处重建第二个 `measured:` 标记** ——
  > 唯一权威标记在决策 3，复算入口也在那里。
  「零阴影」从此是项目里**可 grep、可门禁**的一个档位（实现手段是删声明，不是写显式 0）。
- **`--md-elevation-4/5` 从「在位」转为「在位但明确不用」** —— 这是**来源等级如实登记**的
  结果，不是删令牌。若将来解封，解封条件写在决策 4 里，不必重新论证。
- **`--md-surface-tint` 的职责被收窄为状态层式叠加**，`PagePickerSheet.vue` 的现有点不动。
  代价是**「主」在本项目与 MD3 官方口径不同**（用五档明度而非 tint 强度阶梯）——
  这是 `--md-surface-tint ≡ --md-primary`（14 色板逐个同值）这个事实的必然结果，已登记。
- **`active:shadow-elevation-*` 出清后，按压反馈只剩状态层与 opacity 两条通道**，
  而 `primary-container` 底色的状态层档位**缺失**（决策 6）⇒ 该缺口需要在令牌层补齐，
  本 ADR 不越界处理。
- **静态门禁的口径必须从「类名」扩到「CSS 声明」**（理由见复核判据 3：**类名与 CSS 声明是
  两条互不覆盖的扫描路径**；原反例锚点 `GlassCard.vue` 的声明已随 #884 删除，仓内现存
  `box-shadow` 声明为 0 处），否则新的 elevation 门禁会留一个已知盲区。

## 复核判据

以下判据**尚未实现**（本 ADR 只授权决策，落地由后续 ticket 承担）。
建议挂在既有门禁 `packages/app-lynx/tests/md3GuardScans.test.ts`（现为规则 1–8）新增规则 9，
沿用该文件既有纪律：每条规则须有 `it('反事实')` 与 `it('抽取器自身有效')`，
且反事实须喂**两种换皮形态**，避免单形态门禁 fail-open。

1. **贴面零阴影**：`src/**/*.vue` 中，凡元素带 `bg-surface-container-lowest` 且位于
   `v-for="n in …"` 骨架块内或列表行容器内者，**不得**带任何 `shadow-[var(--md-elevation-1..5)]`。
2. **无 `active:shadow`**：`src/**/*.vue` 中 **`active:shadow-[var(--md-elevation-*)]` 命中数必须为 0**。
3. **扫描面覆盖 CSS 声明**：判据 1/2 的扫描**必须同时覆盖 `.vue` 的 `<style>` 块**
   （只扫类名会漏掉直接写在样式块里的 `box-shadow: var(--md-elevation-*)`）。
   ⚠️ **锚点已失效，勿再引用**：本条最初以 `GlassCard.vue` 的 scoped
   `box-shadow: var(--md-elevation-1)` 作反例锚点，但该声明已随 **#884** 删除
   （归零 = 删声明，见决策 2 规则 3）。**2026-10-01 复算：`src/**/*.vue` 中存活的
   `box-shadow` 声明为 0 处** ⇒ 仓内已无可复现的反例，锚点从「可核对」退化为「不可核对」。
   保留本条的**理由不是那个文件**，而是**结构性理由**：类名扫描与 CSS 声明扫描是两条
   互不覆盖的路径，只要其中一条不实现，盲区就在。实现时请自行构造一个正样本临时注入
   以验证抽取面（不得落盘到 `src/`），不要指望仓内还留着一个现成反例。
   ⚠️ 已知结构性边界：`.ts` 全文与 `.vue` 的 `<script>` 块内拼接的类名仍是盲区
   （与 ADR-0207 决策 8 消费约束节登记的 C3 盲区同源，此处不重复展开）。
4. **外推档零消费**：`--md-elevation-4` / `-5` 在 `src/**/*.vue` 的消费处数必须为 **0**；
   一旦有人要用，**先改本 ADR 的决策 4**（解封条件），而不是改门禁白名单。

   > 🚨 **本判据的真实漏口（如实标注 —— 本 ADR 不假装它已被覆盖）**：
   > 本判据**只按「令牌名出现次数」计数**，因此**抓不到绕过令牌直写字面量阴影的写法**，例如
   > - 类名通道：`shadow-[0_2px_4px_rgba(0,0,0,0.5)]`
   > - CSS 声明通道（`<style>` 块内）：`box-shadow: 0 2px 4px rgba(0, 0, 0, 0.5);`
   >
   > 这类写法**既不含 `elevation-4/5` 字样，也不含任何令牌名** ⇒ 本判据判它绿灯。
   > 换言之，**「外推档零消费」为真 ≠ 「全站无 level-4 观感的阴影」**。
   >
   > **当前存量实测**（复算入口与结果，均为**已验证**）：
   > ```bash
   > # 结果为空 ⇒ 当前 0 处字面量 box-shadow 绕过令牌
   > grep -rnE 'box-shadow' --include='*.vue' --include='*.css' packages/app-lynx/src \
   >   | grep -v 'var(--md-elevation' | grep -vE '//|<!--|\* '
   > # 结果为空 ⇒ 当前 0 处类名通道的字面量 shadow-[…]
   > grep -rnoE "shadow-\[[^]]*\]" --include='*.vue' packages/app-lynx/src | grep -v 'var(--md-elevation'
   > ```
   > ⇒ **漏口是「当前未被触发」，不是「不存在」**。它防的是**未来**有人为「就是要个更深投影」而
   > 手写字面量，恰好绕开本 ADR 全部六道判据（1/2 只管 `elevation-*` 类名、6 只管令牌消费数）。
   >
   > **兜底归属（不在本判据的承诺范围内）**：要么**另设一条**「全站 `box-shadow` 声明必须走令牌」的
   > 独立判据（口径为「取到 `box-shadow` 的值必须含 `var(--md-elevation-*)`」，与判据 3 的扫描面配套），
   > 要么**明确接受由 code review 人工兜底**。在二者择一落地之前，**本漏口处于未覆盖状态**，
   > 不得在任何汇总文档里被转述为「外推档已受门禁保护」。
5. ~~**`--md-elevation-0` 有真实消费**~~ —— **⛔ 已撤销（2026-10-01，code review Spec 轴 F1）**

   > **原判据**：`shadow-[var(--md-elevation-0)]` 消费处数 **≥ 1**
   > （原话是「延续 ADR-0207 复核判据第 5 条『死代码应删而非留着』的精神，反向要求它不被闲置」）。
   > **撤销理由**：本判据要求的目标与**已落地**的决策 2 规则 3 / 决策 7 相反。零阴影在本项目
   > 是**删掉 `shadow-*` 声明**达成的（决策 7 票 #882 已在该处留下同源订正），写 `elevation-0`
   > 恰恰是被明令禁止的写法 ⇒ **按此判据挂门禁等于逼人写出违规写法才能转绿**。
   > 实测消费处数 **0**（`grep -rhoE 'md-elevation-0\b' --include='*.vue' packages/app-lynx/src | wc -l`），
   > 与撤销后的立场方向一致。完整订正见**决策 4.1**。
   > **对上游的更正**：ADR-0207 复核判据第 5 条写的是「`--md-elevation-0..5` 全部定义，
   > **且至少一处消费 `--md-surface-tint`**（否则该 token 是死代码，应删而非留着）」——
   > 它的「至少一处消费」落在 `--md-surface-tint` 上，「死代码应删」针对的是**令牌定义是否闲置**。
   > 本判据把该条**反向误用**为「`elevation-0` 必须有消费点」，该误用自此不再延用。
6. **~~`elevation-1` 余额钉零~~ → ⛔ 已撤销（2026-10-01，与决策 3 的修订同步）**
   原判据要求 `--md-elevation-1` 消费处数**目标为 0**、并称「**实测 43**」——两个数都已失效。
   > **现状**：实测 **3**（权威出处 = 决策 3 的那行 `measured:` 标记），逐处为
   > `RestrictedNovelCard.vue` / `AiRestrictedNovelCard.vue` / `Recommended.vue`，
   > 决策 3 已按决策 1 判定为**合规消费、不再追求归零**。
   > **为什么仍不写「余额 = 3」这条门禁**：余额随合法的 UI 增减变动，把 3 钉死会制造
   > 与「门禁只为防回归」相悖的维护负担（AGENTS.md 门禁冻结线第 1 条）。
   > **改由何处承载**：余额的防回归由 `tests/adrClaimConsistency.test.ts` 对决策 3 那行
   > `measured:` 标记的**双向锁**承担（数值漂移即转红），语义承载见
   > `docs/adr/glossary-md3-alignment.md` §13.4。
   （决策 3 的裁定；若将来出现新的 level-1 场景，须先改本 ADR。）
7. **决策 8 探针结论入库**：真机探针的四种判读结论**必须回填到本 ADR 的决策 8**，
   并注明设备（API 34 / Lynx SDK 4.0.1）、色板（light / dark）、日期。
   **未回填前决策 8 的表保持「待真机验证」状态**，不得在任何汇总文档里被转述为「多层可用」或
   「多层不可用」。

## 参考

- 上游决策：[`ADR-0207`](./ADR-0207-shape-and-state-layer-guardrails.md)
  **决策 5**（`active:` 变体可用 / `hover-class` 失效，含首版探针假阴性的教训）、
  **决策 7**（本 ADR 的直接上游：令牌已补、口径待落地、「主辅」提法与未验证引擎约束的出处）、
  **决策 8**（引擎「替换」语义的实证，取样点不可信的撤稿记录）、**决策 9**（禁 `hover-class`）
- 事实底座：[`glossary-md3-alignment.md`](./glossary-md3-alignment.md) §6「层级（elevation）」
  （六档来源等级、`surface tint` 消费现状、多层 `box-shadow` 未验证的原始登记）
- 令牌定义：`packages/app-lynx/src/styles/tokens.css` 的 `--md-elevation-0..5`（4/5 行尾带「外推」）
  与 `--md-surface-container-*` 五档、`--md-surface-tint`、`--md-scrim`
- Tailwind 登记：`packages/app-lynx/tailwind.config.ts` 的 `colors.surface`（五档 + `tint`）
  与 `boxShadow` 档位
- 门禁宿主：`packages/app-lynx/tests/md3GuardScans.test.ts`（规则 1–8；本 ADR 判据拟作规则 9）
- 官方数值来源：
  [`_md-sys-state.scss`](https://github.com/material-components/material-web/blob/main/tokens/versions/v0_192/_md-sys-state.scss)、
  [`_md-sys-shape.scss`](https://github.com/material-components/material-web/blob/main/tokens/versions/v0_192/_md-sys-shape.scss)

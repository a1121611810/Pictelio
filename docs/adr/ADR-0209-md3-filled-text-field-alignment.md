# ADR-0209：表单输入框对齐 MD3 filled text field（含官方规格回源纠正）

## 状态

accepted（2026-10-01）

## 背景

`docs/research/md3-conformance-audit-2026-10-01.md`（本轮复核报告）发现一处**此前未被登记**的差距：

`packages/app-lynx` 全仓 17 处 `<input>` 表单输入框（分布在 6 个文件）**未对齐 MD3 filled text field**，
且它们**不在** [ADR-0205](./ADR-0205-md3-baseline-and-scope.md) 决策 4 的「有意偏离」封闭清单里——
该清单只豁免了**全局搜索框**的药丸形态。

按 ADR-0205 决策 4 的口径「**不在表内的差距默认按「要修」处理**」，这是当前最实质的未关闭差距。

### 一个必须先纠正的前提

立项时（本 ADR 起草前）项目内部流传的 filled text field 规格口径有**两处错误**：
「顶 4dp / **底 12dp** 圆角」与「**顶部 4dp 色带**」。

回源核对后**两处都不成立**（详见决策 1）。若按错误口径实施，会把已经正确的部分改错
（项目现有 11 处输入框的 `rounded-t-extra-small rounded-b-none` + 底部 1px 指示条**恰好命中官方真值**）。

## 决策

### 决策 1：官方规格以回源核对结果为准（三处纠正）

本项目 [ADR-0205](./ADR-0205-md3-baseline-and-scope.md) 决策 1 规定：MD3 数值一律以
`material-components/material-web` 的 `tokens/versions/v0_192/` 生成令牌文件为唯一基准，
**取值冲突时以令牌文件为准，不以记忆或二手转述为准**。据此逐条回源：

| 项 | 此前错误口径 | **官方真值** | 回源依据 |
|---|---|---|---|
| 容器高度 | 56dp | **56dp**（唯一本来就对） | AndroidX `TextFieldDefaults.kt`：`public val MinHeight: Dp = 56.dp` |
| 圆角 | 顶 4dp / **底 12dp** | 顶 4dp / **底 0dp** | `_md-sys-shape.scss`：`'corner-extra-small-top': (4px 4px 0px 0px)` |
| 指示条位置 | **顶部 4dp 色带** | **底部**（`inset: auto 0 0 0` + `border-bottom`） | `field/internal/_filled-field.scss`：`.active-indicator { inset: auto 0 0 0; }` |
| 指示条厚度 | 4dp | 未聚焦 **1px** / 聚焦 **2px** | `_md-comp-filled-text-field.scss`：`'active-indicator-height': 1px`、`'focus-active-indicator-height': 2px` |

其余官方真值（容器色 `surface-container-highest`、指示条色 `on-surface-variant` → 聚焦 `primary`、
label 静止 `body-large` → 浮动态 `body-small`、label 色 `on-surface-variant` → 聚焦 `primary`）
同样出自上述两个令牌文件，**不在本表抄写具体值**——引用时回源核对，避免两处抄本各自漂移
（同 ADR-0205 决策 1 的取数纪律）。

**教训（与 `easing-standard` 误判同族）**：本项目历史上曾把 MD2 legacy 曲线误记为 `easing-standard`，
差点把正确值改错（见 ADR-0205 背景末段）。本次是同一类错误的第二次发生——**凭印象填 MD3 数值**。
回源核对不是形式，是硬要求。

### 决策 2：label 浮动用 focus/blur 事件驱动，不依赖 `:focus` 伪类

[ADR-0207](./ADR-0207-shape-and-state-layer-guardrails.md) 决策 5 已真机实证：`:focus` / `:focus-visible`
在 Lynx 上**引擎不匹配**（阳性对照 `:active` 生效而这两类无任何变化），故本项目刻意为 0。

但**死的是伪类，不是事件**：Lynx `<input>` 官方支持 `bindfocus` / `bindblur`
（Android / iOS / Harmony，since 3.4；本项目 Lynx SDK 4.0.1 满足）。
来源：<https://lynxjs.org/3.6/api/elements/built-in/input> 的 Events 段。

因此 label 浮动**用 focus/blur 事件驱动响应式 class 实现**。这与 ADR-0207 决策 5 **不冲突**，
两者判定的不是同一件事：ADR-0207 判的是「CSS 伪类不可用」，本决策用的是「元素事件可用」。

⚠️ **前提风险**：`@lynx-js/types` 未在本仓 `node_modules` 中落地（`vue-lynx` 的 d.ts 从它 import
`IntrinsicElements`，被 `skipLibCheck` 掩盖）⇒ **vue-tsc 对 Lynx 内建元素属性零类型校验**，
写 `bindfocus` 不会有编译期保护。故本决策的合规性**必须**由单测 + 真机证据承担（见决策 4）。

### 决策 3：整改范围 = 全部 17 处表单输入框；搜索框不动

实测口径（生产 `.vue`，排除 `.test.` 与 `errorPrototype/`）：

| 文件 | 处数 | 现状 | 处置 |
|---|---|---|---|
| `pages/Me.vue` | 7 | 56dp + 顶 4dp/底 0，**缺底部指示条** | 补指示条 + 聚焦态 + label 浮动 |
| `components/SettingsEndpoint.vue` | 6 | 45dp + 中圆角 + **全描边** | 改 56dp + 顶 4dp/底 0 + 底部指示条 |
| `components/BookmarkPanel.vue` | 1 | 42dp **药丸** | 改 56dp + 底部指示条（**不做 label 浮动**，见下方决策 6） |
| `pages/Login.vue` | 1 | 56dp + 顶部指示条（形态已对） | 补聚焦态 + label 浮动 |
| `components/CommentInputBar.vue` | 1 | 同上 | 补聚焦态 + label 浮动 |
| `components/SearchSheet.vue` | 1 | 42dp 药丸 | **不动** |

**搜索框不动**：ADR-0205 决策 4 第 2 条已豁免全局搜索框的药丸形态，且该清单是**封闭**的
（「重开某条须新开 ADR 推翻 ADR-0205 决策 4」）。本 ADR **不扩张**该清单。

⚠️ 实测纠正：本轮立项时曾按「6 处」估算，实测为 **17 处 / 6 个文件**（`Me.vue` 7 处、
`SettingsEndpoint` 6 处形态完全同构）。范围以本表为准。

### 决策 4：合规判定沿用三层证据，且本 ADR 强制第 ② 层

沿用 ADR-0205 决策 6：① 静态审计 + ② 真机截图 + ③ e2e 断言，缺一不可。

本 ADR 特别强调两点：
1. label 浮动属**观感类**问题，**第 ② 层真机截图不可省**；且「代码里写了 `bindfocus`」**不等于**
   「真机生效」——这正是 ADR-0205 决策 6 存在的理由。
2. 第 ③ 层 e2e 只断言数值类（56dp 高度、指示条 1px/2px），**观感类不由 e2e 假装能判**。

关闭条件按 ADR-0205 决策 7：现象消失 + 机器可判部分有断言 + 不可判定部分有截图留档，
三者缺一即视为**未关闭**，不得宣称「已对齐 MD3」。

### 决策 5：不推翻既有决策

本 ADR 明确**不**做以下任何一项（列出以免后续 review 重复提议）：

- 不新增「有意偏离」条目，不扩张 ADR-0205 决策 4 的封闭清单
- 不触碰 [ADR-0179](./ADR-0179-app-lynx-m3-switch-component.md)（`M3Switch` 组件「无 a11y 绑定」
  是其**刻意设计**，为避免 TalkBack 双重播报；本轮 a11y 语义走**先真机探针**再决策的路径）

### 决策 6：label 浮动不得与常驻字段名重复

MD3 filled text field 的 label 是**容器内浮动**的（聚焦/有值时上移到容器顶部），
它**取代**而非叠加于字段名。因此：

- `BookmarkPanel` 的新建标签输入框**不做浮动 label** —— 其正上方已有常驻可见的
  `bookmarkPanel.newTagLabel` 字段名，再加浮动 label 会同屏出现两份「新建标签」。
  该处只对齐容器形态（56dp + 顶部 4dp/底 0 + 底部指示条），label 沿用常驻形态。
- 反向约束：**不得**在已有常驻字段名的输入框上叠加浮动 label。

这不是「有意偏离 MD3」——MD3 要求的是「字段名始终可见且不重复」，常驻标签同样满足；
它只是 M3 之外的另一种合规实现。留痕以免每次 review 都被当成漏做而重新提出。

## 后果

**正面**
- 17 处表单输入框形态统一，MD3 合规面从「色彩/排版/形状/状态层/图标」扩展到**组件规格**层
- 建立了 filled text field 的机器门禁（形态类），后续新增输入框有防线
- 决策 1 的回源纠正避免了「按错误口径把已经正确的 11 处改错」

**负面 / 成本**
- **17 处输入框视觉会变**（高度、圆角、指示条、label 占位）⇒ 必须进截图回归
  （`packages/app-lynx/scripts/capture-md3-matrix.sh` + android-e2e）
- label 浮动需要**新增 i18n key**（当前 `Me.vue` 的 5 个 WebDAV 字段只有 `*Placeholder`、无 label），
  且 zh-CN / en **两语种必须同步**
- 形态类同构但**所在页面的滚动布局会因 label 占位而位移**，需真机确认无内容截断

**风险登记**
- `@lynx-js/types` 缺失 ⇒ Lynx 元素属性零类型校验（决策 2 的前提风险），
  写错属性名不会报错、只会在真机静默失效。**缓解**：门禁断言属性字面量 + 真机验证。

### 第②层真机验证结论（2026-10-01，emulator-5554 / Android 14 / Lynx SDK 4.0.1 / 1080×2160）

第②层已实跑，**两项风险均证伪**（不是「未验证」）：

| 项 | 结论 | 观测证据 |
|---|---|---|
| **label 浮动真机生效** | ✅ | `Me.vue` WebDAV 区聚焦「用户名」后：label 由容器中部移到**顶部**、字号 `body-large → body-small`、颜色 `on-surface-variant → primary`（采样 `(26,111,168)` = `--md-primary`） |
| **聚焦指示条 1px→2px + primary** | ✅ | 聚焦框底部线呈 primary 蓝且明显加粗；未聚焦框为 1px 深灰 `on-surface-variant` |
| **label 遮挡点击** | ✅ **不成立** | 点击落在 label 所在位置 ⇒ **软键盘弹出、input 获焦**。绝对定位 `<text>` 未吞掉命中事件，ADR 原风险登记的「若被吞则改布局」分支**不需要触发** |

阳性对照：同批观测中 `M3Switch` 点击正常切换、页面导航正常 ⇒ 不是「探针/导航失效」导致的假阴性。

⚠️ **真机同时暴露并已修复两个静态门禁抓不到的缺陷**（这正是本层不可省的原因）：

1. **label 与 placeholder 同框双行**：静止态两者争同一居中位，屏上出现「用户名 / 用户名」两行。
   修法：placeholder 随状态条件化，静止态传空串（`SettingsEndpoint` 当时已是正确写法，`Me.vue` 漏了）。
2. **有值未聚焦时 placeholder 仍显示**：`目录` 字段因有值而 label 已浮顶（primary 蓝），
   placeholder 又叠一层 ⇒ 「目录 / 目录（默认 Pictelio/backup）」两行。
   修法：判据从「随浮动（含『有值』）显示」收紧为「**仅聚焦时**显示」——
   placeholder 的职责是提示可输入什么，值已存在时提示无意义。

### a11y 语义探针结论（2026-10-01，emulator-5554 / TalkBack）

本轮一并执行了 a11y 语义探针（对标 ADR-0207 决策 5 的做法），**结论是「当前 SDK 下无法判定」**，
不是「不支持」也不是「支持」：

| 观测 | 结果 |
|---|---|
| `uiautomator dump`（TalkBack 开启前） | Lynx 内容 **0 节点**进树（仅 6 个 Android 原生容器） |
| TalkBack 开启 + 触摸探索 | ✅ **阳性对照成立**（标题「我的」获得绿色焦点框 ⇒ 通道本身通） |
| 触摸探索能否到达下方 4 个输入框 | ❌ **不能** —— 焦点停在标题，6 次连续探索不前进 |
| `dumpsys accessibility` | `io.pictelio.app` 在服务列表内，但渲染内容不进树 |

⇒ 与 [ADR-0061](./ADR-0061-android-emulator-e2e-gate.md) 已记录的事实一致：
**Lynx 4.0.1 的 accessibility 树只暴露表单元素，view/text 容器即使标注
`accessibility-element` + `accessibility-label` 也不暴露**；本轮进一步实测到
**本文件的 `<input>` 同样未进入无障碍树**。

**因此**：`accessibility-role` / `accessibility-state` / `accessibility-checked` 是否被引擎消费，
**在当前 SDK 上无法用真机探针判定**——底座（节点都不进树）不具备，写了也观测不到。
按「不静默放过」纪律，此项**显式挂账**而非记为已完成：

- **挂账内容**：13 处 `M3Switch` 行容器补 `accessibility-checked` 的实施票**不开**。
- **重开条件**：① Lynx SDK 升级后 `<input>` 能进 a11y 树；或 ② 改用真机人工 TalkBack 听测
  （当前环境无音频通道，agent 无法执行）；或 ③ 项目引入 `@lynx-js/types` 后由宿主侧
  直接查询 `AccessibilityNodeInfo` 的 role/state（绕开 JS 侧探针）。
- **不得**在此之前写入任何 `accessibility-*` 语义属性：它们无法被验证，
  且与 ADR-0207 决策 5 判定的「引擎不匹配」风险同族（写了可能静默无效果）。

### 引擎约束（真机取色实证）：disabled 状态层不得与底色写在同一元素

**这是本轮真机取色抓到的第三个缺陷，且是令牌化改法本身引入的。**

| 项 | 内容 |
|---|---|
| 现象 | BookmarkPanel 保存按钮 disabled 态实测底色 `(163,197,220)`；期望 `#e6e8ee`(`surface-container-high`) 叠 on-surface 12% = `(205,208,213)` ⇒ **12% alpha 层完全没生效** |
| 根因 | `bg-state-disabled-container` 与 `bg-surface-container-*` 都是 `background-color`。Tailwind 产物里 `bg-surface-container-high` 的声明**更靠后** ⇒ 同特异性按声明顺序决胜，后者整条覆盖前者 |
| 判定 | 属 **CSS 互斥属性**问题，与 `on-primary` 状态层的引擎约束同族（都是「叠加以表达状态」在本栈不可靠） |
| 修法 | disabled 层**必须独立成层**：底色留在原元素，加一个 `absolute inset-0` 的覆盖元素承载 `bg-state-disabled-container`，文字加 `relative` 浮回上层 |
| 波及 | `BookmarkPanel` 1 处 + `DownloadManager` 5 处，**全部**同构 ⇒ 6 处一起修 |

**证据（Tailwind 产物实跑，非推测）**：
```
$ npx tailwindcss -c tailwind.config.ts --content <probe>
.bg-state-disabled-container { background-color: var(--md-state-disabled-container) }   ← 靠前
.bg-surface-container-high   { background-color: var(--md-surface-container-high) }     ← 靠后 ⇒ 胜出
```

⚠️ **这类缺陷静态门禁与产物 grep 都抓不到**：类名在、令牌在、门禁全绿、构建通过，**只有取色看得见**。
故落结构契约门禁（`tests/md3FilledTextField.test.ts`「disabled 状态层必须独立成层」）：
断言 `bg-state-disabled-container` 所在元素的 class 里**不得再出现第二个 `bg-*`**，
并配阳性对照防止判据退化为恒真。

⚠️ 修法受既有门禁约束：覆盖层用 `absolute inset-0` 而非 `left-0 right-0 top-0 bottom-0` ——
后者违反 `BookmarkPanel.template.test.ts` 的 ADR-0123 定位纪律（禁止 `right-/bottom-` 反向锚点）。
本轮该门禁确实转红过一次，属门禁正常发挥作用。

### 第②层真机验证矩阵（emulator-5554 / Android 14 / Lynx SDK 4.0.1 / 1080×2160）

| 改造点 | 状态 | 观测 |
|---|---|---|
| `Me.vue` 命名模板框 | ✅ | 56dp + 顶 4dp 圆角 + 底部指示条；**无浮动 label**（按决策 6 刻意不做，上方已有常驻字段名） |
| `Me.vue` WebDAV 4 框 | ✅ | 空值：label 居中灰（`on-surface-variant`）；聚焦：label 浮顶转 primary `(26,111,168)`、指示条加粗转 primary、键盘弹出 |
| `Me.vue` label/placeholder 同框修复 | ✅ | 静止态与有值态均单行显示（两处真机缺陷的修复保持有效） |
| `SettingsEndpoint` 6 框 | ✅ | 有值字段 label 浮顶 + primary；空字段 label 居中灰；无重影；形态与 Me.vue 一致 |
| `pointer-events` / label 点击命中 | ✅ | 点在 label 上软键盘正常弹出、input 获焦 |
| `CommentInputBar` 1 框 | ✅ | 56dp 实测 161px；静止态逐位命中令牌（见下表）；聚焦态 label 浮顶转 primary `(26,111,168)` |
| `BookmarkPanel` 1 框 | ✅ | 56dp + 底 0 圆角 + 指示条；**不做 label 浮动**（决策 6）；该页 disabled 按钮取色见下 |
| **disabled 状态层** | ❌→✅ | **发现缺陷并修复并复验通过**：同元素双 `background-color` ⇒ 12% alpha 静默失效（详见上节）；`DownloadManager` 3 处 = `(228,228,229)`、`BookmarkPanel` 1 处 = `(206,208,214)`，均落在期望的 +1 渲染容差内（见「渲染容差」） |

#### disabled 修复的真机复验（`DownloadManager`，5 按钮同构）

测试态构造：两个任务均为「已完成」⇒ `availability.start/pause/stop` 为 false、`share/delete` 为 true
⇒ 天然出现 **3 disabled + 2 enabled** 的对照，**无需人为制造状态**。

| 按钮 | 期望（`ceil` 口径，见下） | 实测 | 判定 |
|---|---|---|---|
| 全部开始 | `(228,228,229)` | `(228,228,229)` | ✅ 逐位匹配 |
| 全部暂停 | `(228,228,229)` | `(228,228,229)` | ✅ 逐位匹配 |
| 全部停止 | `(228,228,229)` | `(228,228,229)` | ✅ 逐位匹配 |
| 分享（enabled 对照） | `#ffffff` 纯底，无覆盖层 | `(255,255,255)` | ✅ |
| 全部删除（enabled 对照） | `#ffffff` 纯底，无覆盖层 | `(255,255,255)` | ✅ |

期望值推导：`#ffffff`(`surface-container-lowest`) 叠 `on-surface 12%`：
`ceil(255×0.88 + 25×0.12) = 228`（逐通道同式）。`ceil` 而非 `round` 的依据见下方
「渲染容差」——该 +1 已被第二次独立验证确认为系统性取整，非取色噪声。

> ⚠️ **本表曾有一处错值已订正**：「分享」原记为 `(236,238,244)` 容器色透出，
> 2026-10-02 复测为 `(255,255,255)`，与「全部删除」一致 ⇒ 原值是把**工具条容器底色**
> 当成了按钮底色，正是同页下方「取色教训」第 2 条描述的那类误取。**同一页里
> 记录过一次教训、又踩一次**，故在此显式留痕。

**enabled 对照组是这次验证的关键**：它证明判别力——
若 alpha 层失效，两组会**同色**；实测 3 disabled 与 2 enabled 明显不同 ⇒ 覆盖层真的在起作用。

⚠️ 取色教训（本次踩到，值此记录）：
1. 截图给的是**显示坐标**（1000 宽），取色/点击要**原图像素坐标**（1080 宽），需 ×1.08；
2. 工具条容器的 `bg-surface-container`(#eceef4) 与按钮的 `lowest`(#ffffff) **只差一点点**，
   我最初取到的 `(248,250,255)` 其实是**容器底色**、既不是按钮也不是叠加结果——
   **若当时直接判定「修复失效」，就会误改已经正确的代码**。判据是：
   先用「逐通道反解底色」检查自洽性，反推出 >255 的底色即说明**取错了元素**，
   而非合成异常。

#### 渲染容差：实测系统性 `+1`（跨两次独立验证，勿当噪声放过）

两处 disabled 复验都出现**同方向、同幅度**的 +1：

| 底色 | alpha | 公式（`round`） | 公式（`ceil`） | 实测 |
|---|---|---|---|---|
| `#ffffff` `(255,255,255)` | 12% | `(227,228,228)` | `(228,228,229)` | `(228,228,229)` |
| `#e6e8ee` `(230,232,238)` | 12% | `(205,208,213)` | `(206,208,214)` | `(206,208,214)` |

**实测逐位等于 `ceil(base×0.88 + onSurface×0.12)`**。两次验证用的是不同底色、不同控件、
不同会话时点，偏移仍完全一致 ⇒ 这是 Skia 合成管线的系统性取整行为，**不是取色噪声**。

**判定纪律**：α 层「生效 vs 失效」的差是 **24/255 ≈ 9.4%**，而渲染容差是 **1/255 ≈ 0.4%**，
两者差 24 倍 ⇒ 该容差**不影响判别力**，但**不可**用「必须逐位等于 round 公式」写死断言。
`DownloadManager` 表中的「逐位匹配」应按此理解为「匹配 `ceil` 公式」。

#### `CommentInputBar` 静止态取色（令牌回源比对，1080×2160 / dpr=3）

沿 `x=432` 逐行扫描，`y=1500→1720`：

| 观测 | 实测 | 令牌 | 判定 |
|---|---|---|---|
| input 底色 | `(225,227,233)` | `--md-surface-container-highest` `#e1e3e9` | ✅ 逐位精确 |
| 底部指示条 | `(65,71,78)`，厚 **3 物理像素** | `--md-on-surface-variant` `#41474e` | ✅ 逐位精确（dpr=3 的 1px） |
| input 高度 | `y 1544→1704` = **161px** | 56dp ⇒ `1080×0.14935 = 161.3` | ✅ |
| 顶部圆角 | 左边界 `x 44`(y1544) → `x 35`(y1554) 后贴边，跨度 **10~11px** | 4dp ⇒ `4×0.2667×1080/100 = 11.5` | ✅ |
| 底部圆角 | `x 40/45/820/826` 一律延伸到 `y=1701` | 0dp | ✅ 底角为 0（若为 4dp，x=40 处应提前 ~4px 收口） |

聚焦态（键盘弹出后）：浮动 label 字色采样 `(26,111,168)` = `--md-primary` **逐位精确**；
input 底色**保持不变**（filled 语义正确——聚焦只改指示条，不改容器底色）。

⚠️ **诚实登记的不可观测项**：`CommentInputBar` 的**聚焦态指示条**在真机上**被软键盘完全遮挡**
（输入栏贴键盘上沿），全图扫描 primary 邻近像素只命中浮动的 label 文字、**零命中**指示条。
故「聚焦指示条转 primary」在**本控件**上未取到直接证据；该行为由 `Me.vue` WebDAV 4 框
（同源实现，已实测 `(26,111,168)`）+ 静态门禁承担。**这是控件布局特性，不是判据缺失。**

#### `BookmarkPanel` disabled 取色（构造方式与结果）

`canSave = detailStatus === 'ready' && !saving`。抢 `saving` 时间窗不可靠（adb 截图启动 ~600ms
已超出 API 往返），改用**确定性构造**：面板在 `onMounted` 拉取预填，`detailStatus` 非 ready 即
`canSave=false`。`adb shell svc wifi disable` + `svc data disable` 断网后重开面板：

| 按钮 | 期望（`round`） | 期望（`ceil`，见上） | 实测 | 判定 |
|---|---|---|---|---|
| 收藏（disabled） | `(205,208,213)` | `(206,208,214)` | `(206,208,214)` ×3 点 | ✅ |
| 作品标签 chip（enabled 对照） | 无覆盖层 | `#e6e8ee` `(230,232,238)` | `(230,232,238)` | ✅ |
| 添加按钮（enabled 对照） | 无覆盖层 | `#e6e8ee` `(230,232,238)` | `(230,232,238)` | ✅ |

**判别力**：disabled 与两个 enabled 对照差 24/24/24 ⇒ 覆盖层真的在起作用。
（同屏顺带验证了**禁静默降级**：`收藏状态获取失败：未知错误（为避免覆盖错误数据，保存已禁用）`
与 `标签库加载失败，仍可手动输入` 两条红色提示均正确渲染。）

⚠️ 附带订正：长按入口**与页数无关**。先前记的「多页作品点保存走 `showPicker` 而非
`BookmarkPanel`」是针对**单击心形**的分支；**长按心形 500ms 打开 `BookmarkPanel` 对单页/多页作品
一律成立**（实测在 9 页漫画上长按直接开面板）。此前把该限制套到长按路径上是错的。

**仍未覆盖项（显式挂账，非遗漏）**：
- a11y 语义属性：见下节（SDK 底座不具备，无法判定）。

### 取色的可达性边界（本轮实测，避免下轮重复盲试）

- ✅ **可定位**：FAB 菜单圆钮（按 `surface-container-highest ≈ (230,232,238)` 找圆心，稳）；
  Me 页 / SettingsEndpoint 区（滚动即可）；`IllustDetail` 操作行（**方法见下**）。
- ✅ **`IllustDetail` 操作行已可稳定进入**（本轮补齐，订正上轮「不可定位」的结论）：
  1. **先读截图、再点**。上轮失败的真因是写了**像素探针脚本**去自动找心形胶囊
     （`probe-bookmark*.py`），而当时进入的是 9 页漫画，**画面里大量深色线条**被判成心形
     ⇒ 连续 3 轮点空。**读截图用眼睛看**则一次命中：心形胶囊显示坐标 ≈(140,1194)，
     ×1.08 ⇒ 原图 (151,1290)，长按 `input swipe 103 1290 103 1290 900` 直接开面板。
  2. **长按入口与 `page_count` 无关**（订正上轮记反的约束）：`i.page_count > 1` 只影响
     **单击心形**走 `showPicker`；**长按 500ms 开 `BookmarkPanel` 对单页/多页一律成立**。
  3. 评论区由操作行评论按钮进入（显示 ≈(497,1194) ⇒ 原图 (537,1290)）。
- **根因（仍然成立）**：`uiautomator dump` 在 Lynx 上拿不到节点树（实测只出 6 个 Android 原生容器节点），
  且 Lynx 4.0.1 的 a11y 树只暴露表单元素（ADR-0061 已记录）⇒ **不能用 dump 定位**。
- ⚠️ **方法论教训（比结论更重要）**：**不要为「找控件」写像素探针脚本**——它要求对画面
  内容做假设，而 feed 每次加载的**图片内容不可预测**，假设必被打破。控件存在与否是
  **开放世界**问题，用**开放世界**工具（直接读图）回答；像素探针只适合在**已知静止**的画面上
  做**取色**这类封闭判定。**两者不可互换。**
- **纪律**：坐标盲试 5~6 轮不中就停手换方法。上轮据此改为产物级验证；本轮据此改为
  「停止写探针、直接读截图」，一次成功。**换方法 ≠ 降低证据强度。**

## 复核判据

本 ADR 自身的可执行判据：

1. **非豁免输入框形态合规**：全仓生产 `<input>`（除 `SearchSheet` 豁免）的**静态** `class` 必含
   56dp（`h-[14.933vw]`）+ `rounded-t-[var(--md-shape-extra-small)]` + `rounded-b-none`
   + 底部 `border-b-[1px]` `border-b-surface-on-variant`。由新增门禁 `tests/md3FilledTextField.test.ts`
   机器判定。
2. **门禁有判别力**，且**静态优先规则本身是判据的一部分**（不是实现细节）：
   - 上述 4 项形态**只认静态 `class`**，动态 `:class` 不参与补齐。理由：聚焦态才需要动态切换，
     未聚焦基线必须静态可判；且若允许动态补齐，同一 input 调一个**被共享**的合规函数即可
     替「静态缺形态」的违规 input 免检（该绕过形态已实测存在并被反事实用例锁死）。
   - 判据须有**反事实**（42dp 药丸 / 45dp 全描边 / 无指示条 / 底角非 0 四种形态逐项点名）
     与**抽取器自检**（扫描面非空 + 数量下界），防正则塌陷导致全称断言静默恒真。
   - 已知失效面（AGENTS.md 门禁冻结线第 5 条要求登记）：① 静态 class 只认双引号写法
     （`class='…'` 不被识别，仓内 0 处）；② 静态五项齐备但动态返回冲突类时，门禁不判红
     （Tailwind 同优先级类按样式表顺序全局决胜，实践中不可利用）。
3. **label 浮动真机生效**：至少一处输入框的 label 在聚焦时确实浮动（截图留档），
   且指示条在聚焦时由 1px 变 2px、颜色转 `primary`。
4. **豁免清单不扩张**：`SearchSheet` 药丸仍在、且门禁对它走**登记制**而非静默放行；
   登记项若不再命中真实违规必须转红（死登记判据）。
5. **i18n 双语同步**：新增 label key 在 zh-CN 与 en 同时存在（有测试钉住）。

## 参考

- 官方数值来源（本 ADR 决策 1 的回源依据，均为可逐字核对的原始文件）：
  - [`_md-comp-filled-text-field.scss`](https://github.com/material-components/material-web/blob/main/tokens/versions/v0_192/_md-comp-filled-text-field.scss)
  - [`_md-sys-shape.scss`](https://github.com/material-components/material-web/blob/main/tokens/versions/v0_192/_md-sys-shape.scss)
  - [`field/internal/_filled-field.scss`](https://github.com/material-components/material-web/blob/main/field/internal/_filled-field.scss)
  - AndroidX `TextFieldDefaults.kt`（56dp / 1dp / 2dp）
- Lynx 引擎能力（决策 2）：<https://lynxjs.org/3.6/api/elements/built-in/input>（Events 段）
- 上游 ADR：[ADR-0205](./ADR-0205-md3-baseline-and-scope.md)（基线与封闭清单、三层证据）
  · [ADR-0207](./ADR-0207-shape-and-state-layer-guardrails.md)（引擎边界与 `:focus` 实证）
  · [ADR-0179](./ADR-0179-app-lynx-m3-switch-component.md)（M3Switch 的 a11y 刻意设计）
- 事实底座：[`material-design-3-gap-analysis-2026-09.md`](../research/material-design-3-gap-analysis-2026-09.md)（§2 #8 text field）
- 本轮复核报告：[`md3-conformance-audit-2026-10-01.md`](../research/md3-conformance-audit-2026-10-01.md)
- 实施规格：[`md3-alignment-round2.md`](../specs/md3-alignment-round2.md)

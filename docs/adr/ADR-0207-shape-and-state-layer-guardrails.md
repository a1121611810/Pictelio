# ADR-0207：形状与状态层的护栏化 —— 把「碰巧正确」变成「写错即失败」

## 状态

accepted（2026-09-30）

## 背景

[ADR-0205](./ADR-0205-md3-baseline-and-scope.md) 立项后，两处**看起来合规、实际没有护栏**的地方
在复核中被挖出来。它们的共同特征是：**正确性依赖巧合，而不是依赖机制。**

### 一、shape scale：令牌是对的，但类名消费不到它

`tokens.css:127-132` 的 6 档形状**数值全对**（extra-small 4 / small 8 / medium 12 /
large 16 / extra-large 28 / full 9999，与官方 v0.192 `_md-sys-shape.scss` 逐条一致），
dp→vw 换算也正确（4dp=1.067vw … 28dp=7.467vw）。

但是：

- `tailwind.config.ts` **没有 `borderRadius` 键**（全量读过，确认无）
- `@lynx-js/tailwind-preset` **也不提供** —— 实测 preset 导出仅
  `boxShadow` / `zIndex` / `grid*` / `aspectRatio` / `perspective` / `transitionProperty`，
  `extend` 仅 `transitionDuration` / `transitionTimingFunction` / `grayscale`
- ⇒ `rounded-*` 落到 **Tailwind 3 默认的 rem 值**。构建产物实测：
  `rounded-md` = `0.375rem`（6px）、`rounded-3xl` = `1.5rem`（24px）——
  **两者都不在 M3 shape scale 上**，而 M3 的 28px `extra-large` **无法用任何类名表达**

项目之所以没出事，是因为**存量代码几乎不走默认类**，而是写 arbitrary utility：
`rounded-[var(--md-shape-*)]` 共 261 处（`--md-shape-full` 103 / `medium` 73 /
`extra-small` 52 / `small` 24 / `large` 5 / `extra-large` 4），
`rounded-lg/md/xl/2xl/3xl` 实测 **0 处**。
（⚠️ 本段数字原写「274 / medium 72」—— **分项和只有 260，自称 274 更不自洽**；
已按 `grep -rho "rounded-\[var(--md-shape-[a-z-]*)\]" src --include='*.vue' | sort | uniq -c`
实跑订正为 261 / medium 73。）

但这套写法**没有任何保护**：

- 写成 `rounded-[var(--md-shap-medium)]`（少个 e）→ **静默无圆角**，不报错、不警告
- 将来谁写 `rounded-lg` → 得到 6px，越界且与项目令牌体系脱节
- 残留 16 处方向类（`rounded-t` 13 / `rounded-b` 2 / `rounded-tr` 1）静默取 `0.25rem`
  （数值恰好 = M3 extra-small，**对得上但是靠巧合**）
- ~~残留 2 处硬编码 `rounded-[0.65vw]`~~ → **已清零**（`grep -rn 'rounded-\[0\.65vw\]' src`
  实测 **0 处**；本段原写「2 处，`TextSelectionToolbar.vue:63,66`」已过期）

### 二、state layer：只做了 pressed，且两套并存

官方 v0.192 [`_md-sys-state.scss`](https://github.com/material-components/material-web/blob/main/tokens/versions/v0_192/_md-sys-state.scss)
的四态 opacity 是 `hover 0.08` / `focus 0.12` / `pressed 0.12` / `dragged 0.16`，
另有 disabled 的 12% / 38%。

项目 `tokens.css:78-83` 只有 `pressed`（12%）与 `disabled`（12% / 38%）——
**hover / focus / dragged 三层 token 缺失**。后果是：
hover 态全仓 0 覆盖、focus-visible 0 覆盖（`focus-visible` 命中数为 0）。

同时 `tokens.css:73-83` **并存两套**表达：预计算实色（`--md-state-pressed-primary: #155b8a`）
与正确的 alpha 层（`--md-state-layer-pressed-primary: rgba(26,111,168,0.12)`）。
消费侧**多用实色**（`ActionButton.vue:31` 的 `active:bg-white/10`），
且实色是「容器色 + 12% 叠加」的**人工近似**（注释自述 `pressedOnSurface` 是「视觉近似」）。

### 三、越界缓动：全站默认 timing function 是 MD2 legacy

`tokens.css:163-166` 的四条曲线**与官方逐条一致**（含 `standard` 与 `emphasized` 同值
`(0.2,0,0,1)` 这一官方事实）。但构建产物实测显示：
**Tailwind `transition-*` 类的默认 timing function 来自 lynx preset，是
`cubic-bezier(0.4, 0, 0.2, 1)`** —— 在 v0.192 里这是 `easing-legacy`（MD2 遗留）。
也就是说，项目令牌是对的，但**全站默认消费路径拿到的是 MD2 曲线**。

另有 `GlassCard.vue:40` 的 `cubic-bezier(0.33, 0, 0.67, 1)`（Fluent 遗留值）。

## 引擎能力边界（真机实证）

状态层的整套设计建立在「alpha 层叠在容器色之上」这一**合成语义**上，而 Lynx 在三个关键点上不提供该语义。以下三条均为 `pictelio_ui`（API 34 / Lynx SDK 4.0.1）真机实测，且**每条都自带阳性对照**（否则「什么都没发生」无法区分「引擎不支持」与「没触发」）。详见 issue #867（塌陷）与 #868（hover-class）。

| # | 能力边界 | 实证观测 | 判读 |
|---|---|---|---|
| 1 | **`background-color` 是替换语义，不是合成语义** | Tailwind `bg-*` 直接替换元素 `background-color`，不与容器色合成。alpha 状态层用在**实心底色**（`bg-primary`）上时，底色被替换掉，按压观感 = 半透明层直接叠在**背后的页面色**上 | 实心按钮按压时「填色整个消失」⇒ #867 |
| 2 | **Lynx 不渲染 `color-mix()`** | `active:bg-[color-mix(in srgb, var(--md-primary) 12%, var(--md-on-primary))]` 按下后测得 `(248,250,255)`，恰等于探针容器 `bg-surface` 的白 | 该声明彻底失效、背景变透明 ⇒ 失败方式比原缺陷更隐蔽（表现为「按压无反馈」而非「颜色错」） |
| 3 | **Lynx 的 `hover-class` 不产生视觉切换** | 5 个色块在按住期间**全部零变化**，连写死不透明色的阳性对照都不变；而同一次长按确实触发了 `@tap`（对照块逐次 toggle），证明注入链路正常 | 与 `pointer-events` 同类问题：preset/引擎不保证，失败方式是**静默无反馈** ⇒ **只有 `active:` 变体可用**（详见 #868、决策 9） |

> 第 1 条是根本约束：MD3 状态层要生效，前提是引擎支持「把一层半透明色**盖**在已知底色上」。Lynx 给的是「**换掉**底色」。这个错配不是实现疏忽，是引擎能力边界；第 2、3 条是它的两个具体表现。

## 决策

### 决策 1：`borderRadius` 注册进 `tailwind.config.ts`，映射到形状令牌

新增 `borderRadius` 档位，全部指向 `--md-shape-*`：

```
xs   → var(--md-shape-extra-small)   DEFAULT → var(--md-shape-medium)
sm   → var(--md-shape-small)         lg      → var(--md-shape-large)
xl   → var(--md-shape-extra-large)  full    → var(--md-shape-full)
```

**意图不是减少 arbitrary 写法，而是让写错能失败**：
Tailwind 会对 `borderRadius` 的取值求值，一个不存在的 CSS 变量在构建期就暴露，
而不是渲染出一个没圆角的元素。

### 决策 2：存量 arbitrary 写法**不强制迁移**

261 处 `rounded-[var(--md-shape-*)]` **保持原样**（实测数，见上文背景章；原文写 274 有误）。理由：

- 它们**当前是正确的**，迁移属范围蔓延
- 强制迁移会让本轮 diff 膨胀到掩盖真正的行为变更
- 新增代码一律用 `rounded-{xs,sm,DEFAULT,lg,xl,full}`；旧写法在注释中标注为存量

**要清的是那 16 处非 token 消费**：14 处方向类改走对应档位，
`TextSelectionToolbar.vue:63,66` 的 `rounded-[0.65vw]` 改走 `--md-shape-extra-small`。

### 决策 3：形状随屏宽缩放是**有意取舍**，不改

`--md-shape-*` 用 vw 而非固定 px，意味着 12px 的圆角在 430px 宽屏上是 13.8px。
严格讲 MD3 的 shape scale 是固定 dp。

**保留现状**：与项目既有的「spacing/fontSize 随屏宽缩放」决策一致
（见 [`glossary-lynx-units.md`](./glossary-lynx-units.md)），且**比例关系不变**，
视觉层次一致。把它记为取舍而非缺陷，避免将来被反复当 bug 提。

### 决策 4：state layer 补齐四态 alpha token，alpha 层为正路

`tokens.css` 补 `--md-state-layer-hover-*`(0.08) / `--md-state-layer-focus-*`(0.12) /
`--md-state-layer-dragged-*`(0.16)，覆盖项目现有的 4 个语义色
（primary / on-surface / error / surface），并在 `tailwind.config.ts` 的
`extend.colors.state` 同步登记，使 `bg-layer-hover-*` 等 utility 可用。

**口径**：官方用 alpha 叠加层，**alpha 层是正路**；
预计算实色（`--md-state-pressed-*`）降级为「Lynx 不支持某伪类时的兜底」，
其注释里「视觉近似」的表述必须保留（不是精确合成，别误导后来者）。

> ⚠️ **本条已被决策 8 限定**：「alpha 层是正路」在 `on-primary` 档上**不可达**
> （引擎是替换语义，见「引擎能力边界」），该档改用预合成不透明色。
> 其余四档仍按本条走 alpha。

### 决策 5：`focus` / `focus-visible` 判定为引擎不适用；`hover` 在纯触屏判定为不适用

> **本条已按真机实证重写**（初稿判 `:focus-visible` 为「要修」，前置条件是「需真机验证
> Lynx 支持度」）。验证结果与初稿判断相反，故重写而非追加。

**实证方法**：在 `pictelio_ui`（API 34 / Lynx SDK 4.0.1）上注入一次性探针，三者同批对照：

| 探针 | Tailwind 变体 | 触发 | 观测 | 判读 |
|---|---|---|---|---|
| A | `focus:bg-error` | 点按 `<input>` | RGB 恒 `225,227,233` | 无变化 |
| B | `focus-visible:bg-primary` | 点按 `<input>` | RGB 恒 `225,227,233` | 无变化 |
| C | `active:bg-primary` | 长按带 `@tap` 的 `<view>` | `200,202,207` → **`23,98,149`**（= `--md-primary`），松开复原 | **生效** |

**C 是阳性对照**，它证明引擎**能**匹配伪类、且探针与采样方法有效——所以 A/B 的阴性是
**引擎不匹配**的结论，而不是「探针没触发」。

> ⚠️ 首版探针**假阴性**的教训：最初的 C 是个**没有 `@tap` 处理器**的 `<view>`，Lynx 不视其为
> 可交互元素，永不进入 `:active`，于是三个探针**全阴**——若就此收工，会得出「所有伪类都失效」
> 的错误结论。**判据必须自带阳性对照**，否则「什么都没发生」无法区分「不支持」与「没触发」。

**结论**：
1. `:focus` 与 `:focus-visible` **不写**。写出来只是死类名、**静默无样式**，
   与本 ADR 决策 4 记录的 `bg-state-layer-*` 同类陷阱。
2. 附加的独立理由：`:focus-visible` 的语义是「焦点由**键盘 / D-pad** 抵达」，
   本应用纯触屏（Lynx 连 `cursor` 都不支持），**无触发源**——即便引擎支持也永不命中。
3. **无障碍关键路径不受影响**：改由 `accessibility-element` 标注 +
   TalkBack 平台焦点环承担。焦点环是平台画的，不需要 CSS 伪类。
4. `hover`：本项目**纯触屏**，无 hover 语义 ⇒ 「不适用」
   （已由 [ADR-0205](./ADR-0205-md3-baseline-and-scope.md) 决策 4 豁免）。
   **但 token 仍保留** —— 未来若支持外接鼠标/键盘外设，token 已在位。
   > ⚠️ 补一条独立于「无 hover 语义」的结论：`hover-class` **属性本身**在 Lynx 上
   > 不产生视觉切换（决策 9 / #868），即便将来接了外设也不能靠它。

> AGENTS.md 的「禁裸 `:focus`（须 `:focus-visible`）」一条据此改为「禁写这两类变体」，
> 并在「有意偏离 MD3」封闭清单新增第 5 条留痕（该清单要求留痕以免每次 review 被当成新 bug 重提）。

### 决策 6：全站默认缓动改为 M3 emphasized

把 Tailwind `transition-*` 的默认 timing function 从 preset 给的 MD2 legacy
`(0.4,0,0.2,1)` 改为项目令牌 `var(--motion-emphasized)`；
`GlassCard.vue:40` 的 Fluent 值改用 `var(--motion-emphasized-decelerate)`。

**注意 `standard` 与 `emphasized` 在 v0.192 同为 `(0.2,0,0,1)`**，
本决策不改变「standard 用什么」的既有取值（它本就正确），
改的是**实际生效的全站默认值**（此前是 MD2 legacy）。

### 决策 7：elevation 补 0/4/5，并以 surface tint 为主表达

`tokens.css` 现有 `--md-elevation-1/2/3` 是 Android 简化版 box-shadow；
`--md-surface-tint` 已定义但**全仓零引用**。

决策：补 `--md-elevation-0/4/5`；并规定**层级表达以 surface-container 色调为主、
box-shadow 为辅**——这是 MD3 elevation 的本意（`surface-container-low…highest` 五档已在位），
纯 box-shadow 叠加是 MD2 的做法。

**已知引擎约束**（需真机确认，记此备查）：Lynx 对多层 `box-shadow` 的支持度未知；
若不生效，则层级完全由 surface 色调承担，本决策的「辅」部分自然失效，不影响「主」。

### 决策 8：`on-primary` 档状态层改「预合成不透明色」，其余 4 档保持 alpha（#867）

**背景**：MD3 状态层靠 alpha 叠加生效，要生效就需要「叠加」语义 —— 而 Lynx 是「替换」语义
（见「引擎能力边界」第 1 条）。三个方案里 `color-mix()` 已被真机否证（渲染为全透明），
伪元素（`::after` 叠层）在本仓未验证，最终选择**把 `on-primary` 档的令牌预合成为不透明色**。

**为什么只改 `on-primary` 一档**（由机器判据圈定，不凭感觉）：判据脚本
`packages/app-lynx/scripts/state-layer-collapse-audit.mjs` 对 14 色板 × 4 态 × 5 role
共 **280 条**（14 色板 × 5 role × 4 态）计算「替换后观感 vs 元素原底色」的 CIELAB ΔE76：

> ⚠️ 早先版本报 256 条 —— 6 个亮色板（violet/pink/green/orange/teal/bili）不声明
> `--md-error`，运行时由 `page,` 基础块**继承**，而脚本既不解析基础块也不做继承、
> `continue` 又无 warn ⇒ **24 行被静默丢弃**（违反测试硬约束 #3「禁静默降级」）。
> 已修：脚本现解析 `page,` 基础块并按 CSS 继承拼接，跳过项计数上报 + 条目数自检（280/280 ✓）。
> 结论本身经补算仍成立（**那 24 行** 的 ΔE 区间为 **[6.45, 13.42]**，全 < 25，0 条会塌），
> 但证据面曾被缩小 —— 这就是为什么必须补而不是「反正结论没变就算了」。
> ⚠️ 别把 13.42 写成 15.23：15.23 是 **error 档全 56 行**（含 7 套暗色板）的 max，
> 与「被跳过的 24 行」不是同一个集合 —— 早先版本就是混用了这两个数。

- **修复前**（口径：把 56 条 `on-primary` 按各自色板的 `--md-on-primary` 还原成 `rgba(on-primary, α)` 后实跑）：
  塌陷侧 56 条 ΔE ∈ [62.79, 83.39]；不塌侧 **224** 条 ΔE ∈ [4.84, 16.81]
- 两簇之间是 **45.98 宽的数据空档**（16.81 … 62.79），阈值取 **25** 落在空档内
  （空档中点 39.80，25 距下沿 8.19、距上沿 37.79 —— 早先写「稳居正中」不准确，已订正）
  —— 阈值在 [16.82, 62.78] 内任意取值，结论都不变
- **56 条塌陷条目全部是 `-on-primary` 档**（实心 primary 按钮）；其余 `primary` /
  `on-surface` / `error` / `surface` 四档画在 `surface` 底上，ΔE 最大仅 16.81，
  按压仍有可见反馈
- **修复后重跑判据：0 条会塌**，ΔE 上限 16.81，全表下界 4.31

> ⚠️ 两条易混数字，引用时务必分清口径：
> · 「修复前的 **200** 条」是**旧错数**（56+200=256，正是本节上方刚修掉的那个数）；
>   正确的修复前分布是 56 + **224** = 280。
> · 「修复前不塌侧下界 4.84」与「修复后全表下界 4.31」**不是同一个集合**，不可互换。

**阈值不是拍脑袋定的**，由**两个互相独立的量化**夹逼 —— 真机测「按下去颜色变没变」，
模型测「替换前后差多远」。二者量纲不同，**数值接近不构成互证**，各管各的：

| 锚点 | 令牌 | 设备观测（emulator-5556，1080×2160 的 RGB 取样） | 模型推算（CIELAB ΔE76） | 塌？ |
|---|---|---|---|---|
| 1 | `on-primary/pressed` | 静止 `(26,111,168)` = `--md-primary` → 按住 **`(249,251,255)`**（≈ 页面色，填色消失） | ΔE **64.33** | 塌 |
| 2 | `primary/pressed` | FAB 按压前后**逐位相同** | ΔE **8.13** | 不塌 |

两列各自**独立可复算**（不是互相印证）：
- 设备列的塌陷值 `(249,251,255)` = sRGB 直混 `composite(#ffffff, 0.12, #f8faff)`，**逐位命中**；
- 模型列的 ΔE 由脚本从同一组底色独立算出。

> ⚠️ **本表原先的「设备观测」列写的是 HSV 饱和度（`sat 64.22 → 0.00`），已整列删除。**
> 两个原因：
> ① **量纲错配**：HSV 饱和度 ×100 与 CIELAB ΔE76 是不同单位，早先版本把
>    「sat 64.22」与「ΔE 64.33」并排称作「独立吻合」，那是**数字巧合**，不构成证据
>    —— 而 64.22 / 64.33 过于接近，反过来强烈提示当初是把**模型的 ΔE 误记成了设备 sat**，
>    那样「两种独立量化」就成了循环论证。
> ② **数值本身不成立**：`#1a6fa8` 的 HSV 饱和度是 **84.52**，不是 64.22；
>    `(249,251,255)` 的饱和度是 **2.35**，不是 0.00。两条都对不上任何实测色。
>
> ⇒ 教训不只在这张表：**引用设备观测时优先用 RGB 三元组**（可直接复算、可逐位比对），
> 派生量（sat / ΔE）要么给出可复算公式，要么别写。

脚本的 `--verify` 子命令用**合成样本**证明判据有分离能力（门禁 C2 消费）；
门禁 **C5** 另消费 `--json` 对**当前 tokens** 实跑，钉住「280 条 / 0 条会塌」这个事实
—— C2 验判别力（对任何令牌改动恒绿）、C5 钉现状（引入塌陷即转红），**两者分工不同，缺一不可**。

**与 MD3 原始表述的关系**（不要含糊）：MD3 官方**不用**预计算实色，一律 alpha 叠加。
本决策**是引擎能力边界导致的偏离，不是对 MD3 的重新解读** —— alpha 叠加在 Lynx 上
原理上不可达。修法在**视觉效果上与 MD3 叠加等价**（容器色已知且固定），但**表达形式**
从 alpha 变成了不透明值。代价：`on-primary` 档的令牌值**隐含假设了底色是 `--md-primary`**，
若把它用在别的底色上会得到错误的颜色（故有决策 8 的消费约束）。

**范围是封闭的**：不在「`on-primary` 档」内的状态层**一律保持 alpha**，不要扩大化。
门禁 `stateLayerOnPrimary.test.ts` 的 C1 钉住「其余 4 档必须**终点 alpha < 1**」
（跟引用解终点，不看字面形态 —— `surface` 档 56 条本就是 `var()` 别名）。

### 决策 8 的消费约束（硬规则）

`on-primary` 档是预合成不透明色，**只能画在 `bg-primary` 底上**。令牌名不携带底色信息，
唯一的保证点是消费点。机器门禁：`packages/app-lynx/tests/stateLayerOnPrimary.test.ts` 的
**C3** 逐标签扫真实 `src/**/*.vue` —— 凡是元素写了 `bg-layer-*-on-primary`，
同一元素必须带精确的 `bg-primary` 底色，否则判红。

> ⚠️ C3 按**元素**扫描，有三个结构性盲区 —— 不是"收窄扫描面"能补的，
> **只能从构造侧堵**（门禁 **C6**）：
> · **`.ts` 全文**：类名在脚本里拼好、模板只写 `:class="cls"`，元素上没有字面类名
> · **`.vue` 自己的 `<script>` 块**：`.vue` 既能藏字面类名（模板）又能藏拼接类名
>   （script），**是 C3 与 C6 v1 的共同盲区** —— v1 只扫 `*.ts`，宣称"堵住缺口"属夸大
> · **PascalCase 组件标签**：生产模板里 99 种（`AppIcon` / `GlobalFab` …），
>   Vue 里组件根节点透传 class 是常规写法
> C3 的标签正则已相应放宽为「`[A-Za-z]` + 引号感知的属性串」，覆盖后两项。
>
> ⚠️ C6 **不再声称覆盖**的边界：`['bg','layer','pressed','on','primary'].join('-')`
> 这类彻底拆散字面量的写法两条门禁都挡不住。静态门禁的固有边界，如实登记不假装堵上。

### 决策 9：禁用 `hover-class`，pressed 态一律走 `active:` 变体（#868）

`hover-class` 应与 `pointer-events` 同类处理：**preset/引擎不保证，失败方式是静默无反馈，
比不写更危险**（真机 5 色块按住全零变化，连阳性对照都不变，见「引擎能力边界」第 3 条）。
改用 Tailwind `active:` 变体后**全部按预期变色**。

**规则**：**禁写 `hover-class`，交互反馈一律用 `active:` 变体。**

**曾存在的存量死类名已清理**：`src/components/TranslateButton.vue` 原先写
`hover-class="bg-layer-hovered-on-primary"` —— `tailwind.config.ts` 只注册了
`layer-hover-` 系列，**无 `hovered` 变体** ⇒ 产物零规则，叠加 `hover-class` 本身无效，
双重失效。已改走 `active:bg-layer-pressed-on-primary`；门禁 **C4** 的拦截面是
**「`.vue` 内不得出现 `hover-class` 绑定本身」**（不限值、不限类名）+ 追加
`bg-layer-hovered-*` 死拼写检查。收窄到「绑定」是必要的：只查状态层类名的旧口径
可被 `hover-class="bg-error"` 绕过，而该属性在 Lynx 上同样不产生视觉切换，仍是死路径。

**disabled 态不给按压反馈**：状态层类名挂在 `:class` 三元的**非 disabled 分支**，
`disabled ? 'opacity-50' : 'active:…'`。这是刻意的：禁用态叠加交互反馈会暗示「可以点」。

> 真机取证（emulator-5556，1080×2160，`SettingsEndpoint` 保存按钮，长按 3s 后取像素）：
> · **enabled**（`formValid` 成立）→ 静止 `(26,111,168)` = `--md-primary`，
>   按住 `(53,128,178)` = **`#3580b2`**，与 `tokens.css` 的预合成值**逐位精确命中**
>   （修复前同一按钮按住是 `(249,251,255)` 近白）
> · **disabled**（表单未填）→ 静止与按住**逐位相同** ⇒ 不叠加按压反馈
>
> ⚠️ disabled 的**行为**结论（无按压反馈）成立且不依赖取样点；
> 但早先记录的**绝对像素 `(137,168,189)` 不可信，已撤** ——
> 复算显示 `#1a6fa8` 以 `opacity-50` 叠在**任何**中性浅底上
> （`#f8faff` / `#f2f4fa` / 纯白）都算不出该值，sRGB 直混得 G≈178~183、
> 线性光合成得 G≈193~200，而记录值 G=168，两条路径都对不上
> ⇒ 判定为**取样点未落在按钮填色区**（本轮已知的取样风险，见下）。
> 重采时须先确认取样点，再记录数值。

## 后果

- 形状与状态层从「靠约定」变成「靠机制」：写错 token 名会在构建期或渲染期暴露
- 新增代码有明确的形状档位可选，不再需要「记 vw 换算值」
- 全站默认缓动从 MD2 曲线切到 M3 emphasized ⇒ **所有 `transition-*` 类的动效观感会变**
  （缓动形状变了，位移类动效的收尾手感会不同）。与 ADR-0206 的行高变更**叠加**在同一批
  ⇒ 两者**必须分批落地、分批回归**，否则无法归因是哪一个引起的
- elevation 的层级感从「阴影」转向「色调」⇒ 观感更接近 MD3，但在无 box-shadow 渲染的
  设备上会**明显变平**（这是 MD3 的预期形态，不是退化）
- **`on-primary` 档的按压反馈从「无反馈」变为「可见变化」**（决策 8）：此前实心 primary
  按钮按压时 alpha 层替换掉底色、看起来像按钮消失；现在是预合成色的正常明度变化。
  **属可见视觉变化，需进截图回归**（#867）
- **`on-primary` 档的令牌不再透明** ⇒ 不能再叠加在非 `primary` 底色上（决策 8 消费约束）。
  写错时颜色是「错」而不是「没」，门禁 C3 负责抓住
- 决策 9 使 `hover-class` 成为**死路径** ⇒ 任何 `hover-class` 里的状态层类名
  按压无反馈且不报错。存量误用已清理（`TranslateButton.vue`），门禁 C4 守住不再复发

## 复核判据

1. **形状护栏**：`tailwind.config.ts` 必须有 `borderRadius`，且 6 档全部指向
   `--md-shape-*`；任一档指向字面量（如 `4px`）即判红。
2. **无隐藏 rem 圆角**：`src/**/*.vue` 中不得出现**不引用 `--md-shape-*`** 的
   `rounded-[<数字>]` 形式；方向类 `rounded-t*` 不得再单独出现（须带尺寸或档位）。
   判红条件要能抓住「换了写法但没接 token」——例如 `rounded-t-lg` 这类
   **看似走了档位、实则拿到 Tailwind 默认 rem** 的形态。
3. **状态层四态齐备**：`tokens.css` 必须同时定义 hover(0.08) / focus(0.12) /
   pressed(0.12) / dragged(0.16) 四态 × 对应语义色；缺任一即判红。
   **opacity 值要逐一核对，不得只判「有没有这个 token」**。
4. **无 MD2 legacy 缓动**：`src/**` 与 `tailwind.config.ts` 中不得出现
   `cubic-bezier(0.4, 0, 0.2, 1)`；`tokens.css` 允许存在但**须有注释标明是 legacy**。
5. **elevation 五档齐备**：`--md-elevation-0..5` 全部定义，且至少一处消费
   `--md-surface-tint`（否则该 token 是死代码，应删而非留着）。
6. **状态层无塌陷**：`node scripts/state-layer-collapse-audit.mjs` 对全量 280 条计算
   「替换后观感 vs 元素原底色」的 ΔE76，**判为「按压时填色消失」的条目必须为 0**。
   `--verify` 子命令须自证两个真机锚点仍分居阈值两侧。
7. **`on-primary` 档的范围封闭性**：`--md-state-layer-{hover,focus,pressed,dragged}-on-primary`
   在 14 套色板里均为**6 位不透明 hex**（不得回退成 `rgba`）；同时其余四档
   （`primary` / `on-surface` / `error` / `surface`）必须**仍是 alpha 形态**，
   有人「顺手把状态层都改成不透明色」时判红。
   ⚠️ 这里说的是「**终点 alpha < 1**」，**不是**「字面长得像 `rgba(...)`」：
   `surface` 档的 56 条字面全是 `var(--md-state-layer-*-primary)` 别名，终点才是
   rgba。门禁 C1 的判据已迭代到 v3（跟引用解终点），本条文字同步到 v3 口径 ——
   早先这里写「必须是 `rgba(...)` 形态」，那是 C1 v1 的旧口径，**照字面执行会误伤
   56 条合法别名**。
8. **on-primary 消费约束**：`src/**/*.vue` 中凡元素写了 `bg-layer-*-on-primary`，
   同一元素必须带 `bg-primary` 底色（预合成值隐含假设了底色）。
   该扫描有结构性盲区（`.ts` 全文、`.vue` 的 `<script>` 块里拼出来的类名，
   以及 PascalCase 组件标签）⇒ 由**判据 C6** 从构造侧堵，详见决策 8 的消费约束节。
9. **无死 `hover-class`**：`src/**/*.vue` 不得出现 `hover-class` 绑定；交互反馈走 `active:` 变体。

## 参考

- 决策来源：[`ADR-0205`](./ADR-0205-md3-baseline-and-scope.md) 决策 3、决策 6
- 差距条目：[差距分析 §2 #7 / #13 / #19、§3.3、§3.4、§3.5](../../research/material-design-3-gap-analysis-2026-09.md)
- 术语文档：[`glossary-md3-alignment.md`](./glossary-md3-alignment.md)
- 引擎能力边界的原始记录：[issue #867](https://github.com/a1121611810/Pictelio/issues/867)（`bg-*` 替换语义导致的实心按钮塌陷）、[issue #868](https://github.com/a1121611810/Pictelio/issues/868)（`hover-class` 静默无反馈）
- 状态层塌陷判据脚本：`packages/app-lynx/scripts/state-layer-collapse-audit.mjs`（子命令 `--json` / `--verify`）
- 状态层 on-primary 门禁：`packages/app-lynx/tests/stateLayerOnPrimary.test.ts`（C1 范围封闭 / C2 阈值自证 / C3 消费约束）
- 排版相关（**必须分批落地**）：[`ADR-0206`](./ADR-0206-typography-type-scale.md)
- 官方数值来源：
  [`_md-sys-shape.scss`](https://github.com/material-components/material-web/blob/main/tokens/versions/v0_192/_md-sys-shape.scss)、
  [`_md-sys-state.scss`](https://github.com/material-components/material-web/blob/main/tokens/versions/v0_192/_md-sys-state.scss)、
  [`_md-sys-motion.scss`](https://github.com/material-components/material-web/blob/main/tokens/versions/v0_192/_md-sys-motion.scss)

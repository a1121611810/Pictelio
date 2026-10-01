# ADR-0211：界面连续性契约 —— 让每一次可见状态变化都在时间维度上被表达

## 状态

accepted（2026-10-01）· 依赖 ADR-0210（Lynx 样式栈能力边界，与本 ADR 并行产出）
· **落地耦合 ADR-0212**（决策 6 改主 FAB 按压反馈 ⇒ 状态层处数变动；
耦合细节与免疫方式见决策 2 表注与复核判据 2）

## 背景

[ADR-0205](./ADR-0205-md3-baseline-and-scope.md) 立项、[ADR-0206](./ADR-0206-typography-type-scale.md) 与
[ADR-0207](./ADR-0207-shape-and-state-layer-guardrails.md) 落地之后，令牌层已高度合规。
但复核发现一个**结构性的断裂**：合规的是令牌，**空的是消费**。

### 一、令牌层：20/20 齐备，不再是问题

实跑复算（`packages/app-lynx` 下执行）：

```
# 6 档时长 / 4 条缓动
grep -nE '\-\-duration[A-Za-z0-9]*:[[:space:]]*[0-9]+ms' src/styles/tokens.css      # 6 条
grep -nE '\-\-motion-[a-z-]+:' src/styles/tokens.css                               # 4 条
```

排版 15 档四元组、6 档 shape、20 条 state layer 已在 ADR-0206 / ADR-0207 落地并有门禁钉住。
**本 ADR 不重复令牌工作，只处理消费层。**

### 二、消费层：76 个组件里 6 个有动效

```
find src -name '*.vue' | wc -l                                    # 76
grep -rl '@keyframes' src --include='*.vue' | wc -l              # 4
grep -rlE 'transition-(colors|all|transform|opacity|shadow|none)|transition:[[:space:]]|transitionStyle' \
  src --include='*.vue' | wc -l                                  # 3
```

两份清单取并集 = **6 个组件**（`App.vue` / `BookmarkButton.vue` / `GlassCard.vue` /
`GlobalFab.vue` / `M3Switch.vue` / `RefreshableList.vue`），即 **70/76 组件零动效**。

> ⚠️ **复算口径警告**：直接 `grep -rl 'transition' src --include='*.vue'` 会得 **5**，
> 比正确值多 2 —— `ActionButton.vue` 与 `RefreshableList.vue` 的命中是**中文注释里提到
> transition 这个词**，不是消费。`6` 是「真实消费」口径（上面那条带 `transition-*` 工具类
> 或 `transition:` 声明的正则）。本项目已有同类教训（ADR-0207 背景章的 274/261 之误）。

7 个弹层组件**全部零入场动画**（`@keyframes` 与 `transition` 命中行数均为 0）：

```
for f in BottomSheet SearchSheet SeriesSheet CommentOverlay BookmarkPanel \
         PagePickerSheet WatchlistPromptDialog; do
  printf "%s %s\n" "$f" "$(grep -cE '@keyframes|transition' "src/components/$f.vue")"
done
```

### 三、核心机理：MD3 的按压感是**时间**，不是颜色

MD3 的按压反馈 = **12% alpha 状态层在约 100–150ms 内淡入**。本项目颜色是对的，**但时间是 0ms**。
人眼对 0ms 变化的知觉是「闪」，对 150ms 的知觉是「响应」—— 两者不是强弱之别，是**性质之别**。

实测证据（`active:` CSS 变体形态分布，**66 处 / 33 文件**）：

```
grep -rhoE 'active:[a-zA-Z0-9_.#/%-]+' src --include='*.vue' \
  | sort | uniq -c | sort -rn                                       # 形态分布，合计 66 处
grep -rlE 'active:[a-zA-Z0-9_.#/%-]+' src --include='*.vue' | wc -l   # 33 文件（窄口径）
```

| 形态 | 出现次数 | 属状态层？ |
| --- | --- | --- |
| `active:bg-state-pressed-*` | 24 | 是（**预计算实色兜底路径**，20 文件） |
| `active:bg-layer-pressed-*` | 27 | 是（alpha 正路） |
| `active:opacity-*` | 7 | 是 |
| `active:shadow-[var(--md-elevation-1)]` | 5 | 是 |
| `active:w-[7.467vw]` / `active:h-[7.467vw]` | 2 | 否（尺寸变化） |
| `active:bg-white/10` | 1 | 形似但**非令牌字面量** |

**这 63 个状态层点，0 处挂过渡。**

> ⚠️ **复算口径警告（处数与文件数是两个不同的陷阱，别混用）**：
>
> **陷阱一 · 处数**：`grep -rhoE 'active:' src --include='*.vue' | wc -l` 会得 **79**，
> 比正确值多 13 —— 多出来的是 `SearchSheet.vue`（+6）/ `BookmarkPanel.vue`（+4）/
> `ActionButton.vue`（+1）/ `NovelIntro.vue`（+1）/ `DownloadManager.vue`（+1）里
> **以 `active` 为名的 TS 标识符与对象键**（`(active: boolean) =>`、`active: summary.active`）。
> `66` 是 CSS 变体口径。
>
> **陷阱二 · 文件数（更隐蔽）**：上列 5 个「污染」文件里**只有 `DownloadManager.vue`**
> 窄口径零命中（它整份文件只出现 1 次 `active:`，就是那个对象键）。另 4 个文件**同时**含真
> CSS 变体（窄口径 2 / 1 / 2 / 1 处），宽窄口径都会命中 ⇒ **不改变文件数**。
> 于是宽口径得 **34 文件**、窄口径得 **33 文件**，差的那 1 个就是 `DownloadManager.vue`。
> ⇒ **文件数不能用宽口径数**：它比处数更敏感，一个纯 TS 命中就能凭空多出一个「组件」。
> 引用本 ADR 数字时必须带口径，且**处数与文件数分别标注**。

`--md-elevation-0/4/5` 同样零消费（`grep -rho 'md-elevation-N' src --include='*.vue' | wc -l`
→ 0/0/0，而 `-1` 53、`-3` 10、`-2` 5）—— 这不是本 ADR 的整改面，仅记录现状。

### 四、既有机制已就位，本 ADR 不重建

| 已有资产 | 位置 | 本 ADR 的关系 |
| --- | --- | --- |
| `useReducedMotion`（唯一偏好事实源，R1/R2/R3 三条降级规则） | `src/composables/useReducedMotion.ts` | **接入对象**（决策 9），不重写 |
| 6 个消费方 | `App.vue` / `BookmarkButton.vue` / `GlassCard.vue` / `GlobalFab.vue` / `M3Switch.vue` / `RefreshableList.vue` | 口径归一（决策 1） |
| `RefreshableList` 的 `item-rise` + 0/60/120ms stagger | `src/components/RefreshableList.vue` | 收口进 `motion.ts`（决策 5） |
| `BottomSheet`（scrim + `bottom-0` 面板 + 标题栏 + ×） | `src/components/BottomSheet.vue` | 演进为 `SheetShell`（决策 4） |
| `router.ts` 24 条路由 | `src/router.ts` | 补转场（决策 6） |

---

## 前置依赖：Lynx 样式栈能力边界（ADR-0210 结论）

以下结论本 ADR **全盘遵守**。「已验证」= 产物实测；「待真机」= 需在
`pictelio_ui`（API 34 / Lynx SDK 4.0.1）上取证。

| 能力 | 状态 | 复算命令 / 依据 |
| --- | --- | --- |
| `transition-colors` + `duration-[var(--durationX)]` + `ease-[var(--motionX)]` | **已验证** | `grep -aoc 'transition-colors' dist/main.lynx.bundle` → 3 |
| inline `:style` 绑定 | **已验证** | `GlassCard.vue` / `GlobalFab.vue` 的 `cardStyle` / `transition:` 走的就是它 |
| `<style>` 块内 `@keyframes` + `animation` | **已验证（产物在）** | 见下方注 |
| `transform-*` / `scale-*` / `translate-*` / `rotate-*` 工具类 | **❌ 死类名** | **依据是 ADR-0210 路径 E 的 JIT 实测**，不是产物 0 条：用项目真实 config 跑一次，`.rotate-45` 等候选类**确实产出规则**，但规则引用的 9 个 `--tw-*` 变量**从未被定义** ⇒ 计算值阶段非法 ⇒ 渲染 `transform: none`。⚠️ `grep -ao 'scale-\[\|translate-x\|translate-y\|rotate-\[' dist/main.lynx.bundle \| wc -l` → 0 **不是本条的依据**（产物 0 条只说明源码里没人这么写，无法区分「无人使用」与「引擎不支持」—— 同下两行的 `@keyframes` 假阴性形态）。机制与两种正确写法见决策 7 |
| `hover-class` 属性 | **❌ 静默失效** | ADR-0207 决策 9 / #868；`grep -aoc 'hover-class' dist/main.lynx.bundle` → 0 |
| `background-color` 是**替换**语义非合成语义 | **⚠️ 引擎边界** | ADR-0207 决策 8 / #867 |
| `transition-opacity` / `transition-shadow` / `transition-transform` / `transition-all` 工具类 | **未验证** | `grep -ao 'transition-opacity\|transition-shadow\|transition-transform\|transition-all' dist/main.lynx.bundle \| wc -l` → 0 |

> **`@keyframes` 的验证口径说明**：`grep -ao '@keyframes' dist/main.lynx.bundle | wc -l`
> 返回 **0**，但这**不是**「不支持」—— 压缩器去掉了 `@keyframes` 前缀，只留名称与体。
> 按名字查证，源码里 10 个 keyframes 名（`item-rise` / `scrim-in` / `fab-spin` /
> `fab-ring-in` / `fab-ring-spin` / `bookmark-pop-add` / `bookmark-pop-remove` /
> `bookmark-ring-in` / `bookmark-ring-out` / `shimmer`）**全部命中产物**
> （`grep -ao 'item-rise' dist/main.lynx.bundle | wc -l` → 4）。
> ⚠️ 这是本项目「假阴性」的标准形态：**判据必须自带阳性对照**，
> 否则「什么都没搜到」无法区分「不支持」与「搜错了」。
>
> 产物实证片段（`item-rise` 体）证明 **`transform` 在 `@keyframes` 内可用**：
> `translateY(12px) scale(.92)`。这与「`scale-*` 工具类是死类名」**不矛盾** ——
> 死的是**工具类**，活的是**手写 CSS 声明**。决策 7 全靠这条区分。

---

## 决策

### 决策 1：新增 `composables/motion.ts` 为动效唯一入口，导出四类预设

所有动效时长与曲线从该模块取，**组件内禁止出现时长/曲线字面量**。

```
src/composables/motion.ts
├─ 预设一：入场 ENTER       —— 弹层 / 列表项 / 页面首次出现
├─ 预设二：退场 EXIT        —— 弹层 / 列表项消失
├─ 预设三：按压 PRESS       —— active: 状态层的过渡
└─ 预设四：错峰 STAGGER     —— 列表项逐项延迟
```

**两个必须遵守的实现约束**（都是会静默失效的坑）：

1. **类名必须以字面量出现在 `motion.ts` 里**，不能运行时拼接。
   `tailwind.config.ts` 的 `content: ['./src/**/*.{vue,js,ts}']` **包含 `.ts`**，
   字面量能被扫到；但 `` `bg-layer-pressed-${role}` `` 拼出来的名字扫不到 ⇒ **产物零规则、渲染零反馈**。
2. **导出值要区分「工具类串」与「inline style 值」两种形态**，因为可过渡的属性不同（决策 2）。

**`on-primary` 档类名不搬进 `motion.ts`**，保持字面量留在 `.vue` 元素上 ——
理由见决策 8 的门禁交互。

### 决策 2：状态层过渡化 —— 逐形态档位映射表

**先看引擎实际过渡哪些属性**（产物实测，`.transition-colors` 与 `.transition` 各自的
`transition-property` 字面量）：

| 类 | 覆盖属性 | 判定 |
| --- | --- | --- |
| `.transition-colors` | `background-color, border-color, color`（3 条） | **已验证** |
| `.transition`（裸） | `background-color, opacity, transform, border-color, color`（5 条） | 规则在产物中 |
| 二者**均不含** `box-shadow` | — | **阴影过渡无可用工具类** |
| `transition-opacity` / `transition-shadow` / `transition-transform` / `transition-all` | — | 产物 0 条，**未验证 ⇒ 不押注** |

复算：`python3 -c "d=open('dist/main.lynx.bundle','rb').read().decode('utf8','replace');
i=d.find('background-color,border-color,color'); print(repr(d[i-200:i+80]))"`

由此得到映射表。**时长档的依据**：`--durationFast: 150ms` 是全项目最短时长档，
且**与 Tailwind `transition-colors` 的内置默认 `.15s` 同值**（产物实测）——
选它既符合 M3 短反馈量级，又不引入「动效专用时长」这个新概念。

| 形态 | 处数 | 过渡载体 | 时长 | 曲线 | 依据 |
| --- | --- | --- | --- | --- | --- |
| alpha 状态层 `active:bg-layer-*` | 27 | `transition-colors` 工具类 | `--durationFast` | `--motion-standard` | `background-color` 在 `.transition-colors` 覆盖内，**已验证** |
| 预计算实色 `active:bg-state-pressed-*` → 迁至 `bg-layer-pressed-*` | 24 | `transition-colors` 工具类 | `--durationFast` | `--motion-standard` | 同上。**与 alpha 档同档**：12% 明度差上曲线差异不可分辨，分档属凭感觉 |
| `active:opacity-*` | 7 | **inline `:style`** | `--durationFast` | `--motion-standard` | `opacity` **不在** `.transition-colors` 覆盖内 ⇒ 挂该类是**静默失效** |
| `active:shadow-[var(--md-elevation-1)]` | 5 | **不引入过渡**（见下） | — | — | `box-shadow` 不被上述两个类覆盖，且 ADR-0207 决策 7 已记「Lynx 多层 box-shadow 支持度未知」 |
| `active:w-[7.467vw]` / `active:h-[7.467vw]` | 2 | **inline `:style`** | `--durationFast` | `--motion-standard` | 尺寸变化，工具类无覆盖 ⇒ inline |
| `active:bg-white/10` | 1 | 归正后同上（alpha 行） | `--durationFast` | `--motion-standard` | 见决策 10 |

> ⚠️ **「处数」列是基线快照（复算日 2026-10-01），不是门禁输入**，口径见背景章「陷阱一 / 陷阱二」。
> 复核判据 2 **已改为全覆盖判据、不认处数** —— 因为处数会被别的票合法改动：
> ADR-0212 决策 6 硬禁 `active:shadow-[var(--md-elevation-*)]` 并把 `GlobalFab.vue` 主 FAB
> 改为 `active:opacity-80` ⇒ 本表 `active:opacity-*` 由 **7 → 8**、`active:shadow-*` 由 **5 → 0**；
> 决策 8 的归正则再把 `active:bg-state-pressed-*` 由 **24 → 0**。
> **结论：本表用于说明规模与载体选择，不用于判红。**

**为什么阴影这一档选「不引入过渡」而不是「赌一个工具类」**：按项目纪律
（ADR-0205 决策 6「代码里写了 ≠ 真机生效」），未验证的路径要么取证后再用、要么不用。
`box-shadow` 过渡列为**待真机取证项 P3**；若真机证实不支持，
本条即成为**该失效面的显式登记**（而非「待修的缺陷」）——
阴影档的按压反馈靠 `RefreshableList` 菜单项上**同元素并列的
`active:bg-layer-pressed-on-surface`** 提供，颜色反馈不受影响。

**非颜色属性一律走 inline `:style` 的理由**：`transition-opacity` / `transition-shadow`
在产物中是 0 条，而「产物 0 条」**无法区分「无人使用」与「引擎不支持」**
（同 `@keyframes` 的假阴性形态）。inline `:style` 已被 `GlassCard.vue` / `GlobalFab.vue`
实证可用，是当前**唯一无歧义**的路径。

### 决策 3：退场动画走「两段式显隐」协议，不靠事件驱动

**硬约束：Lynx 无 `transitionend` 事件**（ADR-0111 已记：「v1 瞬撤，避免 setTimeout」）。
这意味着**退场动画无法用「播完再卸载」的事件回调实现**，只能显式建模。

更棘手的是 `BottomSheet.vue` 的既有契约：**挂载由父级 `v-if` 控制（卸载式显隐，
ADR-0123），本组件不自管 `open` 状态、禁止 `v-show`/visibility 化**。
即**卸载即消失，不存在「已挂载但正在淡出」的中间态**。

**协议**（`SheetShell` 收口，调用方从「直接 `v-if` 组件」改为「传 `open`」）：

```
调用方:  <SheetShell :open="showPanel" @close="showPanel = false">
SheetShell 内部状态机:
  open=true        → 挂载 + 挂入场动画类
  open=false       → 摘入场类 + 挂退场类 → 启动计时器
  计时器到期        → 卸载（真正 v-if=false）
  计时器时长 = 与退场动画**同源**的令牌值（不写字面量）
```

**计时器时长必须从令牌读**：降级开启时（R1 整条置 `none`）退场瞬间完成，
计时器必须同步归零，否则关弹层会**卡住一个空窗期**（`--durationFast` = 150ms 的白屏停顿）。
这是决策 1「唯一入口」的第二个硬需求。

**已知代价**：退场期间弹层仍占位且不响应滚动（`overflow` 需在退场态锁住）。
这是「无 `transitionend`」的必然成本，不假装免费。

### 决策 4：`SheetShell` —— 弹层壳（遮罩淡入 + 面板上滑）

收口 `BottomSheet.vue` 的既有壳（scrim + `bottom-0` 面板 + 标题栏 + ×），
在其上**加两条入场动画**：遮罩 `opacity` 淡入、面板 `translateY` 上滑（走 `@keyframes`，
非工具类 —— 见决策 7）。

**归属边界按几何划分，不按「谁引入了我」划分**。实跑核验 7 个弹层的几何：

| 弹层 | 几何 | 处置 |
| --- | --- | --- |
| `SeriesSheet` / `CommentOverlay` / `SearchSheet` / `NovelExportSheet` | `absolute bottom-0 left-0 right-0`（均 `<BottomSheet>` 消费方，`grep -rn '<BottomSheet' src` 实测 4 个） | **进 `SheetShell`** |
| `PagePickerSheet` | 自绘壳，但 `absolute inset-0 bg-scrim` + `absolute left-0 right-0 bottom-0` 面板，**与 `BottomSheet` 同款几何**；有根 view `w-full h-full relative` | **进 `SheetShell`** |
| `BookmarkPanel` | `absolute inset-0 bg-scrim` + `absolute left-0 top-[20vh] w-full h-[80vh]`，注释自述「与 `bottom-0` 贴底等价」 | **进 `SheetShell`**，但需支持「顶部锚定 + 定高」变体（或归一到 `bottom-0`） |
| `WatchlistPromptDialog` | `fixed inset-0 flex items-center justify-center` + 居中 `w-[74.667vw]` 面板 + `shadow-elevation-3` | **❌ 不进**：居中对话框几何（入场应是 scale+fade 而非上滑）；**且它是唯一已有 `open: boolean` prop 的弹层** ⇒ 选它做两段式退场的**首个试点** |

> ⚠️ **两处与初始测绘不符，已按实跑订正**：
> ① `SearchSheet` **不是**「自绘面板」—— 它 `import BottomSheet` 并以 `<BottomSheet>` 包裹，
> 与 `SeriesSheet` / `CommentOverlay` 结构同款；初始测绘漏了它，**实际消费 `BottomSheet` 的是 4 个**（多出 `NovelExportSheet`）。
> ② `PagePickerSheet` **不缺根 view**，且**不是**「非底部几何」—— 它有
> `<view class="w-full h-full relative">` 根节点、面板同样贴底。
> `BookmarkPanel` 同理，「非底部几何」不成立，是**锚点写法不同**（`top-[20vh]+h-[80vh]` vs `bottom-0`）。
> 这三条都只影响「谁进 `SheetShell`」，不影响任何门禁判据。

### 决策 5：`MotionList` —— 列表项入场 + 错峰

`RefreshableList.vue` **已有** `item-rise-1/2/extra` 三档（0 / 60 / 120ms）与 `staggerMs`
归零逻辑，机制是现成的。本决策**不是新建组件，而是把该机制收口进 `motion.ts` 的 STAGGER 预设**，
并给剩余手写 `scroll-view` 列表提供接入点。

实跑规模：

```
grep -rl '<RefreshableList' src/pages --include='*.vue' | wc -l          # 10
comm -23 <(grep -rl '<scroll-view' src/pages --include='*.vue' | sort) \
         <(grep -rl '<RefreshableList' src/pages --include='*.vue' | sort)
```

⇒ **10 个页面已覆盖**，**7 个页面仍是手写 `scroll-view` 列表**
（`DownloadManager` / `IllustDetail` / `Me` / `MuteTags` / `NetworkCheck` /
`PlatformCheck` / `UpdatePage`）—— `MotionList` 的整改面就是这 7 个。

> ⚠️ 初始测绘写「仅 `IllustList` 与 `Following` 用 `RefreshableList`」，
> 实测（grep + CodeGraph `explore RefreshableList` 的 callers 面双向确认）
> **20 个调用点 / 10 个页面**，非 2 个。已订正。

**错峰上限**：只对**首屏可见的前 N 项**施加 stagger，其余直接终态。
虚拟滚动场景下若对全部项逐项延迟，长列表的末项入场时间会随长度线性漂移。

### 决策 6：路由转场在 `navigate()` 侧自做

`src/router.ts` 是裸 `createRouter({...})`（458 行 / 24 条路由 / **零 transition 配置**），
所有导航是整页硬替换。**Lynx 侧无路由 transition 支持**（vue-router 的
`<Transition>` / `transition` 配置项不生效），因此转场**只能在导航发起侧自建**：
页面容器持有「方向 + 阶段」状态，`navigate()` 时写入，页面按状态挂入场类。

**方向性差异必须显式区分**，否则前进与后退的手感相同，用户失去空间定位：

| 方向 | 视觉 | 依据 |
| --- | --- | --- |
| forward（进入更深的层级） | 新页面**从右侧**滑入 + 轻微 fade | 平台约定：前进 = 内容右移 |
| back（返回上层） | 旧页面**从左侧**回位 | 与 forward 互为逆操作，**不是**新页面反向滑入 |

> **实施补记（2026-10-01，#880 真机取证后回填）——两方向刻意不对称**：
> 落地时 **forward 带 `opacity: 0→1` 的轻微 fade，back 不带**（帧体只写 `translateX`）。
> 理由：若 back 也补上 fade，两条 keyframes 就成了**同一条动画的位移取反**，
> 观感退化成「同一段动画正放 / 倒放」——这正是 #880 验收 1 明确不接受的情形。
> 本表原文只规定 back「从左侧回位」、未提 fade，故实现与决策**不冲突**；
> 但「刻意不对称」这条**设计决定**必须留痕，否则下一个人会出于「对称即正确」的直觉
> 给 back 补上 fade，随即被 `tests/routeTransitionGate.test.ts` 判红而不知为何。
> 帧体见 `src/App.vue` 的 `route-forward-in` / `route-back-in`（唯一定义方）。

**实现约束**：

1. **不引入路由库层抽象** —— 只在 `router.ts` 导出 `navigate(to, direction)` 包装，
   现有 `router.push/replace` 调用点保持不变（`navigate` 内部委托）。
2. **back 不做「旧页等待新页退出」的双页并存** —— 那是 Web 侧 `<Transition mode="out-in">` 的做法，
   Lynx 上双页并存的生命周期成本高且无 `transitionend` 可挂（决策 3 同源约束）。
   退而求其次：back 只给**重新进入的旧页**一个滑入，不做真实反向。
   这是**有意的能力削减**，在此登记，不假装做到了双向完整转场。
3. 与决策 3 的两段式协议共用同一套「令牌同源计时器」。

### 决策 7：按压缩放**不可用** Tailwind 工具类，必须走 inline `:style`

> ### ⚠️ 本条是「构建全绿、渲染为空」的典型陷阱
>
> **`active:scale-*` / `active:translate-*` / `active:rotate-*` 一律无效。**
>
> 复算：`grep -ao 'scale-\[\|translate-x\|translate-y\|rotate-\[' dist/main.lynx.bundle | wc -l` → **0**。
>
> ⚠️ **但「产物 0 条」不是本条的理由** —— 那只说明**源码里没人这么写**（Tailwind JIT 按需生成），
> 无法区分「无人使用」与「引擎不支持」。真实机制由 [ADR-0210](./ADR-0210-lynx-style-stack-capability-boundary.md)
> 路径 E 实测定论：
> **① 这族工具类是被支持的**（用项目真实 config 跑一次 JIT，`.rotate-45` 等 15/19 个候选类**确实产出规则**，
> preset 带了 35 个自定义 plugin 绕开 57 项白名单）；
> **② 产出的规则引用 9 个 `--tw-*` 变量，而这些变量从未被定义**（preset 不发 base/preflight 层，
> `src` 里 0 处 `--tw-*` 定义）⇒ 按 CSS 规范该声明在**计算值阶段非法** ⇒ 渲染为 `transform: none`。
>
> ⇒ 这是**第三类失败：构建过、类型过、单测过、产物有规则，只有真机看得见渲染为空。**
> ⚠️ **不要试图「把 corePlugin 加回白名单」来修** —— 规则本来就在，缺的是 `--tw-*` 的定义。
>
> 同一现象的另一面：本仓 `TextSelectionToolbar.vue` 的 `rotate-45` 抓手是这条的**在册存量疑点**（ADR-0210 决策 5）。

**唯一正确写法**（两个都可用，按场景选）：

```
① 持续跟手的按压反馈（按下即缩、松开复原）
   → inline :style，绑 reactive 的 transform 值
     style="transform: scale(0.96)"          ← 参照 GlassCard.vue 的 cardStyle 形态

② 一次性播放的动画（缩放入场 / 弹跳）
   → <style> 块内 @keyframes 里手写 transform 声明
     @keyframes sheet-panel-in { from { transform: translateY(100%) } to { transform: none } }
```

**为什么 `@keyframes` 里能写而工具类不行**（产物实证）：
`item-rise` 的关键帧体里**确实有** `translateY(12px) scale(.92)` ——
即引擎**支持** transform 声明。失效的不是 transform 属性，而是 **Tailwind 工具类那条路径的
`--tw-*` 变量未定义**。**判据是「变量有没有定义」，不是「属性是什么」。**

**依据**：`GlassCard.vue` 的 `cardStyle` 已经在用 inline `:style` 交付
跟手位移 + `transform` 过渡（`transition: transform var(--durationNormal) var(--motion-emphasized-decelerate)`），
是本仓已实证的可行形态。

**同时禁止**：`hover-class` 承载任何缩放/位移（ADR-0207 决策 9：属性本身静默失效）。

### 决策 8：`bg-state-pressed-*` → `bg-layer-pressed-*` 是**口径归正**，不是 bug 修复

24 处 `active:bg-state-pressed-*` 迁到 27 处所在的 alpha 正路 `active:bg-layer-pressed-*`。

**必须写清楚它不是什么**：这不是「24 处按压没生效」的 bug 修复 ——
这 24 处**当前是生效的**（预计算实色在 `bg-primary` 底上正常显示，
ADR-0207 决策 8 的真机锚点 `SettingsEndpoint` 按住取样 `(53,128,178)` 即此路径）。
它是**口径归正**：ADR-0207 决策 4 定的「alpha 层是正路」被 24 处绕过，
按 ADR-0207 的自我监督纪律应记为「口径待归正」而非缺陷。

**迁移必须逐点判定底色档，不能批量改名**：

| 消费点底色 | 目标类 | 依据 |
| --- | --- | --- |
| `bg-primary`（实心按钮） | `active:bg-layer-pressed-on-primary`（**预合成不透明色**） | ADR-0207 决策 8：`on-primary` 档的 alpha 叠加在 Lynx 上原理不可达 |
| `surface` / `surface-container-*` / 其他 | `active:bg-layer-pressed-{primary,on-surface,error,surface}`（**保持 alpha**） | ADR-0207 决策 8「范围是封闭的」，不得扩大化 |

**⛔ 与现有门禁的交互（这是本决策最容易踩的坑）**：
`on-primary` 档类名**必须继续以字面量留在 `.vue` 元素上，不得搬进 `motion.ts`**。
门禁 `tests/stateLayerOnPrimary.test.ts` 的 **C3** 逐标签扫 `src/**/*.vue`，
要求「元素写了 `bg-layer-*-on-primary` ⇒ 同元素必须带 `bg-primary`」；
ADR-0207 已明确登记 C3 的盲区之一是「**`.ts` 全文**」。
把类名挪进 `.ts` 会**主动制造**这个盲区，让消费约束失去机器防线。
⇒ 决策 1 的「类名收口进 `motion.ts`」对 `on-primary` 档**不适用**。

另需注意 `ActionButton.vue` 的 `active:bg-white/10`：它是 FAB 菜单项，画在
**菜单面 scrim** 上而非 `bg-primary` 上，既不是 `on-primary` 档也不是令牌路径 ⇒ 单列处置（决策 10）。

### 决策 9：所有新动效接 `useReducedMotion`，复用 R1/R2/R3 不新增规则

`src/composables/useReducedMotion.ts` 是**唯一偏好事实源**（禁止组件自建 `matchMedia`）。
四类预设与本 ADR 的所有新组件**一律接入**，与既有 R1/R2/R3 的关系：

| 本 ADR 的动效形态 | 归入 | 既有规则的确定行为 |
| --- | --- | --- |
| 状态层过渡、遮罩淡入、面板上滑 | **R1**（过渡） | 整条 `transition` 置 `none` ⇒ 状态瞬切。Tailwind 侧 = **不挂** `transition-*` 类（挂 0ms 是同义反复） |
| 列表项入场、错峰浮出 | **R2**（关键帧） | 整条 `animation` 置 `none`，**含 infinite 循环**（`fab-spin` / `shimmer`） |
| 按压跟手缩放、弹跳 | **R3**（弹性与错峰） | 动效**本身不生成** —— 不改几何、stagger 恒 0。只降时长无效（前庭反应与位移量成正比） |

**两条本决策的增量**（均不新增规则形态，只是把已有规则的适用范围写明）：

1. **R1 侧**：`transitionStyle.value === 'none'` 时，**决策 3 的退场计时器必须同步归零** ——
   否则会出现「动画已停但遮罩滞留 150ms」的空窗期。
2. **R3 侧**：决策 7 的 inline `transform` 跟手值，在 R3 下**不生成**（不只是不加过渡），
   与 `GlassCard.vue` 现有做法一致（该组件在 R1 下 `elasticOn` 恒 false、`transform` 不再变化）。

**未验证项**：`useReducedMotion` 走 `matchMedia`，而 Lynx 原生是否实现
`window.matchMedia` 需真机确认（该 composable 已有「无 matchMedia ⇒ 按未开启处理并
`console.warn`」的显式降级，符合禁静默降级）。列入取证项 **P7**。

### 决策 10：残留项处置口径

| 残留 | 实测状态 | 处置 |
| --- | --- | --- |
| `GlassCard.vue` 的 `cubic-bezier(0.33, 0, 0.67, 1)`（Fluent 遗留） | **已归正**。`grep -rn 'cubic-bezier' src --include='*.vue'` 只命中 **2 处注释**，`cardStyle` 实际用 `var(--motion-emphasized-decelerate)`（ADR-0207 决策 6 / #854 已完成） | **不改代码**。残留物是**注释里引用旧值的历史说明**，保留即可 —— 删掉它反而丢失「为何改」的证据链。若日后清理，只删注释文本，不得回退代码 |
| `ActionButton.vue` 的 `active:bg-white/10` | 1 处**非令牌字面量**，画在 FAB 菜单面 scrim 上（非 `bg-primary`） | **单列**：不并入决策 8 的 24 处批量迁移。归正目标是 `active:bg-layer-pressed-on-surface`（菜单项底为 `surface-container-high`，属 surface 系）—— **实施前须逐点确认底色档**，禁止批量改名 |
| `active:w-[7.467vw]` / `active:h-[7.467vw]` | 2 处**尺寸**变化（`w`/`h`），非状态层 | 归决策 2 表末行，inline `:style` 过渡。**不计入状态层统计** |
| `GlobalFab.vue` 注释里的 `cubic-bezier(.05,.7,.1,1)` | 注释，说明「与 `GlassCard` 构成同值双写」已避免 | 同上，只删不改 |

### 决策 11：`--md-state-pressed-*` 在 `.vue` 侧归零后**保留**，登记为「能力储备」

决策 8 的 24 处归正会让 `--md-state-pressed-*` 这一族令牌的 **`.vue` 侧消费归零**。
**本决策裁定：保留该族令牌，不删。** 这是**显式豁免**，不是遗漏（与 ADR-0207 复核判据第 5 条
的关系见下）。

> ⚠️ **先纠正一个容易顺口写错的说法**：归正后「消费归零」**不等于**「键无引用」。
> `tailwind.config.ts` 的 `state` 色板段**仍以 4 条 `var(--md-state-pressed-*)`**
> 把它们映射为 Tailwind 档位来源（复算：
> `grep -ohE 'var\(--md-state-pressed-[a-z-]+\)' tailwind.config.ts | wc -l` → **4**）。
> 删掉令牌 ⇒ `bg-state-pressed-*` 直接解析到未定义变量。
> ⇒ 该族在**工具类侧仍有结构消费**，本就不是死键。**已验证。**

**保留的两条理由**：

1. **它是引擎兜底路径本身，不是冗余**。ADR-0207 决策 4 原文把预计算实色降级为
   「**Lynx 不支持某伪类时的兜底**」。删掉等于把兜底路径一并删了。而本 ADR 的
   **P1 / P2 / P3 取证项尚未过** —— alpha 正路在 Lynx 上是否处处可达**仍未证实**
   （`on-primary` 档已经是「正路不可达、改走预合成」的既有实例，决策 8 依赖的正是它）。
   在取证结论落地前删掉兜底，是拿未验证的乐观假设换零收益。**已验证**（决策 4 原文 + 决策 8 表格）。
2. **同构先例：保留判据是「角色身份」，不是「引用计数」**。
   `glossary-md3-alignment.md` §1.2 的 `--color*` 兼容层是同型结构。
   ⚠️ 但该先例**不能**被表述为「因为零消费才保留」—— 实跑
   `grep -rlE 'var\(--color[A-Za-z0-9]+' src --include='*.vue'` → **3 个 `.vue` 仍在消费**
   （`RestrictOverlay.vue` / `AiOverlay.vue` / `PagePickerSheet.vue` 用 `--colorOverlayForeground`）。
   它被保留的理由是**被登记为只读兼容层**这一策略身份（"新增代码不得再写旧名"），
   与消费数无关。**本族继承的是同一条原则：身份一经登记，就不按计数回收。**

**与 ADR-0207 复核判据第 5 条的关系 —— 显式豁免**：
准确地说，判据 5 是「**elevation 五档齐备**，且至少一处消费 `--md-surface-tint`
（否则**该 token** 是死代码，应删而非留着）」——
其「应删」条款的**显式对象是 `--md-surface-tint`**，判据 5 本身是 **elevation 族**的齐备判据，
**不是**一条覆盖全令牌层的通用「零消费即删」规则。
⇒ `--md-state-pressed-*` 本就不在判据 5 的射程内；本条把这一判断**写下来**，
是为了让后续复核不必重新推一遍。**已验证**（判据 5 原文）。

**归正后哪两道门禁仍盯着它（避免腐化）**：

| 门禁 | 断言的是 | 归正后 |
| --- | --- | --- |
| `tests/md3ConfigTokens.test.ts` | 探针集保留 `bg-state-pressed-primary` / `bg-state-pressed-on-surface`（注释自述「存量写法不回归」）⇒ 断言**类名仍能产出规则** | **不转红** |
| `tests/unit/utils/appearanceClasses.test.ts` | 逐套色板断言 `--md-state-pressed-primary` ≠ 同块 `--md-primary` 且**更亮**（暗色下防「按下零反馈」）⇒ **语义断言**，强于「键仍产出规则」 | **不转红** |

⚠️ **正因为两道门禁都不会转红，这条豁免没有任何机器信号会提醒复核者** ——
「零消费」在门禁眼里是**正常态**。这正是它必须以文字显式登记的原因：
一旦将来有人误以为「门禁绿 = 消费正常」，就会反向把这族令牌当死键清掉。

**与复核判据 5 不矛盾**：判据 5 判的是**类名** `active:bg-state-pressed-*` 的**消费**归零，
本决策保留的是**令牌**（定义面）。一个判消费面、一个判定义面，**两者口径不同、结论相反也不冲突**。

---

### 决策 12：缩略图 → 大图的**连续性转场**（hero transition，双向）

**问题**：从列表点缩略图进详情、返回，现在两个方向都是**整页滑动**（决策 6）。
用户点的是那张图，却得到一次与那张图无关的整页位移 ⇒ **图像类 App 最大的沉浸感来源缺席**。
决策 6 只解决了「方向可辨」，没解决「点的那张图去了哪里」。

**可行性已取证（本决策不是凭空设想）**：`src/primitives/measureRects.ts` 已封装
`SelectorQuery`，按 ADR-0149 spike **双端实测**可用，返回 `{left, top, width, height}`。
⇒ 被点元素的矩形**拿得到**，这是本决策成立的前提。

**机制**（Lynx 无共享元素原语，故自建，与决策 6「不引入路由库层抽象」同款自建思路）：

1. 列表侧：图片挂稳定 `id`；`@tap` 里**先发起** `measureRects([id])`（异步），**不等它**，
   立即 `navigate(...)` ⇒ **不给导航加可见延迟**（平台约束：测量跨线程异步，见 ADR-0149）。
2. 详情侧：挂载时若有本作品的 hero 矩形，用一段 `@keyframes` 把图片容器**从该矩形插值到自然位置**；
   插值对象是**矩形**（left/top/width/height），图内用 `object-fit` 吸收缩略图与大图的**比例差**
   （否则直接缩放会变形）。
3. 返回侧：详情页卸载前测量自身图片矩形，回列表页后再插值回原位。
4. **降级（必须实现，不是可选优化）**：拿不到矩形 / 图片未就绪 / 用户快速连点 ⇒ **退回决策 6 的普通转场**。
   **一个空白矩形在屏幕上放大，比一次滑动难看得多** —— 降级是正确性要求，不是体验优化。

**方向：双向**（前进放大 + 后退缩回）。**覆盖：全部能点图进详情的流**，不留「只有推荐流有」的割裂。

⚠️ **KeepAlive 造成的**逐页**能力差（本决策最重要的已知边界）**：
`App.vue` 的 `include = ['recommended','illusts','novels','me','ranking','mypixiv']`。
⇒ 这 4 个 feed 在 push 详情时**实例仍在**（停用而非卸载），**双向都成立**；
而 `Following` / `UserHome` / `Bookmarks` / `Watchlist` / `WatchLater` / `TagNeighbors`
**不在名单内**，push 即卸载 ⇒ **返回时原图已不存在，只能前进有连续性、返回退回普通转场**。
这是**平台/架构现状的必然结果，不是可以随手统一掉的疏漏**；要统一就得扩 KeepAlive 名单，
而那会引入「缓存旧 id 实例显示错误内容」的既有风险（`IllustDetail` 正是因为这条才不在名单里）。
⇒ **登记为能力削减**，按页降级，不假装全站一致。

**不做的事**（避免与既有决策打架）：
- 不改 `RefreshableList` / 虚拟滚动的列表结构（改结构在 Lynx 上是 ADR-0162 的雷区）；
- 不引入路由库层抽象（沿用决策 6 约束 1）；
- 不为了「对称」而给 back 也补 fade（决策 6 补记已把「不对称」定为刻意取舍）。

#### 实施与真机结论（2026-10-01）

唯一实现处 = `src/composables/heroTransition.ts`；页面只接线。**动画通道只动
`transform` / `width` / `height`** 三条（本仓生产代码已被决策 1/2 实证：`GlassCard.vue:51`
transform、`M3Switch.vue:33` width+height、`RankingEntryCard.vue:164` opacity），
**刻意不过渡 `left/top`**（定位属性本仓零实证消费面）—— 覆盖层用**静态 `left/top` 落在起点**，
位移走 `translate(dx,dy)`。比例差由 **`<image mode="aspectFill">`** 吸收（**不是** CSS `object-fit`，
见 `CoverImage.vue:6` 头注与 `SkeletonImage.vue:14` 记的 `aspect-ratio` 坑），**插值布局盒、
绝不 `transform: scale()`**（那会把已按 aspectFill 裁好的位图再拉伸一次 = 变形）。

| 项 | 结论 |
|---|---|
| 前进方向 | ✅ 真机逐帧验证，**两个流**（推荐流、插画分类流）标记框单调插值收敛 |
| 返回方向 | ⚠️ 真机 trace 证明**跑到了 `play()`**（`onActivated survived=<id>` → `PLAY ok`）且与前进共用同一条 `play()/:style` 路径，但**中间帧未取到帧级几何证据**（推荐流上 from/to 几乎重合；插画分类流那 10 帧逐字节相同）—— **不是「双向不可行」，是「返回的视觉未取证」** |
| 生产路径 | ✅ 进入正常、**返回后与进入前逐字节一致**（无残留）、logcat 无崩溃 |
| 降级 | 10 条触发（`measure-failed` / `deadline` / `no-source` / `id-mismatch` / `stale-generation` / `invalid-rect` / `reduced-motion` / `not-cached` / `no-source-image` / `cancelled`），每条都有可观察行为 |

**真机推翻原设计的一处**：返回方向原设计是「返回那一刻测详情页 hero 盒」。真机实测下
**前进正常、返回永远等不到起点**——页面正在被销毁，UI 线程的结果回不来（240ms 截止）。
改为**详情页活着时就把 hero 盒存下**（它本来已为前进方向测过一次），返回守卫只做**同步置位**
⇒ 返回路径零等待、零跨线程依赖。

**能力划分不硬编码名单**：判定问 Vue 自己的生命周期——`onDeactivated` 触发 = 本实例 push 时
只是停用没被销毁 ⇒ 返回方向可用；标记是**实例局部**的，实例被销毁后随之消失。
⇒ `App.vue` 的 KeepAlive 名单将来改了，这段判定**不会腐化**。

⚠️ **两条必须登记的失效面**：
1. **插画分类流起点矩形偏大**（实测 `x[0,1011]` ≈ list 全宽，卡片实际 ≈522px）。
   **根因已收窄（#898）**：原假设「引擎把 `<list>` 内元素的 `boundingClientRect`
   报成 list 的 cross-axis 范围」**被证伪** —— `uiautomator dump` 在真实插画分类页读到的
   卡片就是 **522px**（两列并排），与 JS 测量一致 ⇒ 引擎没报错，**是被测元素本身真的那么宽**。
   真因：被测 view **自身没有宽度**，其祖先 `w-full` 在 `<list>` 里的解析基准是
   **list 的内容盒（≈1010px）**而非本 list-item 所在列；卡片看起来 522px 靠的是内部图片的
   `height="48.4vw"`。推荐流的卡片本来就是全宽，所以同一套代码在那里「看起来对」——
   **这解释了为什么只有这一个流出问题**。
   已按「宽度与内部图片同源」下修复（`w-[48.4vw]`），**布局无回归已实测**（卡片前后均 522px）；
   ⚠️ **但覆盖层动画本身仍未在真机抓到**（三种检测方式均判不出），不写成「已验证」。
   ⚠️ **不得**用「宽度超阈值就降级」兜底——推荐流卡片本身就是全宽，会打死正确用例。
2. **release 构建里 JS `console.*` 不落 logcat**（`LynxLog : failed to load LynxLog dependency`）
   ⇒ **「日志里没有降级行」不能当作没降级的证据**。取证改用屏上探针。
   这与本仓今日反复出现的「假绿」同族：**验证手段本身可能静默失效**。

**降级优先于动画**：一个空白/错误矩形在屏幕上放大，比一次整页滑动难看得多 ⇒ 降级是
**正确性要求**，不是体验优化。

## 后果

- **观感层面**：63 个状态层点从「闪」变成「响应」；7 个弹层获得入场动画；
  10 个页面 + 路由获得转场 ⇒ 这是「粗糙」观感的**主要来源**被直接处理
  （`63` = 预计算实色 24 + alpha 27 + `opacity` 7 + 阴影 5，是 **2026-10-01 基线快照**；
  同批落地后：24 处归正**并入** alpha 档（总数不减）、`opacity` 因 ADR-0212 决策 6 **7 → 8**、
  阴影 5 处被该决策**整体删除**（不再是按压机制）⇒ 终态 **59**。
  同判据 2：**此数只用于说明规模，不用于判红**）
- **机制层面**：动效从「6 个组件里的偶然实现」变成项目级契约（决策 1 的唯一入口）
- **`on-primary` 档多一道人工约束**：决策 8 要求该档类名**留在 `.vue`**，
  与决策 1 的收口方向相反 —— 这是刻意的（保 C3 机器防线），不是例外
- **退场多一段「不响应滚动」的空窗期**（决策 3）：`--durationFast` = 150ms，
  换来退场可见。纯触屏下 150ms 的不可交互窗口可接受；`prefers-reduced-motion` 开启时归零
- **阴影档按压无过渡**（决策 2）：若真机证实 `box-shadow` 不可过渡，这是**显式登记的失效面**，
  该点的颜色反馈不受影响
- **`--md-state-pressed-*` 归零但不删**（决策 11）：`.vue` 侧零消费是**预期终态**，
  不是待清理的债（`tailwind.config.ts` 仍以 4 条 `var()` 引用它们，见决策 11）。
  两道门禁**不会**因它转绿或转红 ⇒ 该豁免**只靠本文件维持**，
  任何「顺手清死键」的清理都须先回到决策 11
- **路由转场是能力削减**（决策 6 约束 2）：back 不做双页并存真实反向，只做滑入
- **与 ADR-0206 / ADR-0207 的关系**：本 ADR 不改任何令牌值，只加消费层 ⇒
  **三者可同批落地**（与 ADR-0207 决策 6 要求它与 ADR-0206 分批的约束不冲突 —— 那是两个令牌 ADR 之间的事）
- **视觉回归面扩大**：弹层入场 + 路由转场 + 状态层过渡都会改截图基准
  ⇒ 需与既有 MD3 视觉回归分批对齐

---

## 待真机取证清单

**共同要求**：每条探针**必须自带阳性对照**。否则「什么都没发生」无法区分
「引擎不支持」与「探针没触发」（ADR-0207 决策 5 的首版假阴性教训，
以及本 ADR 前置依赖节 `@keyframes` 字面量 0 命中的同型陷阱）。

| # | 待验证项 | 探针设计 | 阳性对照 | 判读 |
| --- | --- | --- | --- | --- |
| **P1** | `transition-opacity` / `transition-shadow` / `transition-transform` / `transition-all` 工具类是否可用 | 同一元素四组并列，`:style` 驱动 opacity 0.4↔1，带 `@tap` | 同批放一个 `transition-colors` 的 `background-color` 切换探针 | 对照变 ⇒ 采样法有效；变体不变 ⇒ 引擎不支持（**不是**没人触发） |
| **P2** | inline `:style` 的 `transition: opacity/box-shadow var(--durationFast) var(--motion-standard)` 是否真被过渡 | 定时切换 opacity，连采 5 帧看是否出现**中间值** | 同期 `GlassCard.vue` 的 transform 跟手（已知可用） | 有中间值 ⇒ R1 侧非颜色属性过渡成立；只有首尾两值 ⇒ 引擎按替换语义处理 |
| **P3** | `box-shadow` 本身是否渲染、是否可过渡 | 单个 `shadow-[var(--md-elevation-3)]` 元素，静止 vs 按住连采 | 同期 `elevation-3` 静态阴影截图（应有可见阴影） | 静态阴影都不可见 ⇒ ADR-0207 决策 7 的「辅」部分自然失效，**登记而非整改** |
| **P4** | `<style>` 块内 `@keyframes` 在 Lynx 真机上是否真播放 | `item-rise` 关键帧连采 5 帧找 `translateY` 中间值 | 同期 `shimmer`（骨架屏，循环动画，历史已在真机出现） | 有中间值 ⇒ 决策 7 的 ② 路径成立 |
| **P5** | 两段式退场（先播退场再卸载）在真机上是否**可见** | 打开/关闭弹层各连采 8 帧 | 同批 `scrim-in` 入场动画（既有路径） | 退场有中间帧 ⇒ 决策 3 协议成立；**秒消失** ⇒ 退场必须改回「瞬撤」并登记失效面 |
| **P6** | 路由转场的 forward / back 方向在真机上**可区分** | 连续走 forward→back 两步，逐帧比对位移方向 | 同期任一已验证的入场动画 | 方向不可分 ⇒ 转场改为无方向的纯 fade，并登记能力削减 |
| **P7** | Lynx 原生是否实现 `window.matchMedia` | 读系统「移除动画」开关后进入应用 | 同批 `useReducedMotion` 的 `console.warn` 缺席 | 无 `matchMedia` ⇒ 降级路径生效（既有 `console.warn` 兜底），**登记为引擎边界**，非缺陷 |

**取证顺序建议**：P4 → P2 → P1 → P3 → P5 → P6 → P7。
P4/P2 是决策 1/2/7 的地基，未过则后续决策的实施面要重估。

### P5 取证结果（2026-10-01 实测，#878）：**通过** —— 弹层入场动画在真机真实播放

**探针设计（长时长法）**：单帧 `adb exec-out screencap` 往返实测 **446–596ms**（丢弃输出）
与 **464–484ms**（写盘到文件）两法同量级，中位 ≈480ms —— 与 `glossary-md3-alignment.md` §13.6
登记的 420ms 同量级，**该节无误**。而弹层入场档位是 250ms ⇒ 直接连采必然**全部落在终态之后**，
「没看到中间态」无判别力。

> ⚠️ **本次探针自己踩的坑（留档，因为差点造成一条假订正）**：探针脚本里实测的**帧间隔**
> 是约 1.0–1.2s，明显大于 screencap 本身（≈480ms）。差额来自**逐帧的计时插桩**——每帧额外
> 起 3 次 `python -c` 进程取时间戳。⇒ **「帧间隔」≠「采样耗时」**，两者混在同一段脚本里时，
> 会把插桩开销当成工具开销，进而去「修正」一条本来正确的文档。
> 复核手法：把两种计时方式分开各跑 5 次看分布，而不是沿用探针内的相对时间戳。
故沿用 canary 的长时长探针：临时把 `--durationMedium1` 由 `250ms` 改 `6000ms`、
`--motion-emphasized-decelerate` 由 `cubic-bezier(0.05,0.7,0.1,1)` 改 `linear`
（**只改 CSS 令牌，不动 `motion.ts`**，使退场计时器 `holdMs` 仍取 `fast` 档、退场协议保持自洽），
重建后点开 `SearchSheet` 连采 10 帧。**探针结束后 `tokens.css` 按 sha256 校验逐字节还原。**

**结果**（面板 `h-[80vh]` 贴底 ⇒ 终态上沿 y = 2160 − 1728 = **432**）：

| 帧 | t(s) | 面板上沿 y（目视 + 像素） | 状态 |
|---|---|---|---|
| 打开前 | — | 无面板 | 基线 |
| g2 | ≈2.4 | ≈1933 | **中间态**：仅「搜索」标题栏 + 输入框 + 「搜索历史」露在屏幕下缘 |
| g4 | ≈4.7 | ≈1134 | **中间态**：筛选胶囊（全部/插画/小说、最新/最早/热门）已展开 |
| g6–g10 | ≈6.4–8.0 | 474 | 收敛到终态 |

**遮罩独立验证**：g2 与 g4 的插画整体亮度**肉眼可辨地变暗** ⇒ `sheet-scrim-enter` 的
opacity 通道与面板的 `translateY` 通道**各自独立插值**（若二者共用一条 keyframes，
遮罩会跟着位移，表现为「暗块跟着面板一起滑」而非全屏均匀变暗）。

**判据自检（两次翻车，必须留档）**：
1. **第一版探针无判别力**：只把时长改到 2000ms、仍用 decelerate 缓动。该缓动**前置极重**
   （t=0.5 时进度已 ≈0.92），加上 screencap 往返比估计值慢，10 帧里只捞到 1 帧且落在
   **96% 进度**（y=487 vs 终态 474）——与「动画完全没播」不可区分。**改用 linear 缓动 +
   6000ms 后才拿到 3 个清晰中间态。**
2. **「最长连续亮段」取面板上沿这个判据本身失效**：遮罩淡入会同时压暗**页面自身**的亮度，
   而该作品是**亮底**插画 ⇒ 底色与面板同为「亮」，段长被污染，读数非单调（1675/1676/1986/…）。
   改为**相邻帧全图逐像素差异**定位真正在动的帧对（g1→g2 起稳定 ≈100%，因遮罩压暗使
   几乎每个像素都在变），再**直接看图**判读。
   ⇒ 与 §13.6 同一纪律的第二个实例：**判据必须先自证能红/能分辨，否则"通过"是空话。**

**结论**：决策 3 的两段式协议与决策 4 的「遮罩淡入 + 面板上滑」在真机**成立**，
`@keyframes` 帧体在非 scoped `<style>` 中**全局生效**（`SheetShell.vue` 是唯一定义方，
而 `BottomSheet` / `BookmarkPanel` / `WatchlistPromptDialog` 并不 import 它——见复核判据 6）。

### 决策 5 取证结果（#879，2026-10-01）：**通过** —— 列表逐项铺开在真机可测

**探针**：把 `--durationMedium1` 临时改 `6000ms`、`STAGGER_STEP_MS` 改 `1500ms`（`STAGGER_MAX_ITEMS=8`
⇒ 总时长约 16.5s），重建后在 `网络自检`（7 个手写列表之一，诊断行铺满整屏）点入并**设备内连拍**
26 帧（`input tap; screencap -p /sdcard/…` 放在同一条 `adb shell` 里，避免单帧 ≈480ms 的往返吞掉动画）。

**判据 = 逐条水平带的「是否已达终态」**（每带 140px，带内 99.5% 像素与终态一致即判就位）。
这是**结构边界**判据而非逐点取值——避免「用户内容偏亮/偏暗」污染读数。

| 内容带（y） | 首次就位帧 |
|---|---|
| 带 0–2（300–720） | q_9（开拍时已就位） |
| 带 3（720–860） | **q_20** |
| 带 4（860–1000） | **q_22** |
| 带 5（1000–1140） | **q_24** |
| 带 6（1140–1280） | **q_26** |
| 带 7–9（1280–1700） | q_26（视口外/末尾项，延迟按上限归 0 直接终态） |

⇒ 各项**严格自上而下依次就位**，相邻两项间隔 ≈2 帧，与设定的 1500ms 步长一致
（设备内连拍实测 ≈750ms/帧）。**逐项错峰在真机成立**。

**判据自检**：单看「整屏与终态一致率」会得到 95.46→99.74→99.83→99.84→99.93→99.99→100.00
这条单调曲线，但**它无法区分「错峰」与「单项动画」**——必须切到逐带来读，才有上面的阶梯。
另：`Me.vue` 首屏只有 **1 个**接入块在视口内（账户组的行位于 `GlassCard` 内部，
而 `GlassCard` 自带 inline 弹性 transform，与 `item-rise` 的 `both` 终态填充冲突，故刻意不接入），
在 `Me` 上测量只能得到单项动画，**测不出错峰**——换 `网络自检` 才有足够的可见项。

### 决策 6 取证结果（#880，2026-10-01）：**通过** —— 前进/后退方向差在真机可分

**探针**：只改本票自有的两个文件（`App.vue` 的时长令牌引用 + `routeTransition.ts` 的保持时长），
放大到 6s；锚点取**顶栏最右暗像素 x**（返回箭头/标题右缘），基准取本次连拍的末帧。

| 场景 | 逐帧 Δx(px) | 判定 |
|---|---|---|
| forward（点推荐卡进详情） | +14 → +6 → +2 → +1 → 0 | 页面**右**移归位 |
| forward（独立第二次会话） | +24 → +16 → +11 → +4 → +1 → 0 | 可复现 |
| back（系统返回键） | **−74** → −25 → −12 → −6 → −3 → −1 → 0 | 页面**左**移归位 |
| 对照：tab 切换（`replace`） | 0 ×8（全窗口） | 无转场 |
| 对照：冷启首路由（`replace`） | 0 ×8（全窗口） | 无转场 |
| 对照：静止连拍 | 0 ×6 | 无转场 |

同机同会话、**同一锚点**，forward 为正、back 为负，符号相反 ⇒ 方向可辨识（验收 1）。
两组 `replace` 对照在**整个 6s 窗口**内 0 帧有位移 ⇒ 深链/切 tab 不出现异常转场（验收 4），
且这三组对照同时证明判据**有判别力**（不是恒零）。

**实现要点（一处非显然决策）**：方向**不在 `navigate()` 里同步写**，而由 `router.afterEach` 落成。
依据 vue-router 源码：`finalizeNavigation` 写 `currentRoute.value` 后，`triggerAfterEach` 与它在
**同一 `.then` 回调内同步执行**，排在 Vue 渲染 flush 微任务**之前** ⇒ 新页首帧即带动画。
`navigate` / `goBack` 只写「意图 + 预期落点」，`afterEach` 拿实际落点对账
（被守卫重定向或导航取消 ⇒ 不给没发生的导航挂转场）。
`navigate` 的**签名未变、既有调用点零改动**——方向由纯函数 `decideRouteDirection` 推导
（`replace === true → 'none'`，否则取显式声明，未声明即 `forward`）。

---

## 复核判据

1. **唯一入口**：`src/composables/motion.ts` 存在且导出四类预设。
   **判红条件**：`src/**/*.vue` 中，`transition:` / `animation:` 声明或
   `duration-*` / `ease-*` 工具类的**时长位与 timing-function 位**上出现字面量
   （`150ms` / `200ms` / `0.15s` / `cubic-bezier(`）。
   **例外登记**（不判红，但须在同处有注释说明）：
   · `App.vue` 的 `animation: var(--shimmer-motion, shimmer 1.5s linear infinite)`
     —— 令牌表缺席时的 fail-open 兜底，**已钉**：
     `src/components/motionDurationTokens.template.test.ts` 的 `LITERAL_EXCEPTIONS`
     键 `'App.vue | .shimmer | 1.5s'`（该门禁**死登记也转红**，登记与实存必须一致）；
     另由 `src/shimmerGate.test.ts` 与 `src/composables/useReducedMotion.test.ts`
     逐字锁死该回退实参。⚠️ 注意这三份门禁在 **`src/` 下**（与 `tests/` 同级），
     不在 `packages/app-lynx/tests/` —— 复核时别在 `tests/` 里找（那里 0 命中）。
   · `RefreshableList.vue` 的 `animation: … 0ms / 60ms / 120ms both` —— **延迟位**
     （duration 与 curve 两位已走令牌）。延迟位按决策 1 迁入 STAGGER 预设后豁免
   **判据要能区分「时长/曲线位」与「延迟位」与「注释」** —— 早期粗口径
   `grep -rnE '[0-9]+ms|[0-9]+\.[0-9]+s|cubic-bezier\(' src --include='*.vue'`
   会命中 **54** 处，其中含 `TagPressChip.vue` 的长按 500ms、`SettingsEndpoint.vue` 的
   debounce 600ms 等**非动效**时长，以及大量中文注释 ⇒ **信噪比不可用，不得作为门禁**。
2. **状态层过渡覆盖率（全覆盖判据，不认处数）**：**遍历式**判定，不比计数 ——
   对 `src/**/*.vue` 中**每一个** `active:bg-layer-*` 与 `active:bg-state-pressed-*` 消费点，
   断言其所在元素带 `transition-colors` + `duration-[var(--durationFast)]`；
   对**每一个** `active:opacity-*` 消费点，断言其走 inline `:style` 过渡。
   判据要能抓住「挂了 `transition-colors` 却以为覆盖了 opacity」——
   `transition-property` 不含 `opacity`，判据须查载体而非查「有没有 transition」。
   **零消费即通过**（消费点归零不是失败，是迁移完成的形态）；新增消费点自动入判，
   **不需要改判据**。

   > ⚠️ **处数耦合登记（为什么本条不写死「51 个点 / 7 个点」）**：
   > 状态层消费点数会被**别的票**合法改动，写死就会在对方落地时**假红**。
   > 已知耦合（三处，全在同批落地里发生）：
   > ① **ADR-0212 决策 6** 硬禁 `active:shadow-[var(--md-elevation-*)]`（5 处 → 0），
   >    并把 `GlobalFab.vue` 主 FAB 改为 `active:opacity-80`
   >    （`primary-container` 档无状态层，见该 ADR 决策 6）⇒ `active:opacity-*` 由 **7 → 8**；
   > ② **决策 8** 的归正把 `active:bg-state-pressed-*` 由 **24 → 0**。
   > ⇒ **写死处数的判据在这两票落地时必然转红。** 全覆盖判据天然免疫：
   > 它只关心「该形态的每个消费点是否合规」，不关心有几个。
3. **无死 transform 工具类**：`src/**/*.vue` 与 `motion.ts` 中不得出现
   `scale-*` / `translate-*` / `rotate-*` 工具类。
   复算：`grep -ao 'scale-\[\|translate-x\|translate-y\|rotate-\[' dist/main.lynx.bundle | wc -l` → 必须为 0
   ⚠️ **与前置依赖表那行的「0 条不是依据」不矛盾，方向相反**：那里是**从「产物没有」推断
   「引擎不支持」**（无效，JIT 按需生成）；这里是**禁令门禁**——期望态本就是「产物里没有」，
   而 JIT 按需生成使「源码写了 ⇒ 产物必现」⇒ 0 是**有效**的判红信号。
4. **`on-primary` 档仍留在 `.vue`**：`motion.ts` 中不得出现 `bg-layer-*-on-primary` 字面量
   （否则 C3 盲区被主动制造，决策 8）。
5. **口径归正完成**：**类名** `active:bg-state-pressed-*` 的消费计数为 0；
   复算 `grep -rhoE 'active:bg-state-pressed-[a-z-]+' src --include='*.vue' | wc -l`
   ⚠️ 本条只判**消费面（类名）**，**不判定义面（`--md-state-pressed-*` 令牌）** ——
   令牌族按决策 11 **保留**为「能力储备」（`.vue` 侧零消费）。
   两者口径不同，不要拿本条去推令牌该删。
6. **弹层入场齐备**：7 个弹层组件中，6 个走 `SheetShell`（含入场）、
   1 个（`WatchlistPromptDialog`）走居中变体，**0 个零动画**。

   > ⚠️ **验证方法已于 2026-10-01 更正；判据含义未变**（仍是「0 个零动画」，
   > 只是原来的复算命令与决策 4 直接矛盾）。原复算
   > `for f in <7 个弹层>; do grep -c '@keyframes' src/components/$f.vue; done` 要求「全部 > 0」，
   > 而**决策 4 把 6 副帧体唯一定义在 `components/SheetShell.vue`**：弹层只经
   > `useSheetMotion` / `useSheetDismiss` 消费**动画名**，自身不定义帧体
   > ⇒ 那条命令对 7 个弹层**恒返回 0**（实测：7 个全 0），与决策 4 自相矛盾。
   > 复算改为验证决策 4 的真实接线：**动画名来自登记表 + 帧体由 `SheetShell` 唯一定义**。

   ```sh
   cd packages/app-lynx
   for f in BottomSheet SearchSheet SeriesSheet CommentOverlay BookmarkPanel PagePickerSheet WatchlistPromptDialog; do
     printf '%-24s @keyframes=%s 登记表=%s\n' "$f" \
       "$(grep -c '@keyframes' src/components/$f.vue)" \
       "$(grep -cE 'SHEET_ANIMATION|DIALOG_ANIMATION' src/components/$f.vue)"
   done
   printf '%-24s @keyframes=%s\n' SheetShell "$(grep -c '@keyframes' src/components/SheetShell.vue)"
   ```

   期望：7 个弹层一律 **`@keyframes=0`**（帧体不在弹层里）、**`登记表=2`**
   （各引用 `SHEET_ANIMATION` / `DIALOG_ANIMATION` 常量并作为 `useSheetMotion` 实参）；
   **`SheetShell=6`**（6 副帧体的唯一定义方）。
   > 「7 个弹层」= **直接接线登记表的那 7 个文件**。决策 4 表里与 `SeriesSheet` /
   > `CommentOverlay` / `SearchSheet` 同列的 `NovelExportSheet` 是 `<BottomSheet>` 的**消费方**，
   > 经 `BottomSheet` 间接拿到同一套帧体，故名单里由 `BottomSheet` 代表那一支。
   > 间接链路复算：`grep -rl '<BottomSheet' src --include='*.vue'` → 4 个（决策 4 实测同值）。

   **「名字 ↔ 帧体对账 + 全仓唯一定义方」不靠人肉 grep，由既有单测钉死**：
   `src/components/SheetShell.test.ts` 的 S1 组（登记表逐条对账 / 6 个名字全仓唯一定义方 /
   登记表有真实消费方 / 帧体只写 transform 与 opacity、零时长曲线简写）
   + `src/composables/useSheetDismiss.test.ts`：
   `npx vitest run src/components/SheetShell.test.ts src/composables/useSheetDismiss.test.ts`
   → `Test Files 2 passed (2) / Tests 33 passed (33)`。
7. **路由转场存在**：`src/router.ts` 导出 `navigate(to, direction)`，
   `direction` 取值集合恰为 `{ forward, back }`；`createRouter` 本身不带 transition 配置。
8. **偏好接入**：`motion.ts` 依赖 `useReducedMotion`（单测可注入 `matchMedia` 假实现覆盖两条路径）；
   `SheetShell` 的退场计时器在 `transitionStyle === 'none'` 时**时长为 0**。
9. **`hover-class` 零出现**（沿用 ADR-0207 判据 9，不得回潮）。

---

## 门禁已知失效面登记（单一登记处 = `glossary-md3-alignment.md` §13.8）

> **本节不复制登记表。** 逐门禁的「实际守住的契约 / 抓不到的情况 / 是否已登记」三列表，
> 唯一权威落点是 [`glossary-md3-alignment.md` §13.8](./glossary-md3-alignment.md)（§13.8.1 表 +
> §13.8.2 仓库级结构性盲区）。**本节只做两件事**：① 指出复核本 ADR 判据时该去哪读；
> ② 登记**动效域特有**、§13.8 必须一并覆盖的口径。
>
> **为什么必须单一登记处**：失效面表一旦复制成两份，两份就会各自漂移 ——
> 改了一处忘了另一处，读者读到未更新的那份就会得出「已被覆盖」的错误结论。
> 本仓已经吃过同形的亏（`adrClaimConsistency.test.ts:66-74` 记的「文档级 `match` 只取首个匹配 ⇒
> 第二处陈旧标记永远无人发现」：**同一事实被抄成两份时，必有一份是假的**）。

### 一、复核动效判据时的读取路径

| 要回答的问题 | 去哪读 |
|---|---|
| 判据 1–9 各自的**失效面**（它抓不到什么） | `glossary-md3-alignment.md` §13.8.1 逐门禁表 |
| 判据 1/3/4/5 共用的**扫描面盲区**（`.ts` 类串、`.vue` 的 `<script>` 块、`<style>` 块） | 同上 §13.8.2 第 1–4 条 |
| 判据 5 的**错峰上限**为何不可区分 | 同上 §13.8.2 第 5 条 |
| 「门禁全绿」这句话的**准确含义** | 同上 §13.8.0（16 道门禁无一读真机像素） |
| `#881` 验收 3 / `#886` 验收 4 的登记物 | 同上 §13.8 整节 |

### 二、动效域特有、§13.8 必须一并覆盖的口径（复核时按这五条查）

1. **判据 1 与判据 3 的覆盖面是分裂的，引用时不得互相顶替。**
   判据 1（唯一入口 / 时长曲线）的 `.ts` 声明位由
   `tests/motionContract.test.ts` M5 补齐（`tests/motionContract.test.ts:59`、`:429-468`），
   判据 3（无死 transform 工具类）的 `.vue` 侧只认**模板属性位**加 **一张登记表**
   （`classTokens:113` + `motionClassRegistryTokens:120-122`）。
   ⇒ **判据 3 已经在 `.ts` 声明位与 `.vue` 类名位这两处**建立防线，
   **但 `.ts` 的类名位与 `.vue` 的 `<script>` 块仍是空的**。引用「判据 3 已覆盖」时必须带这个限定。

2. **判据 4 是**为保护另一道门禁**而存在的一格，失效面要按「被保护者的盲区」读。**
   `M4`（`tests/motionContract.test.ts:400-423`）自己不产 CSS、不消费类名，
   它守的是「别把 `on-primary` 类名搬进 `.ts`」——因为
   `tests/stateLayerOnPrimary.test.ts` 的 C3 只按**元素**扫 `.vue` 模板，
   类名一旦挪进 `.ts` 就**同时**逃出 C3 与 C4 之外的视线。
   M4 的失败文案（`:407-411`）已把这条因果写死，但**只覆盖 `motion.ts` 一个文件**——
   其它 `.ts` 造出 `on-primary` 类名由 C6 兜（`tests/stateLayerOnPrimary.test.ts:652-716`），
   C6 自己的已知边界（`['bg','layer','pressed','on','primary'].join('-')`，见 C6 注释 `:672-674`）
   也已显式登记。⇒ 这一族是**全仓登记最完整的一族**，可作为其余族的登记样板。

3. **判据 6 的复算命令与判据本身不同源，改一处不会带红另一处。**
   判据 6 的 `S1` 组（`src/components/SheetShell.test.ts:292-361`）与
   §复核判据 6 里那段 shell 复算（`:671-687`）**各写各的**：
   前者认「名字 ↔ 帧体对账 + 全仓唯一定义方」，后者是 `grep -c` 计数。
   ⚠️ 已知两处同源缺陷：① `styleBlock`（`SheetShell.test.ts:63-65`）只取**第一个** `<style>` 块；
   ② 「帧体唯一性」（`:304-316`）只查 `OWNED_NAMES` 那 6 个名字 ⇒ **第二个 `<style>` 块里的孤儿帧体两处都看不见**。
   复核时若发现「孤儿帧体」类缺陷，先查这两处，再怀疑实现。

4. **判据 7/8 的方向差与偏好门控，两者的失效面互不覆盖。**
   - 判据 7（路由转场方向差）的真机侧由本 ADR 的「决策 6 取证结果」（`:581-`）承担，
     机器侧只读**三个文件**（`tests/routeTransitionGate.test.ts:32-35`、`:272-275`）。
   - 判据 8（偏好接入 R1/R2/R3）的机器侧由 `src/composables/useReducedMotion.test.ts` 承担，
     其含动画组件面**是 `.vue` only**（`animationCandidates:184-189` 的 `.endsWith('.vue')` 过滤）。
   ⇒ **`.ts` 里新增一条 `animation:` 声明，既不进判据 7 的文件清单，也不进判据 8 的门控面。**
   复核「偏好门控有没有覆盖新写法」时，**先看那个写法落在哪个文件类型**。

5. **判据 9（`hover-class` 零出现）不在本 ADR 的门禁清单里，归属 ADR-0207。**
   沿用判据 9 时请回 ADR-0207 取其门禁与失效面；
   本 ADR 不复制该条，避免两处各自漂移（理由同本节开头的「单一登记处」）。

### 三、本 ADR 侧两条**自曝**的失效面（不重复登记，只做索引）

- **判据 1 的早期粗口径已被否决**：`:625-628` 记的
  `grep -rnE '[0-9]+ms|[0-9]+\.[0-9]+s|cubic-bezier\(' src --include='*.vue'` 命中 54 处、
  含长按 500ms / debounce 600ms 等**非动效**时长 ⇒ **信噪比不可用，不得作为门禁**。
  该否决已由结构化判据取代（`motionDurationTokens.template.test.ts:15-23` 记的两处盲区修复），
  登记状态：**已闭环**。
- **判据 2 的处数耦合**：`:638-646` 记的「写死 51 个点 / 7 个点必然假红」是**已登记**的维护约束，
  配套的全覆盖判据落在 `tests/pressStateLayerTransition.test.ts:300-305`（判据内核 `judge`）。
  ⚠️ 该内核**只认五种 `active:` 形态**（`propertyOfToken:79-95`），
  新增第六种形态时「全覆盖」会**静默失效**——这是 §13.8.1 该行「未登记」的第一条。

## 参考

- 前置：[`ADR-0207`](./ADR-0207-shape-and-state-layer-guardrails.md)（state layer 口径与门禁 C1–C6、
  `transform` / `hover-class` / `background-color` 替换语义的实证来源）
- 前置：[`ADR-0206`](./ADR-0206-typography-type-scale.md)（决策编号与「四元组」式取值表写法范本）
- 基线：[`ADR-0205`](./ADR-0205-md3-baseline-and-scope.md) 决策 6（「代码里写了 ≠ 真机生效」）
- 引擎边界：ADR-0210（Lynx 样式栈能力边界，与本 ADR 并行产出，**产出前本 ADR 的
  「已验证」行以本文件前置依赖节的产物复算为准**）
- 卸载式显隐：[`ADR-0123`](./ADR-0123-app-lynx-fab-hit-testing-fix.md)、
  无 `transitionend`：[`ADR-0111`](./ADR-0111-lynx-fab-menu.md)
- 偏好事实源：`src/composables/useReducedMotion.ts`（R1/R2/R3）
- 门禁：`packages/app-lynx/tests/stateLayerOnPrimary.test.ts`（C3 消费约束，本决策 8 依赖其扫描面）
- 门禁（判据 1 的例外登记处，在 `src/` 下而非 `tests/`）：
  `src/components/motionDurationTokens.template.test.ts`（时长字面量判据 + `LITERAL_EXCEPTIONS`）、
  `src/shimmerGate.test.ts`、`src/composables/useReducedMotion.test.ts`（后两者逐字锁死
  `App.vue` 的 `--shimmer-motion` 回退实参）
- 门禁（决策 11 保留的 `--md-state-pressed-*` 令牌仍被这两道盯住，归正后**不会转红**）：
  `packages/app-lynx/tests/md3ConfigTokens.test.ts`（探针含 `bg-state-pressed-*`「存量写法不回归」）、
  `packages/app-lynx/tests/unit/utils/appearanceClasses.test.ts`（暗色 pressed 语义断言）
- 官方数值来源：
  [`_md-sys-motion.scss`](https://github.com/material-components/material-web/blob/main/tokens/versions/v0_192/_md-sys-motion.scss)、
  [`_md-sys-state.scss`](https://github.com/material-components/material-web/blob/main/tokens/versions/v0_192/_md-sys-state.scss)
- 术语文档：[`glossary-md3-alignment.md`](./glossary-md3-alignment.md)（动效域）

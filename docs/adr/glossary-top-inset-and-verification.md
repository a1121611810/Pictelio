# 顶部让位与验收判据术语表

> 范围：`packages/app-lynx`（vue-lynx + Lynx 4.0.1 + Tailwind 3.4，Android 构建）中**顶部安全区让位**与**真机验收判据**两族概念。**本表是术语文档：只登记「这个概念在我们这儿叫什么、落在哪、什么含义」，不含修复方案。**
> 配套 ADR：[ADR-0214-top-inset-per-page-ownership.md](./ADR-0214-top-inset-per-page-ownership.md)（顶部让位逐页归属）、[ADR-0211-ui-continuity-motion-contract.md](./ADR-0211-ui-continuity-motion-contract.md)（动效契约，`item-rise` 帧体的出处）。
> 交叉引用（不重复定义）：单位与换算见 [./glossary-lynx-units.md](./glossary-lynx-units.md)（**权威**）；色板/暗色三态见 [./glossary-lynx-bili-theme.md](./glossary-lynx-bili-theme.md)；MD3 角色与形状档位见 [./glossary-md3-alignment.md](./glossary-md3-alignment.md)。
> 证据坐标一律用**稳定锚点**（符号名 / 类名 / 文件），不写行号。

---

## 一、顶部让位族

| 术语 | 含义 | 本项目落点 | 证据 |
|---|---|---|---|
| **Top inset（顶部让位）** | 屏幕顶端到内容起点的距离。平台真值 = 状态栏 inset（`dumpsys window` 的 `type=statusBars frame` 高度）。**本项目取「内容起点」而非「可绘制起点」**——不把内容画进状态栏区域，除非页面显式声明出血 | `utils/safeArea.ts` 的 `safeTop` / `safeBottom`；换算见 `glossary-lynx-units.md` | `safeArea.ts`；ADR-0214 |
| **让位归属（topInset ownership）** | 每条路由**必须**显式声明的顶栏形态。两个封闭值，无第三选项 | `utils/topInset.ts` 的 `TopInsetMode = 'self' \| 'bleed'`；`router.ts` 每条路由的 `meta.topInset` | `topInset.ts` 的 `TopInsetMode` / `TOP_INSET_MODES` |
| **`self`（自让位）** | 页面自带一个**零内容 spacer** 把内容推到状态栏之下。**绝大多数页面**（当前 25 条路由中 24 条） | `composables/useTopInsetSpacer.ts` 的 `useTopInsetSpacer()`；13 个页面经 `PageTopBar` 内置消费、11 个自持，两类交集为空 | `useTopInsetSpacer.ts`；`PageTopBar.vue`；ADR-0214 §2 |
| **`bleed`（出血）** | 两侧都不让位，内容铺到状态栏底下。**仅沉浸式页**（当前只有首页，且由构建宏决定） | `router.ts` 首页那条：`topInset: __HOME_BLEED_HEADER__ ? 'bleed' : 'self'` | `router.ts`；`Recommended.vue` |
| **让位归属 vs 让位实现** | 归属 = 路由 `meta.topInset` 的**声明**；实现 = 页面里那个真正撑开高度的 spacer。**两者必须成对存在** | 跨端契约测试断言「声明了就必须有实现」，缺任一方向都指名具体路由 | `utils/safeAreaJavaContract.test.ts` |
| **spacer（零内容让位块）** | 一个**不渲染任何内容**、只为占位的元素。刻意不用父容器 padding：Lynx 的 border-box UA 默认会让 padding 吃掉内容高度，而 web-core 预览不复刻该默认 | `useTopInsetSpacer()` 返回的 `ComputedRef<number>` 被绑成 spacer 高度；底部不动，6 个底部弹层继续各自消费 `safeBottom` | `useTopInsetSpacer.ts`；`App.vue` 的 `rootStyle` |
| **首页沉浸悬浮顶栏（B 变体）** | 首页取消 64dp 实体顶栏，封面出血到屏幕顶端；右上角通知铃铛（暗底圆钮）；底部标题胶囊进场后 2s 淡出；状态栏加遮罩 | `Recommended.vue` 的 `HOME_BLEED` 分支 + `showTitleChip()` | `Recommended.vue`；ADR-0214 §后果 |
| **状态栏遮罩（statusbar scrim）** | 覆盖在状态栏区域的一层半透明底（`to bottom`，本色板 `surface` 渐隐到透明，高 `safeTop × 2.2`），解决「系统状态栏字压在浅色封面上不可读」。遮罩在状态栏带底约 55% 不透明，**封面像素仍会透上来** ⇒ 带内最坏对比度**随图而变**。已留样的实测区间 **5.83:1 … 16.67:1**（原引用的 `12.03:1` 是其中某一张封面的值；无遮罩时最坏 `1.09:1`） | `--md-statusbar-scrim`，**14 套色板各烘一份字面量、零 `var()`**；量它的脚本 `verify-statusbar-contrast.mjs` | `tokens.css`；`Recommended.vue` 的遮罩层；ADR-0214 §后果与 §对比度的复现手段 |
| **烘焙字面量（baked literal）** | 把本可用 CSS 变量表达的色值**直接写死**进样式。用于消除「未取证的平台行为」——`linear-gradient(…, var(--md-surface) …)` 依赖 Lynx 引擎对「变量出现在 CSS 函数实参内」的支持，该行为真机可用但机制未明 | 14 块遮罩各自烘焙本色板 surface；曾有两条「修法」（集中定义 / 逐块写同名变量）都**没消除**该假定，最后才真正消掉 | `tokens.css`；门禁 `tests/immersiveScrimContrast.test.ts` |
| **回退阀（escape hatch）** | `PICTELIO_HOME_BLEED=0` —— 唯一的关闭方式，回到旧的 64dp 实体顶栏。**刻意用 `!== '0'` 而非 `=== '1'`**：默认值该由「关掉需要显式动作」表达 | `homeBleedHeaderFlag.ts` 的 `resolveHomeBleedHeaderFlag()`；`lynx.config.ts` 的 `source.define` | `homeBleedHeaderFlag.ts`；`docs/release-checklist.md` §六之二 |
| **构建期宏（build-time macro）** | rspeedy `define` 阶段内联进 bundle 的常量，**运行期不可改**。`__HOME_BLEED_HEADER__` 属此类 ⇒ 已发布的 APK **无法**在设备上回滚，必须重新构建重新发版 | `lynx.config.ts` 定义；读点两处：`router.ts`（模块顶层）、`Recommended.vue` | `lynx.config.ts`；`rspeedy-env.d.ts` |
| **benchNav 深链** | 仅在 `BENCH_NAV=1` 构建里注入的调试入口：`adb shell am start … --es benchNav <短名>`。发版构建**不存在**（`__BENCH_NAV__` 缺省 false） | `LynxActivity.java` 的 benchNav 分支；短名表含 17 个场景 | `LynxActivity.java`；`docs/adr/ADR-0136-*` |

---

## 二、验收判据族

| 术语 | 含义 | 本项目落点 | 证据 |
|---|---|---|---|
| **幅值对拍（amplitude cross-check）** | 用「标题文字带中心」反推应用实际让位量，与 `dumpsys` 平台真值比对。**量的是绝对偏差，不是跨页离散度** | `scripts/verify-top-inset.mjs`；真机 16/17 路由全部在 ±12 物理 px 内 | `verify-top-inset.mjs`；#909 |
| **对比度对拍（contrast cross-check）** | 与幅值判据**同构但不同题**：读同一批平台真值、各取各的截图、同出三态，但一个量**几何**（让位多少 px）、一个量**颜色**（看不看得清）。「有遮罩」不等于「看得清」，两者不可互相替代 | `scripts/verify-statusbar-contrast.mjs`（驱动）+ `status_bar_contrast_metrics.py`（取样）+ `statusBarContrastVerdict.mjs`（判定纯函数）；采样窗 = `dumpsys` 状态栏带的**正中竖带**内缩 4px | `verify-statusbar-contrast.mjs`；ADR-0214 §对比度的复现手段；#909 |
| **最坏一端（worst end）** | 带内同时量**最暗**与**最亮**两个底色，判定取**两端之更差者**。极性由原生契约决定（暗图标 or 浅图标），落到哪一端不由脚本选 ⇒ 报最小值才是诚实口径 | `classifyStatusBarContrast` 的 `worst` / `branch`；门禁断言「两端不等时 worst === min(...)」 | `statusBarContrastVerdict.mjs`；`tests/statusBarContrast.test.ts` |
| **判据三层** | 判定「本页适不适用、让位对不对」的三道闸门，**顺序即代价**：① 路由声明（规格级，最可靠）② 平色 surface 两个度量 ③ 反推 inset 非负 | `topInsetVerdict.mjs` 的 `resolveDeclaredTopInset` → `classifyTopInsetVerdict` | `topInsetVerdict.mjs`；ADR-0214 §后果 |
| **REJECT / FAIL / PASS** | 三种判定，**互不等价**。REJECT = **本判据在此样本上给不出答案**（既不是通过也不是缺陷）；FAIL = 偏差超容差且样本适用；PASS = 在容差内。**REJECT ≠ 通过** | `verify-top-inset.mjs` 的三条退出路径 | `verify-top-inset.mjs` |
| **已登记的失效面** | 判据**原理上**区分不了的那一族输入。AGENTS.md「门禁冻结线」#5 要求**显式登记**（「不得只记它抓到了什么」），且登记要在**代码里**并有会红的断言 | 「整屏浅纯色底」与浅色顶栏在颜色统计上同形，三层都拦不住 | `topInsetVerdict.mjs` 的 `MIN_*` 常量注释；门禁 `tests/topInsetMetrics.test.ts` |
| **接缝（seam）** | 跨进程/跨语言边界上，A 与 B 之间的**转换本身**。A 有测试、B 有测试，**接缝没有** ⇒ B 的输入未经验证 | Python 度量 → JS 解析的接缝曾整段零覆盖：字段序错位导致两道闸门被无条件旁路，而当时 3568 条测试全绿 | `topInsetVerdict.mjs` 的 `parseMetricsOutput`；门禁 `tests/metricsParse.test.ts` |
| **防空转断言** | 抽取器/剥除器必须有「结果非空 / 长度有下界」断言。ArchUnit `failOnEmptyShould` 教训：正则失效会让全称断言**静默恒真** | `homeBleedHeaderFlag.test.ts` 的 `stripComments` 防空转 + `defineEntry()` 长度下界；`topBarHeightContract.test.ts` 的 owner 清单非空 | 各门禁的注释与断言 |
| **自证能红（counterfactual proof）** | 门禁必须证明**自己会红**：把被守的东西改坏，门禁转红，再还原 | 每道新门禁都做过变异验证（极性翻反 / 字段序改回 / 常量改值 / 关掉判据分支） | 各 commit message 的「自证能红」段 |
| **值域不变量** | 比率型输出加「必须落在 [0,1]」断言。比逐字段断言更抗重排：像素坐标可以是 167，比率不可能 > 1，字段序一错必然转红 | `tests/metricsParse.test.ts` | `tests/metricsParse.test.ts` |
| **冷挂载 vs patch 插入** | Lynx 上两种节点创建时机。**冷挂载** = 随页面初次创建；**patch 插入** = 数据到达后增量插入。ADR-0212/0162 记：瀑布流 list-item 的插入/移除/替换在 Lynx 上分别表现为**静默丢弃 / 留空位 / 错位** | 入场动画 `listItemStyle` 绑在**冷挂载的静态兄弟**上时会让内容不可见；绑在 `v-for` 动态行（patch 插入）上正常 | `motion.ts` 的 `listItemStyle`；`Me.vue` 的 10 处绑定；#908 |
| **单页标定常数** | 判据里从**单一页面**实测标定的经验常数。跨页面时若排版不同会漂移 | `TITLE_GLYPH_BIAS = 3.3`（单页标定）；容差 ±12 = 偏置 3.3 + 余量 8.7 | `verify-top-inset.mjs`；`tests/topInsetVerdict.test.ts` |

---

## 三、容易混淆的三组

| 这两个 | 别混在哪 |
|---|---|
| **让位归属 `self` / `bleed`** vs **`--md-scrim` / `--md-statusbar-scrim` / `--md-scrim-overlay` 三个遮罩** | 前者是**布局归属**（内容起不开始让位）；后者是**叠在其上的装饰层**。`--md-scrim` 主题无关恒为暗（白图标恒需暗底，**不可**用会随深色翻浅的 `--md-inverse-surface`） |
| **幅值的绝对偏差** vs **跨页离散度** | 前者是本工具**能**验的（16/16 通过，结论成立）；后者是**探测器标定噪声**，不是布局信号——顶栏高度全站按构造相同（`h-[17.067vw]`，13 个文件），真实布局方差 = 0 |
| **REJECT** vs **PASS** | REJECT 表示「本判据在此样本上给不出答案」。把它读成通过，或把它读成缺陷，都是误判。前者偏乐观（漏报），后者偏悲观（假警报） |

---

## 三之二、横图封面的已接受代价（决策见 ADR-0215 D6）

| 术语 | 含义 | 本项目落点 | 证据 |
|---|---|---|---|
| **横图封面留白（已接受代价）** | 取消首页 64dp 顶栏后，**横图封面**（宽高比大、可视区更高）的顶部留白比其他图多 64dp，视觉上不均衡 | 维护者已裁定**接受并登记**，**不改** ADR-0118 的「贴顶、宽满、不裁切」策略 | ADR-0215 决策 4；`Recommended.vue` 的 bleed 分支 |

**⚠️ 代价必须写明**：首页的视觉均衡性**依赖图片本身的宽高比分布，不��代码保证**。
⇒ 将来若收到「某些图看起来不均衡」的反馈，那是本决策的**已知代价，不是回归**。

**未选中的方案及理由**（避免下一个人重新推一遍）：

| 方案 | 不选的理由 |
|------|-----------|
| 横图按比例分档压缩留白 | 分档阈值从哪来**没有依据**；偏离 ADR-0118 的统一策略 |
| 横图恢复 64dp 实体顶栏，出血只对竖图生效 | 让「首页 = 沉浸」不再是单一事实；回退矩阵变复杂 |

---

## 四、本表的已知边界

- **§2 的「单页标定常数」尚未按标题变体分别标定**（`back` / 居中 / 大字重），当前靠容差吸收。提高判别力需按变体标定，见 #909。
- **全站顶栏几何一致性无机器防线**：`topBarHeightContract.test.ts` 只覆盖 5 条无歧义断言。全站枚举需「顶栏容器」的结构化识别——正则扫 `h-[Nvw]` 会误判（该写法在页面里大量用于进度条、网格单元等非顶栏元素）。**该门禁不做全站枚举是刻意的**，理由写在它自己的文件头。
- **§1 的「烘焙字面量」是取舍不是最优**：代价是遮罩不随主题运行时切换（按 7 套色板各烘一份，换主题时重算）。
- **§三之二 是已接受的代价，不是待修项**——见该节的反馈判据。

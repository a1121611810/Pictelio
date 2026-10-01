# Material Design 3 对标术语表

> 范围：`packages/app-lynx`（vue-lynx + Lynx 4.0.1 + Tailwind CSS 3.4，Android 构建）所使用的 **Material Design 3 概念**，与本项目实现（`src/styles/tokens.css` + `tailwind.config.ts`）之间的术语对齐。**本表是术语文档：只登记「这个概念在我们这儿叫什么、落在哪」，不含修复方案。**
> 配套 ADR：[ADR-0205-md3-baseline-and-scope.md](./ADR-0205-md3-baseline-and-scope.md)（MD3 基线与范围）、[ADR-0206-typography-type-scale.md](./ADR-0206-typography-type-scale.md)（排版 type scale）、[ADR-0207-shape-and-state-layer-guardrails.md](./ADR-0207-shape-and-state-layer-guardrails.md)（形状与状态层护栏）、[ADR-0208-material-symbols-icons.md](./ADR-0208-material-symbols-icons.md)（图标集）。
> 事实底座：`docs/research/material-design-3-gap-analysis-2026-09.md`（19 条差距 + 逐条证据）。本表「项目落点」列与该报告的**结论**一致；**坐标/计数以本表实测为准**（报告测于 MD3 整改之前）。
> ⚠️ **本表正文（§1–§11）记录的是整改后的现状，不是差距分析结论。** 差距报告的每一条差距在 §12.2 都有对应的「整改前 → 现状」对照；§12.1 是**整改前快照**（含历史行号），只作留痕，勿当现状引用。
> ⚠️ **§13 是 2026-10-01 新增的独立维度**，与 §1–§11 正交：§1–§11 记的是**令牌层**合规，
> §13 记的是**消费层**覆盖率与 Lynx 样式栈能力边界。诊断结论是「令牌层 95% 合规、消费层接近零，
> 用户感知的粗糙几乎全部来自消费层」——**只读 §1–§11 会得出「MD3 已全面落地」的错误印象**。
> **证据坐标一律用稳定锚点**（令牌名 / 类名 / 文件 + 符号名），不写行号 —— 理由与来龙去脉见 §4.2 末的注。
> 交叉引用（不重复定义）：单位与换算体系见 [./glossary-lynx-units.md](./glossary-lynx-units.md)（**权威**）；色板/主题色/暗色三态/漂移锁见 [./glossary-lynx-bili-theme.md](./glossary-lynx-bili-theme.md)。
> 基线声明：AGENTS.md「Fluent Design 规范」章服务的是已删除的 WebView 客户端（ADR-0203），为历史存档，对 app-lynx 无约束力。

## 核心术语

| 术语 | MD3 官方定义 | 本项目落点 | 证据 |
|---|---|---|---|
| **Color role（色彩角色）** | 以**语义**而非颜色命名的令牌槽位（如 `primary` / `surface` / `outline`），组件只消费角色。命名法是 MD3 与 MD2/Fluent 的根本分野 | 全部角色用 `--md-*` 前缀；Tailwind `extend.colors` 逐角色登记 | `tokens.css` 的 `--md-*` 角色段（首个色板 `.theme-sky` 内）；`tailwind.config.ts` 的 `extend.colors` |
| **Tonal palette（色调色板）** | 由一个 seed 色经 tonal 算法派生的整套角色取值 | 7 支主题色各一份亮色板 + 一份暗色板；暗色由脚本经 SchemeTonalSpot `isDark=true` 生成，**非明暗反相** | `tokens.css` 的 7 个亮色板（`.theme-sky` … `.theme-bili`）与 7 个暗色板（`.theme-sky.dark` … `.theme-bili.dark`） |
| **Dynamic color（动态色）** | M3 核心能力：运行时从设备壁纸/种子色实时派生色板 | **有意不做**，7 套构建期静态色板 | `utils/themeColor.ts` 的主题色常量；决策见 ADR-0205 |
| **Type scale（排版档位）** | 15 档 = display / headline / title / body / label × Large / Medium / Small | **15 档全部映射**（display×3 此前缺失已补）；**size + lineHeight + letterSpacing 三要素已落地**为 `fontSize` 数组四元组，weight 走 `fontWeight` 档位。⚠️ `text-display-*` 消费数仍为 0（可表达 ≠ 已用） | `tailwind.config.ts` 的 `fontSize` 语义档位段（15 条）；决策见 ADR-0206 |
| **Four-tuple（四元组）** | MD3 每档排版档位是 size + line-height + tracking + weight 的**四元组**，四者同档绑定 | ✅ **已落地**：`fontSize` 每档为 `['<size>', { lineHeight, letterSpacing }]`，weight 不随字号档位派生、由 `extend.fontWeight`（`regular` 400 / `medium` 500）显式承载 —— 故「档位名不变 ⇒ 存量类名零改动即获得正确行高」。⚠️ 官方四元组里 weight 随档绑定，本项目是**拆成两处显式写**，不是自动派生 | `tailwind.config.ts` 的 `fontSize` + `extend.fontWeight`；决策见 ADR-0206 决策 1 / 决策 2 |
| **Shape scale（形状档位）** | 6 档圆角：extra-small 4 / small 8 / medium 12 / large 16 / extra-large 28 / full 9999 | `--md-shape-*` 6 档全在（dp→vw 换算）；**已注册**进 `tailwind.config.ts` 的 `borderRadius`：`xs` / `sm` / `DEFAULT` / `lg` / `xl` / `full` 六档全部指向 `var(--md-shape-*)`。⚠️ **档位名目前 0 处消费**——存量仍是 `rounded-[var(--md-shape-*)]` arbitrary 写法（**只读兼容写法，不必迁移**）；裸方向类 `rounded-t` 取 `DEFAULT`（medium 12dp，**非** extra-small）；残留 `rounded-full` 49 处走 Tailwind 内置值（数值恰等于 `--md-shape-full` 但不走 token） | `tailwind.config.ts` 的 `borderRadius`（`xs`→extra-small … `full`）；`tokens.css` 的 `--md-shape-*` 6 档；消费统计（本轮后实测）：档位名 0 处 / 裸 `rounded-[var(--md-shape-*)]` 254 处 / 方向变体带 token 21 处 / `rounded-b-none` 16 处 / `rounded-full` 49 处；护栏见 ADR-0207 |
| **Easing（缓动曲线）** | material-web v0.192 定义 4 条：`emphasized (0.2,0,0,1)` / `standard (0.2,0,0,1)` / `emphasized-accelerate (0.3,0,0.8,0.15)` / `emphasized-decelerate (0.05,0.7,0.1,1)` | `--motion-*` 4 条**逐条与官方一致**（standard 与 emphasized 同值是官方事实） | `tokens.css` 的 `--motion-*` 四条定义 |
| **easing-legacy** | material-web v0.192 中的 MD2 遗留曲线 `cubic-bezier(0.4, 0, 0.2, 1)`。**不是 standard** | 项目**未定义**该 token。⚠️ 它曾有第二条入口 —— `transition-*` 的默认 timing function（来自 lynx preset 的 `extend`）恰是该值，即「令牌对、默认消费路径拿 MD2 曲线」；**已在 `extend.transitionTimingFunction.DEFAULT` 重新声明为 `var(--motion-emphasized)` 堵掉**（顶层替换会被 preset 的 extend 在其后覆盖，故必须写两处）。门禁规则 1 守回归 | `tailwind.config.ts` 的 `transitionTimingFunction` + `extend.transitionTimingFunction.DEFAULT`；门禁 `tests/md3GuardScans.test.ts` 规则 1 |
| **Duration scale（时长档位）** | short1-4 = 50/100/150/200ms；medium1-4 = 250/300/350/400ms；long1-4 = 450/500/550/600ms | 已定义 **6 档**：`--durationFast` 150ms（short3）/ `--durationNormal` 200ms（short4）/ `--durationMedium1` 250ms（medium1）/ `--durationGentle` 300ms（medium2）/ `--durationMedium3` 350ms（medium3）/ `--durationExtraLong4` 1000ms（extra-long4），取值**均落在官方档位内**；short1-2、medium4、long1-4、extra-long1-3 未定义。✅ 组件侧硬编码已清零（`--shimmer-motion` 获真实定义走 `--durationExtraLong4`；`fab-ring-spin` 令牌化），仅 `App.vue` 的回退实参 `1.5s` 逐字保留且在册（fail-open 兜底，有真机依据，详见 §4.2）；0/60/120ms stagger 延迟按 §4.2「M3 无官方值」例外保留 | `tokens.css` 的 6 个 `--duration*`（`--durationFast` / `--durationNormal` / `--durationGentle` / `--durationMedium1` / `--durationMedium3` / `--durationExtraLong4`）；补档用例见 `tests/unit.test.ts` 的「M3 duration scale 补档」 |
| **Expressive spring** | MD3 Expressive 的 spring 物理曲线 | **引擎受限**：Lynx transition 支持有限，无法表达 | `tokens.css` 的 `--motion-*` 段注释自述；差距报告 §5 |
| **State layer（状态层）** | 覆盖在容器色之上的半透明 alpha 层，四态 opacity：hover 0.08 / focus 0.12 / pressed 0.12 / dragged 0.16 | **四态令牌全齐**，每态按 primary / on-surface / error / surface / on-primary 五色展开 = **20 条** `--md-state-layer-*`；已注册为**顶层** utility `bg-layer-{hover,focus,pressed,dragged}-*`。⚠️ 嵌套在 `state` 组下会产出**不同名**的 `bg-state-layer-*`，写错层级即死类名、**静默无样式**。⚠️ **`on-primary` 档已改为预合成不透明色**（引擎是替换语义、alpha 不可达，见 §5.4） | `tokens.css` 的 `--md-state-layer-hover-*` / `-focus-*` / `-pressed-*` / `-dragged-*`（各 5 色）；`tailwind.config.ts` 的顶层 `layer-*` 档位键；护栏见 ADR-0207 |
| **Pre-computed state color（预计算实色）** | MD3 **不用**这种方式；官方一律是 alpha 叠加层 | 项目**两套并存**：`--md-state-pressed-*`（预计算实色，4 条）+ `--md-state-layer-*`（alpha 层 **20 条** = 4 态 × 5 色）。⚠️ 消费已从「以实色为主」反转为持平（alpha 层 27 处 vs 实色 24 处），详见 §5.2。⚠️ **第三种形态已引入**：`on-primary` 档因引擎限制也改预合成（§5.4），它是**引擎妥协**而非官方口径 | `tokens.css` 的 `--md-state-pressed-*` vs `--md-state-layer-*` |
| **Disabled state（禁用态）** | on-surface 12%（容器）/ 38%（内容） | 2 条 token 已定义（`--md-state-disabled-container` / `--md-state-disabled-on-surface`）并登记为 `state.disabled-*` utility；但**消费侧未改用 token**——13 个 `.vue` 仍走 `opacity-40/50` 字面量近似（**知情接受的存量债**）。⚠️ 部分组件同写的 `pointer-events-none` 是**死类名**：`@lynx-js/tailwind-preset@0.5.1` 的 `corePlugins: DEFAULT_CORE_PLUGINS` 白名单不含 `pointerEvents`（57 项，该类名不产出任何 CSS，已由构建产物实测 + 门禁双重锁定），**不能算进「消费做法」** | `tokens.css` 的 `--md-state-disabled-*`；`tailwind.config.ts` 的 `state.disabled-*`；死类名依据 = `tests/lynxUnsupportedTailwindClasses.test.ts`（preset 白名单 + 产物无 `.pointer-events-none{…}` 规则） |
| **Elevation（层级）** | M3 分 0–5 级，**每级主要由 surface tint（primary 叠加）表达**，box-shadow 为辅 | `--md-elevation-0..5` **六档齐全**：`--md-elevation-0` = `none`（官方定义「无阴影」，**非**外推）、1/2/3 官方配方、**4/5 标注「外推」**——按 `tokens.css` 的可复算规则接续，**不是官方一手表**。⚠️ 层级仍**纯 box-shadow 表达**，与官方「surface tint 为主」口径有差距；消费侧只用到 level 1/2/3，level 0/4/5 **0 处消费** | `tokens.css` 的 `--md-elevation-0` … `--md-elevation-5`（4/5 行尾带「外推」注释 + 段首外推规则说明）；层级口径见 ADR-0207 决策 7 |
| **Surface tint（表面着色）** | 用于表达 elevation 层级的 primary 色调叠加 | 已定义并**已有一处真实消费**：登记为 `surface.tint` → `bg-surface-tint`，由 `PagePickerSheet.vue` 以 `bg-surface-tint opacity-[0.08]` 叠加消费（8% 口径对齐 hover 层），单测钉住「产物有规则 + 模板有真实 class + 低透明度合成生效」并挡住「把 tint 当 bg-primary 改名」的假消费。⚠️ 该消费**不承载 elevation 层级**（是状态层式叠加），层级仍靠 `surface-container-*` 底色 + box-shadow | `tailwind.config.ts` 的 `surface.tint`；`components/PagePickerSheet.vue` 的 `bg-surface-tint opacity-[0.08]` 用例 + `components/PagePickerSheet.test.ts`；色板定义见 `tokens.css` 的 `--md-surface-tint` |
| **Material Symbols** | M3 官方图标集，图标随字号缩放、描边粗细随状态变化 | **已引入 Material Symbols Outlined 子集字体**（ADR-0208）：base64 内联 `@font-face` 在 `src/styles/icon-font.css`，码位映射表 `utils/iconMap.ts` 的 `ICON_CODEPOINTS` 为唯一事实源，模板统一走 `AppIcon.vue` 组件（26 个 `.vue` 在用）。⚠️ 字体为**静态子集**——可变轴 FILL / GRAD / opsz / wght 在子集化时定死（Lynx 的 `@font-face` 不支持 weight/variant），故「描边随状态变化」尚未实现；unicode 字形已退为 `iconMap.ts` 注释里的历史对照 | `src/styles/icon-font.css` 的 `MaterialSymbolsOutlinedSubset`；`utils/iconMap.ts` 的 `ICON_CODEPOINTS` / `ICON_FONT_FAMILY`；`components/AppIcon.vue`；门禁 `tests/iconMap.test.ts` + `tests/iconConsumption.test.ts`；决策见 ADR-0208 |
| **Touch target（触控目标）** | MD3 / Android 平台**建议** ≥ 48×48dp | 见 §9.1「两个口径不是一回事」（平台建议 48dp ≠ WCAG 2.2 AA 最小值 24×24px，两者不可混引） | 差距报告 §1、§3.8 |
| **focus-visible** | 只在键盘/辅助技术导航时暴露焦点环，禁裸 `:focus` | 生产代码 **0** 处 `:focus-visible` / `focus-visible:`（grep 命中全落在 `tokens.css` 的自述注释与门禁/模板测试的断言串里，不是消费）——**刻意为 0，不是「没整改」**：ADR-0207 决策 5 真机实证引擎不匹配（阳性对照 `:active` 生效而这两类无变化），写出来即死类名；门禁 `md3GuardScans` 规则 6 守着「写了就转红」，无障碍改由 `accessibility-element` + 平台焦点环承担 | 差距报告 §2 #4（grep 全量）；ADR-0207 决策 5；门禁 `tests/md3GuardScans.test.ts` 的「规则 6 · 不得出现裸 :focus / :focus-visible」 |
| **prefers-reduced-motion** | 尊重用户「减弱动效」系统偏好 | 已收敛到**唯一偏好事实源** `composables/useReducedMotion.ts`（组件禁自建 `matchMedia`），**6 个组件消费**：`App.vue` / `GlobalFab.vue` / `GlassCard.vue` / `M3Switch.vue` / `RefreshableList.vue` / `BookmarkButton.vue`。降级规则 R1 过渡整条置 `none`、R2 关键帧（含 infinite 循环）亦停、R3 弹性与 stagger 不生成，由单测逐条钉死；无 `matchMedia` 环境按「未开启」处理并 `console.warn`（**禁静默降级**） | `composables/useReducedMotion.ts`（及其单测）；6 个消费组件的 `useReducedMotion` 调用 |
| **Legacy Fluent alias（旧兼容别名）** | 非 MD3 概念。旧 Fluent 2 语义名映射到同一批 M3 令牌，供存量代码继续引用 | 令牌层 22 条 `--color*` + 6 条 `--borderRadius*` + 2 条 `--elevation*`；Tailwind 层 9 组 Fluent 语义名 | `tokens.css` 的 `--color*` / `--borderRadius*` / `--elevation2`+`--elevation4` 定义段；`tailwind.config.ts` 的 `extend.colors` 兼容别名段 |
| **Color role class（色板类）** | 非 MD3 概念。本项目载体：把一整套角色值挂在根 `<page>` 上的 CSS class | 7 支主题色 × 明暗 = **14 个色板类**（7 个 `.theme-X` 亮 + 7 个 `.theme-X.dark` 暗） | `.theme-sky` … `.theme-bili` 七个亮色板选择器 + `.theme-sky.dark` … `.theme-bili.dark` 七个暗色板选择器 |

## 1. 色彩（color）

| 术语 | MD3 官方定义 | 本项目落点 | 证据 |
|---|---|---|---|
| **Primary 四元组** | `primary` / `on-primary` / `primary-container` / `on-primary-container` | 4 条 `--md-primary*`；Tailwind `primary.{DEFAULT,on,container,on-container}` → `bg-primary` / `text-primary-on` / `bg-primary-container` | `tokens.css` 的 `--md-primary*` 四元组；`tailwind.config.ts` 的 `primary` 颜色档位 |
| **Secondary 四元组** | `secondary` / `on-secondary` / `secondary-container` / `on-secondary-container` | 同上，4 条齐全 | `tokens.css` 的 `--md-secondary*` 四元组；`tailwind.config.ts` 的 `secondary` 颜色档位 |
| **Tertiary 四元组** | `tertiary` / `on-tertiary` / `tertiary-container` / `on-tertiary-container` | 同上，4 条齐全 | `tokens.css` 的 `--md-tertiary*` 四元组；`tailwind.config.ts` 的 `tertiary` 颜色档位 |
| **Error 四元组** | `error` / `on-error` / `error-container` / `on-error-container` | 同上，4 条齐全 | `tokens.css` 的 `--md-error*` 四元组；`tailwind.config.ts` 的 `error` 颜色档位 |
| **Surface 基础三角色** | `surface`（底层）+ `on-surface`（其上内容）+ `surface-variant` / `on-surface-variant`（次要内容面） | 4 条齐全；Tailwind `surface.{DEFAULT,on,variant,on-variant}` | `tokens.css` 的 `--md-surface` / `--md-on-surface` / `--md-surface-variant` / `--md-on-surface-variant`；`tailwind.config.ts` 的 `surface` 颜色档位 |
| **Surface container 五档** | `surface-container-lowest` / `-low` / `surface-container`（base）/ `-high` / `-highest`，用**明度分档**表达层级而非阴影 | 5 档全在；Tailwind `surface.container-*` → `bg-surface-container` 等 | `tokens.css` 的 `--md-surface-container-*` 五档；`tailwind.config.ts` 的 `surface.container-*` |
| **Outline 两角色** | `outline`（控件边界）/ `outline-variant`（装饰性分隔线，非控件唯一边界） | 2 条齐全；Tailwind `outline.{DEFAULT,variant}`。`outline-variant` 对比度低于 3:1 属 MD3 角色设计，WCAG 1.4.11 对纯装饰边界有豁免 | `tokens.css` 的 `--md-outline` / `--md-outline-variant`；`tailwind.config.ts` 的 `outline` 颜色档位；差距报告 §3.1 复核补测 |
| **Inverse 三角色** | `inverse-surface` / `inverse-on-surface` / `inverse-primary`（深色反色面，用于 snackbar 等） | 3 条齐全；Tailwind `inverse.{surface,on-surface,primary}` | `tokens.css` 的 `--md-inverse-*` 三角色；`tailwind.config.ts` 的 `inverse` 颜色档位 |
| **Surface dim / bright** | `surface-dim` / `surface-bright` | 2 条已定义 | `tokens.css` 的 `--md-surface-dim` / `--md-surface-bright` |
| **Fixed 角色族** | `primary-fixed` / `-dim` / `variant` 及 `on-×` 对，共 12 个（primary / secondary / tertiary × 4 变体） | 12 条全在 | `tokens.css` 的 `--md-{primary,secondary,tertiary}-fixed*` |
| **Scrim** | 覆盖全屏的遮罩层（`scrim` = 不透明遮罩；`inverse-*` = 其上的内容色） | `--md-scrim: rgba(0,0,0,0.5)`；另自引申出 `--md-scrim-overlay`（沉浸卡底部渐变，**非 M3 官方 token**） | `tokens.css` 的 `--md-scrim` / `--md-scrim-overlay` |
| **Scroll indicator** | M3 未对滚动条色值做强制规定（属平台 affordance） | 亮色 7 主题共用中性值、暗色按各主题 outline 派生；**明暗不对称是有意设计，已在代码留痕**并由测试守值 | `tokens.css` 的滚动条注释块（紧邻兼容别名段之前）；`tests/unit/utils/appearanceClasses.test.ts` |
| **Role naming（角色命名法）** | MD3 用角色名，代码里看不到颜色 | 单一事实源 = `tokens.css` 的 `--md-*`；Tailwind `colors` 只放 `var(--md-*)` 引用，不含字面量 | `tailwind.config.ts` 文件头「colors → M3 语义色板」注释 + `extend.colors` |

### 1.1 「角色化」与本项目「静态色板类」的关系

MD3 规范只定义**角色槽位**，不定义"有几种配色方案"。本项目在角色层之上多了一层**方案选择**（主题色 7 选 1 × 暗色 3 选 1），落地为 14 个色板类。这是项目侧的载体概念，不是 MD3 概念：

- 色板类覆盖在根 `<page>` 上，通过 CSS 变量继承向下生效；运行期**不做任何颜色计算**。
- 亮色 sky 板与 `page` 选择器共用同一条规则（默认即 sky，零视觉变化）。
- 暗色板由脚本生成，**勿手改**；与亮色 `--md-primary` 由漂移锁测试双向锁死。
- 相关术语（主题色 / 色板 / 亮色锚点 / 漂移锁 / 零运行时算色）见 [./glossary-lynx-bili-theme.md](./glossary-lynx-bili-theme.md)，此处不重复。

| 术语 | MD3 官方定义 | 本项目落点 | 证据 |
|---|---|---|---|
| **色板类（palette class）** | 非 MD3 概念 | 亮 7 个 + 暗 7 个 = 14 个；`.theme-X.dark` 复合选择器 | `tokens.css` 的 14 个 `.theme-*` / `.theme-*.dark` 选择器 |
| **暗色三态** | M3 区分 light / dark | `light / dark / system` 三态 + 原生哑桥订阅 | `utils/darkMode.ts` 的 `DARK_MODE_OPTIONS`；`stores/settingsStore.ts` 的持久化 / 系统订阅 / 初始化三处 |
| **生成段（generated block）** | 非 MD3 概念 | 暗色板由脚本产出并锁死，禁止手改 | `tokens.css` 首个暗色板（`.theme-sky.dark`）段的「生成段 / 勿手改」声明；`tests/palettes-drift.test.ts` |

### 1.2 旧 Fluent 兼容别名（并存关系）

新代码一律用 M3 角色名；旧名是**存量兼容层**，值全部指向同一批 M3 令牌（单一事实源不变）：

| 别名族 | 条数 | 项目落点 | 证据 |
|---|---|---|---|
| `--color*`（`--colorNeutralBackground1` 等） | **22 条** | 令牌层 22 条；Tailwind 侧聚合为 9 组语义名（`background` / `foreground` / `stroke` / `brand` / `onBrand` / `danger` / `warning` / `success` / `overlay`） | `tokens.css` 的 22 条 `--color*` 定义；`tailwind.config.ts` 的 `extend.colors` 兼容别名段 |
| `--borderRadius*` | 6 条 | `--borderRadiusSmall/Medium/Large/XLarge/2XLarge/Circular` → 映射到 `--md-shape-*`（值档位已按 M3 对齐，如 6px→8px、16px→28px） | `tokens.css` 的 6 条 `--borderRadius*` 定义 |
| `--elevation2` / `--elevation4` | 2 条 | 旧 elevation 引用 → `--md-elevation-1/2` | `tokens.css` 的 `--elevation2` / `--elevation4` |

> **并存规则**：别名是**只读兼容层**——新增代码不得再写 `--color*` / `bg-brand-*` 等旧名；别名指向的 M3 令牌是唯一事实源。22 条 `--color*` 里有 **5 条**是字面量而非 `var()` 引用（`--colorBrandBackgroundHover` / `--colorBrandBackgroundPressed` / `--colorBrandForeground2` / `--colorPaletteGreenBackground3` / `--colorOverlayForeground`），属令牌定义处的可接受例外。

## 2. 排版（type scale）

### 2.1 MD3 的四元组

MD3 的排版档位是 **size + line-height + tracking + weight** 的四元组，四者**同档绑定**：换档即四项同时变。项目已按 ADR-0206 决策 1 补齐前三项（`fontSize` 数组的 `['<size>', { lineHeight, letterSpacing }]` 形式），weight 走 `fontWeight` 档位（决策 2）。

| 项 | MD3 官方定义 | 本项目落点 | 证据 |
|---|---|---|---|
| **Size（字号）** | 15 档 sp 值 | **15 档齐全**的 rpx 值（1sp = 2rpx @375），与官方 size 逐档对齐；另有 10 条旧档位兼容别名 | `tailwind.config.ts` 的 `fontSize` 语义档位段（`'display-large'` … `'label-small'`）与旧档位段（`xs` … `'6xl'`） |
| **Line height（行高）** | 每档配固定 line-height（body-large 1.5rem、label-large 1.25rem、headline-large 2.5rem…） | ✅ **已定义**：`fontSize` 每档的 `lineHeight` 项（sp × 2 换算 rpx）。⚠️ **行高已由档位决定，正文不应再手写 `leading-*`**；模板里残留的自选行高只剩 `TextSelectionToolbar.vue` 的 1 处 `leading-[3vw]`（`text-[2.4vw]` 任意尺寸 + 图标字形收紧排版，在 `tests/md3-guard-whitelist.json` 的 `self-chosen-leading` 台账内），另有 10 处 `leading-none` 同属该登记口径 | `tailwind.config.ts` 的 `fontSize` 第二元素；台账 `tests/md3-guard-whitelist.json` 的 `rule: "self-chosen-leading"` 条目；`components/TextSelectionToolbar.vue` 的 `text-[2.4vw] leading-[3vw]` |
| **Tracking（字距）** | 每档配 letter-spacing（body-large 0.03125rem = 0.5px、label-large 0.00625rem = 0.1px、title-medium 0.009375rem = 0.15px） | ✅ **已定义**：`fontSize` 每档的 `letterSpacing` 项（sp × 2 换算 rpx）。官方区间 0–0.5sp ⇒ 项目 0–1rpx，1x 屏上亚像素；因此**模板里 `tracking-*` 类名 0 处是预期结果**（行高字距由档位类带出，不需要组件再写） | `tailwind.config.ts` 的 `fontSize` 第二元素；`tests/md3GuardScans.test.ts` 无 tracking 形态规则（由 ADR-0206 决策 1 的档位定义承担） |
| **Weight（字重）** | label-* 与 title-small/medium = 500；body-* 与 headline-* = 400 | ✅ **已分档**：`extend.fontWeight` 登记 `regular: 400` / `medium: 500`，对应决策 2「weight 不随字号档位派生、需组件显式写 `font-medium`」。⚠️ **存量债**：`font-medium` 仍散在 41 个 `.vue`、`font-regular` 5 个、**`font-bold`(700) 仍有 1 个文件**（700 不属于任何 M3 档位，是清理对象） | `tailwind.config.ts` 的 `extend.fontWeight`；ADR-0206 决策 2（`font-bold` 清理属决策 2 后半段，`.vue` 层待办） |

> **官方数值的取数纪律**：上表**不逐档列官方 line-height / tracking 数值** —— 已落地的逐档值全在 `tailwind.config.ts` 的 `fontSize` 定义里，性质是「已人工回源核对过的一手断言」（见 §12.3(b)）。本表**只登记「哪几个键已定义、谁在消费」**，不复制数值，避免两处抄本各自漂移。引用具体数值时按 ADR-0205 决策 1 回源 `tokens/versions/v0_192/_md-sys-typescale.scss` 核对，**勿凭记忆填表、勿从本表或配置里反推**。

### 2.2 15 档映射现状

| 档位族 | MD3 档位 | 项目 size（rpx） | 状态 |
|---|---|---|---|
| **Display** | display-small / medium / large | 72 / 90 / 114 | ✅ 三档已补（此前全缺）。⚠️ **`text-display-*` 消费数仍为 0** —— 档位可表达不等于已用 |
| **Headline** | headline-small / medium / large | 48 / 56 / 64 | ✅ |
| **Title** | title-small / medium / large | 28 / 32 / 44 | ✅ |
| **Body** | body-small / medium / large | 24 / 28 / 32 | ✅ |
| **Label** | label-small / medium / large | 22 / 24 / 28 | ✅ |

证据：`tailwind.config.ts` 的 `fontSize` —— 语义档位 **15 条**（`'display-large'` … `'label-small'`，每条含 size + lineHeight + letterSpacing）、旧档位别名 10 条。**15/15 档齐全**。行高/字距的逐档官方值同样只在该配置内可查，引用时按 ADR-0205 决策 1 回源 `tokens/versions/v0_192/_md-sys-typescale.scss` 核对，勿凭记忆填表。

### 2.3 旧档位别名（塌陷档位）

旧档位类名（`text-xs` … `text-6xl`）保留为兼容别名，值已对齐"最接近的 M3 档位"；**存在多档映射到同一值的有意塌陷**：

| 旧档位 | 值 | 塌陷情况 |
|---|---|---|
| `xs` / `sm` | 22rpx / 24rpx | 各自唯一 |
| `base` / `lg` / `xl` | 28rpx / 28rpx / 28rpx | **三档同值**，失去层级差 |
| `2xl` | 32rpx | 唯一 |
| `3xl` | 44rpx | 唯一 |
| `4xl` | 48rpx | 唯一 |
| `5xl` / `6xl` | 56rpx / 56rpx | **两档同值** |

10 条别名现在**各自带完整四元组**（size + lineHeight + letterSpacing，weight 仍需显式 `font-medium`）：`lineHeight` / `letterSpacing` 整档取自映射目标档，size 沿用对齐后的既有值（**本次不因补四元组而改任何 size，避免存量观感位移**）。因 size 塌陷，`base`/`lg`/`xl` 三档塌陷后靠 line-height/tracking 仍能区分部分层次。

证据：`tailwind.config.ts` 的 `fontSize` 旧档位段（含「值已对齐 M3 最接近档位」注释）。这是**有意决策**（新代码用语义档位），不是缺陷；`base/lg/xl`、`5xl/6xl` 的同值是**有意塌陷**，勿当 bug 修。

## 3. 形状（shape）

| 术语 | MD3 官方定义 | 本项目落点 | 证据 |
|---|---|---|---|
| **extra-small** | 4dp | `--md-shape-extra-small: 1.067vw` | `tokens.css` 的 `--md-shape-extra-small` |
| **small** | 8dp | `--md-shape-small: 2.133vw` | `tokens.css` 的 `--md-shape-small` |
| **medium** | 12dp | `--md-shape-medium: 3.2vw` | `tokens.css` 的 `--md-shape-medium` |
| **large** | 16dp | `--md-shape-large: 4.267vw` | `tokens.css` 的 `--md-shape-large` |
| **extra-large** | 28dp | `--md-shape-extra-large: 7.467vw` | `tokens.css` 的 `--md-shape-extra-large` |
| **full** | 9999px | `--md-shape-full: 9999px` | `tokens.css` 的 `--md-shape-full` |

来源：material-web v0.192 `_md-sys-shape.scss`。dp→vw 换算按 375 设计稿（1dp = 0.2667vw，权威换算见 [./glossary-lynx-units.md](./glossary-lynx-units.md)）。

### 3.1 本项目特殊约定（四条，必须知悉）

| 约定 | 说明 | 证据 |
|---|---|---|
| **Shape 随屏宽缩放（dp→vw）** | 圆角不是固定 dp，而是按视口宽线性缩放的 vw 值。取舍：与间距档位（vw）视觉一致，代价是同一 shape token 在不同屏宽下物理尺寸不同 | `tokens.css` 的 `--md-shape-*` 6 档（含换算注释）；间距同策略见 `tailwind.config.ts` 的 `spacing` |
| **`borderRadius` 已注册，档位名与 arbitrary 写法并存** | ADR-0207 决策 1 已把 6 档**顶层替换**进 `tailwind.config.ts` 的 `borderRadius`（`none` + `xs`/`sm`/`DEFAULT`/`lg`/`xl`/`full`），全部指向 `var(--md-shape-*)`。⚠️ 顶层替换（而非 `extend`）是为了清掉 Tailwind 3 默认的 rem 档位（`rounded-md`=6px、`rounded-3xl`=24px，**均不在 M3 scale 上**），且 28dp 的 extra-large 在默认档位里无对应项。**`2xl`/`3xl` 有意不定义**（M3 shape scale 只有 6 档，再挂同值别名会让人误以为有 Tailwind 惯例的两级）。**新代码用档位名，存量 arbitrary 写法不迁移** | `tailwind.config.ts` 的 `borderRadius`；护栏见 ADR-0207 决策 1。消费统计（生产 `.vue`，本轮后实测）：`rounded-*` 共 **340** 处 = 消费 shape token **291**（254 处裸 `rounded-[var(--md-shape-*)]` + 21 处方向变体带 token + 16 处 `rounded-b-none`）+ 49 处 `rounded-full`；**档位名（`rounded-xs/sm/lg/xl`）0 处**，Tailwind 默认档位 `rounded-md/2xl/3xl` **0 处**。⚠️ `rounded-b-none` 由整改前的 2 → **16**（本轮 17 处 input 的底 0dp 圆角，官方 `corner-extra-small-top` 明文） |
| **残留非 token 圆角** | 49 处 `rounded-full`（Tailwind 内置 `full` = 9999px，数值恰好等于 `--md-shape-full`，但**不走 token**）；**16 处 `rounded-b-none`**（本轮由 2 → 16：17 处表单输入框的底 0dp 圆角，官方 `corner-extra-small-top` 的明文要求，非「未写」）。⚠️ 此前登记的「2 处硬编码 `rounded-[0.65vw]` ≈ 2.4px，低于 M3 最小档 4px」**已清零** —— `TextSelectionToolbar.vue` 的手绘复制图标两段描边改走 `rounded-full` | `components/TextSelectionToolbar.vue` 的图标描边 `rounded-full` 用例；17 处 input 的 `rounded-t-[var(--md-shape-extra-small)] rounded-b-none`（ADR-0209 决策 3） |
| **shape 档位名消费为 0 是已知存量债，不是缺陷** | 档位名已注册但**生产代码 0 处消费** —— 275 处 arbitrary 写法当前就是对的，迁移属纯收益无风险的批量替换，未排期。⚠️ 迁移前先确认：Tailwind 的**类名在模板字符串里的可见性**（`md3GuardScans` 规则 3 的注释已记录「只认双引号/单引号」） | 消费统计见上格；`tests/md3GuardScans.test.ts` 规则 2「未接令牌的圆角消费」 |

### 3.2 文本字段（text field）— ADR-0209

| 术语 | MD3 官方定义 | 本项目落点 | 证据 |
|---|---|---|---|
| **Filled text field（填充式文本框）** | 容器 56dp，底色 `surface-container-highest`，**顶部 4dp / 底部 0dp 圆角**（官方 shape token `corner-extra-small-top`），**底部**一条指示条：未聚焦 1px `on-surface-variant` → 聚焦 2px `primary` | 全仓 17 处 `<input>` 统一形态：`h-[14.933vw]` + `bg-surface-container-highest` + `rounded-t-[var(--md-shape-extra-small)] rounded-b-none` + `border-b-[1px] border-b-surface-on-variant`（聚焦态 2px + `primary`）。⚠️ 指示条色是 `on-surface-variant`（官方 `active-indicator-color`），**不是 `outline-variant`** —— 后者是 outlined 变体的色 | 官方真值回源见 [ADR-0209 决策 1](./ADR-0209-md3-filled-text-field-alignment.md)；消费分布 = `Me.vue` ×7 / `SettingsEndpoint.vue` ×6 / `BookmarkPanel` / `CommentInputBar` / `Login` 各 ×1 + `SearchSheet` ×1（豁免） |
| **Active indicator（指示条）** | 位于容器**底部**（`.active-indicator { inset: auto 0 0 0 }` + `border-bottom`），未聚焦 1px、聚焦 2px | 以 Tailwind `border-b-[Npx]` + `border-b-{outline-variant\|primary}` 表达 | material-web `field/internal/_filled-field.scss`；`_md-comp-filled-text-field.scss` 的 `active-indicator-height` / `focus-active-indicator-height` |
| **Floating label（浮动标签）** | 静止 `body-large` + `on-surface-variant`；**聚焦或已有值**时浮到顶部并转 `body-small` + `primary` | 由 `<input>` 的 **focus/blur 事件**驱动响应式 class，**不使用 `:focus` 伪类**（伪类在本项目是死类名，见下） | 引擎能力：Lynx `<input>` 官方 `bindfocus`/`bindblur`（Android/iOS since 3.4，SDK 4.0.1 满足）——<https://lynxjs.org/3.6/api/elements/built-in/input> |
| **⚠️ 伪类 vs 事件（易混点）** | — | ADR-0207 决策 5 判定的 `:focus` / `:focus-visible` 是**伪类**且引擎不匹配（刻意为 0）；ADR-0209 决策 2 用的是**元素事件**。**两者判定的不是同一件事**，不因本条而改写 ADR-0207 的结论 | ADR-0207 决策 5；ADR-0209 决策 2 |
| **药丸搜索框（有意偏离）** | M3 filled/outlined 均为 56dp + 特定圆角 | `SearchSheet.vue` 保持 42dp 全圆角药丸 —— ADR-0205 决策 4 第 2 条**已豁免**，封闭清单**不因本 ADR 扩张** | `components/SearchSheet.vue` 的 `h-[11.2vw] rounded-[var(--md-shape-full)]`；门禁 `tests/md3FilledTextField.test.ts` 的 `EXEMPTIONS` 登记制（死登记转红） |
| **形态门禁** | 形态类应受机器防线保护 | `tests/md3FilledTextField.test.ts`：非豁免 `<input>` 的**静态** `class` 必含 56dp + 顶 4dp 令牌圆角 + 底 0 + 底部 1px `on-surface-variant` 指示条 + `bg-surface-container-highest`。⚠️ **4 项形态只认静态 class，动态 `:class` 不参与补齐** —— 未聚焦基线必须静态可判；且若允许动态补齐，同一 input 调一个**被共享**的合规函数即可替「静态缺形态」的违规 input 免检（该绕过已实测并被反事实锁死）。含四类反事实 + 跨元素污染反例 + 共享函数背书反例 + 抽取器自检；**已知失效面见 ADR-0209 复核判据 2** | `tests/md3FilledTextField.test.ts`；依据 ADR-0209 复核判据 1/2/4 |
| **指示条的两层承载** | 聚焦态颜色/粗细随焦点变 | **刻意不用互斥类对**：① 未聚焦 1px + `on-surface-variant` 写在 input **静态** class；② 聚焦 2px + `primary` 是 input 之后的**独立 `<view>` 覆盖**。⚠️ 换互斥类（同一 CSS 属性叠 `border-b-[1px]`/`[2px]`）会让胜负取决于 **Tailwind 产物声明顺序**——实测 `.border-b-primary` 排在 `.border-b-surface-on-variant` **之前**，颜色侧会静默停在未聚焦色 | `pages/Me.vue` 各 input 的 `h-[2px] bg-primary` 覆盖元素；`components/SettingsEndpoint.vue` 的 `v-if="isFocused(...)"` 同款；ADR-0209 决策 3 |
| **label 与 placeholder 分家** | label 是字段名，placeholder 是提示 | 两者**不同 key**且**不同时显示**：`*Label` 短名（label，恒显示）；`*Placeholder` 可带括号补充说明（placeholder，**仅聚焦时显示**，静止与有值未聚焦时传空串）。⚠️ 双重理由：① placeholder 允许冗长，label 浮到 56dp 顶部后与输入文字同行，长文案会挤在一起；② 同框渲染会出双行——**真机实证两种失败形态**（2026-10-01 emulator-5554）：静止态「用户名/用户名」、有值未聚焦态「目录/目录（默认…）」 | `src/i18n/locales/{zh-CN,en}/misc.ts` 的 `me.webdav.*Label`；`pages/Me.vue` 的 `isPlaceholderShown(id)`；门禁 `tests/md3FilledTextField.test.ts`「label 与 placeholder 不得同框渲染」 |
| **浮动 label 的命中测试** | — | ✅ **真机已证不构成风险**（2026-10-01 emulator-5554）：点击落在绝对定位 label 上时软键盘正常弹出、input 获焦 ⇒ 原生 LynxView 的命中测试**让位**给下方 input。`pointer-events-none` 是死类名这一点在本方案下**无关紧要**（无需它来规避） | ADR-0209 第②层真机验证表；截图留档于开发会话（`/tmp/md3-probe/18-focus-label.png`，未入库） |

> ⚠️ **两处易错口径（ADR-0209 决策 1 已纠正，勿再改回）**：
> ① 指示条在**底部**，**不是**顶部色带；② 圆角是**顶 4dp / 底 0dp**，
> **底角不是 12dp**。项目输入框的 `rounded-t-extra-small rounded-b-none` +
> 底部 1px 指示条**恰好命中官方真值**（整改前 `CommentInputBar` / `Login` 共 2 处已如此，
> 其余 14 处是本轮整改拉齐的；整改后全仓 16 处 `rounded-b-none`）——按错误口径实施会把已经正确的改错。

## 4. 动效（motion）

### 4.1 缓动曲线（easing）

| 术语 | MD3 官方定义（material-web v0.192） | 本项目落点 | 证据 |
|---|---|---|---|
| **`easing-standard`** | `cubic-bezier(0.2, 0, 0, 1)` | `--motion-standard` 同值 ✅ | `tokens.css` 的 `--motion-standard` |
| **`easing-emphasized`** | `cubic-bezier(0.2, 0, 0, 1)`（**与 standard 同值是官方事实，非缺陷**） | `--motion-emphasized` 同值 ✅ | `tokens.css` 的 `--motion-emphasized` |
| **`easing-emphasized-accelerate`** | `cubic-bezier(0.3, 0, 0.8, 0.15)` | `--motion-emphasized-accelerate` 同值 ✅ | `tokens.css` 的 `--motion-emphasized-accelerate` |
| **`easing-emphasized-decelerate`** | `cubic-bezier(0.05, 0.7, 0.1, 1)` | `--motion-emphasized-decelerate` 同值 ✅ | `tokens.css` 的 `--motion-emphasized-decelerate` |
| **`easing-legacy`** | `cubic-bezier(0.4, 0, 0.2, 1)` —— **MD2 遗留，不是 standard**。本项目历史上曾把它误判为 standard，2026-09 复核已更正 | 项目**未定义**该 token；但 Tailwind `transition-*` 的默认 timing function 曾是该值（来自 lynx preset）。✅ **已整改**：`transitionTimingFunction` 顶层替换清掉越界档位，并在 `extend.transitionTimingFunction.DEFAULT` 重新声明为 `var(--motion-emphasized)`，解决 preset 的 extend 在顶层 theme 键**之后**合并覆盖的坑 | `tailwind.config.ts` 的 `transitionTimingFunction` + `extend.transitionTimingFunction.DEFAULT`；门禁 `tests/md3GuardScans.test.ts` 规则 1「MD2 legacy 缓动」 |
| **非 M3 曲线** | M3 未定义的缓动不应出现 | ✅ **已清零**。`GlassCard.vue` 原用的 `cubic-bezier(0.33, 0, 0.67, 1)`（Fluent standard，非 M3）已改为 `var(--motion-emphasized-decelerate)`；`RefreshableList` / `GlobalFab` / `BookmarkButton` 的动效也全部走 `--motion-*` 令牌 | `components/GlassCard.vue` 的 `transform` 过渡声明（注释自述「曲线走令牌」）；门禁规则 1 守护 |

### 4.2 时长档位（duration）

| 术语 | MD3 官方定义 | 本项目落点 | 证据 |
|---|---|---|---|
| **short1–short4** | 50 / 100 / 150 / 200ms | `--durationFast: 150ms`（short3）、`--durationNormal: 200ms`（short4）。short1/short2 未定义 | `tokens.css` 的 `--durationFast` / `--durationNormal` |
| **medium1–medium4** | 250 / 300 / 350 / 400ms | `--durationMedium1: 250ms`、`--durationGentle: 300ms`（medium2）、`--durationMedium3: 350ms`。medium4 未定义 | `tokens.css` 的 `--durationMedium1` / `--durationGentle` / `--durationMedium3` |
| **long1–long4** | 450 / 500 / 550 / 600ms | **未定义** | — |
| **extra-long1–4** | 700 / 800 / 900 / **1000ms** | `--durationExtraLong4: 1000ms`（`RefreshableList` 的 `.fab-spin` 无限循环）。前三档未定义 | `tokens.css` 的 `--durationExtraLong4`；官方值见 material-web `tokens/versions/v0_192/_md-sys-motion.scss` 的 `'duration-extra-long4'`（2026-09-30 联网核对） |
| **stagger delay（错峰延迟）** | M3 无官方值 | 组件自定，可留：`RefreshableList.vue` 的 `item-rise-*` keyframes 注释（0/60/120ms）、`GlobalFab.vue` 的 `staggerMs(i, 30)`（30ms 步进） | `components/RefreshableList.vue` 的 `item-rise` 动画；`components/GlobalFab.vue` 的 `staggerMs` |
| **硬编码毫秒绕过 token（残留债）** | 应走 duration token | ✅ **本轮已清零**（ADR-0209 配套整改）：① `GlobalFab.vue` 的 `.fab-ring-spin` → `animation: fab-ring-spin var(--durationExtraLong4) linear infinite`（令牌化，原 `1s` 字面量在册登记已删除）；② `App.vue` 的 `.shimmer` → `tokens.css` 新增 `--shimmer-motion: shimmer var(--durationExtraLong4) linear infinite` **真实定义**，故 1000ms 生效值走令牌。⚠️ `App.vue` 的**回退实参 `1.5s` 仍逐字保留**——它被 `src/shimmerGate.test.ts` 断言必须在（去掉后若引擎不解析回退，`animation` 取初始值 `none` ⇒ 全站骨架屏消失，有真机实证）。该字面量已从「隐形的盲区」转为**在册登记的可见项**（见下格）。0/60/120ms stagger 延迟按 §4.2「M3 无官方值」例外保留 | `components/App.vue` 的 `.shimmer` 声明 + `src/styles/tokens.css` 的 `--shimmer-motion`；`components/GlobalFab.vue` 的 `.fab-ring-spin` |
| **（上一格的）门禁覆盖边界** | 判据本身也是现状的一部分 | ✅ **本轮已修**：`motionDurationTokens.template.test.ts` 的两处判据缺陷已补——① `SOURCES` 从硬编码 3 文件改为**扫全仓生产 `.vue`**（75 个文件）；② `scanDurations` 原先第 123 行把**整个 `var(...)` 连回退实参一起摘掉**，致 `var(--x, 200ms)` 里的 `200ms` 隐形（盲区）；现改为**只摘变量名、保留回退实参参与判据**。判别力由反事实证明：旧的整段摘除判据对 `var(--shimmer-motion, shimmer 1.5s …)` **不红**而现行判据**红**（同一 token kernel，仅归一化不同）。⚠️ **剩余覆盖边界（已知，非缺陷）**：判据只覆盖 CSS 里 `animation:` / `transition:` 声明；全仓 75 个生产 `.vue` 中仅 5 个有此类声明（其余动效走 Tailwind utility 或 `:style` 绑定），长写法的 `animation-duration:` 不在 `\b(?:animation|transition):` 匹配内 —— 当前零实例，未加判据（不为假想造门禁） | `src/components/motionDurationTokens.template.test.ts` 的 `SOURCES`（全仓递归）/ `LITERAL_EXCEPTIONS` / `scanDurations`（回退实参不再被整段摘除） |

> **证据列为什么不再写行号**：本表原先逐格引用 `tokens.css:153-154` 这类行号，
> 而 tokens.css 每轮整改都在增删行 —— 复审实测**整体偏移 61 行**，
> 格子里的数字指向的已经是 `--colorBrandForeground2` 这类完全无关的声明。
> 行号在这里是**必然漂移的引用**，改成令牌名 / keyframes 名这类稳定锚点。
> **该纪律现已适用于本表全文**（§1–§11 全部证据列用「令牌名 / 类名 / 文件 + 符号名」）；
> 唯一例外是 §12.1 —— 那是**整改前快照**，行号本身就是被留痕的对象，勿当现状引用。
> 仍需行号定位时，请现场 `grep` 令牌名 / 类名，不要引用本表里的历史行号。

### 4.3 引擎约束

| 术语 | MD3 官方定义 | 本项目落点 | 证据 |
|---|---|---|---|
| **Expressive spring** | MD3 Expressive 的 spring 物理曲线（stiffness / damping 模型，非 cubic-bezier） | ⛔ **引擎受限**：Lynx transition 支持有限，无法表达 spring；现有组件用 cubic-bezier 近似 | `tokens.css` 的 `--motion-*` 段注释（自述「Lynx transition 属性支持有限」）；差距报告 §5 |
| **`prefers-reduced-motion`** | 尊重用户系统偏好 | ✅ **已收敛到唯一偏好事实源** `composables/useReducedMotion.ts`（组件禁自建 `matchMedia`），**6 个组件消费**：`App.vue` / `GlobalFab.vue` / `GlassCard.vue` / `M3Switch.vue` / `RefreshableList.vue` / `BookmarkButton.vue`。降级 R1 过渡整条置 `none`、R2 关键帧（含 infinite 循环）亦停、R3 弹性与 stagger 不生成；无 `matchMedia` 环境按「未开启」处理并 `console.warn`（**禁静默降级**） | `composables/useReducedMotion.ts` 及其单测；6 个消费组件的 `useReducedMotion` 调用 |

## 5. 状态层（state layer）

MD3 的交互反馈是**覆盖在容器色之上的半透明 alpha 层**，不是"算好的实色"。

### 5.1 官方四态 opacity 与项目现状

| 状态 | MD3 官方 opacity | 项目 token | 状态 | 证据 |
|---|---|---|---|---|
| **hover** | 0.08 | `--md-state-layer-hover-{primary,on-surface,error,surface,on-primary}`（5 条） | ✅ | `tokens.css` 的 `--md-state-layer-hover-*` |
| **focus** | 0.12 | `--md-state-layer-focus-{primary,on-surface,error,surface,on-primary}`（5 条） | ✅ | `tokens.css` 的 `--md-state-layer-focus-*` |
| **pressed** | 0.12 | `--md-state-layer-pressed-{primary,on-surface,error,surface,on-primary}`（5 条） | ✅ | `tokens.css` 的 `--md-state-layer-pressed-*` |
| **dragged** | 0.16 | `--md-state-layer-dragged-{primary,on-surface,error,surface,on-primary}`（5 条） | ✅ | `tokens.css` 的 `--md-state-layer-dragged-*` |
| **disabled（容器）** | on-surface 12% | `--md-state-disabled-container` | ✅ 已定义；⚠️ 消费侧未改用（见 §5.3） | `tokens.css` 的 `--md-state-disabled-container` |
| **disabled（内容）** | on-surface 38% | `--md-state-disabled-on-surface` | ✅ 已定义；⚠️ 消费侧未改用（见 §5.3） | `tokens.css` 的 `--md-state-disabled-on-surface` |

**四态合计 20 条** `--md-state-layer-*`（4 态 × 5 色）；`-surface` 档取 primary 色相（`tokens.css` 内以 `var()` 自引用注明）；⚠️ **`-on-primary` 档是唯一的例外**——它是**预合成的不透明色**而非 alpha，理由见 §5.4。⚠️ 消费侧只有 **pressed** 有真实用例（hover/focus/dragged 三态令牌已就绪但 `hover:`/`focus:` 在纯触屏判定为不适用、dragged 无触发源，详见 §5.3 与 §11 第 4 条）。

来源：material-web v0.192 `_md-sys-state.scss`（`focus` 是 12% 不是 10%，2026-09 复核更正，见差距报告 §8.4）。

### 5.2 本项目的两套并存（关键歧义点）

| 术语 | 官方口径 | 项目落点 | 证据 |
|---|---|---|---|
| **`--md-state-layer-*`** | ✅ **正确**：alpha 叠加层，容器色透过 | **20 条**（4 态 × primary/on-surface/error/surface/on-primary），Tailwind 登记为**顶层** utility `bg-layer-{hover,focus,pressed,dragged}-*`。⚠️ 嵌套在 `state` 组下会产出**不同名**的 `bg-state-layer-*`（`state.layer-*` 别名组也保留着，两套写法现已对称） | `tokens.css` 的 `--md-state-layer-*`；`tailwind.config.ts` 的顶层 `layer-*` 键与 `state.layer-*` 别名 |
| **`--md-state-pressed-*`** | ❌ **非官方**：预计算实色（容器色 + 12% primary/black 的合成结果） | 4 条（primary / on-surface / error / surface），Tailwind `state.pressed-*` → `bg-state-pressed-*`。⚠️ **消费已不再以这一套为主**：实测生产 `.vue` 里正确 alpha 层 `active:bg-layer-pressed-*` **27 处** vs 预计算实色 `active:bg-state-pressed-*` **24 处** —— 顶层 utility 落地后优先级已反转，两套现在基本持平 | `tokens.css` 的 `--md-state-pressed-*`；`tailwind.config.ts` 的 `state.pressed-*` |
| **`bg-layer-pressed-on-primary`** | 不该存在 | ✅ **已从死类名转正**：`layer-pressed-on-primary` 已登记进 `tailwind.config.ts` 顶层颜色档位（`state` 嵌套别名组同步补齐），对应令牌 `--md-state-layer-pressed-on-primary` 逐色板声明。✅ **生产 `.vue` 有 2 处消费**：`SettingsEndpoint` 的保存按钮与 `TranslateButton`，均用 `active:bg-layer-pressed-on-primary`（#867 修完令牌后已恢复；`active:` 是 Lynx 唯一可用的按压机制，见 §5.4）。门禁 C3 钉住「消费点必须与 `bg-primary` 同元素」 | `tailwind.config.ts` 的 `layer-pressed-on-primary`；`tokens.css` 的 `--md-state-layer-pressed-on-primary`；门禁 `tests/stateLayerOnPrimary.test.ts` A2 / A4（反事实：撤登记即退化为死类名） |
| **`bg-layer-hovered-on-primary`（⚠️ 死类名）** | 不该存在 | **零规则**：`tailwind.config.ts` 只注册了 `layer-hover-` 系列，**无 `hovered` 变体**（正确名是 `layer-hover-on-primary`）。✅ **原 `TranslateButton.vue` 的那处 `hover-class` 绑定已删除**，全仓 `hover-class` 里不再有状态层类名。⚠️ 双重失效 —— 类名不存在，**且 `hover-class` 属性本身在 Lynx 上不产生视觉切换**（§5.4 / ADR-0207 决策 9） | `tailwind.config.ts` 的 `layer-hover-*` 段（无 `hovered` 变体）；`components/TranslateButton.vue` 的 `hover-class` 绑定 |
| **字面量 alpha 绕过 token** | 应走 state layer token | ⚠️ 仍存：`ActionButton.vue` 在非 disabled 分支用 `active:bg-white/10`（≈10% 白的实色近似，不是 primary 12% 的 state layer） | `components/ActionButton.vue` 的 `disabled ? 'opacity-50' : 'active:bg-white/10'` |

> **判读规则**：看到 `--md-state-pressed-*` 不要当成"另一种 MD3 表达"——它是官方 alpha 层的**预计算替身**。两套并存是过渡态，不是两种设计语言。

### 5.3 伪类近似

| 术语 | MD3 官方定义 | 本项目落点 | 证据 |
|---|---|---|---|
| **hover 伪类** | 指针悬停时叠加 hover 层 | 全仓生产 `.vue` 的 `hover:*` 命中 **0**。纯触屏无 hover 场景，登记为「有意偏离：hover 在纯触屏判定为不适用」（§11 第 4 条） | 差距报告 §2 #4；ADR-0205 决策 4 |
| **`active:` 变体近似** | pressed 态的官方触发 | 用 Tailwind `active:` 变体近似 pressed —— 是 Lynx 上**唯一可用的**按压反馈路径（`hover-class` 属性本身无效，见 §5.4）。✅ **已从「静默失效」转为生效**：四态 utility 此前被错登记在 `state` 组下，真实类名是 `bg-state-layer-*`，而存量代码写的是 ADR-0207 规定的 `bg-layer-pressed-*` —— 约 15 处组件的 pressed alpha 反馈一直不产出任何 CSS；顶层登记后真正生效（**属可见视觉变化，已进截图回归**） | `tailwind.config.ts` 的顶层 `layer-*` 段（注释自述「实测在改动前不产出任何 CSS」）；ADR-0207 决策 4 |
| **focus-visible** | 键盘/辅助技术导航时暴露焦点环，**禁裸 `:focus`** | ✅ **刻意为 0，不是「没整改」**：生产代码 `focus-visible` / `focus-visible:` / `:focus` 均 **0** 处。ADR-0207 决策 5 真机实证引擎不匹配（阳性对照 `:active` 生效而这两类无任何变化），写出来即死类名、**静默无样式**。门禁规则 6 守着「写了就转红」；无障碍改由 `accessibility-element` + 平台焦点环承担 | `tests/md3GuardScans.test.ts` 规则 6；ADR-0207 决策 5 |
| **disabled 消费方式** | on-surface 12%/38% alpha 层 | ⚠️ **未改用 token，属知情接受的存量债**：`--md-state-disabled-*` 两条令牌 + `state.disabled-*` utility 均已就绪，但 **13 个生产 `.vue`** 仍走 `opacity-40` / `opacity-50` 字面量近似（`ActionButton` / `BookmarkButton` / `BookmarkPanel` / `CommentItem` / `M3SegmentedButton` / `PagePickerSheet` / `SearchSheet` / `SettingsEndpoint` / `TranslateButton` / `WatchlistPromptDialog` / `DownloadManager` / `NovelIntro` / `Ranking`）。⚠️ 部分组件同写的 `pointer-events-none` 是**死类名、不产出任何 CSS**（`@lynx-js/tailwind-preset@0.5.1` 的 `corePlugins` 白名单不含 `pointerEvents`），**不能算进「消费做法」**，也不构成「禁用态真的挡了点击」的证据 | 实测口径：生产 `.vue`（剔除 `.test.`）全文 grep `opacity-(40\|50)`；死类名依据 = `tests/lynxUnsupportedTailwindClasses.test.ts`（preset 白名单 + 构建产物无 `.pointer-events-none{…}` 规则） |

### 5.4 引擎能力边界：为什么 `on-primary` 档不是 alpha（#867 / #868）

MD3 状态层的前提是「**把一层半透明色盖在已知底色上**」（合成语义）。Lynx 给的是「**换掉**底色」（替换语义）——`background-color` 被 `bg-*` 直接替换，不与容器色合成。三条边界均真机实证（`pictelio_ui`，API 34 / Lynx SDK 4.0.1）：

| 能力边界 | 实证观测 |
|---|---|
| `background-color` 是**替换**语义 | alpha 层画在实心底色上时底色被替换，观感 = 半透明层直接叠在**背后的页面色**上 ⇒ 实心 primary 按钮按压时「填色整个消失」 |
| 不渲染 `color-mix()` | `bg-[color-mix(in srgb, var(--md-primary) 12%, var(--md-on-primary))]` 按下后测得 `(248,250,255)`，恰等于探针容器 `bg-surface` 的白 ⇒ 声明彻底失效、背景变透明（失败方式比原缺陷更隐蔽） |
| `hover-class` 不产生视觉切换 | 5 个色块按住期间**全部零变化**，连不透明色的阳性对照也不变；而同一次长按确实触发了 `@tap`（对照块逐次 toggle）⇒ 注入链路正常，是属性本身无效 |

**后果与修法**：

- **`on-primary` 档改预合成不透明色**（14 色板逐板声明，`bg-layer-pressed-on-primary` 等 utility 生效）。`color-mix()` 已被真机否证，伪元素方案未验证 ⇒ 这是三个方案里唯一落地的。
- **范围由机器判据圈定，不是凭感觉**：`scripts/state-layer-collapse-audit.mjs` 对全量 **280 条**（14 色板 × 5 role × 4 态）算「替换后观感 vs 元素原底色」的 CIELAB ΔE76。修复前 56 条 ΔE ∈ [62.79, 83.39] 会塌，**全部是 `-on-primary` 档**；不塌侧 224 条 ΔE ∈ [4.31, 16.81]。两簇间是 45.98 宽的数据空档，阈值取 **25** 落在空档内（[16.82, 62.78] 内任意取值结论不变）。⚠️ 早先报 256 条：6 个亮色板不声明 `--md-error`、靠 `page,` 基础块继承，而脚本静默跳过 ⇒ 24 行无声丢失（违反「禁静默降级」），已修。修复后重跑：**0 条**会塌，ΔE 上限 16.81。
- **阈值由两个锚点夹逼，非拍脑袋** —— 两列是**各自独立可复算**的量化，不是互相印证：设备侧（emulator-5556 的 RGB 取样）`on-primary/pressed` 静止 `(26,111,168)` → 按住 `(249,251,255)`（≈ 页面色，填色消失；该值 = sRGB 直混 `composite(#ffffff, 0.12, #f8faff)`，可逐位复算）、`primary/pressed` FAB 按压前后**逐位相同**；模型侧（CIELAB ΔE76）对应 ΔE **64.33** / **8.13**。⚠️ 设备列**原先写的是 HSV 饱和度**（`sat 64.22 → 0.00`）并与 ΔE 并列称作「独立吻合」—— 那是**量纲错配**（HSV 饱和度 ×100 ≠ ΔE76），且数值本身不成立（`#1a6fa8` 的 sat 是 **84.52**，`(249,251,255)` 的是 **2.35**）。64.22 与 64.33 过于接近，反向提示**当初可能是把模型 ΔE 误记成设备 sat** —— 若真如此，「两种独立量化」即循环论证。⇒ 整列已改为 RGB；**引用设备观测优先用三元组**，派生量须给复算公式。判别力由脚本 `--verify`（合成样本）证明，现状由门禁 **C5** 对 `--json` 实跑钉住（280 条 / 0 条会塌）—— C2 与 C5 分工不同，缺一不可。
- **消费约束（硬规则）**：预合成值**隐含假设底色是 `--md-primary`**，用在别的底色上会算错 ⇒ `bg-layer-*-on-primary` **只能与 `bg-primary` 同元素**。令牌名不携带底色信息，唯一保证点是消费点。门禁 `tests/stateLayerOnPrimary.test.ts` 的 **C3** 逐标签扫真实 `src/**/*.vue`；C1 钉住「其余四档必须**终点 alpha < 1**」以防范围扩大化（跟引用解终点，不看字面形态 —— `surface` 档 56 条本就是 `var()` 别名）。C3 按元素扫描、看不见拼接出来的类名（`.ts` 全文与 `.vue` 的 `<script>` 块，且只认小写标签、遇属性值里的 `>` 会截断），该缺口由 **C6** 钉住：连续写法与拼接写法都判红。
- **`hover-class` 禁用**（#868）：应与 `pointer-events` 同类处理——preset/引擎不保证，失败方式是**静默无反馈**，比不写更危险。交互反馈一律走 `active:` 变体。门禁 **C4** 拦截面是「`.vue` 内不得出现 `hover-class` **绑定本身**」（不限值、不限类名，否则写 `hover-class="bg-error"` 即可绕过）。

> **与 MD3 原始表述的关系**：术语文档此前记「MD3 不用预计算实色，官方一律 alpha 叠加」。本次**是引擎能力边界导致的偏离，不是对 MD3 的重新解读**——alpha 叠加在 Lynx 上原理上不可达。修法在**视觉效果上与 MD3 叠加等价**（容器色已知且固定），但**表达形式**从 alpha 变成了不透明值。代价即上面的消费约束。

## 6. 层级（elevation）

| 术语 | MD3 官方定义 | 本项目落点 | 证据 |
|---|---|---|---|
| **Elevation level** | 0–5 共 6 级，**每级主要由 surface tint（primary 叠加）表达**，box-shadow 为辅 | `--md-elevation-0` … `--md-elevation-5` **六档齐全**：`--md-elevation-0: none`（官方定义「无阴影」，**非**外推）、1/2/3 官方配方、**4/5 行尾标注「外推」**——按 `tokens.css` 段首的可复算规则接续，**不是官方一手表**。⚠️ 层级仍**纯 box-shadow 表达**，与官方「surface tint 为主」口径有差距 | `tokens.css` 的 `--md-elevation-0` … `--md-elevation-5`（4/5 带「外推」注释）；层级口径见 ADR-0207 决策 7 |
| **Level 0** | 无阴影、无 tint 叠加（默认页面层级） | ✅ 已定义 `--md-elevation-0: none`（**不是**靠 `surface-container-lowest/low` 底色隐式表达），但 ⚠️ **0 处消费** —— 页面底层色直接用 `surface-container-*` | `tokens.css` 的 `--md-elevation-0` |
| **Surface tint** | 表达层级的主要手段（等价于"用 primary 染色"） | ✅ 已定义并**已有一处真实消费**：登记为 `surface.tint` → `bg-surface-tint`，由 `PagePickerSheet.vue` 以 `bg-surface-tint opacity-[0.08]` 叠加消费（8% 口径对齐 hover 层），单测钉住「产物有规则 + 模板有真实 class + 低透明度合成生效」并挡住「把 tint 当 bg-primary 改名」的假消费。⚠️ 该消费**不承载 elevation 层级**（是状态层式叠加），层级仍靠 `surface-container-*` 底色 + box-shadow | `tailwind.config.ts` 的 `surface.tint`；`components/PagePickerSheet.vue` 的 `bg-surface-tint opacity-[0.08]` + `components/PagePickerSheet.test.ts`；令牌定义见 `tokens.css` 的 `--md-surface-tint` |
| **Shadow 多层逗号分隔** | 标准 CSS 多层阴影 | tokens.css 已按多层写法定义；LynxView 对多层 `shadow-[var(--md-elevation-N)]` 的支持度**未真机验证**（多层取值本身与官方配方一致） | `tokens.css` 的 `--md-elevation-1/2/3`；差距报告 §5、§7.6 |
| **替代表达（降级路径）** | M3 用 tint 表达层级 | 若多层 box-shadow 真机不生效，可用 `surface-container-*` 底色层级替代 | 差距报告 §5 处理建议 |
| **消费侧实测分布** | — | ⚠️ **只用到 level 1/2/3**：生产 `.vue` 里 `--md-elevation-1` **3 处**（ADR-0212 整改后；**整改前为 53**）、`--md-elevation-3` **10 处**、`--md-elevation-2` **5 处**；**level 0/4/5 各 0 处**（4/5 是外推档、无人消费正说明外推未被当作事实使用；level-0 的 0 处是 [ADR-0212](./ADR-0212-tonal-elevation-surface-over-shadow.md) 决策 4.1 的**决策结果**——零阴影靠**删声明**达成，不写显式 0） | 实测口径：生产 `.vue`（剔除 `.test.`）全文 grep `md-elevation-[0-9]`；复算 `grep -rhoE 'md-elevation-[0-5]' --include='*.vue' packages/app-lynx/src \| sort \| uniq -c` → `3 / 5 / 10`（**2026-10-01 实测**） |

组件形态的层级落点（稳定锚点，不引用行号）：`NavigationBar.vue` 的根 `view`（`h-[21.333vw] bg-surface-container`，用底色不用阴影）；`RefreshableList.vue` 的菜单项（静止档 `shadow-[var(--md-elevation-2)]`）与 FAB；`GlobalFab.vue` 的展开环 / 回顶环用 `--md-elevation-2`、主按钮用 `--md-elevation-3`。

> ⚠️ **本段原有三处锚点已于 2026-10-01 作废**（票 #885 / [ADR-0212](./ADR-0212-tonal-elevation-surface-over-shadow.md) 决策 3、决策 6），勿再按旧文本核对：
> 原写 `RefreshableList.vue` 菜单项与 `GlobalFab.vue` 主按钮「`active:shadow-[var(--md-elevation-1)]` 做按压反馈」——
> **实测 `active:shadow` 已在生产 `.vue` 中 0 命中**，现为 `active:bg-layer-pressed-*`（菜单项）与 `active:opacity-80`（FAB / 主按钮）；
> 原写 `GlassCard.vue` 的 scoped `box-shadow: var(--md-elevation-1)`——**该声明已整条删除**（该文件现存 `box-shadow` 字样仅剩一条解释性注释）。
> 静止档（`elevation-2` / `elevation-3`）不受影响，仍以上句为准。

## 7. 主题与动态色

| 术语 | MD3 官方定义 | 本项目落点 | 证据 |
|---|---|---|---|
| **Dynamic color（动态色）** | M3 核心能力：从设备壁纸/种子色实时派生整套餐色（Compose `dynamicLightColorScheme` / `dynamicDarkColorScheme`） | **有意不做**。7 支构建期静态色板，运行期只切根类名 | `utils/themeColor.ts` 的主题色常量；决策与理由见 **ADR-0205** |
| **Zero runtime color computation（零运行时算色）** | 非 MD3 概念，项目硬约束（ADR-0152） | Lynx 运行期不引入 material-color-utilities、不写 CSS 变量 | `utils/themeColor.ts` 文件头注释；[./glossary-lynx-bili-theme.md](./glossary-lynx-bili-theme.md) |
| **TonalSpot 派生** | M3 默认 scheme 生成器之一 | 暗色板经 SchemeTonalSpot `isDark=true` 从亮色锚点生成 | `tokens.css` 首个暗色板（`.theme-sky.dark`）段的生成声明；`scripts/generate-theme-palettes.mjs` |
| **Light / dark / system** | M3 区分亮暗两种 scheme | `light / dark / system` 三态 + 原生哑桥订阅系统变化 | `utils/darkMode.ts` 的 `DARK_MODE_OPTIONS`；`stores/settingsStore.ts` 的持久化与系统订阅 |
| **主题色（accent theme）** | 非 MD3 概念 | 7 选 1，id 持久化为 `settings_theme_color`，类名映射单一事实源 | `utils/themeColor.ts` 的主题色常量与类名映射表；术语详见 [./glossary-lynx-bili-theme.md](./glossary-lynx-bili-theme.md) |

## 8. 图标（icons）

| 术语 | MD3 官方定义 | 本项目落点 | 证据 |
|---|---|---|---|
| **Material Symbols** | M3 官方可变图标集：随字号缩放、描边粗细随状态变化、字形可变 | ✅ **已引入 Material Symbols Outlined 子集**（ADR-0208）：base64 内联 `@font-face`（`font-family: MaterialSymbolsOutlinedSubset`）落在 `src/styles/icon-font.css`，由 `scripts/generate-icon-subset.py` 生成、**不要手改**。⚠️ 字体是**静态子集** —— 可变轴 FILL / GRAD / opsz / wght 在子集化时定死（Lynx 的 `@font-face` 不支持 weight/variant），故「描边随状态变化」**尚未实现**；随字号缩放已由 `AppIcon` 的 `:size` 实现 | `src/styles/icon-font.css` 的 `MaterialSymbolsOutlinedSubset`；决策见 ADR-0208 |
| **图标映射唯一事实源** | 非 MD3 概念，项目载体 | `utils/iconMap.ts` 的 `ICON_CODEPOINTS`（图标名 → 码位，如 `home: 0xe9b2`）+ `ICON_FONT_FAMILY`；模板侧统一走 `components/AppIcon.vue`（`:name` 取 `IconName`，字形经 `iconChar()` 查表），**26 个生产 `.vue` 在用** | `utils/iconMap.ts`；`components/AppIcon.vue`；门禁 `tests/iconMap.test.ts` + `tests/iconConsumption.test.ts` |
| **Unicode 字形（现状）** | 非 MD3 概念 | 基本退场：`navTabs.ts` 的 `NAV_TABS` 现在给的是**图标名字符串**（`home` / `explore` / `menu_book` / `person`），不再是 `⌂ ✦ ✎ ◎` 字面量；`ActionButton` 的 `icon` prop 类型也是 `IconName`。原字形只作为**历史对照**留在 `utils/iconMap.ts` 的码位注释里。⚠️ **残留 1 处未迁移**：`BottomSheet.vue` 默认标题栏的关闭键仍写死 `<text class="text-[6.4vw] leading-none text-surface-on-variant">×</text>`（未走 `AppIcon`） | `components/navTabs.ts` 的 `NAV_TABS`；`utils/iconMap.ts` 的 `ICON_CODEPOINTS` 注释；`components/BottomSheet.vue` 的默认关闭键 |
| **图标尺寸** | M3 图标随字号缩放 | 随屏宽缩放：由 `AppIcon` 的 `:size` prop（vw，**缺省 6.4** ≈ 24px@375）以行内 `fontSize: ${size}vw` 施加，已不写 `text-[6.4vw]` 类 | `components/AppIcon.vue` 的 `withDefaults`（`size: 6.4`）与 `iconChar` 渲染块；消费例 `components/NavigationBar.vue`（图标走缺省 6.4vw）、`components/PageTopBar.vue` 的 `<AppIcon name="arrow_back">` |
| **宿主 assets 同步脚本** | 非 MD3 概念 | 字体类资源已有同步通道 | `packages/app-lynx/scripts/sync-android-assets.mjs` |
| **组件命名先例** | 非 MD3 概念 | 已有 `M3Switch.vue` / `M3SegmentedButton.vue` 以 `M3` 前缀标明组件谱系 | `src/components/M3Switch.vue`、`src/components/M3SegmentedButton.vue` |

## 9. 可访问性（accessibility）

### 9.1 触控目标：两个口径不是一回事

| 口径 | 数值 | 性质 | 来源 |
|---|---|---|---|
| **MD3 / Android 平台建议** | ≥ 48×48dp | **建议值**（Android 平台规范），非 WCAG 强制项 | MD3 / Android 平台规范 |
| **WCAG 2.1 AAA SC 2.5.5** | ≥ 44×44 CSS px | WCAG 2.1 的加强级口径 | W3C WCAG 2.1 |
| **WCAG 2.2 AA SC 2.5.8** | ≥ 24×24 CSS px | **WCAG 2.2 的最小值**（AA 级） | [W3C WCAG 2.2 SC 2.5.8](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html) |

> **常见误引**：把「WCAG 2.2 触控目标 48dp」当作标准原文。48dp 是平台建议；WCAG 2.2 的 AA 最小值是 24×24 CSS px。判定合规时**两口径分别标注**，不要混用。

项目落点（按 vw 类值按 375 设计稿静态换算，**未真机测量**）。证据列给**类值锚点**而非行号 —— 行号每轮整改都在漂，类值是判读触控尺寸时真正要看的东西：

| 组件 | 实际值 | 48dp 口径 | 24px AA 口径 | 证据（类值锚点） |
|---|---|---|---|---|
| 底部导航 | 80px | ✅ | ✅ | `components/NavigationBar.vue` 根条 `h-[21.333vw] bg-surface-container` |
| 顶栏 | 64px | ✅ | ✅ | `components/PageTopBar.vue` 两处标题条 `h-[17.067vw] px-4 bg-surface` |
| 搜索输入框（药丸） | 42px | ❌ | ✅ | `components/SearchSheet.vue` `h-[11.2vw] rounded-[var(--md-shape-full)]` |
| 筛选 chip | 40px | ❌ | ✅ | `components/SearchSheet.vue` chip 行 `h-[10.667vw] px-4 rounded-[var(--md-shape-full)]` |
| 二级 tab | 48px | ✅（刚好） | ✅ | `components/SubTabBar.vue` `flex-1 h-[12.8vw] flex items-center justify-center` |
| 导航指示器胶囊 | 64×32px | 高度 < 48 | ✅（非独立触控目标） | `components/NavigationBar.vue` 指示器 `w-[17.067vw] h-[8.533vw] rounded-full` |

> **判触控合规必须回到事件绑定节点**（`@tap` 挂在哪），不能只看尺寸。例：`TextSelectionToolbar.vue` 里 `w-[2.8vw] h-[2.8vw]` 与 `w-[1.7vw] h-[0.33vw]` 两段小方块是手绘"复制"图标的**内部描边**（`rounded-full`），`@tap` 挂在父级容器上，**不是触控目标**（差距报告 §8.3）。

### 9.2 焦点与动效偏好

| 术语 | 标准要求 | 本项目落点 | 证据 |
|---|---|---|---|
| **focus-visible** | 只在键盘/辅助技术导航时暴露焦点环，**禁裸 `:focus`** | ✅ **刻意为 0**。生产代码 0 处 `focus-visible` / `:focus`；ADR-0207 决策 5 已给**真机实证结论**（同批探针里阳性对照 `:active` 生效而这两类无任何变化 ⇒ 引擎不匹配），不是「未验证」也不是「没整改」。无障碍改由 `accessibility-element` + 平台焦点环承担 | ADR-0207 决策 5；门禁 `tests/md3GuardScans.test.ts` 规则 6 |
| **对比度** | 正文 4.5:1 / UI 组件 3:1（WCAG 1.4.3 / 1.4.11） | 亮 20 组 + 暗 18 组静态计算全过（`outline-variant` 属装饰性分隔线，WCAG 1.4.11 豁免） | 差距报告 §3.1（静态计算，未真机验证渲染色值） |
| **`prefers-reduced-motion`** | 尊重系统「减弱动效」偏好 | ✅ **6 个组件已处理**（`App.vue` / `GlobalFab.vue` / `GlassCard.vue` / `M3Switch.vue` / `RefreshableList.vue` / `BookmarkButton.vue`），走 `composables/useReducedMotion.ts` 唯一事实源 | 见 §4.3 与核心术语表 `prefers-reduced-motion` 行 |
| **辅助技术标注** | 可交互元素应可被辅助技术识别 | 生产 `.vue` **32 / 76** 个文件引入 `A11Y_ELEMENT_ENABLED`（无障碍元素开关）；未开启时**不渲染** a11y 属性 | `components/NavigationBar.vue` 的导航项；实测口径 = 生产 `.vue`（剔除 `.test.`）全文 grep `A11Y_ELEMENT_ENABLED` |

## 10. 单位与换算（交叉引用，不重复定义）

**权威文档：[./glossary-lynx-units.md](./glossary-lynx-units.md)**。本表只登记与 MD3 dp/sp 的换算关系。

| MD3 单位 | 定义 | 375 设计稿换算 | 证据 |
|---|---|---|---|
| **dp（density-independent pixel）** | MD3 布局/尺寸基准单位 | `1dp = 0.2667vw = 2rpx = 2px@375` | `tokens.css` 的 `--md-shape-*` 段换算注释；`tailwind.config.ts` 的 `spacing` 段注释（逐档 `// Npx` 标注） |
| **sp（scale-independent pixel）** | MD3 字号基准单位（随用户字体缩放） | `1sp = 2rpx = 2px@375` | `tailwind.config.ts` 的 `fontSize` 段注释（`rpx = sp × 2`） |
| **vw** | 视口宽百分比 | `1vw = 3.75px@375 = 7.5rpx` | 见 [./glossary-lynx-units.md](./glossary-lynx-units.md) §换算速查 |
| **rpx** | Lynx 响应式像素（`750rpx = 屏宽`） | 字号走 rpx；宽高/间距/圆角走 vw；边框/阴影走 px | `tailwind.config.ts` 文件头「单位策略」注释 |

> **注意**：MD3 的 sp 本应随系统字体缩放设置变化；本项目的 rpx 只随屏宽缩放，不含用户字体缩放因子。这是**引擎/单位能力层面的取舍**，登记为事实，不展开论证。

## 11. 「有意偏离 MD3」清单

以下 5 条为已拍板决策，**只登记名称与指向，不在本表展开论证**（论证在各 ADR）：

| 编号 | 偏离名称 | 指向 | 项目现状（证据） |
|---|---|---|---|
| 1 | **动态色不做**（Dynamic color 不引入） | ADR-0205 | `utils/themeColor.ts` 的 7 套静态色板常量 |
| 2 | **搜索框保持 42px 药丸形态**（不对齐 M3 filled/outlined 56dp） | ADR-0205 | `components/SearchSheet.vue` 的 `h-[11.2vw] rounded-[var(--md-shape-full)]` |
| 3 | **二级 tab 保持 48px**（不上调至 56px） | ADR-0205 | `components/SubTabBar.vue` 的 `flex-1 h-[12.8vw]` |
| 4 | **hover 在纯触屏判定为不适用**（不要求 `hover:` 覆盖） | ADR-0205 | 生产 `.vue` 的 `hover:` 命中 0（见 §5.3） |
| 5 | **`focus` / `focus-visible` 判定为不适用**（禁写这两类伪类变体） | ADR-0207 决策 5 | **真机实证**：同批探针中阳性对照 `:active` 生效，而这两类无任何变化 ⇒ 引擎不匹配；且纯触屏无键盘 / D-pad 触发源。写出来即死类名、**静默无样式**（同 §5.2 的 `bg-state-layer-*` 陷阱）。无障碍改由 `accessibility-element` + TalkBack 平台焦点环承担 |

> 该清单是**封闭的**（与 `AGENTS.md`「有意偏离 MD3」章一致）：不在表内的差距**默认按「要修」处理**；重开某条须新开 ADR 推翻 ADR-0205 决策 4。注意第 4 条的展开形态在本表 §5.3 与 §9.2：hover 令牌**已就绪**（`--md-state-layer-hover-*` 五色齐全），刻意为 0 的只有 `hover:` **伪类**，不是「令牌缺失」。

> ⚠️ **一条不在上表、但性质相同的引擎妥协**：`on-primary` 档状态层用预合成不透明色而非 alpha（§5.4）。它**没有**进上表，是因为上表是「有意偏离」清单、而本条是**引擎能力边界下的唯一可行解**（alpha 叠加在 Lynx 上不可达），记在 ADR-0207 决策 8 与本表 §5.4。判读口径见 §5.4 末的「与 MD3 原始表述的关系」。

> **修订留痕（2026-10-01）**：本表此前只有 4 条，缺第 5 条 `focus`/`focus-visible`，却在正文声称
> 「与 `AGENTS.md` 一致」——两处口径漂移。`AGENTS.md` 侧一直有 5 条，本表侧漏了。已补齐，
> 论证不搬进本表（权威在 ADR-0207 决策 5 与 §5.2）。顺带说明：`AGENTS.md` 为守 30KiB
> 体积门禁，其封闭清单只留「名称 + 指向」，**理由展开一律以本表与各 ADR 为准**。

## 12. 与差距报告的坐标差异（复核留痕）

### 12.0 ⚠️ 本节两表读法：§12.1 是**整改前**快照，§12.2 才是**现状**

本节登记的是「本表与差距报告在哪几处对不上」。**§12.1 那张表测于 2026-09-30、MD3 整改落地之前**；此后 `tailwind.config.ts` / `tokens.css` / 组件层都动过，表内多数计数**已不再成立**。**读现状请直接看 §12.2，不要拿 §12.1 的数字去 grep。** 保留 §12.1 是为了留痕「当初的差异是什么」——它记录的是历史，不是现在的差距。

### 12.1 整改前快照：与差距报告的坐标出入（2026-09-30 首轮复核，**已被 §12.2 取代**）

下表测于 MD3 整改落地**之前**，与 `docs/research/material-design-3-gap-analysis-2026-09.md` 存在以下**坐标/计数出入**。**表内所有计数与行号均已过期**，保留仅为留痕：

| 项 | 差距报告 | 首轮复核实测（**整改前**） | 现状见 |
|---|---|---|---|
| Fluent 兼容别名条数 | 23 条（§2 #9） | 22 条 | §12.2 复核仍为 **22 条**（未变） |
| `leading-*` 存量 | 「仅 10 处」（§2 #1） | 29 处非 `leading-none`（跨 35 个文件，另 52 处 `leading-none`） | §12.2 已降至 **1 处**（在白名单内） |
| `ActionButton.vue` 圆角行号 | `:29` | `:26` | 行号仍会漂，正文已改用类名锚点 |
| `ActionButton.vue` `active:bg-white/10` 行号 | `:31` | `:28` | 同上；`active:bg-white/10` **仍未迁移**（§5.2） |
| `GlobalFab.vue` 硬编码 duration 行号 | `:147,152,160` | `:154,160` | 同上。⚠️ **本行为整改前快照**：`fab-ring-spin 1s` 已于本轮令牌化（§4.2） |
| `darkMode.ts` 三态行号 | `:23-27` | `:19-23`（`DARK_MODE_OPTIONS`） | 同上 |
| `NavigationBar.vue` a11y 属性行号 | `:27` | `:29-30` | 同上 |
| `--md-surface-tint` 引用面 | 「`.vue` 中引用数 = 0」（§2 #7） | `.vue` / `.ts` 0 处；全仓仅生成脚本 1 处 | §12.2 已补到 **1 处真实消费**（§6） |

> 首轮复核确认**一致**、且至今仍成立的关键项：14 个色板类、`--md-shape-*` 6 档 vw 取值、motion 四条曲线取值、`hover:` / `tracking-*` 0 处。
> 首轮复核确认**一致、但现已失效**的两项（整改已改变现状）：shape 消费计数 274/327（现为 277/324）、`--md-elevation-1/2/3` 与 `--md-surface-tint` 状态（现六档齐全 + 已消费）。

### 12.2 整改后现状（2026-09-30 二轮复核，正文各章的数据源）

本表是**现状的权威口径**，与本文件 §1–§11 各章逐格对应。已翻转或已失效的旧断言集中在这里，便于一眼看清「改了什么、还欠什么」：

| 项 | 整改前（§12.1 快照） | **整改后实测（现状）** | 正文落点 |
|---|---|---|---|
| 排版档位数 | 12/15，缺 display×3 | **15/15**（display 三档 114/90/72rpx 已补；⚠️ `text-display-*` 消费仍 0） | §2.2 |
| 四元组 | 只落地 size | **size + lineHeight + letterSpacing 全在 `fontSize` 数组内**；weight 走 `extend.fontWeight`（`regular` / `medium`） | §2.1 |
| `leading-*` 自选行高 | 29 处 | **1 处**（`TextSelectionToolbar.vue` 的 `leading-[3vw]`，在 `md3-guard-whitelist.json` 的 `self-chosen-leading` 台账内） | §2.1 |
| `tracking-*` 类名 | 0 处（因无定义） | **0 处（预期）** —— 字距由档位类带出，不再需要组件写 | §2.1 |
| `font-bold`(700) | 混用 | **仅剩 1 处**（`Login.vue` 的 `font-bold text-primary` 产品字标，与 `typographyFontWeight.test.ts` 白名单一致） | §2.1 / §12.3(a) |
| `borderRadius` | **无该键**，`rounded-*` 落 Tailwind 默认 rem | **已注册**（顶层替换 `none` + 六档全指向 `var(--md-shape-*)`），写错令牌名构建期报错 | §3.1 |
| shape 消费计数 | 274 / 327 | **本轮再订正为 254 / 21 / 16 / 49**（裸 `rounded-[var(--md-shape-*)]` 254 + 方向变体带 token 21 + `rounded-b-none` 16 + `rounded-full` 49；`rounded-b-none` 由 2 增至 16 = 17 处 input 的底 0dp 圆角）；档位名仍 0 处。⚠️ 本行原写「275 / 326 = 261 + 14 方向变体」，方向类实测为 **16**（`grep -rhoE '\brounded-(t\|b\|tl\|tr\|bl\|br)\b' src --include='*.vue'`），已订正 | §3.1 |
| 硬编码 `rounded-[0.65vw]` | 2 处，低于 M3 最小档 | **0 处**（`TextSelectionToolbar.vue` 的手绘描边改走 `rounded-full`） | §3.1 |
| 非 M3 缓动曲线 | `GlassCard.vue` 的 `cubic-bezier(0.33,0,0.67,1)` | **已清零**（改 `var(--motion-emphasized-decelerate)`）；`transitionTimingFunction.DEFAULT` 亦已从 legacy 改回 `--motion-emphasized` | §4.1 |
| 硬编码毫秒 | 「现状 0 处」 | ✅ **本轮已清零**：`GlobalFab.vue` 的 `fab-ring-spin` 令牌化到 `--durationExtraLong4`；`App.vue` 的 `--shimmer-motion` 获真实定义（`tokens.css`），1000ms 生效值走令牌。仅 `App.vue` 的**回退实参 `1.5s`** 逐字保留（`shimmerGate.test.ts` 断言必须在，有真机 fail-open 依据），且已在 `LITERAL_EXCEPTIONS` 在册 | §4.2 |
| 时长门禁 | 标为 `md3GuardScans` / `motionDurationTokens`（名与覆盖均不准） | 实为 `src/components/motionDurationTokens.template.test.ts`，**只覆盖 3 个文件**；`md3GuardScans` 的 8 条形态规则里**没有** duration 规则；`App.vue` 那处因 `var()` 整体被摘而**落在判据盲区** | §4.2 |
| 状态层四态 | hover / focus / dragged 标 `❌ 缺失`；`--md-state-layer-*` 仅 2 条 | **20 条齐全**（4 态 × 5 色），四态已登记为**顶层** `bg-layer-*` utility；⚠️ **`on-primary` 档是预合成不透明色**、其余四档保持 alpha（§5.4） | §5.1 / §5.4 |
| 状态层 on-primary 档 | 「`bg-layer-pressed-on-primary` 是死类名，2 处消费静默失效」 | ✅ **已登记生效**且**有 2 处消费**（`SettingsEndpoint` 保存按钮 / `TranslateButton`，均走 `active:bg-layer-pressed-on-primary`）。原死类名 `bg-layer-hovered-on-primary`（`TranslateButton.vue` 的 `hover-class`）**已删除**；门禁 C4 禁止状态层类名再出现在 `hover-class` 里 | §5.2 / §5.4 |
| 状态层消费优先级 | 「以预计算实色 `--md-state-pressed-*` 为主」 | **已反转/持平**：`active:bg-layer-pressed-*` **27 处** vs `active:bg-state-pressed-*` **24 处** | §5.2 |
| `active:` 近似 | 「原生 LynxView 待真机验证」 | 顶层登记后**真正生效**（此前 `state` 嵌套产出 `bg-state-layer-*` 不同名，约 15 处静默失效） | §5.3 |
| focus-visible | 「Lynx 支持度未验证」 | **ADR-0207 决策 5 已给真机实证**：引擎不匹配 ⇒ 刻意为 0，门禁规则 6 守红 | §5.3 / §9.2 |
| disabled 消费 | 13 个文件 `opacity-40/50` + `pointer-events-none` | **13 个生产 `.vue`** 走 `opacity-40/50`（知情接受的存量债）；`pointer-events-none` 是**死类名**，不计入消费做法 | §5.3 / 核心术语表 |
| Elevation | 三档，**无 level 0/4/5**；消费 1/2/3 = **53/5/10 处** | **六档 0–5 齐全**（`0: none` 为官方定义；**4/5 标「外推」，非官方一手表**）；消费只到 1/2/3（**3/5/10 处**，ADR-0212 整改后，2026-10-01），0/4/5 各 0 处（level-0 的 0 处是**决策结果**：零阴影靠删声明，见 ADR-0212 决策 4.1） | §6 |
| Surface tint | 「`.vue`/`.ts` 零引用」 | **1 处真实消费**（`PagePickerSheet.vue` 的 `bg-surface-tint opacity-[0.08]`，单测钉住非假消费）；⚠️ 不承载 elevation 层级 | §6 |
| Material Symbols | 「全仓无该字体引用（grep 0）」 | **已引入**：base64 内联子集 + `iconMap.ts` + `AppIcon.vue`（26 个生产 `.vue`）；⚠️ 可变轴子集化时定死，「描边随状态」未实现 | §8 |
| Unicode 字形 | 导航 `⌂ ✦ ✎ ◎`、关闭 `×`、`ActionButton` 传文本符号 | 基本退场（`navTabs.ts` 改图标名字符串，字形降为 `iconMap.ts` 注释里的历史对照）；⚠️ **残留 1 处**：`BottomSheet.vue` 默认关闭键仍写死 `×` | §8 |
| 图标尺寸 | 固定类值 `text-[6.4vw]` | 改由 `AppIcon` 的 `:size` prop（缺省 6.4vw）以行内 `fontSize` 施加 | §8 |
| reduced-motion | 1/4 含动画组件已处理 | **6 个组件**消费唯一事实源 `useReducedMotion.ts` | §4.3 / §9.2 |
| a11y 标注 | 31/75 文件 | **32 / 76** 个生产 `.vue` | §9.2 |

### 12.3 两条可核查性留痕（2026-09-30 复审）

这两条不是 MD3 概念，是**「凭什么说本表/本仓的数值与官方一致」**的取数纪律。登记以免下次复审重复提出、或有人照着错误前提去改门禁。

**(a) 门禁台账不止一份，`md3-guard-whitelist.json` 不是「全仓唯一台账」。**

| 台账 | 覆盖 | 不覆盖 |
|---|---|---|
| `tests/md3-guard-whitelist.json`（**9 条**：`legacy-color-alias`×3 + `self-chosen-leading`×6） | `md3GuardScans.test.ts` 的 8 条形态规则 + tokens 留痕子规则 | **字重**（无 font-weight 规则） |
| `tests/typographyFontWeight.test.ts:34-44` 内联 `WHITELIST`（`file`+`marker`+`reason`） | 700 字重唯一落点 = `Login.vue` 产品字标 | 形态回流 |
| `tests/hardcode-whitelist.json` / `hardcode-whitelist-colors.json` | 硬编码尺寸 / 颜色 | 以上全部 |

- **不要往 `md3-guard-whitelist.json` 里加字重条目**：该台账被 `md3GuardScans.test.ts:825-839` 的**死条目棘轮**守着（每条必须命中一个真实违规），而那 8 条规则里没有任何一条会产出字重违规 ⇒ 加进去当场转红。字重的机器可读对侧是 `typographyFontWeight.test.ts`，它靠 `marker` 串与源码注释**双向耦合**（`:155-163` 断言标记真实存在于源码，删理由即转红）。
- 判读规则：查「某个 MD3 形态有没有机器防线」时，**先按形态找规则，再找台账**；反过来从台账文件名猜覆盖面必然错。

**(b) MD3 数值一手来源在仓外，这是设计而非漏提交。**

`tokens/versions/v0_192/_md-sys-*.scss` **在本仓不存在，且从未入库**（`git log --all -- tokens` 为空；`.gitignore` 无相关条目；依赖里只有 `@material/color-utilities` 一类算法包，不含令牌文件）。它是 [material-web](https://github.com/material-components/material-web) 的**上游路径** —— ADR-0205 决策 1 就是这么定的（`ADR-0205:32-33,46-47` 明确写「material-web **仓库的**」，`:145-149` 给出可点击 URL），本仓刻意不 vendor 它（vendor 就要承担版本漂移与同步责任，与「唯一基准」的可复核性冲突）。

- 因此本表所有「与 material-web v0.192 逐条一致」的表述，其性质是**「已人工回源核对过的一手断言」**，不是「仓内可机器复算的等式」。取数纪律见 `AGENTS.md`「数值来源（唯一基准）」与本表 §2.1 注（需引用时先拉该文件核对，勿凭记忆填表）。
- **残留缺口（知情接受）**：这些数值**没有 CI 机器防线**。`md3ConfigTokens.test.ts` 只能核对「`tokens.css` / `tailwind.config.ts` 里的值等不等于本仓抄下来的期望值」，抄错时它与实现同源同错。真正的回源复核仍是人工联网动作（§4.2 的 `duration-extra-long4` 就是这么核的，2026-09-30）。若日后要闭这个环，选项是「CI 里拉上游文件做差分」或「把四份 scss vendor 进仓并锁 commit」——属独立决策，不在本次范围。

## 13. 界面连续性（UI continuity）— 2026-10-01 新增

> **本章的由来**：§1–§11 记录的是**令牌层**的合规状态（颜色 / 排版 / 形状 / 动效 / 状态层 / 层级各自成表）。
> 2026-10-01 的观感诊断发现：**令牌层 95% 合规，消费层覆盖率却接近零**——用户感知到的「粗糙」
> 几乎全部来自**消费层**，而非令牌值本身。本章登记这条新维度，并定义描述它所需的术语。
> 配套决策见 [ADR-0210](./ADR-0210-lynx-style-stack-capability-boundary.md)（能力边界）·
> [ADR-0211](./ADR-0211-ui-continuity-motion-contract.md)（连续性契约）·
> [ADR-0212](./ADR-0212-tonal-elevation-surface-over-shadow.md)（色调层级）·
> [ADR-0213](./ADR-0213-immersive-media-view.md)（沉浸模式）。

### 13.1 核心判据：白名单 ≠ 不可用

| 术语 | 定义 | 本项目落点 | 证据 |
|---|---|---|---|
| **死类名（dead class name）** | 工具类**构建期不产出任何 CSS**，写了看似生效、实际静默无样式。与「构建期报错」是两类不同的失败，**后者安全、前者危险** | 已确认死类名（**产物 0 条规则**）：`pointer-events-*` / `cursor-*` / `select-none` / `touch-none`。⛔ **反例一（白名单骗人）**：`transition-colors` / `duration-[…]` / `ease-[…]` 全部可用。⛔ **反例二（更隐蔽，2026-10-01 订正）**：`transform-*` / `scale-*` / `translate-*` / `rotate-*` **产出 CSS 但渲染为空**，见下格 | 门禁 `tests/lynxUnsupportedTailwindClasses.test.ts`（只守 `pointer-events-*`，**其余死类名无门禁**）；机制见 [ADR-0210](./ADR-0210-lynx-style-stack-capability-boundary.md) 路径 E |
| **⚠️ 零命中 ≠ 不支持（JIT 假象）** | 产物里 grep 命中 0 条，有**两种**完全不同的成因，**产物本身区分不了** | ① **JIT 裁剪**：源码里没人写这个类，Tailwind 就不生成 ⇒ 0 命中；② **真不支持**：preset 裁掉该 plugin ⇒ 0 命中。**`transform-*` / `scale-*` 属第 ① 种**——用项目真实 config 跑一次 Tailwind JIT，19 个候选类里 15 个产出规则、仅 4 个真死。⚠️ 判据：**不能只看产物 0 命中就断言「不支持」，必须跑一次真实编译** | 判别方法：用项目 `tailwind.config.ts` 对候选类串跑一次 JIT，比对产出规则；`rotate-45` 在生产产物中有 4 处命中（`--tw-rz`），是该结论的独立佐证 |
| **第三类失败：构建全绿、渲染为空** | 声明**能构建、也有 CSS 规则**，但计算值阶段失效 | `transform` 族产出的规则引用 9 个 `--tw-*` 变量，而 **preset 不发 base/preflight 层**（`preflight` 不在 `corePlugins` 内）+ `src` 里 0 处 `--tw-*` 定义 ⇒ 按 CSS 规范该声明在计算值阶段非法 ⇒ 渲染为 `transform: none`。**它能通过所有静态检查**（构建过、类型过、单测过），只有真机取色/截图看得见 | 产物侧佐证：`tw-rz` 命中 4 次（其自身定义），其余 8 个 `--tw-*` 各命中 3 次（**仅被引用、无定义**）；决策与探针方法见 ADR-0210 路径 E |
| **corePlugins 白名单既不充分也不必要** | 57 项白名单只决定 Tailwind **内置** plugin；preset 可用**自定义 plugin** 把某族补回来（产物确实带 35 个 `plugins:`） | **真的死**（白名单正确）：`pointerEvents` / `cursor` / `select` / `touch`；**不是死**（白名单被绕过）：`transition*` 三族、`transform` / `rotate` / `scale` 族 | 复算白名单：`node -e "const s=require('fs').readFileSync('node_modules/@lynx-js/tailwind-preset/dist/lynx.js','utf8');console.log(s.match(/DEFAULT_CORE_PLUGINS\s*=\s*\[([\s\S]*?)\]/)[1].split(',').length)"`；机制见 [ADR-0210](./ADR-0210-lynx-style-stack-capability-boundary.md) |
| **产物判据（唯一可信的可用性判据）** | 判定某工具类是否生效，**看构建产物的 CSS 查找表，不看配置、也不看注释** | 产物 `packages/app-lynx/dist/main.lynx.bundle` 内联 CSS 表；`transition-colors` → `.15s,.15s,.15s` + `background-color,border-color,color`，`duration-[var(--durationNormal)]` → `{{--durationNormal}}`，`ease-[var(--motion-standard)]` → `{{--motion-standard}}`，**三条全是真规则** | 复算：`grep -ao 'transition-colors.\{0,60\}' packages/app-lynx/dist/main.lynx.bundle`。⚠️ **只看出现次数不够**——bundle 里「CSS 规则」与「JS 里的类名字符串」同形，必须看类名**后面跟的是值（`…{0,60}` 内出现 `.2s` / `{{--token}}`）还是引号 / 逗号** |
| **⚠️ 产物复算的第三个坑：产物是序列化 AST** | 用**纯文本 grep `.<类名>`** 查产物里某类有没有规则，**会得出反向的错误结论** | Lynx 把产物序列化成 AST，**类名以裸 token 存储、不带前导点** ⇒ `grep '\.rotate-45'` 在产物里 **0 命中**，看起来像「该类没产出规则」，而实际它**有**。本轮被此坑误导两次（一次在子代理、一次在人工复核） | 正确做法：grep **类名本身**（不带前导点）看其后是否跟值；或用项目真实 config 跑一次 Tailwind CLI 探针。**判别标志：若某类「产物 0 命中」但源码确实写了它，先怀疑是本坑，再怀疑不支持** |
| **（上一格的）反面教材** | 否定性注释比肯定性注释更容易过期 | ✅ **已于 2026-10-01 订正**（票 #875）：`packages/app-lynx/src/components/ActionButton.vue` 文件头、`packages/app-lynx/tests/lynxUnsupportedTailwindClasses.test.ts` 的白名单快照说明——两处原写「同样被裁的还有 `transition`」，现已改为准确机制（transition 族被自定义 plugin 补回、可用；transform 族能产规则但变量未定义、渲染为空），并附「不在白名单 ⇒ 死类名不能当通用判据」的警示 | 遗留项：该测试文件 `expect()` 的**报错文案字符串**内仍列着 `transition`（属断言内字面量，按「不改断言」纪律保留）；机制见 [ADR-0210](./ADR-0210-lynx-style-stack-capability-boundary.md) |

### 13.2 动效落地路径（五条，只有三条能走）

| 路径 | 写法 | 可用 | 失败方式 |
|---|---|---|---|
| A | Tailwind `transition-colors` + `duration-[var(--durationX)]` + `ease-[var(--motionX)]` | ✅ | — |
| B | inline `:style` 绑定 | ✅ | — |
| C | `<style>` 块内 `@keyframes` + `animation`（`animation` 在白名单内） | ✅ | — |
| D | `hover-class` 属性 | ❌ | **静默无反馈**（ADR-0207 决策 9 / #868 真机实证） |
| E | `transform-*` / `scale-*` / `translate-*` / `rotate-*` 工具类 | ⚠️ **构建全绿、渲染为空** | **第三类失败**：规则能产出，但其引用的 9 个 `--tw-*` 变量**从未定义**（preset 不发 base 层）⇒ 计算值阶段非法 ⇒ 渲染为 `transform: none`。**能通过构建 / 类型 / 单测全部静态检查** |

> **路径 E 的直接后果**：按压缩放 / 位移反馈**必须走路径 B**（inline `:style`）——不是「因为工具类被裁」
> （那个理由是错的，见 §13.1「零命中 ≠ 不支持」），而是因为**走工具类会静默渲染为空**。
> ⚠️ 已知存量疑点：`TextSelectionToolbar.vue` 的 `rotate-45` 抓手是这条的**在册候选**，
> 待真机取证（见 [ADR-0210](./ADR-0210-lynx-style-stack-capability-boundary.md) 决策 5）。

### 13.3 连续性与覆盖率的度量

| 术语 | 定义 | 本项目落点（2026-10-01 实测） |
|---|---|---|
| **界面连续性（UI continuity）** | 非 MD3 概念，项目侧载体：**每一次可见状态变化都在时间维度上被表达** | 见下方覆盖率行 |
| **动效契约（Motion contract）** | 项目侧唯一动效预设入口（入场 / 退场 / 按压 / 列表 stagger 四类），全部由 `--motion-*` + `--duration*` 驱动 | **待建**（决策见 ADR-0211） |
| **瞬变（instant switch）** | **0ms** 状态切换。**「粗糙」的直接成因**——与颜色对不对无关 | 全部 `active:` 消费点均为瞬变（见下） |
| **状态层过渡（state-layer transition）** | `active:` 状态层挂过渡，使其在档位时长内淡入 | **待建**（决策见 ADR-0211） |
| **动效覆盖率** | 含任意动效（`transition-*` / `transition:` / `@keyframes` / `animation:`）的生产 `.vue` 占比 | **6 / 76 ≈ 7.9%**（transition 3 个、`@keyframes` 4 个） |
| **弹层入场覆盖率** | 有入场动画的弹层占比 | **0 / 7** —— `BottomSheet` / `SearchSheet` / `SeriesSheet` / `CommentOverlay` / `BookmarkPanel` / `PagePickerSheet` / `WatchlistPromptDialog` 的 `@keyframes` 与 `transition` 计数**全部为 0** |
| **页面转场覆盖率** | 有导航转场的路由占比 | **0** —— `src/router.ts` 是裸 `createRouter`，全部导航为整页硬替换 |

**`active:` 消费点的口径归正**（实测 `grep -rhoE 'active:[a-z-]+' src --include='*.vue'`）：

| 形态 | 处数 | 口径判定 |
|---|---|---|
| `active:bg-layer-*`（alpha 层） | **27** | ✅ **正路**（ADR-0207 决策 4：alpha 层是正路） |
| `active:bg-state-pressed-*`（预计算实色） | **24** | ⚠️ **兜底路径**，按决策 4 属口径待归正（**不是死类名**——产物实测 29 条真规则） |
| `active:opacity-*` | 7 | 合法 |
| `active:shadow-*` | 5 | ⚠️ **心智污染**：用阴影表达**状态**，与「阴影表达**高度**」混用（见 §13.4）。✅ **已于 2026-10-01 清零**（票 #885，实测 0 命中）⇒ 本行的 5 是**诊断时快照** |
| 其他（`active:w-` / `active:h-` / `active:bg-white`） | 3 | 合法 |
| **合计** | **66 处 / 34 文件** | — |

> ⚠️ **两个易混数字**：本表的 **66** 是 `active:` 全量；而 §5.2 记的「alpha 27 vs 实色 24」是**同一批数据的两种切分**
> （27 + 24 = 51，加 `active:opacity-*` 7 + `active:shadow-*` 5 + 其他 3 = 66）。**两处数字自洽，可互相校验。**
>
> ⛔ **合计 66 已因一格失效而降为「诊断时快照」**：`active:shadow-*` 一行于 2026-10-01 由 5 变为 **0**（票 #885，
> `grep -rhoE 'active:shadow' --include='*.vue' packages/app-lynx/src | wc -l` → `0`）⇒ 本表各行**须整表重测**后才能继续当现状引用。
> **本轮只实测了 `active:shadow` 一格**，其余四格未复测 ⇒ **不臆造新合计**，新合计留待下一轮整表重测。

### 13.4 色调层级与贴面元素

| 术语 | 定义 | 本项目落点 |
|---|---|---|
| **色调层级（tonal elevation）** | MD3 官方口径：**层级主要由 surface tint / `surface-container-*` 明度分档表达，box-shadow 为辅** | 决策已在 ADR-0207 决策 7 拍板；令牌六档齐全，**消费侧零落地**（见 §6） |
| **贴面元素（surface-lying element）** | 与 surface 近乎同色的平面容器（`surface-container-lowest/low`），MD3 下**应零阴影** | ✅ **已归零**（票 #882 骨架屏 9 声明点 + #883 贴面 34 处 + #884 / #885 其余）：实测 `elevation-1` 由 **53**（整改前）→ **3**（2026-10-01），余下 3 处为 `RestrictedNovelCard.vue` / `AiRestrictedNovelCard.vue` / `Recommended.vue`，按 ADR-0212 决策 1 属**合规消费**（非贴面），**不再追求归零**。⚠️ 初稿写的「→ **9**」是中途快照，**已作废**；权威值与逐处台账见 [ADR-0212](./ADR-0212-tonal-elevation-surface-over-shadow.md) 决策 3 的实测标记行 |
| **阴影语义分离** | 阴影**只表达高度**，不表达**状态** | ✅ **已清零**（2026-10-01，票 #885）：实测 `active:shadow` 在生产 `.vue` 中 **0 命中** —— `RefreshableList.vue` 菜单项改用 `active:bg-layer-pressed-*`，`RefreshableList.vue` 的 FAB 与 `GlobalFab.vue` 主按钮改用 `active:opacity-80`（决策见 [ADR-0212](./ADR-0212-tonal-elevation-surface-over-shadow.md) 决策 6 与复核判据 2）。⚠️ 初稿写的「`RefreshableList.vue` / `GlobalFab.vue` 用 `active:shadow-elevation-1` 做按下反馈」为**整改前**状态 |

### 13.5 沉浸模式

| 术语 | 定义 | 本项目落点 |
|---|---|---|
| **沉浸模式（immersive mode）** | 全屏媒体 + 非内容元素可隐藏 + 系统栏可隐藏 | 决策见 ADR-0213 |
| **chrome** | 非内容元素：顶栏 / 操作行 / 页面角标 | `IllustDetail.vue` 的 `PageTopBar` 与操作行容器 |
| **（地基状态）** | 原生侧基础设施 | ✅ **已完备且已验证可用**：`EdgeToEdge.enable(this)`、insets 桥 `pictelioInsets`、`applySystemBarsHidden` + `setSystemBarsHidden`、`KEY_FULLSCREEN_MODE`、`settingsStore.setFullscreenMode()`、`Me.vue` 的 M3Switch 开关、`utils/safeAreaJavaContract.test.ts` 契约测试。真机实测**「全屏模式」开启后状态栏确实隐藏** ⇒ 沉浸模式**近乎零 Java 改动** |
| **（详情页现状）** | `IllustDetail.vue` | 图片**已是满幅宽**（`w-full`）；图片区**零 `@tap`**（已有 `@tap` 全在子元素，操作行内混用 `@tap` 与 `@tap.stop`）⇒ 「点图隐藏 chrome」是纯前端接线 |

### 13.6 真机动效取证的测量能力边界（2026-10-01 实测）

> 这一节记录的是**取证方法本身的限制**。它不是 MD3 概念，也不是缺陷，
> 但**任何按本仓做动效改造的人都必须先知道**，否则会得出「动效没生效」的错误结论。

| 事项 | 实测值 | 判据 |
|---|---|---|
| **单帧 `adb exec-out screencap` 耗时** | **420ms** | 复算：`t0=$(date +%s%N); adb exec-out screencap -p >/dev/null; t1=$(date +%s%N); echo $(( (t1-t0)/1000000 ))`。⚠️ 这是**下限精度**——比它短的动效**在原理上无法用连拍判定** |
| **连拍判定的有效时长** | > ~840ms | 8 帧连拍实测：第 2–8 帧**逐字节相同**（148454 B），第 1 帧不同（150353 B）⇒ tap 后 ~840ms 起画面完全静止 |
| **⚠️ 「采样没看到中间态」≠「没有过渡」** | — | 本项目 MD3 时长档位是 **150–350ms**，**全部短于单帧采样耗时**。用连拍/低帧率视频去判定 200ms 过渡，**采样率不足**，阴性结果**无判别力**。这是本仓最容易犯的取证错误（与 §13.1「零命中 ≠ 不支持」同族：**测不出来 ≠ 不存在**） |
| **可行取证法：长过渡探针** | ✅ **已验证可用（2026-10-01 真机通过）** | 把某个过渡时长令牌**临时**调大到远大于采样周期（本次 200ms → 2000ms），构建安装后连拍。**判据 = 收敛时刻是否与设定时长吻合**，而不是「有没有看到中间色」 |
| **✅ 路径 A 真机结论（已回填）** | **通过** | 把 `--durationNormal` 临时改 2000ms，切换「显示 R-18 内容」开关，连拍 12 帧：**k1→k6 六帧连续不同并单调收敛，k6 之后 7 帧完全静止**；按 420ms 采样换算，收敛于 **≈2100ms**，与 2000ms 设定吻合。目视 k3 帧可见轨道呈 **OFF 浅灰 → ON 实心 primary 蓝之间的中间色**。⇒ **Tailwind `transition-colors` + `duration-[var(--durationNormal)]` 在 Lynx 真机上真实插值，`var()` 时长令牌真实解析** |
| **录屏帧提取能力** | `adb shell screenrecord` → `read` 工具可读并返回采样帧 | ⚠️ 实测：8 秒视频只返回 **5 帧**（约 0.3s 一帧），3 秒视频只返回 **1 帧**。⇒ 录屏**可用于判读状态序列与时序异常**（如整页重排），**不适合做精细色值过渡判定** |
| **像素取色脚本的陷阱** | 手写 PNG 解码器曾解出与肉眼矛盾的色值 | ⚠️ 本环境**无 ffmpeg**，且手写 PNG 解码易错（filter 重建）。判读颜色**优先直接看图**；必须取色时先用一个已知锚点（如 `--md-primary` = `rgb(26,111,168)`）**校准解码器**，校准不过就不要相信输出 |
| **⚠️ 内容区不能逐点取值判定** | 「亮度 < 40 ⇒ 有缺陷」在含白色笔触的插画上**假报** | **用户图片是开放世界内容**：画里本来就有浅色像素。判据若隐含「浅色 = 漏出底色」假设，必然被内容本身骗过。**正确判据是结构边界**：扫描完整色带，看「内容 → 背景」的过渡处**有没有第三种色带**（无中间带 = 正常）。逐点取值判据只在**内容域已知且单一**（如「状态栏区 vs 页面区」两分）时成立。实测见 #896 |

### 13.7 2026-10-01 真机观察到的既有缺陷（非本轮改造范围，登记备查）

| 现象 | 实测证据 | 归属 |
|---|---|---|
| **全屏模式开关切换导致整页重排** | 状态栏显隐改变安全区内边距 ⇒ 页面内容整体位移（实测「通知」行从 y≈189 跳到 y≈257，约 68px） | 连续性相关，属 [ADR-0211](./ADR-0211-ui-continuity-motion-contract.md) 范围的连带发现 |
| **FAB 压住内容行** | 至少 2 处可复现：`Me.vue` 的「全屏模式」行、「最大重试次数」行的最右 chip 被 `GlobalFab` 覆盖 | 布局缺陷，**不在** §13.1–§13.5 任何一条决策内 ⇒ 需单独立项 |
| **原生系统栏基础设施已验证可用** | 「全屏模式」开关 ON ⇒ 状态栏消失；OFF ⇒ 状态栏恢复（两次 A/B 均实测确认） | ✅ 支撑 ADR-0213「近乎零 Java 改动」的结论 |

## 相关链接

- 事实底座：`docs/research/material-design-3-gap-analysis-2026-09.md`
- ADR：[ADR-0205](./ADR-0205-md3-baseline-and-scope.md) · [ADR-0206](./ADR-0206-typography-type-scale.md) · [ADR-0207](./ADR-0207-shape-and-state-layer-guardrails.md) · [ADR-0208](./ADR-0208-material-symbols-icons.md) · [ADR-0209](./ADR-0209-md3-filled-text-field-alignment.md) · [ADR-0210](./ADR-0210-lynx-style-stack-capability-boundary.md) · [ADR-0211](./ADR-0211-ui-continuity-motion-contract.md) · [ADR-0212](./ADR-0212-tonal-elevation-surface-over-shadow.md) · [ADR-0213](./ADR-0213-immersive-media-view.md)
- 术语文档：[./glossary-lynx-units.md](./glossary-lynx-units.md)（单位与换算，权威） · [./glossary-lynx-bili-theme.md](./glossary-lynx-bili-theme.md)（色板/主题/暗色） · [./glossary-emulator-verification.md](./glossary-emulator-verification.md) · [./glossary-ui-cards.md](./glossary-ui-cards.md)（A2 卡片体系，Fluent 2 口径，仅存档参考）

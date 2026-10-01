# MD3 符合性复核报告（2026-10-01）

> 对象：`packages/app-lynx`（vue-lynx + Lynx 4.0.1 + Tailwind 3.4，Android 构建）
> 方法：读 `docs/adr/glossary-md3-alignment.md`（现状口径）+ ADR-0205~0208 + `docs/research/material-design-3-gap-analysis-2026-09.md`（19 条差距底座），
> 然后**逐条独立复算**文档声称的现状（不复述文档数字），并跑门禁取机器读数。
> 样本口径：**生产 `.vue` = `src/` 下排除 `.test.` 与 `errorPrototype/`，共 75 个文件**（与术语文档一致）。
> CodeGraph 索引健康：16,155 节点 / 54,007 边（索引于 2026-09-29，早于本轮 MD3 整改，故代码事实以 grep 实测为准，CodeGraph 用于定位）。

## 0. 一句话结论

**令牌层（tokens / tailwind config）已高度合规且有真门禁；消费层已基本整改完毕；剩余差距集中在 4 类**——
① 引擎妥协（`on-primary` 状态层预合成）② 知情接受的存量债（disabled 仍用 `opacity-40/50`）
③ **文档未登记的新发现：评论/设置输入框未对齐 M3 filled text field 56dp**（只豁免了搜索框）
④ 门禁覆盖盲区（`motionDurationTokens` 漏 `App.vue`、数值无回源机器防线）。
**尚不能称「完全符合 MD3」**，但阻断级差距（type scale 四元组、状态层四态、图标集）已全部关闭。

## 1. 复核方法与可信度声明

- **不复述文档数字**：术语文档里的每个计数我都重数了一遍（见 §2「口径核对」），结论一致才采信。
- **门禁绿 ≠ 合规**：按 ADR-0205 决策 6 的三层证据口径，静态绿只覆盖第①层；第②③层（真机截图 / e2e）本报告未重跑。
- **不确定项显式标注**：凡「静态推断、未真机验证」的，本报告不升级为结论。

## 2. 口径核对：术语文档计数 vs 本轮实测

| 项 | 术语文档 | 本轮实测 | 判定 |
|---|---|---|---|
| 生产 `.vue` 文件数 | 76 | 75（不含 errorPrototype） | ✅ 差 1 为口径说明，文档已注明 |
| `rounded-[var(--md-shape-*)]` | 261 | 261 | ✅ |
| `rounded-full` | 49（§3.1）/ 73（全 src） | 73 | ⚠️ 文档 §3.1 写 49，与全 src 实测 73 不符（疑为口径不同：可能只算 components/ 或剔除某类）——**建议订正** |
| 方向变体 | 16 | `rounded-t` 18 / `rounded-b` 3 / `rounded-tr` 2 = 23 | ⚠️ 文档写 16，与实测 23 不符，**建议复核订正** |
| shape 档位名（`rounded-xs/sm/lg/xl`） | 0 | 0 | ✅ |
| Tailwind 默认档位（`rounded-md/2xl/3xl`） | 0 | 0 | ✅ |
| `text-display-*` 消费 | 0 | 0 | ✅ |
| `hover:` / `focus:` / `focus-visible:` | 0 / 0 / 0 | 0 / 0 / 0 | ✅ |
| A11Y 引入文件数 | 32/76 | 31/75 | ✅ 同口径（差 1 为 errorPrototype） |

> 结论：**术语文档整体可信**，但圆角消费的两处计数（`rounded-full`、方向变体）需订正。

## 3. 已符合的域（有机器防线 + 复算一致）

| 域 | 判定 | 复算证据 |
|---|---|---|
| 色彩角色 | ✅ | 生产 `.vue` 裸 hex 命中 3 处**全在注释**；`rgba()` 2 处全在注释；`--md-*` 为单一事实源，Tailwind `colors` 只放 `var()` 引用 |
| 色板派生 | ✅ | `palettes-drift.test.ts` 是**真源对真源**（tokens.css 生成段 ≡ 脚本 `--stdout` 逐字节 + 7/7 亮色锚点对等），非自证 |
| 排版四元组 | ✅ | 15 档语义 + 10 档旧别名，size/lineHeight/letterSpacing 三要素齐备；消费侧 `leading-*` 0 处、`tracking-*` 0 处（档位带出，预期）；`font-bold` 仅 1 处（`Login.vue` 产品字标，白名单在册） |
| 形状 | ✅ | 6 档全指向 `--md-shape-*`；无未接令牌的圆角；档位名 0 处属登记在案的存量债 |
| 缓动曲线 | ✅ | 四条 `--motion-*` 与官方一致；`transitionTimingFunction` 顶层替换 + `extend.DEFAULT` 双写堵住 preset 覆盖；源码无裸 `cubic-bezier`（3 处全在注释） |
| 状态层四态 | ✅（含引擎妥协） | 四态 × 5 色 = 20 条令牌全齐；`active:` 消费 79 处；`bg-layer-*` 27 处 vs `bg-state-*` 实色 24 处；`hover-class` 绑定 0 处（#868 已清） |
| 图标集 | ✅（静态子集） | Material Symbols 子集 + `AppIcon.vue` 统一；规则 7 禁裸字形 |

**门禁质量评估（正面）**：`md3GuardScans` 8 条规则均带**反事实 + 阳性对照 + 抽取器自检**，例如规则 6 有边界级阳性对照并证明其 load-bearing
（朴素判据下也会红），规则 8 的文件粒度豁免有「塞第二份 @font-face 必须转红」的反事实。这是**能防回归的真门禁**，不是装饰。

## 4. 剩余差距（按处理性质分类）

### 4.1 引擎妥协（不可整改，需持续标注）

- **`on-primary` 状态层为预合成不透明色**：Lynx 的 `background-color` 是**替换**语义、不渲染 `color-mix()`、`hover-class` 无效（#867/#868 真机实证），
  故实心 primary 按钮按压层只能用预合成色。`state-layer-collapse-audit.mjs` 判别：修复后 280 条里 0 条会塌（ΔE ≤ 16.81）。**这是唯一落地的可行解**。
- **Expressive spring 不可表达**：Lynx transition 能力所限，现有组件用 cubic-bezier 近似。

### 4.2 知情接受的存量债（文档已登记，非新发现）

| 项 | 实测 | 文档口径 |
|---|---|---|
| disabled 消费未用 token | 13 文件 `opacity-40/50`（12×40 + 14×50）；`bg-state-disabled-*` 消费 0 | ✅ 一致（知情接受） |
| `ActionButton` 字面量 alpha | 1 处 `active:bg-white/10` | ✅ 一致 |
| 动效硬编码毫秒 | 2 处：`App.vue` `shimmer 1.5s`（藏在 `var()` 回退实参里）、`GlobalFab.vue` `fab-ring-spin 1s` | ✅ 一致 |
| shape 档位名 0 消费 | 261 处走 arbitrary 正确写法 | ✅ 一致 |

### 4.3 ⚠️ 新发现：评论/设置输入框未对齐 M3 filled text field（未在豁免清单）

ADR-0205 决策 4 的「有意偏离」清单是**封闭**的（4 条），其中 text-field 只豁免了**全局搜索框药丸形态**。
但实测另有 4 个文件含 `<input>` 的**表单输入**同样是非 MD3 形态，且**无任何留痕**：

| 组件 | 实际高度 | 形态 | 是否在豁免清单 |
|---|---|---|---|
| `SearchSheet.vue:362` | `h-[11.2vw]`=42dp | 药丸 full | ✅ 已豁免（决策 4 第 2 条） |
| `BookmarkPanel.vue:241,250` | `h-[11.2vw]`=42dp | 药丸 full | ❌ **未豁免** |
| `SettingsEndpoint.vue` | `h-[12vw]`=45dp | `rounded-medium` + outline 边框 | ❌ **未豁免**（≈filled 变体，但高度/形态未对齐 56dp） |
| `CommentInputBar.vue` | `h-[14.933vw]`=56dp | `rounded-t-extra-small rounded-b-none` + 下划线 | ❌ **未豁免**（高度够 56dp，但缺 filled 顶面色带/label 浮动） |
| `pages/Me.vue` ×2 | `h-[14.933vw]`=56dp | 同上 | ❌ **未豁免** |
| `pages/Login.vue` | `h-[14.933vw]`=56dp | 同上 | ❌ **未豁免** |

差距分析 §2 #8 原本建议「评论/设置输入框对齐 M3 filled 56dp」但**仅搜索框被登记豁免**，其余表单输入既未整改也未豁免。
按「封闭清单 + 不在表内默认按要修」的口径，这是**当前最实质的未关闭差距**。建议：要么整改为 filled 56dp，要么补进豁免清单并留痕。

### 4.4 门禁盲区与结构性缺口

- **`motionDurationTokens.template.test.ts` 只覆盖 3 个文件**，且 `App.vue` 的 `shimmer 1.5s` 因 `var()` 整体被摘而**落在判据盲区**（「时长槽零字面量」对它恒真）。
- **MD3 数值无回源机器防线**：`md3ConfigTokens.test.ts` 只能核对「tokens.css/tailwind.config.ts 里的值 = 本仓抄下来的期望值」，抄错时与实现同源同错。真正的上游（material-web v0.192）**不在仓内**（`tokens/…` 从未入库，刻意不 vendor）⇒ 「与官方一致」目前是**人工回源核对过的一手断言**，非仓内可机器复算的等式（术语文档 §12.3(b) 已诚实登记）。
- **a11y 语义偏薄**：31/75 文件引入 `A11Y_ELEMENT_ENABLED`，但全站仅 `accessibility-element` + `accessibility-label`（186+198 处），**无 `accessibility-role`/`state`/`disabled`/`checked`**——开关类、选中类控件（`M3Switch`/`M3SegmentedButton`）的「是/否」语义未通过无障碍属性暴露，仅靠平台焦点环。
- **色板计数需订正**：`rounded-full` 49 vs 73、方向变体 16 vs 23（见 §2）。

## 5. 门禁机器读数（本轮实跑）

- MD3 专项 10 文件 / **193 断言全绿**（976ms）。
- app-lynx 全量 **223 文件 / 3136 断言全绿**（9.67s）。
- 结论：本轮复核未发现门禁红，也未发现「门禁假绿」（各规则均有反事实/阳性对照支撑）。

## 6. 是否「完全符合 MD3」的判词

**否，但已从「系统性缺口」推进到「零星存量债 + 引擎妥协 + 一处未登记差距」。**

- 阻断级（type scale 四元组、状态层四态、图标集、display 档位、shape 档位注册）：**全部关闭**。
- 高危（focus 环：按 ADR-0207 决策 5 实证判定为引擎不匹配，改由 `accessibility-element` 承担）：**已决策并留痕**。
- 剩余：① 1 处未登记的表单 text-field 差距（§4.3，建议最高优先）；② disabled 存量债（13 文件，可选整改）；③ 2 处动效字面量（1 处判据盲区）；④ a11y 语义（role/state）可加强。

> 判读纪律提醒：以上「关闭」均是**第①层静态证据**口径。按 ADR-0205 决策 6，观感类是否贴合仍由第②层真机截图兜底；本报告未重跑截图矩阵（`md3-visual-tokens.spec.ts` A1–A4 / `transition-matrix.spec.ts` 需模拟器），故不代第②③层下结论。

## 附：本轮工具路由记录

- OpenWiki：读 `quickstart.md`/`architecture` 入口定位设计系统归属 → 判定属「设计系统/约定」主题，先读 openwiki 与 ADR 术语表。
- CodeGraph：`codegraph status --json` 查索引健康；符号定位以 grep 实测为准（索引早于整改，见 §0 声明）。
- 门禁：全量 `vitest run` 取机器读数。

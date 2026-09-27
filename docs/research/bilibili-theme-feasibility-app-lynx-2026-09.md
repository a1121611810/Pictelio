# 可行性：给 app-lynx 增加 bili（bilibili）主题

> 评估日期：**2026-09-27**
> 评估对象：`packages/app-lynx`（vue-lynx，Material Design 3 + Tailwind）
> 输入材料：`docs/research/bilibili-theme-style-2026-09.md` 及三份底稿（bilibili 主题令牌体系 / 多端页面 / 动效交互）
> 方法：对 app-lynx 现状做**一手代码审计**（CodeGraph + tokens.css/Me.vue/tailwind.config.ts 逐文件核实），再用调研结论反推方案
> **图例**：✅ 已核实 ｜ 🟡 推断或需设计决策 ｜ ❌ 已验证为不可行 ｜ — 无证据
>
> ⚠️ **本文是可行性评估，不是实施方案。** 若决定推进，接 `/grill-with-docs` → `/to-spec` → `/to-tickets`，不在本文直接落码。

---

## 0. 结论

**可行，且成本远低于预期——因为 app-lynx 早就把「主题机制」建好了，bili 只是第 7 行色板数据。**

| 档位 | 定义 | 可行性 | 改动面 | 产物像不像 bilibili |
|---|---|---|---|---|
| **L1** | bili 作为第 7 个**主题色**，色板由 M3 TonalSpot 从 bili 粉种子生成 | ✅ 高 | 5 文件 / ~200 行 | **不像**——是「M3 的粉」，不是 bilibili |
| **L2** | bili 作为第 7 个主题色，色板用 **bilibili 真实色值手工映射**到 65 个 M3 角色 | ✅ 高（推荐） | 7 文件 / ~400 行 | **像**——主色/强调色/表面层级都对得上 |
| **L3** | 引入 bilibili 那套 191 原语 + 40 语义的完整令牌体系 | ❌ **不建议** | 推翻 Tailwind 映射 | 会破坏 M3 约定，不该做 |

**一句话**：机制侧已经就绪（✅ 6 主题 × 3 暗态在跑、✅ 386 处 `var(--md-*)` 消费、✅ 无 Tailwind 改动、✅ 无 Java 改动、✅ 测试已数据驱动自动覆盖），真正的工作量是**设计决策**（bilibili 的哪个色对应 M3 的哪个角色）而不是工程。

**推荐 L2**，理由见 §3。

---

## 1. app-lynx 现有主题机制解剖（全部一手核实）

### 1.1 机制：根 `<page>` 挂类 + 复合选择器 ✅

```
appearanceClasses(themeColorId, resolvedDark) → ['theme-sky']  或  ['theme-bili', 'dark']
        ↓ 绑到根 <page> 的 class
tokens.css:  .theme-bili { --md-primary: …; … }        ← 亮色板（48 条声明）
             .theme-bili.dark { --md-primary: …; … }    ← 暗色板（65 条声明，特异性 0,2,0 > 0,1,0）
```

- `packages/app-lynx/src/utils/appearanceClasses.ts` — 根类数组的唯一实现，**零运行时算色**
- `packages/app-lynx/src/utils/themeColor.ts` — `THEME_COLOR_OPTIONS` 是 id → className 的**单一事实源**，未知 id `console.warn` + 回退（符合 AGENTS.md「禁止静默降级」）
- `packages/app-lynx/src/utils/darkMode.ts` — 三态 `light/dark/system`，`system` 走系统监听
- `packages/app-lynx/tailwind.config.ts` — `colors.primary = 'var(--md-primary)'` 等，**所有颜色工具类最终指向 CSS 变量**

**这意味着换肤 = 换根节点一个 class**，不重渲染、不重算色、不发网络请求。

### 1.2 关键约束：零运行时算色（ADR-0152 决策延续）✅

`scripts/generate-theme-palettes.mjs` 文件头明确写着理由：

> 零运行时算色：产物为静态 CSS，Lynx bundle 不引入 material-color-utilities（ADR-0152 决策延续：**避免 Lynx bundle 增大 + 动态 CSS 变量写入支持面窄**）

即：**Lynx 引擎对运行时动态写 CSS 变量的支持面窄**，所以整个体系被设计成「构建期把色板算好、运行期只切类名」。

> 📌 **这条约束直接决定了 L3 为什么不可行**——bilibili 的做法是运行时换 `<link>`（link-swap），依赖运行时替换样式表；Lynx 侧不做这件事，也不该为了一个主题破掉这条 ADR。

### 1.3 现有主题色清单（6 个）✅

`themeColor.ts` 的 `THEME_COLOR_OPTIONS`：`sky`（默认）/ `violet` / `pink` / `green` / `orange` / `teal`
`generate-theme-palettes.mjs` 的 `THEMES[]`（暗色 seed 输入）：

| id | lightPrimaryAnchor | id | lightPrimaryAnchor |
|---|---|---|---|
| `sky` | `#1a6fa8` | `orange` | `#855317` |
| `violet` | `#65558f` | `teal` | `#00696d` |
| `pink` | `#8b4a61` | | |
| `green` | `#3c6939` | | |

> ⚠️ 注意两个清单**不是同一批数**：`themeColor.ts` 只持 id→className，锚点由脚本持有；脚本注释明确纠正过「themeColor.ts 是锚点单一事实源」的旧说法。`tests/palettes-drift.test.ts` 双向锁死二者。

### 1.4 令牌体量（决定改动面）✅

`src/styles/tokens.css`：**851 行 / 33,731 B / 104 个唯一 CSS 变量，其中 65 个是 `--md-*`**

| 块 | 数量 | 每块声明数 |
|---|---|---|
| 基础 `page` 色板（= 默认 sky） | 1 | 104 |
| 亮色主题覆盖（`.theme-pink` 等，sky 复用基础块） | 5 | **48** |
| 暗色主题块（`.theme-X.dark`，脚本生成） | 6 | **65** |

→ **加第 7 个主题 = 1 个亮色块（48 条）+ 1 个暗色块（65 条）≈ 113 条声明**。

### 1.5 硬编码色值普查（决定「换肤会不会只换一半」）✅

| 形态 | 数量 | 结论 |
|---|---|---|
| `var(--md-*)` 消费点 | **386 处 / 62 个 .vue 文件** | ✅ 令牌化程度很高 |
| Tailwind 任意值 `bg-[#xxx]` / `text-[#xxx]` | **0** | ✅ 无绕过令牌的做法 |
| 6 位 hex（.vue） | **9 处 / 仅 2 个文件**（`BookmarkButton.vue`、`errorPrototype/ErrorPagePreview.vue`） | ✅ 极少数 |
| Tailwind 内置色板类（`text-white` / `bg-white`） | **44 处**（33 + 11） | 🟡 **不随主题变化**，是「on-primary 上的白字」这类语义用法，bili 主题下若 `--md-on-primary` 仍是白则无视觉差；若改成深色则会冲突 |

**结论**：换肤的视觉覆盖面接近 100%，不会出现「只换一半」的破碎感。这是 L2 可行的**决定性依据**——如果 token 覆盖率只有 50%，做任何新主题都会露出硬编码的破绽。

### 1.6 测试：已经数据驱动，加主题自动覆盖 ✅

- `tests/unit.test.ts:630` — **「每个主题色板类都覆盖同一套可主题角色」**不变量测试：`for (const option of THEME_COLOR_OPTIONS)` 逐个断言角色集完整。**加第 7 个自动进入这个循环**。
- `tests/unit.test.ts:631` — `expect(THEME_COLOR_OPTIONS.length).toBeGreaterThanOrEqual(6)`，加到 7 仍然通过。
- `tests/palettes-drift.test.ts` — 双向锁：tokens.css 自动生成段 ≡ 脚本 `--stdout`；脚本锚点 ≡ tokens.css 亮色 `--md-primary`。**加了主题忘了改脚本（或反之）会直接红**。

这是本仓库比 bilibili 做得好的地方：调研发现 bilibili 站内 7 套设计血脉、首页副本与官方包漂移 11–12 个原语；而 app-lynx 有一道**机器强制**的双向漂移锁。

### 1.7 原生侧：不需要改 Java ✅

- `LynxActivity.java:95` — `KEY_DARK_MODE = "settings_dark_mode"`，原生**只读暗色键**
- 全仓 Java 侧**没有任何主题色读取点**（`grep themeColor|theme_color` 在 `packages/app/android/` 零命中）
- 状态栏图标色按 `resolvedDark` 走，不依赖 accent color

→ **加 accent 主题不触碰原生契约**，`darkModeJavaContract` 契约测试不受影响。

### 1.8 跨端对照：webview 根本没有 accent 主题概念 ⚠️ 最重要的边界

| | webview（`packages/app`） | app-lynx |
|---|---|---|
| 设计体系 | Fluent 2 | Material Design 3 |
| 主题模型 | `light / dark / system`（`ThemeSelector.tsx` 的 `THEME_OPTIONS` **只有 3 项**） | **6 主题色 × 3 暗态** = 18 种组合 |
| accent 主题色 | **不存在**（`grep themeColor\|accentColor` 零命中） | ✅ 一等公民 |
| 令牌形态 | `var(--colorCompoundBrandStroke)` 等语义别名 | `var(--md-primary)` 等 M3 角色 |

**这是既有的结构不对称**（与 ADR-0098 记录的「同语义双实现真实分叉」同类），不是 bili 引入的新问题。但它决定了 bili 主题的**定位选择**：

- **只在 lynx 加** → 成本 ~400 行，但双端外观差异进一步拉大
- **webview 同步加** → 需要**先给 Fluent 2 建 accent 色板 seam**（Fluent 2 的 brand ramp 在 tokens.css 里是否存在可切分的多档？需要单独评估），工作量至少翻倍，且要动 `ThemeSelector` 与 Fluent 令牌体系

---

## 2. bilibili 能提供什么、不能提供什么（基于调研）

### 2.1 ❌ 不能提供「主题系统」——因为 bilibili 自己就没有 ✅（反直觉但已验证）

调研底稿的 App 端结论是 **(b) 只有亮/暗切换**：

- 1,837 B 的主题运行时 JS，**全文 `dark` 出现 0 次**，值域硬编码为 `"light"` / `"dark"` 两个字符串
- Web 端主题菜单源码里**只有 `dark` / `light` 两个 `value`**，结构上不存在主题编辑器
- **无主题市场、无皮肤包、无大会员主题路径**

→ **所以「bili 主题」能拿到的只有「一套配色」，拿不到「一套主题机制」。** 而机制侧 app-lynx 本来就有。**这正是本评估成本低的根本原因。**

### 2.2 ✅ 能提供：真实色值（已核实的一手数据）

| 令牌 | 亮色 | 暗色 | 用途（bilibili 实证） |
|---|---|---|---|
| `--Pi5` | **`#FF6699`** | **`#D44E7D`** | 品牌粉。PC 端 v12 主题值（**不是**经典的 `#FB7299`） |
| `--Lb5` | **`#00AEEC`** | **`#0087BD`** | 品牌蓝。**bilibili 真正的通用交互强调色** |
| `--Ga0 / Ga1 / Ga10` 等 | 灰阶 0–13 | 灰阶反转 | 表面层级 / 文字层级 |
| `--text_white` | 恒 `#FFFFFF` | 恒 `#FFFFFF` | 主题不变层（`_u`） |

**关键洞察：bilibili 的品牌是「粉蓝双色」，且蓝色才是交互强调色**（首页 CSS 中 `brand_blue` 引用 39 次 vs `brand_pink` 9 次，粉色集中在大会员/装扮语境）。

→ 这给 L2 提供了一个**明确的设计答案**：M3 的 `primary` 该取粉还是蓝？按 bilibili 自身的用法，**`primary` 更接近粉（品牌）而 `secondary`/交互强调更接近蓝**——但这与 M3「primary 就是交互强调色」的语义**直接冲突**。这是 L2 唯一真正的设计难点，也是必须在 `/grill-with-docs` 里拍板的事。

### 2.3 ✅ 能提供：两条值得抄的架构经验

| bilibili 的做法 | app-lynx 现状 | 结论 |
|---|---|---|
| 语义别名层与主题无关（`map.css` 亮暗共用），切主题只换原语层 | `.theme-X` / `.theme-X.dark` 复合块切同一批变量名 | ✅ **已等价内化**，无需借鉴 |
| 品牌色 `#FB7299` 出现在 3 种写法共 197 处 | 有 `palettes-drift` 双向锁 + 角色集不变量测试 | ✅ **app-lynx 的纪律强于 bilibili** |

→ 架构上**没有需要补的短板**。这进一步支持「只加数据不加机制」的结论。

### 2.4 ❌ 明确不可行的（记录以免日后重提）

- ❌ **照搬 bilibili 的 link-swap 机制**：依赖运行时替换样式表，撞 ADR-0152「动态 CSS 变量写入支持面窄」
- ❌ **引入 191 原语 + 40 语义**：要改 `tailwind.config.ts` 的 `colors` 映射（现全部指向 `--md-*`），推翻 M3 约定，违反 `AGENTS.md` 的 app-lynx 样式硬约定
- ❌ **引入 14 色相族**：现有架构的语义角色只有 65 个，14 族 × 11 阶 = 154 个原语远超需求，徒增体积与漂移面

---

## 3. 三档方案对比与推荐

### L1：M3 TonalSpot 从 bili 种子生成

| 维度 | 评估 |
|---|---|
| 做法 | `THEMES` 加 `{ id: 'bili', lightPrimaryAnchor: '#FF6699' }`，跑脚本生成暗色板，tokens.css 手调/沿用亮色 |
| 改动面 | 5 文件：脚本(+1 行)、tokens.css(+1 亮块)、themeColor.ts(+1 行)、Me.vue(+15 行)、i18n(+2 键) |
| 优点 | 最省；暗色板由脚本保证与既有 6 套同构 |
| 缺点 | 产物是 **M3 的粉**。M3 TonalSpot 的色相/明度关系与 bilibili 手工调的阶梯不同，主色会偏；且失去 bilibili「蓝才是交互色」的特征 |
| 适合 | 「我就是想要个粉色调」的快速方案 |

### L2：用 bilibili 真实色值手工映射（**推荐**）

| 维度 | 评估 |
|---|---|
| 做法 | 亮色板**手调**（照 ADR-0152 既有 6 套的做法），暗色板可脚本生成后按 bilibili 暗值微调（`--Pi5` 暗 = `#D44E7D` 是已知锚点） |
| 改动面 | 7 文件：L1 的 5 个 + 暗色微调 + a11y 标签 + 测试补充断言 |
| 优点 | 视觉可信；沿用既有「亮色手调、暗色生成」的既定做法，不破坏任何 ADR |
| 缺点 | 需要做 48+65 条的角色映射决策（哪 65 个 M3 角色各取 bilibili 哪个值）——**这是设计工作不是工程工作** |
| 适合 | 「要看起来就是 bili」的目标 |

### L3：引入 bilibili 完整令牌体系 ❌

不推荐，理由见 §2.4。若真要「完整 bilibili 化」，正确做法不是加主题，而是**换设计体系**——那是一次独立的设计决策工程，不在本题范围。

### 决策矩阵

| 判据 | L1 | L2 |
|---|---|---|
| 工程成本 | ~200 行 | ~400 行 |
| 设计决策量 | 1 个（种子色） | ~65 个角色映射 |
| 视觉可信度 | 低 | 高 |
| 破坏既有 ADR | 无 | 无 |
| 未来加第 8 主题的边际成本 | 同等 | 同等（机制已通用） |
| 跨端是否需同步 | 否（但差异扩大） | 否（同） |

**建议：L2。** 多出的 200 行是一次性设计投入，而 L1 省下的部分会以「看起来不对」的形式在每次评审里反复出现。

---

## 4. 改动面清单（L2 预估）

| # | 文件 | 改动 | 量级 | 风险 |
|---|---|---|---|---|
| 1 | `packages/app-lynx/scripts/generate-theme-palettes.mjs` | `THEMES[]` += `{ id: 'bili', lightPrimaryAnchor: … }` | 1 行 | 低（漂移测试会强制 tokens.css 同步） |
| 2 | `packages/app-lynx/src/styles/tokens.css` | += `.theme-bili {…48 条 }` + `.theme-bili.dark {…65 条 }` | ~150 行 | 低（脚本可生成暗色块） |
| 3 | `packages/app-lynx/src/utils/themeColor.ts` | `THEME_COLOR_OPTIONS` += 1 项 | 1 行 | 低（类型自动派生） |
| 4 | `packages/app-lynx/src/pages/Me.vue` | += 1 个色块（**手写重复模板**） | ~15 行 | 🟡 重复代码，7 份近乎相同的模板 |
| 5 | `packages/app-lynx/src/i18n/locales/{zh-CN,en}/pages.ts` | += 色名 label；**改 hint 文案**（现文案「选择主题色（Material Design 3 配色）」将不再准确） | 3 键 | 🟡 文案正确性 |
| 6 | a11y labels（`ME_A11Y_LABELS`） | += 1 项 | 1 行 | 低 |
| 7 | 测试 | `palettes-drift` / 角色集不变量**自动覆盖**；可能需补 1–2 条显式断言 | ~5 行 | 低 |
| — | `tailwind.config.ts` | **无需改动**（colors → `var(--md-*)`） | 0 | — |
| — | Java / 原生 | **无需改动**（只读暗色键） | 0 | — |
| — | webview | 若不同步则不动 | 0 | 🟡 双端不对称扩大 |

**顺带发现（独立于本题）**：`Me.vue` 的 6 个色块是**手写重复模板**，每块约 15 行且 id 字面量散落 4 处（`themeColor === 'x'` / `appearanceClasses('x', …)` / `ME_A11Y_LABELS.themeColorX` / `setThemeColor('x')`）。第 7 个会让重复变成 7 份。**建议在加主题的同时（或之前）把它收敛成 `v-for` 驱动的单块**——这正是 `/codebase-design` 所说的「deep module」机会点。是否一并做属于范围决策，留给 grill。

---

## 5. 风险与边界

| # | 风险 | 等级 | 说明 / 缓解 |
|---|---|---|---|
| R1 | **双端外观不对称扩大** | 🟡 中 | webview 无 accent 概念。缓解：bili 定位为「lynx 端可选配色」，不进跨端承诺；若要跨端，先单独立项评估 Fluent 2 的 accent seam |
| R2 | **M3 `primary` 语义 vs bilibili「蓝才是交互色」冲突** | 🟡 中 | L2 唯一真设计难点。必须在 grill 拍板：`primary` = 粉（品牌）还是蓝（交互） |
| R3 | **品牌归属** | 🟡 中 | 使用 bilibili 色值本身无技术障碍，但把第三方品牌色以「bili」命名内置进 Pixiv 客户端是**产品/法务判断**，属用户决策，不由技术评估代劳 |
| R4 | **i18n hint 文案失真** | 🟢 低 | 改为中性表述（如「选择主题色」），去掉体系名 |
| R5 | **`text-white`/`bg-white` 不随主题变**（44 处） | 🟢 低 | 若 bili 亮色 `--md-on-primary` 仍为白则无差异；需在设计映射时验证 |
| R6 | **手写色块模板膨胀** | 🟢 低 | 见 §4 顺带发现 |
| R7 | **Lynx 引擎 CSS 变量支持面** | 🟢 低 | 现有 6 套 × 暗态已随应用发布并被单测契约锁定（`unit.test.ts` 角色集不变量 + `palettes-drift`），**不引入新机制即不引入新风险**。注：现有 `lynx-device-check.sh` / `lynx-screen-analyze.py` 覆盖登录→推荐→图片比例流程，**并不覆盖主题视觉回归**——这是实现阶段要补的验证缺口（见 §7-5） |
| R8 | **忘记同步脚本/tokens.css** | 🟢 无 | `palettes-drift` 双向锁会红 |

---

## 6. 若决定推进：建议流程

按 `AGENTS.md` 的工作流硬约束（Grill → to-spec → to-tickets → implement），本评估**不能直接进实现**。建议：

1. **`/grill-with-docs`**（不是 `/grill-me`——有工作目录，需留 `CONTEXT.md` + ADR 痕迹）拍板三件事：
   - 档位：L1 还是 L2
   - `primary` 取粉还是蓝（R2）
   - 是否一并收敛 `Me.vue` 色块模板（§4 顺带发现）
   - 是否需要 webview 对齐（R1）
2. **`/to-spec`** → 产出「bili 主题色板规格」：48 + 65 条角色映射表（这是本评估留下的**主要空白**——具体每个 M3 角色取 bilibili 哪个值，属于 spec 内容而非评估内容）
3. **`/to-tickets`** → 至少拆成「色板数据」「接线（themeColor/Me.vue/i18n/a11y）」「测试与漂移锁」三张，声明依赖边
4. **`/implement`** → 每张 ticket 走 `/tdd` + `/code-review` 闭环

---

## 7. 本评估的空白与未验证项

| # | 项 | 状态 |
|---|---|---|
| 1 | **65 个 M3 角色 ↔ bilibili 原语的具体映射表** | — 未产出（属 spec 阶段工作，见 §6） |
| 2 | bilibili 亮/暗色板的完整 191 原语值 | ✅ 已在 `bilibili-theme-tokens-full-2026-09.md`（可直接取用） |
| 3 | Fluent 2 侧能否切出 accent 色板（跨端同步的前置） | — 未评估 |
| 4 | `ErrorPagePreview.vue`（错误原型页）的 6 处硬编码 hex 是否会破坏换肤 | 🟡 需在设计映射时目视确认（该页属 errorPrototype，可能不进正式流程） |
| 5 | 真机上 bili 主题的视觉回归 | — 需 `/implement` 阶段用 `lynx-device-check.sh` / `lynx-screen-analyze.py` 验证 |
| 6 | 第 7 个色块是否触发窄屏布局挤压 | 🟡 现有是 `flex-row` 布局，6 → 7 项需真机确认换行行为 |

---

## 8. 审计方法与可复算口径

本评估的代码侧结论全部来自对当前工作区的一手读取（非文档转述），审计时该工作区**存在并行会话对 `packages/app-lynx` 的未提交改动**（`IllustDetail.vue` / `router.ts` / `accessibility.ts` / i18n 等），故：

- 结论反映的是**审计时刻的工作区状态**，非某个 commit
- 本评估**未修改任何源文件**，只新建本文档
- 关键命令与口径：

```bash
# 令牌体量与主题块
python3 -c "import re;t=open('packages/app-lynx/src/styles/tokens.css').read();print(len(t))"
grep -c 'var(--md-' packages/app-lynx/src/**/*.vue     # 386 处 / 62 文件
grep -rhoE '#[0-9a-fA-F]{6}\b' --include='*.vue' packages/app-lynx/src   # 9 处 / 2 文件
grep -rhoE '\b(bg|text|border|ring|fill|stroke)-(white|black)\b' --include='*.vue' packages/app-lynx/src  # 44 处

# 机制
codegraph query theme / codegraph explore "THEMES generateThemePalettes ThemeColorId appearanceClasses"
grep -rn "KEY_DARK_MODE" packages/app/android/            # 原生只读暗色键
grep -rn "THEME_OPTIONS" packages/app/src/components/ThemeSelector.tsx  # webview 仅 3 项
```

> ⚠️ **普查踩坑记录**：`grep -rhoE '#[0-9a-fA-F]{3}\b'` 会把注释里的 issue 编号（`#732` / `#542` / `#534`）全部计入，一度得出「530 处硬编码色」的假结论。**颜色普查必须带上下文（class 属性 / CSS 声明）过滤**，否则数字不可用。

---

## 9. 来源

**代码侧（一手，审计时刻工作区）**

| # | 路径 | 用途 |
|---|---|---|
| C1 | `packages/app-lynx/src/utils/themeColor.ts` | `THEME_COLOR_OPTIONS` 单一事实源 |
| C2 | `packages/app-lynx/src/utils/appearanceClasses.ts` | 根 `<page>` 类绑定 |
| C3 | `packages/app-lynx/src/utils/darkMode.ts` | 三态暗色 |
| C4 | `packages/app-lynx/src/styles/tokens.css` | 令牌体量、主题块结构 |
| C5 | `packages/app-lynx/scripts/generate-theme-palettes.mjs` | `THEMES` 锚点、零运行时算色约束 |
| C6 | `packages/app-lynx/tailwind.config.ts` | `colors` → `var(--md-*)` 映射 |
| C7 | `packages/app-lynx/src/pages/Me.vue` | 主题色选择器 UI（手写 6 块） |
| C8 | `packages/app-lynx/tests/unit.test.ts:568-640` | 主题色契约 + 角色集不变量 |
| C9 | `packages/app-lynx/tests/unit/palettes-drift.test.ts` | 脚本 ↔ tokens.css 双向漂移锁 |
| C10 | `packages/app/android/.../LynxActivity.java:95` | `KEY_DARK_MODE`（无主题色读点） |
| C11 | `packages/app/src/components/ThemeSelector.tsx` | webview 主题仅 3 项 |

**调研侧（bilibili，转引自本仓库文档）**

| # | 文档 | 提供的事实 |
|---|---|---|
| R1 | `docs/research/bilibili-theme-style-2026-09.md` | 汇总层：三层令牌架构、暗色 link-swap、7 套设计血脉 |
| R2 | `docs/research/bilibili-theme-tokens-full-2026-09.md` | 191 原语 light⇄dark 全表、40 语义、`--Pi5`/`--Lb5` 真实值 |
| R3 | `docs/research/bilibili-surfaces-and-mobile-2026-09.md` | 站内一致性、移动 H5 量化、**App 端只有亮/暗**（§2.1 的依据） |
| R4 | `docs/research/bilibili-interaction-and-motion-2026-09.md` | 动效/排版/可达性穷尽统计、Fluent 对照 |

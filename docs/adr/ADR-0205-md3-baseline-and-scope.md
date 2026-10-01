# ADR-0205：app-lynx 设计基线锚定 MD3，整改范围与「有意偏离」清单

## 状态

accepted（2026-09-30）

## 背景

`AGENTS.md` 声明 `pictelio-app-lynx` 使用 Material Design 3 作为设计系统。但这句话在仓库里
**缺少可执行的细则**，落到了两个坏处：

1. **基线信息自相矛盾。** `AGENTS.md` 里篇幅最大的「Fluent Design 规范」章，服务的是
   已被 [ADR-0203](./ADR-0203-webview-client-source-removal.md) 整包删除的 WebView 客户端
   （该章顶部已有存档声明，但正文仍以命令式口吻写着「本项目**强制**遵循」「无例外」）。
   读者无法从文档判断：现在写代码，约束到底是 Fluent 2 还是 MD3。
2. **声明与实现之间有实测缺口。** 一次以官方一手令牌为基准的对标调研
   （[差距分析](../../research/material-design-3-gap-analysis-2026-09.md)）查出 **19 条差距**：
   2 阻断 / 6 高 / 8 中 / 3 低。

调研同时推翻了两个想当然的判断，值得先记下来：

- **差距不是均匀分布的。** 色彩（38 组对比度抽查 36 组达标，唯一未达 3:1 的
  `outline-variant` 在 M3 里本就是装饰性分隔线角色，WCAG 1.4.11 对纯装饰边界有豁免）、
  shape scale 数值、底部导航（80dp 高 + 64×32dp 指示器胶囊 + `secondary-container`）、
  暗色 tonal 板（由 `SchemeTonalSpot isDark=true` 生成，非明暗反相）——**这些都是合规的**。
- **缺口是系统性的，不是散点。** 真正「不贴合」的观感来自两处：
  ① MD3 type scale 只落地了 size，**丢了 line-height 与 tracking**（75 个 `.vue` 的行高
  由各组件自选 `leading-*` 决定）；② 状态层只做了 pressed，**丢了 hover / focus / dragged**
  的 alpha 层语义（官方四态：hover 0.08 / focus 0.12 / pressed 0.12 / dragged 0.16）。

一个必须记下的取数事实：**`m3.material.io` 是 JS 渲染，直接抓取拿不到正文**。
本 ADR 及后续 ADR 的 MD3 数值一律以 material-web 仓库的**生成令牌源文件**为准
（`tokens/versions/v0_192/_md-sys-{shape,motion,state,typescale}.scss`），
路径与 commit 可复核。这不是权宜之计，是**唯一能逐字核对数值的一手来源**。

（附一处已被纠正的历史误判：曾有判词称「官方 `easing-standard` 应为 `(0.4,0,0.2,1)`」，
并建议把项目的 `(0.2,0,0,1)` 改掉。官方 v0.192 令牌里 `easing-standard` **就是**
`(0.2,0,0,1)`（与 `emphasized` 同值是 MD3 的官方定义），`(0.4,0,0.2,1)` 是
`easing-legacy`（MD2 遗留）。**若不做回源核对，这个「修正」会把正确值改错。**
详见差距分析 §8 复核修正记录。）

## 决策

### 决策 1：数值基线 = material-web v0.192 生成令牌源文件

一切 MD3 数值（shape / motion / state / typescale / color roles）以
`material-components/material-web` 的 `tokens/versions/v0_192/` 下生成文件为唯一基准。
`m3.material.io` 仅作图示参考，不作数值来源——它抓不到正文，且无法逐字复核。

**取值冲突时以令牌文件为准，不以记忆或二手转述为准。**

### 决策 2：`AGENTS.md` 的 Fluent 章显式退位，补 app-lynx 的 MD3 细则

「Fluent Design 规范」章的存档声明从章首移到**章首 + 章尾双标注**，正文改为历史语气
（去掉「强制」「无例外」等现行约束口吻），并在 `AGENTS.md`「约定」段补一节
**app-lynx 的 MD3 约定**：数值来源、role 命名法、单位换算（`rounded-[var(--md-shape-*)]`
而非注册 `borderRadius`）、类型档位优先用语义名。

意图是消除「读文档的人不知道该听谁的」——**同一份文档里不能有两套现行约束**。

### 决策 3：整改范围 = 全量 19 条

不做「只修高危」的分批裁剪。理由：本次差口的**根因是系统性的**（type scale 缺两个维度、
state layer 缺三个态），只修表层症状会让下一轮从同一根因重新长出来。

执行分三批，**顺序硬约束**：

| 批次 | 内容 | 性质 |
| --- | --- | --- |
| 第一批 | 零风险单文件改动（display 档位、`borderRadius` 注册、字重、duration token 化、越界曲线、错误原型归档、AGENTS.md 补章） | 不改设计决策，可独立提交 |
| 第二批 | 排版四元组、状态层四态、focus-visible、Material Symbols | 改设计决策，需截图回归 |
| 第三批 | elevation 0/4/5、触控目标、text field | 部分依赖真机验证结果 |

### 决策 4：「有意偏离 MD3」清单（4 条，不再反复讨论）

这 4 条经拍板**不做整改**，但必须在代码或文档留痕，避免每次 review 都被当成新 bug 重提：

| 项 | 偏离 | 理由 |
| --- | --- | --- |
| 动态色 / 壁纸取色 | 不做，保留 7 套构建期静态色板 | ① 客户端有**品牌色**（logo 蓝），跟随壁纸会让品牌识别丢失；② 真做需宿主新增取色能力 + 原生模块 + 运行时换色，工程量与收益不成比例；③ Android 12+ 动态色本就是可选项，非平台强制 |
| 搜索框形态 | 保持 42px 全圆角药丸，不改 M3 filled 56dp | 药丸搜索框是移动端业界惯例，与 MD3 filled text field 的差异是**场景差异**不是规范错误；改 56dp 会让搜索页观感变钝，且与页面内 chip 体系不协调 |
| 二级 tab 高度 | 保持 48px，不加大到 56px | 48px 已达 WCAG 2.2 SC 2.5.8 AA 的 24×24 CSS px 上限要求，也满足 Android 平台 48dp 建议值；chip / tab 类控件不承担 Material 对**主要导航目标**的 48dp 期望外扩 |
| `hover` 态 | 判定为「不适用」而非「不符合」 | 纯触屏场景无 hover 语义。仅 `focus-visible` 需补（无障碍关键路径，见第二批） |

**这份清单是封闭的**：不在表内的差距，默认按「要修」处理。

### 决策 5：图标换 Material Symbols

现状是 unicode 字形（`navTabs.ts:24-27` 的 `'⌂' '✦' '✎' '◎'`、`BottomSheet.vue:121` 的 `'×'`），
既不是 MD3 图标集，也**跨设备不一致**（不同系统 emoji 字体差异明显）。
接入 Material Symbols 字体 + 统一图标组件，详见 [ADR-0208](./ADR-0208-material-symbols-icons.md)。

### 决策 6：合规判定必须三层证据，不接受「代码里写了」

这是本 ADR 最重要的一条**流程**决策。一次整改若只用静态代码审计验收，会系统性地产生假绿：
Lynx 的 CSS 是子集，**代码里有声明 ≠ 真机生效**。

三层证据，缺一不可：

| 层 | 手段 | 能证明什么 | 不能证明什么 |
| --- | --- | --- | --- |
| ① 静态审计 | 配置/令牌逐条比对官方令牌 | 数值是否取对、消费路径是否接通 | 渲染层是否真的生效 |
| ② 真机截图目视 | `pictelio_ui`（android-34）实机截图人工判读 | 观感、层次感、整体是否贴合 | 可回归性 |
| ③ e2e 机器断言 | Appium + 像素采样 | 数值类指标不回归 | 观感类问题 |

**观感类问题（整体是否贴合 MD3）由 ② 兜底，不由 ③ 假装能判。**
可断言性分级见实现阶段的 spec。

### 决策 7：每条差距的关闭必须有对应证据

差距清单不是「待办便签」。关闭任一条必须同时满足：
① 该差距描述的现象已消失；② 有机器可判定的部分已落断言；③ 不可判定的部分已截图留档。
**不满足即视为未关闭**，不得在 commit message 里宣称「已对齐 MD3」。

## 后果

- `AGENTS.md` 读者不再需要猜哪套约束现行
- 19 条差距全部有明确归属：要么被修，要么在决策 4 的封闭清单里被显式豁免
- 新增 MD3 数值时**有一个可逐字核对的来源**，不再依赖记忆
- 整改产生的视觉变更（尤其第二批排版四元组）需要**整站截图回归**——
  这是本轮最大的回归面，`packages/app-lynx` 75 个 `.vue` 的行高都会变
- 决策 4 的清单是**封闭的**：将来若要重开某条（例如真做动态色），须新开 ADR 推翻本条

## 复核判据

本 ADR 自身的可执行判据（防止它变成一纸空文）：

1. **基线唯一性**：`AGENTS.md` 中不得同时存在两套现行设计约束的表述；
   存档章的声明必须出现在章首。
2. **清单封闭性**：决策 4 的 4 条豁免，必须在代码注释或 `AGENTS.md` 中**留痕**，
   而非只存在于本 ADR——否则下一个 reader 会在 review 时重新提出。
3. **取值可核对**：任何写入 `tokens.css` 的 MD3 数值，都应能在 material-web v0.192
   令牌文件中找到同名 token 及其值。
4. **三层证据齐备**：每批整改的完成声明须附 ① ② ③ 的对应产出。

## 参考

- 差距分析（唯一事实底座，19 条逐条含证据位置）：
  [`material-design-3-gap-analysis-2026-09.md`](../../research/material-design-3-gap-analysis-2026-09.md)
- 术语文档：[`glossary-md3-alignment.md`](./glossary-md3-alignment.md)
- 排版落地：[`ADR-0206`](./ADR-0206-typography-type-scale.md)
- 形状与状态层护栏：[`ADR-0207`](./ADR-0207-shape-and-state-layer-guardrails.md)
- 图标接入：[`ADR-0208`](./ADR-0208-material-symbols-icons.md)
- 基线退位的前置：[`ADR-0203`](./ADR-0203-webview-client-source-removal.md)（WebView 客户端删除）
- 官方数值来源（material-web v0.192 生成令牌）：
  [`_md-sys-shape.scss`](https://github.com/material-components/material-web/blob/main/tokens/versions/v0_192/_md-sys-shape.scss)、
  [`_md-sys-motion.scss`](https://github.com/material-components/material-web/blob/main/tokens/versions/v0_192/_md-sys-motion.scss)、
  [`_md-sys-state.scss`](https://github.com/material-components/material-web/blob/main/tokens/versions/v0_192/_md-sys-state.scss)、
  [`_md-sys-typescale.scss`](https://github.com/material-components/material-web/blob/main/tokens/versions/v0_192/_md-sys-typescale.scss)

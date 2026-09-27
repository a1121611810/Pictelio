# app-lynx bili 主题 — 术语表

> 范围：`packages/app-lynx` 第 7 个主题色「bili」（bilibili 品牌配色）涉及的域术语。配套 ADR：[ADR-0198-app-lynx-bili-theme.md](./ADR-0198-app-lynx-bili-theme.md)、[ADR-0152]（主题色机制）、[ADR-0180]（暗色模式）。
> 输入材料：`docs/research/bilibili-theme-feasibility-app-lynx-2026-09.md`（可行性评估，推荐 L2）及三份 bilibili 调研底稿。

## 主题体系

| 术语 | 定义 | 别名（避免使用） |
|------|------|------------------|
| **主题色（accent theme）** | 用户可选的整套 M3 角色配色（当前 6 支 + 本轮新增 bili = 7 支），id 持久化为 `settings_theme_color` | 皮肤、theme（裸词） |
| **bili 主题** | 第 7 支主题色，id = `bili`、类名 = `theme-bili`，色板取 bilibili 官方 v12 令牌真实色值手工映射 | bilibili 主题、B站主题 |
| **暗色模式（dark mode）** | `light / dark / system` 三态外观开关（`settings_dark_mode`），与主题色**正交组合**（7 × 3 = 21 种组合） | 夜间模式、night mode |
| **色板（palette）** | 一支主题在给定明暗态下的全部 M3 角色值集合；亮色 48 角色（手调）/ 暗色 65 角色（脚本生成） | 主题（裸词） |
| **M3 角色（role）** | `--md-*` 语义令牌（primary / surface / outline…），组件只消费角色不消费色值 | CSS 变量（裸词）、token |
| **亮色锚点（lightPrimaryAnchor）** | 生成脚本 `THEMES[]` 字段，双职责 = 亮色 `--md-primary` 值 + 暗色 SchemeTonalSpot 的 seed 输入 | seed（单独使用） |
| **零运行时算色** | ADR-0152 硬约束：色板全部构建期静态生成，Lynx 运行期只切根 `<page>` 类名，不引入 material-color-utilities | 动态换色 |
| **漂移锁（drift lock）** | `tests/palettes-drift.test.ts` 双向断言：(a) tokens.css 自动生成段 ≡ 脚本 `--stdout`；(b) 脚本锚点 ≡ tokens.css 亮色 `--md-primary` | — |

## bilibili 色值（一手调研事实）

| 术语 | 定义 | 别名（避免混用） |
|------|------|------------------|
| **品牌粉 `--Pi5`** | bilibili 官方 v12 主题包的品牌粉原语：亮 `#FF6699` / 暗 `#D44E7D` | 经典粉 #FB7299（那是移动 H5 高频色，**不是** v12 官方包值） |
| **品牌蓝 `--Lb5`** | bilibili 官方 v12 品牌蓝原语：亮 `#00AEEC` / 暗 `#0087BD`；bilibili 站内真正的通用交互强调色 | — |
| **bili 原语** | bili-theme v12 的 191 个颜色原语（14 色相族 × 11 阶 + 36 中性），本主题映射的取值来源 | `--bili-*`（该前缀在 bilibili 产物中**不存在**，调研已证伪） |
| **bili 灰阶** | Ga/Wh/Ba 中性族：亮色 `Ga0 #F6F7F8 → Ga10 #18191C` 由浅到深，暗色整梯反向 | — |

## L2 映射决策术语

| 术语 | 定义 | 别名（避免使用） |
|------|------|------------------|
| **L2（手工映射档）** | 本主题采用档位：bilibili 真实色值逐角色手工映射到 48 个 M3 亮色角色；暗色走既有「锚点 → 脚本生成」管道不做手调 | L1（纯 TonalSpot 生成）、L3（引入 191 原语体系，已否决） |
| **主粉（primary 粉）** | bili 主题 `--md-primary` = `#D03171`（Pi7）——bilibili 粉阶梯中与白字对比 ≥ 4.5:1 的最深品牌档 | 品牌粉 #FF6699（对比仅 2.8:1，不能当 primary） |
| **交互蓝（tertiary 蓝）** | bili 主题 `--md-tertiary` = `#00699D`（Lb7 = bilibili `--text_link`）——在 tertiary 角色保留品牌蓝 DNA | — |
| **蓝灰次级（secondary 蓝灰）** | bili 主题 `--md-secondary` = `#4D5D7C`（Si8）——bilibili 蓝灰族的 muted 次级色 | — |

## 关系

- 一支**主题色** × 三态**暗色模式** = 一份完整**色板**组合（根 `<page>` 同时挂 `.theme-X` 与 `.dark`）。
- **亮色锚点**派生暗色**色板**；**漂移锁**保证锚点清单、脚本输出、tokens.css 三者一致。
- **bili 主题**的亮色**色板**核心角色取自 **bili 原语**（主粉/交互蓝/蓝灰次级/bili 灰阶）；state 系角色按既有主题同源公式派生。
- bili 主题仅存在于 app-lynx；webview（Fluent 2）**没有** accent 主题概念（R1 边界，双端不对称既有事实，本轮不扩大也不收敛）。

## Flagged ambiguities

- **「品牌粉」三种色值**：`#FB7299`（移动 H5 高频/大众认知）、`#FF6699`（v12 官方 `--Pi5`）、`#D03171`（本主题 primary = Pi7）。文档与代码注释必须写明具体 hex + 原语名，禁止裸写「品牌粉」。
- **「seed」一词两义**（历史遗留）：脚本文件头已钉死口径——清单字段叫 `lightPrimaryAnchor`（= 亮色 primary 产物值），它**作为** M3 seed 输入；不要 revival「seed 是生成输入、与产物不等」的旧口径。
- **「主题」歧义**：在 app-lynx 语境下，「主题色」（accent，7 选 1）与「暗色模式」（3 选 1）是两个正交设置；文档中单独的「主题」一律指**主题色**。
- **「bili」与「bilibili」**：id/类名/文件名用短形 `bili`；面向用户的文案（色块标签、a11y）用「哔哩粉」。

## Example dialogue

> **Dev:** bili 主题的 **primary** 为什么不是 `#FF6699`？那才是 **品牌粉 `--Pi5`**。
> **Domain:** `#FF6699` 上放白字对比只有 2.8:1，进不了 M3 primary；我们取粉阶梯里过 4.5:1 的 **主粉** `#D03171`（Pi7），品牌感交给 primary-container（`#FFECF1` = `brand_pink_thin`）和 inverse-primary（`#FF6699` 本体）保住。
> **Dev:** 那暗色下能看到 bilibili 暗粉 `#D44E7D` 吗？
> **Domain:** 看不到——暗色**色板**走 **漂移锁** 管道从 **亮色锚点** `#D03171` 生成 M3 暗粉，不手调 bili 暗值；这是 L2 有意裁剪，保住与既有 6 支暗色观感同构。
> **Dev:** webview 端用户能选到 bili 吗？
> **Domain:** 不能。bili 是 app-lynx 的**主题色**；webview 没有这个概念，这是既有结构不对称，不在本 effort 范围。

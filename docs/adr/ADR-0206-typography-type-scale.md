# ADR-0206：排版系统落地 —— MD3 type scale 的四元组进 Tailwind 档位

## 状态

accepted（2026-09-30）

## 背景

[ADR-0205](./ADR-0205-md3-baseline-and-scope.md) 立项的 2 条**阻断**差距之一。

MD3 的 type scale 不是「一张字号表」，而是 15 档 × **四元组**：
`size` / `line-height` / `tracking` / `weight`，每档四值同进同退。官方 v0.192
[`_md-sys-typescale.scss`](https://github.com/material-components/material-web/blob/main/tokens/versions/v0_192/_md-sys-typescale.scss)
里 15 档各自都有 `*-size` / `*-line-height` / `*-tracking` / `*-weight` 四个独立 token，
外加一个复合 `font` 简写（且官方在 token 注释里**明确警告**复合简写无法表达 tracking，
建议用离散属性）。

项目现状（`packages/app-lynx/tailwind.config.ts:44-74`）：

- 已映射 **12 档 size**（缺 `display-small/medium/large`），**数值逐档核对全对**
- **`lineHeight` 与 `letterSpacing` 一个都没有**——`fontSize` 档位是纯字符串
  （`'label-small': '22rpx'`），Tailwind 只会输出 `font-size`，不带行高
- 于是行高落到各组件**自选**：`leading-[1.4]`（`CommentItem.vue:83`）、
  `leading-snug`（`WatchlistPromptDialog.vue:84`）、`leading-none`（`GlobalFab.vue:225`）、
  `leading-[44rpx]`（`SkeletonNovel.vue:15`）。全仓自选行高共 **27 处**
  （`leading-snug`×16、`leading-[44rpx]`×3、`leading-[1.5]`×2、`leading-[1.3]`×2、
  `leading-[1.6]`/`leading-[1.4]`/`leading-[3vw]`/`leading-relaxed]` 各 1），
  另有 `leading-none` 45 处（图标/徽标收紧排版，**属刻意用法，不在整改面内**）；
  `tracking-*` 命中 0

后果是**同一个 `text-body-medium` 在不同页面行高不同**，MD3 最重要的排版层次感
（靠 size + line-height + tracking 三者协同建立的节奏）整个塌掉，只剩字号一条腿。
这正是「看起来不贴合 MD3」的主要来源。

另有一处**容易被误判为已满足**的事实：项目全仓**没有 `font-family` 声明**。
MD3 指定 Roboto，且 display/headline/title 使用 Roboto 的 brand 变体。
但本项目**只构建 Android**，而 Android 的系统字体就是 Roboto ——
所以「MD3 字体」这条**默认满足**，brand 变体（更紧的字形）则拿不到。
这不是缺陷，是平台巧合；记录在此以免将来有人误以为需要内置字体。

## 决策

### 决策 1：`fontSize` 档位改用 Tailwind 数组形式，补全 15 档

`tailwind.config.ts` 的 `fontSize` 改为 `['<size>', { lineHeight, letterSpacing }]` 形式
（Tailwind 3 原生支持），按官方 v0.192 逐档填值。单位换算沿用项目既有约定
**375 设计稿：1sp = 2rpx**（见 [`glossary-lynx-units.md`](./glossary-lynx-units.md)）。

官方值（sp / sp / sp）→ 项目值（rpx）：

| 档位 | size | line-height | tracking | weight | 语义归类 |
| --- | --- | --- | --- | --- | --- |
| `display-large` | 57 / 114 | 64 / 128 | -0.25 / -0.5 | regular | display |
| `display-medium` | 45 / 90 | 52 / 104 | 0 / 0 | regular | display |
| `display-small` | 36 / 72 | 44 / 88 | 0 / 0 | regular | display |
| `headline-large` | 32 / 64 | 40 / 80 | 0 / 0 | regular | headline |
| `headline-medium` | 28 / 56 | 36 / 72 | 0 / 0 | regular | headline |
| `headline-small` | 24 / 48 | 32 / 64 | 0 / 0 | regular | headline |
| `title-large` | 22 / 44 | 28 / 56 | 0 / 0 | regular | title |
| `title-medium` | 16 / 32 | 24 / 48 | 0.15 / 0.3 | **medium** | title |
| `title-small` | 14 / 28 | 20 / 40 | 0.1 / 0.2 | **medium** | title |
| `body-large` | 16 / 32 | 24 / 48 | 0.5 / 1 | regular | body |
| `body-medium` | 14 / 28 | 20 / 40 | 0.25 / 0.5 | regular | body |
| `body-small` | 12 / 24 | 16 / 32 | 0.4 / 0.8 | regular | body |
| `label-large` | 14 / 28 | 20 / 40 | 0.1 / 0.2 | **medium** | label |
| `label-medium` | 12 / 24 | 16 / 32 | 0.5 / 1 | **medium** | label |
| `label-small` | 11 / 22 | 16 / 32 | 0.5 / 1 | **medium** | label |

**档位名不变**（`text-body-large` 等 class 名照旧），故存量 75 个 `.vue` 的
字号类**不需要改**——这是本决策能低风险落地的关键。

### 决策 2：weight 不进 `fontSize`，走 `fontWeight` 档位

官方 15 档里 label-\* 与 title-small/medium 是 **medium(500)**，其余是 **regular(400)**。
项目当前 `font-medium`(=500) / `font-bold`(=700) 混用（`font-bold` 出现的档位
不符合任何 MD3 档位）。

新建 `fontWeight: { regular: '400', medium: '500' }`，并把需要 medium 的档位在
**文档与 lint 约束**上标明（Tailwind 无法从 `fontSize` 派生 `font-weight`，
数组形式的第三个元素不合法）。同时清理 `font-bold` 在正文/label 档位上的误用。

### 决策 3：逐组件删除自选 `leading-*`，行高一律由档位携带

27 处自选行高（不含 `leading-none` 的 45 处刻意收紧排版）逐处判定：多数直接删
（让档位的 line-height 接管）；少数刻意需要紧排的（图标内文字、骨架屏对齐）**保留并加注释说明理由**。

判据：**正文类内容（body-\*/label-\*）不得有自选行高**；
装饰性场景（图标、徽标、绝对定位的小字）例外。

### 决策 4：旧别名档位同步四元组，并标注为存量兼容层

`xs/sm/base/lg/xl/2xl/3xl/4xl/5xl/6xl` 这 10 个旧档位保留（存量代码在用），
但**值已塌陷**：`base`/`lg`/`xl` 全 = 28rpx，`5xl`/`6xl` 全 = 56rpx ——
10 个类名实际只有 7 个不同值，层级感丢失。

处理：每个旧别名按**最接近的 M3 档位**取完整四元组（而不是只对齐 size），
并在 `tailwind.config.ts` 注释中逐条标注它映射到哪个 M3 档位。
**同时把「旧别名在语义档位补齐后应逐步下线的」写进注释**——
留痕比现在删更安全，因为存量引用面未统计（`ADR-0205` 决策 7 口径）。

### 决策 5：tracking 值即使视觉上接近不可见，也照官方填

M3 的 tracking 区间是 0–0.5sp（项目 0–1rpx），在 1x 屏上**亚像素、几乎不可见**。
但仍照官方填，理由有二：

1. 数值正确性可核对——不填就成了「与官方不一致」，与 ADR-0205 决策 7 的关闭条件冲突
2. rpx 随屏宽线性缩放，宽屏上会被放大到可见量级

**不因此新增任何为了「让 tracking 生效」而做的额外适配。**

## 后果

- **全站 75 个 `.vue` 的行高都会变**——这是本轮最大的回归面。
  容器高度、`flex` 布局、居中态都可能位移，必须整站截图回归（ADR-0205 决策 6 的第 ② 层）
- 类名不变 ⇒ 存量代码零改动即可获得正确行高，迁移不需要逐文件改
- `text-display-*` 三档从「无」变「有」，可被新代码使用
- `font-bold` 若被批量清理，部分标题观感会从 700 降到 500/400——
  这是**向 MD3 靠拢**，但属可见变化，需在截图回归中重点看
- 排版从「每组件自选」变成「全局单一事实源」，后续新增页面不再可能写出不一致的行高

## 复核判据

1. **四元组齐备**：`tailwind.config.ts` 的 15 个语义档位，每个都必须同时有
   `size` + `lineHeight` + `letterSpacing`；缺任一即判红。
2. **数值可回源**：每个值能在 material-web v0.192 `_md-sys-typescale.scss` 找到同名 token。
   换算关系固定为 `rpx = sp × 2`。
3. **无自选行高残留**：`packages/app-lynx/src/**/*.vue` 中，
   `body-*` / `label-*` 字号类与自选 `leading-*` **不得同现**于正文内容。
   装饰性场景的白名单必须逐条带注释理由。
4. **回归防线**：type scale 的 size 与 line-height 应有单测钉住取值表
   （防止后续有人「顺手调一下」），oracle 为官方令牌值。

## 参考

- 决策来源：[`ADR-0205`](./ADR-0205-md3-baseline-and-scope.md) 决策 3（第二批）
- 差距条目：[差距分析 §2 #1 / §3.2](../../research/material-design-3-gap-analysis-2026-09.md)
- 术语文档：[`glossary-md3-alignment.md`](./glossary-md3-alignment.md)
- 单位换算（权威）：[`glossary-lynx-units.md`](./glossary-lynx-units.md)
- 官方数值来源：
  [`_md-sys-typescale.scss`](https://github.com/material-components/material-web/blob/main/tokens/versions/v0_192/_md-sys-typescale.scss)

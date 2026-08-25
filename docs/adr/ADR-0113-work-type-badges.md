# ADR-0113: 作品类型标识（动图/多图）跨端统一 —— App 图标化角标 + Lynx 流内徽章行

- 状态：accepted
- 日期：2026-08-25
- 关联：`packages/app/CONTEXT.md`（作品标识：动图/多图/类型角标）、`packages/app-lynx/CONTEXT.md`（作品标识：类型徽章行；受限内容：遮罩词条的 list-item absolute 平台事实）、`docs/specs/work-type-badges.md`
- 来源：grill-with-docs 会话（Q1 范围 / Q2 App 形态 / Q3 Lynx 位置 / Q4 M3 形态调研 / Q5 判定语义 / Q6 抽象与测试，全部由用户拍板）

## 背景

列表卡片曾有的「动图」「多图」标识在历次改版后口径碎裂：App 侧三种卡片各自为政（IllustSingleCard 有动图无多图、ImageCard 两者皆有但为文字 fluent-badge、GridCard 有多图无动图），app-lynx 全部瀑布流列表两种标识均无。用户在任意列表无法一眼识别动图与多图作品。需求：**两端所有插画列表卡片统一补齐两种类型标识，样式重做以适配当前设计语言**（App = Fluent 2，Lynx = M3）。

**平台/现状事实：**

1. 判定字段两端齐备：Pixiv API 的 `illust.type`（`illust | manga | ugoira`）与 `illust.page_count`，无需动 API 层。
2. Lynx 真机实测：list-item 内 absolute 定位子元素会被高度测量算进内容高度，导致整卡布局崩坏（2026-08-11 实测，已记录于 app-lynx CONTEXT「遮罩」词条）——图上覆盖式角标在 Lynx 列表不可用。
3. M3 组件体系无「媒体类型标识」成品（Badge 仅用于通知计数）；M3 生态成熟做法分两类——图上场景为 scrim 底小角标（YouTube 时长徽章 / Google Photos 播放图标），流内场景为 assist-chip 形态（leading icon + label）。
4. app-lynx 无图标库，既有约定为 unicode 文本符号（NavigationBar：⌂ ✦ ✎ ◎）。
5. ugoira 的 `page_count` 事实上恒为 1（动图为 zip 帧序列而非多页），但 API 契约不保证互斥。

## 决策

1. **范围 = 全部插画列表卡片**：App 的 IllustSingleCard / ImageCard / GridCard；app-lynx 的 Recommended / IllustList / Bookmarks（插画 tab）/ Following / UserHome 瀑布流。小说条目无此概念，不加。
2. **判定语义 = 独立判定、允许并存、动图在前**：`type === 'ugoira'` → 动图标；`page_count > 1` → 多图标。不做互斥假设（事实 5 仅是观察而非契约），异常数据同时满足时两个标识并排显示，动图在前。判定为纯函数、零特例。
3. **App 形态 = 封面右上角图标化角标**：与左上分级标（R-18/R-18G/AI）相对。动图 = play 图标 +「动图」文字；多图 = imageMultiple 图标 + 页数数字（对齐 Pixiv 官方惯例）。样式为磨砂半透明底（overlay token + backdrop-blur）圆角 chip，弃用 fluent-badge 品牌蓝 filled 文字标——避免与分级标撞色、图上可读性更强。图标经 FluentIcon 新增 `play` / `imageMultiple` 两条 SVG path（源自 fluentui-system-icons）。
4. **Lynx 形态 = 流内徽章行**：图片下方、标题上方，仅在有标识时渲染（普通单图零占位）。M3 assist-chip 形态：`▶ 动图` / `⧉ N 图`（unicode 图标沿用 NavigationBar 约定）+ `bg-secondary-container` + `text-label-medium` + `md-shape-small` 圆角。受限条目（图片区被受限卡替换）徽章行照常显示——类型信息非敏感内容。
5. **两端各收敛一个公共组件**：App `IllustTypeBadge`（含 normal/compact 尺寸，GridCard 用 compact）；app-lynx `IllustTypeBadgeRow`。删除三卡片与五页面各自为政的旧写法，防口径再次漂移。
6. **验收 = 公共组件单测（条件矩阵：普通单图=无标 / ugoira=动图 / page_count=N / 并存顺序与文案）**，期望值出处 = 本 ADR/spec 文案字面量 + Pixiv API 字段语义（oracle 溯源）。不强制补 ImageCard/GridCard 历史测试债；IllustSingleCard 现有测试因旧标替换失败时同步更新。

## 被考虑的方案

- **B（App）保留 fluent-badge 文字标，只补缺失**：用户明确要求样式重做；文字标与左上分级标撞色、图上可读性差。否决。
- **C（Lynx）图上 absolute 角标对齐 App**：违反平台事实 2（真机高度测量崩坏），需真机验证兜底仍属高风险。否决。
- **B（Lynx）徽章行放标题下方/与作者行合并**：压缩标题与作者的既有信息层级，瀑布流两列宽度下更易截断。否决。
- **纯文字 chip（Lynx 不带 unicode 图标）**：M3 assist-chip 的 leading icon 提升扫视效率，unicode 约定已有先例，成本为零。否决。
- **判定互斥（ugoira 优先，不再判多图）**：把事实观察当契约，引入特例分支；独立判定更简单且对异常数据更诚实。否决。

## 后果

- 正面：两端全列表类型标识口径统一；判定纯函数可测；App 角标与 Fluent 2 令牌体系、Lynx 徽章与 M3 令牌体系各自合规；公共组件收敛后新增列表页面自动获得正确标识。
- 负面：行为变化点——ImageCard 的「Np」、GridCard 的「📄 N」文字格式被图标 + 数字替换（需在 commit message 标注）；FluentIcon 图标集 +2；Lynx 瀑布流卡片在有标识时增高一行。
- 术语已同步沉淀至两端 CONTEXT.md「作品标识」节。

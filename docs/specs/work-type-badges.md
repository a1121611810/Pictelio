# Spec: 作品类型标识（动图/多图）跨端统一

- 关联 ADR：ADR-0113
- 术语：`packages/app/CONTEXT.md` 与 `packages/app-lynx/CONTEXT.md` 的「作品标识」节（动图 / 多图 / 类型角标 / 类型徽章行）
- 来源：grill-with-docs 会话（2026-08-25，Q1–Q6 用户拍板）

## Problem Statement

用户在浏览任何插画列表（首页单列、瀑布流、网格；App 与 Lynx 双端）时，无法可靠识别一个作品是动图（ugoira）还是多图（多页）作品。历史上列表曾具备这两类标识，但改版后口径碎裂：App 侧三种列表卡片中，首页单列卡只有「动图」没有「多图」，网格卡只有「多图」没有「动图」，瀑布流卡虽两者皆有但仍是旧文字样式；Lynx 侧所有插画列表两种标识完全缺失。

## Solution

在双端所有插画列表卡片上统一提供「动图」「多图」两类类型标识，并按各端设计语言重做样式：

- **App（Fluent 2）**：封面右上角的图标化磨砂角标——动图 = 播放图标 +「动图」，多图 = 叠页图标 + 页数；与左上角既有的 R-18/AI 分级标互不干扰。
- **Lynx（M3）**：图片下方、标题上方的流内徽章行——「▶ 动图」「⧉ N 图」小 chip；普通单图作品不渲染该行、不占用任何空间。

无论用户在哪个端的哪个列表，看到的作品类型标识语义与文案完全一致。

## User Stories

1. 作为浏览用户，我想在首页单列大图上看到「多图」标识和页数，以便在进入详情前知道该作品有多张图。
2. 作为浏览用户，我想在瀑布流卡片上看到图标化的「动图」标识，以便区分动图与静态插画。
3. 作为浏览用户，我想在网格（3 列）卡片上同时看到「动图」「多图」标识，以便在高密度浏览时不漏判作品类型。
4. 作为 Lynx 端用户，我想在推荐/插画/收藏/关注/用户主页的插画列表里看到与 App 端语义一致的「动图」「N 图」标识，以便双端体验一致。
5. 作为浏览用户，当作品是普通单图静态插画时，我不想看到任何类型标识，以便界面保持干净。
6. 作为浏览用户，我希望「多图」标识直接显示页数，以便评估浏览成本。
7. 作为 Lynx 端用户，当作品因内容分级被受限卡替换封面时，我仍想看到其类型标识，以便了解作品形式（类型信息非敏感内容）。
8. 作为维护者，我希望两端各自的类型标识由唯一公共组件渲染，以便后续新增列表页面时不会再次口径漂移。
9. 作为维护者，我希望类型判定是纯函数并有条件矩阵单测，以便字段语义变化时测试能精确失败。

## Implementation Decisions

1. **判定语义（双端一致，纯函数）**：`type === 'ugoira'` → 动图标；`page_count > 1` → 多图标（携带页数）。两条件独立判定、允许并存；并存时输出顺序为动图在前。字段缺失/异常（page_count 为 0/缺省）自然判定为不显示，不做特例分支。
2. **接缝 = 每端一个纯函数模块**：`resolveIllustTypeBadges(illust)` 返回有序标识列表（`ugoira` / `multi + pageCount`），UI 组件只做渲染。双端各自实现、语义互镜像（可参考既有 differential 测试模式做跨端差分）。
3. **App 公共组件 `IllustTypeBadge`**：消费判定函数输出，渲染封面右上角角标组。样式 = overlay token 磨砂半透明底 + backdrop-blur + 圆角 chip + 白字。提供 normal / compact 两档尺寸，网格卡用 compact。图标经 FluentIcon 新增 `play`、`imageMultiple` 两条 SVG path（path 数据源自 fluentui-system-icons 24px）。
4. **App 三卡片接入**：IllustSingleCard（移除旧「动图」fluent-badge）、ImageCard（移除旧「动图」与「Np」badge）、GridCard（移除旧「📄 N」badge），统一替换为公共组件。行为变化点：「Np」「📄 N」文字格式被图标 + 纯数字替换。
5. **Lynx 公共组件 `IllustTypeBadgeRow`**：流内徽章行，图片下方、标题上方，`v-if` 控制仅在有标识时渲染。M3 assist-chip 形态：unicode 图标（`▶` / `⧉`，沿用 NavigationBar 既有约定）+ 文字（「动图」/「N 图」），secondary-container 底、label-medium 字号、md-shape-small 圆角。严禁 absolute 定位（真机 list-item 高度测量约束）。
6. **Lynx 五页面接入**：Recommended、IllustList、Bookmarks（插画 tab）、Following、UserHome 的插画瀑布流卡。受限条目（封面被受限卡替换）徽章行照常渲染。
7. **小说条目一律不加类型标识**（小说无动图/多图概念）。

## Testing Decisions

**好测试的标准**：只断言外部可观察行为（给定 illust 数据 → 输出哪些标识、什么文案、什么顺序），不断言内部实现（DOM 结构细节、CSS 类名）。期望值必须可溯源——出处为本 spec/ADR-0113 的文案字面量与判定条件、Pixiv API 字段语义，禁止从被测实现反推。

- **App 判定纯函数单测**（就近测试）：条件矩阵——普通单图（type=illust, page_count=1）→ 空；ugoira → [动图]；page_count=3 → [多图(3)]；并存（type=ugoira, page_count=5 异常数据）→ [动图, 多图(5)]，动图在前；page_count=0/缺失 → 无多图标。
- **App `IllustTypeBadge` 组件渲染测试**：先例 = `tests/unit/components/IllustSingleCard.test.tsx`、`NovelRowCard.test.tsx`。断言各条件下渲染的文案（「动图」「3」）与不渲染。
- **Lynx 判定纯函数单测**：先例 = `skeletonStyle.test.ts`（逻辑抽纯模块就近测）。矩阵同上。
- **可选：跨端差分测试**——先例 = `packages/app-lynx/tests/differential/`；对同一组输入断言两端判定输出语义等价。
- **既有测试维护**：IllustSingleCard 现有测试若因旧 badge 移除而失败，同步更新；不强制补 ImageCard/GridCard 历史测试债。

## Out of Scope

- 详情页的类型标识（详情页已有动图播放器与多页浏览，不在本次范围）。
- 小说卡片的任何标识改动。
- ImageCard/GridCard 的全量组件测试补齐（历史测试债，另立工作项）。
- R-18/AI 分级标的样式或位置调整。
- 图标资源的懒加载/性能优化（角标为纯 CSS + 内联 SVG/unicode，无网络开销）。

## Further Notes

- Lynx 侧徽章行会使含标识卡片的流内高度增加一行——瀑布流等高约束不受影响（高度由内容自然撑开，非受限卡的固定图区）。
- 「动图」与「多图」术语已入两端 CONTEXT.md「作品标识」节；后续讨论统一使用「类型角标」（App）/「类型徽章行」（Lynx）指称 UI 形态。

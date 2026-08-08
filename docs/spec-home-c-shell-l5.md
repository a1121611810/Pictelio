# Spec: 首页 C 框架 + L5 固定布局（Home C Shell & Fixed Layout L5）

## Problem Statement

首页（/home）存在两处问题：
1. **视觉碎片化**：插画瀑布流、小说卡、历史条目分属不同卡片体系（部分仍为旧 surface-card 边框卡），与已统一的 A2 视觉语言割裂。
2. **布局可配置但非最优**：插画/小说布局由设置页「布局设置」（layoutMode：瀑布流/单列/网格）控制，用户需自选；而经两轮 UI 原型验证，**固定布局**（C 框架 + 插画单列大图 + 小说单列行卡）才是与当前设计最契合的方案。

## Solution

首页改为 **C 框架**（Win11 设置式侧边导航列）+ **L5 固定布局**（插画单列大图、小说单列行卡、历史 A2 行卡），并**移除设置页布局模式设置**。用户打开首页即获得统一、无需配置的最优浏览体验。

## User Stories

1. 作为用户，我希望首页左侧有常驻导航列（推荐/关注/收藏/历史），以便单手快速切换内容域。
2. 作为用户，我希望导航列选中项有清晰的品牌色高亮块，以便知道当前所在内容域。
3. 作为用户，我希望导航列底部有设置与我的入口，以便无需返回顶栏即可进入个人页/设置页。
4. 作为用户，我希望推荐/关注/收藏 Tab 顶部显示页面大标题与当前用户名副标题，以便明确上下文。
5. 作为用户，我希望在插画/小说之间一键切换（contentType 切换器），以便浏览不同类型内容。
6. 作为用户，我希望插画以单列 16:10 大图展示（标题/作者/收藏在卡内），以便沉浸式看图。
7. 作为用户，我希望小说以单列行卡展示（封面缩略 + 标题/作者/统计），以便快速扫描小说信息。
8. 作为用户，我希望列表滚动到底自动加载更多，以便无需手动翻页。
9. 作为用户，我希望历史 Tab 以 A2 行卡展示并可一键清空，以便管理浏览记录。
10. 作为用户，我希望设置页不再有布局模式设置，以便首页布局固定、无需配置。
11. 作为用户，我希望其他页面（用户作品页等）的列表行为不变，以便不受本次改动影响。

## Implementation Decisions

- **C 框架（SideNavShell）**：左侧 56px icon 导航列（搜索 + 4 Tab + 底部设置/我的），选中项 `BrandBackground2` 圆角高亮 + 品牌色图标；右侧内容区（sticky 页面大标题 + contentType 切换器 + 内容域）。首页停用底部 NavBar。
- **插画固定布局**：单列 16:10 大图卡（`IllustSingleCard`，A2：8px 圆角 + 1px 边框 + 无阴影），卡内标题/作者 + ★收藏。
- **小说固定布局**：单列行卡（`NovelRowCard`，56px 封面 + 标题/作者/★统计），系列徽标。
- **历史固定布局**：A2 行卡（40px 缩略 + 标题/时间/次数）+ 清空入口。
- **滚动分页**：列表底部 1px 哨兵 + IntersectionObserver（rootMargin 300px）→ 有 `nextUrl` 时调 `fetchMore`。接入推荐/关注/收藏的插画与小说 6 个 store。
- **layoutMode 移除（UI 层）**：设置页布局设置项与 `LayoutSettings` 路由移除；`settingsStore.layoutMode` 字段保留（默认 waterfall），`VirtualFeed` 等组件 prop 保留——其他页面行为零变化。
- **原型提升为正式组件**：`components/home/` 下正式组件（SideNavShell/IllustSingleCard/NovelRowCard/HistoryRowCard），代码按正式标准重写（非原型约束）。

## Testing Decisions

- 契约测试：layoutMode 设置移除后，`settingsStore` 布局相关测试更新；首页 contentType 持久化行为不变。
- 组件测试：NovelRowCard/IllustSingleCard 渲染结构（标题/作者/统计/封面）断言。
- 分页哨兵：IntersectionObserver 触发 `fetchMore`（mock observer）的契约测试。
- 既有先例：`tests/unit/components/`（FluentDialog/StickySubTabs 等组件测试）、`tests/unit/stores/`（settingsStore 测试）。

## Out of Scope

- 其他页面的 VirtualFeed/layoutMode 行为改动（保持 waterfall 默认）。
- NavBar 在其他页面的保留与样式调整。
- 搜索结果页、用户作品页的小说/插画卡形态（保持现状，后续页面轮次处理）。

## Further Notes

- 原型集归档：/home 两轮原型（风格 A/B/C/D、布局 L1-L5）折入后移入 throwaway 分支 `prototype/home-ui-cards`（延续既有归档惯例）。
- 相关文档：ADR-0075、glossary-ui-cards.md。

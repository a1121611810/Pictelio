# ADR-0075: 首页 C 框架 + L5 固定布局（Home C Shell & Fixed Layout L5）

- 状态：accepted
- 日期：2026-08-08
- 关联：ADR-0069/0074（A2 视觉语言）、ADR-0073（首页内容域 A2 统一）、ADR-0044（glass NavBar）、glossary-ui-cards.md

## 背景

首页（/home）历经两轮 UI 原型：

1. **整体风格变体**（A 底部 Tab 精修 / B 顶部横向 Tab / C 侧边导航列 / D 抽屉导航）——用户选定 **C（侧边导航列，Win11 设置式）**。
2. **内容布局变体**（L1 双列瀑布流 / L2 双列网格 / L3 单列大图 / L4 紧凑行）——用户选定组合 **L5：插画单列大图 + 小说单列行卡**。

同时用户确认：**设置页的布局模式设置（layoutMode：瀑布流/单列/网格）全部移除**，插画/小说各用与当前设计最契合的固定布局。

## 决策

1. **首页改 C 框架（SideNavShell）**：左侧固定 icon 导航列（搜索 + 推荐/关注/收藏/历史 + 底部设置/我的）+ 右侧内容区（页面大标题 + contentType 切换器）。导航列与页面同背景，选中项 `BrandBackground2` 圆角高亮块 + 品牌色图标（Win11 设置式）。底部 NavBar（glass，ADR-0044）在首页停用。
2. **插画固定单列大图**：16:10 全宽图片卡 + 卡内标题/作者 + ★收藏。
3. **小说固定单列行卡**：56px 封面缩略 + 标题/作者/★统计。
4. **滚动分页**：列表底部 IntersectionObserver 哨兵，触发 `nextUrl`/`fetchMore` 自动加载更多。
5. **移除设置页布局模式设置**：`LayoutSettings` 路由与设置入口、settingsStore 的布局设置 UI 移除；`VirtualFeed` 等组件**保留 layoutMode prop**（默认 waterfall，其他页面行为不变）——UI 层移除，组件层向后兼容，blast radius 可控。
6. 历史 Tab：A2 行卡 + 清空入口；contentType 切换保留（插画/小说）。

## 被考虑的方案

- 风格：C（侧边导航列，选定）vs A 底部 Tab / B 顶部横向 Tab / D 抽屉导航。
- 布局：L5 组合（选定）vs L1 双列瀑布流 / L2 双列网格 / L3 单列大图 / L4 紧凑行——L5 兼顾图片沉浸（插画）与信息密度（小说）。
- layoutMode：彻底移除字段（破坏 VirtualFeed 等 10+ 调用点）vs UI 层移除（选定）——后者行为零破坏。

## 后果

- 正面：首页结构稳定为 Win11 风格；插画/小说布局固定后无需用户配置；分页滚动体验完整。
- 负面：`LayoutSettings` 路由移除（路由表与相关引用需清理）；设置页"布局"设置项消失（用户不再可自选布局）。
- 保留：其他页面（用户作品页等）仍用 VirtualFeed + layoutMode 默认瀑布流；NavBar 在其他页面保留。

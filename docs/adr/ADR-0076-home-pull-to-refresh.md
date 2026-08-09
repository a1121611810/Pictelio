# ADR-0076: 首页下拉刷新（Home Pull-to-Refresh）

- 状态：accepted
- 日期：2026-08-08
- 关联：ADR-0075（首页 C 框架 + L5）、ADR-0073（首页内容域 A2 统一）、glossary-ui-cards.md

## 背景

首页折入 C 框架 + L5（ADR-0075）时，自建 Feed 面板（`IllustFeedPanel`/`NovelFeedPanel`，单列大图/行卡列表 + 滚动分页哨兵）**替代了内置下拉刷新的旧渲染路径**（插画 `VirtualFeed`、小说 `NovelVirtualFeed` 均内置 `PullIndicator` + `createFeedVirtualizer` 手势）。新面板零处 Pull/refresh 引用（grep 实证），导致**推荐/关注/收藏 3 Tab × 插画/小说 共 6 个面板下拉刷新全部失效**；历史 Tab 本地数据本无下拉。

## 决策

1. **刷新语义 A（清空重载）**：松手后出现可见刷新过程——列表清空 → 骨架 → 新数据替换。
2. **清空方式 A1（UI 遮罩）**：刷新（`refreshing`）期间 FeedPanel 渲染骨架列表**替换**旧列表（store 数据不清空）；`store.refresh()` 保持 TanStack refetch 语义（stale-while-revalidate，静默替换）。store 层零改动。
3. **范围**：6 个面板全加（插画 + 小说）；历史 Tab 不加。
4. **手势**：新增 JS 原语 `createPullToRefresh`（`src/primitives/createPullToRefresh.ts`）——touch 事件自实现，状态机 `idle → pulling → ready → refreshing`；阻尼下拉；沿用旧版阈值 `refreshThreshold = 60`；仅 `scrollTop === 0` 时启动。复用现有 `PullIndicator` 组件（`zone`/`distance`/`refreshThreshold` props）。
5. **刷新动作**：`onRefresh = () => void src().refresh()`（6 store 均有 `refresh`，返回 `Promise.all(activeQueries.refetch())`；`refreshing` 由 refetch 状态派生，FeedPanel 据此切换骨架遮罩）。

## 被考虑的方案

- **A2（store 清空重载）**：给 6 store 的 refresh 增加清空语义——改动全局共享工厂 `createTQFeedStore`，影响其他消费方（收藏页/关注页等），否决（A 的清空是视觉需求，锁在 UI 层即可）。
- **原生 SwipeRefreshLayout**（Capacitor 插件）：Android 专属，破坏 Web/Native 双模式共享代码（ADR-0037 后原生仅网络层），否决。
- **overscroll-behavior / 浏览器原生 pull-to-refresh**：Chrome 对 Web 页面无通用 pull-to-refresh DOM API（浏览器/系统手势），否决。

## 后果

- 正面：6 面板统一可下拉，行为对齐旧版；`createPullToRefresh` 为深模块（小接口 + 手势状态机实现），可单测、可复用于其他列表页。
- 负面：touch 手势需与滚动/分页共存（仅顶部启动、刷新中忽略重复下拉）；骨架遮罩期间旧列表不渲染（store 数据保留，恢复即现）。

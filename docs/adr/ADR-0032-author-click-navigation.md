# ADR 0032: 全量覆盖第三方用户名点击跳转个人中心

## 状态

已实施

## 分类

功能

## 日期

2026-07-17

## 背景

应用中有多个位置展示了第三方用户的用户名（作者名、评论者名、浏览历史中的用户等），但许多位置只是纯文本渲染，点击后无反应。用户期望点击任何第三方用户名都能进入其个人中心（`/user/${userId}`）。

需要覆盖的"缺失"位置：

1. **ImageCard**（Feed 瀑布流/单列模式）—— `@user.name` 纯文本
2. **GridCard**（Feed 网格模式）—— `@user.name` 纯文本
3. **NovelCard**（小说列表模式）—— `@user.name` 纯文本
4. **NovelCoverCard**（小说封面墙模式）—— `@user.name` 纯文本
5. **HistoryPage**（浏览历史）—— `userName` 纯文本，且未存储作者 ID

已经可点击的位置（无需改动）：

- CommentList + CommentOverlay —— 已有 `onClickUser` → `goToUser()`
- NovelTextListCard —— 已有 `onAuthorClick` prop
- NovelDetail —— 已有 `onAuthorClick` 处理
- NovelFeedPage / NovelBookmarks —— 已传递 `onAuthorClick`
- FollowListPage —— 整行可点击
- IllustDetail —— pixiv:// 链接处理

## 决策

### D1: 统一采用 `onAuthorClick` prop 命名

所有卡片组件使用 `onAuthorClick?: (userId: number) => void` 命名 prop，与已存在的 `NovelTextListCard` 保持一致。父组件（路由页面）负责提供导航实现，保持关注点分离。

### D2: 从卡片到路由的完整 prop 透传链

```
Route Page (navigate) → VirtualFeed/UserWorksFeed (prop pass-through)
  → LazyImageCard/ImageCard/GridCard (prop pass-through)
  → button onClick → e.stopPropagation() → props.onAuthorClick?.(user.id)
```

```
Route Page (navigate) → NovelVirtualFeed (prop pass-through)
  → NovelCard/NovelCoverCard/NovelTextListCard
  → button onClick → e.stopPropagation() → props.onAuthorClick?.(novel.user.id)
```

### D3: `e.stopPropagation()` 防止冒泡

点击用户名按钮时阻止事件冒泡到卡片容器，避免同时触发"进入作品详情"的导航。

### D4: 触控目标符合移动端要求

用户名按钮设置 `min-h-[40px]`，满足 Fluent Design 规范中移动端最小触控区域 40×40px 的要求。

### D5: HistoryEntry 新增 `authorId` 字段

浏览历史 `HistoryEntry` 接口新增 `authorId?: number` 可选字段（标记为 optional，因为旧 localStorage 数据不含此字段），`recordVisit()` 中写入 `item.user.id`（作品作者的 ID，而非当前登录用户的 ID）。

旧数据兼容：`HistoryPage` 中 `Show` 条件渲染，有 `authorId` 时显示为可点击按钮，无则降级为纯文本。

## 与 ADR 的关系

本设计建立在现有的 prop 传递模式上（如 `onIllustClick`、`onNovelClick` 等），未引入新的透传机制或架构概念。

## 后果

### 正面

- 全应用范围内，用户可点击任何第三方用户名跳转到其个人中心
- 统一使用 `onAuthorClick` prop 命名，接口风格一致
- `e.stopPropagation()` 确保不与卡片详情导航冲突
- 浏览历史向下兼容旧存储数据

### 负面

- 新增 prop 透传链增加少量组件接口复杂度
- 浏览历史旧条目（无 `authorId` 字段）暂时无法点击跳转，需等待用户重新访问对应作品生成新记录

### 风险

低。每层组件都是纯新增 optional prop，不影响现有功能。

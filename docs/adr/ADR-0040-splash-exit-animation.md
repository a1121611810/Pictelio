# ADR-0040: Splash Screen 退出动画

## 状态

已实现

## 日期

2026-07-29

## 背景

Splash Screen 在 `setKeepOnScreenCondition` 条件为 false 时直接消失，logo 瞬间切换为内容页。
用户反馈 Splash 期间 logo 静止不动，给人"卡死"的错觉。需要让 Splash 退出时有动效反馈。

此外，列表页（VirtualFeed）在后台刷新时同时显示骨架屏和 LoadingSpinner，造成双重加载反馈的冗余。

## 决策

### 1. SplashScreen 退出动画

利用 AndroidX SplashScreen API 的 `setOnExitAnimationListener`，在 `keepSplashVisible` 变为 false 时触发自定义退出动画：

- 对 `getIconView()` 执行 **scale(1.8x) + alpha(0)** 组合动画
- 时长 280ms，`DecelerateInterpolator` 缓动曲线
- 动画结束后调用 `SplashScreenView.remove()`

**效果**：logo 放大并淡出，视觉上"展开进入"应用。

### 2. 移除 VirtualFeed 冗余 LoadingSpinner

删除 `VirtualFeed.tsx` 中 `loading && illusts.length > 0` 条件分支下的 `LoadingSpinner` 组件。
该 spinner 在有缓存数据后台刷新时出现，与已有的骨架屏（首次加载）和 TanStack Query
的数据替换（刷新）形成双重反馈。删除后各场景覆盖：

- 首次加载 → 骨架屏
- 有缓存后台刷新 → 已有卡片 + 新卡片自动替换
- 翻页 → sentinel 触发追加
- 下拉刷新 → PullIndicator 动画

## 影响

- **MainActivity.java**: +12 行（`setOnExitAnimationListener`），零新依赖
- **VirtualFeed.tsx**: -4 行（删除 LoadingSpinner 及其 import）
- 退出动画纯原生 60fps，零 JS 参与
- 不涉及网络、存储、权限

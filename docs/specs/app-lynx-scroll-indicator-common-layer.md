# Spec: 滚动指示条上移 RefreshableList 公共层（覆盖 7 页）

> 父决策：ADR-0135（指示条方案）；#319（IllustList）+ #323（NovelList）Out of Scope「上移公共层另开票」的落地票
> 日期：2026-09-02 深夜
> 前缀：app-lynx-scroll-indicator-common-layer
> Grill 拍板（2026-09-02）：Q1 集成形态 = A 上移 RefreshableList 内置；Q2 验收口径 = A 两级；Q3 立票粒度 = A 单 spec + T1/T2/T3

## Problem Statement

滚动指示条（ADR-0135）目前只在 IllustList 与 NovelList 两页接线（每页 ~20 行：`useScrollIndicator` 实例化 + `:scroll-event-throttle="0"` + `@scroll` 绑定 + `ScrollIndicator` 渲染 + `dispose`）。其余 5 个 RefreshableList 系页面（Following / Bookmarks / Watchlist / UserHome / FollowList，共 9 个列表实例）无指示条——与「列表滚动应有位置指示」的 webview 对齐目标不一致，且同一接线模式在每页重复（新增页面还得再抄）。#323 Out of Scope 明确「上移 RefreshableList 公共层（一次覆盖 7 页）：独立架构票，需 7 页逐页验证」。

## Solution

**指示条状态与渲染整体收进 `RefreshableList` 公共组件**（唯一持有 `useScrollIndicator` + 渲染 `ScrollIndicator` 的地方）；**页面接线从「实例化 + 4 处绑定」降为「一处 scoped slot 回调绑定」**；6 页补上 `<list>` 的 `:scroll-event-throttle="0"`（ADR-0110 勘误：throttle=100 零派发、throttle=0 才 ~60Hz——当前 5 页无该属性，等于零派发）。

- **事件通路（scoped slot）**：实测结论——slot 内 `<list>` 的 @scroll 无法被外层组件监听（事件不冒泡、slot 内容在父作用域编译、仓内无跨组件事件先例，唯一先例是页面显式 emit）；因此 RefreshableList 用 `<slot :on-scroll="indicator.onScroll" />` 向页面透出**已节流**的回调，页面 `<template #default="{ onScroll }"><list :scroll-event-throttle="0" @scroll="onScroll" ...>`。**向后兼容**：不使用 slot props 的既有调用方（模板未改的父组件）行为不变，slot props 可忽略。
- **公共层改动（RefreshableList.vue）**：内部 `const indicator = useScrollIndicator()`；根 relative 容器内 `<ScrollIndicator :top-px="indicator.topPx.value" :height-px="indicator.heightPx.value" :visible="indicator.visible.value" />`（锚点 = 本组件根 relative——ADR-0131 定位语义，与 #319 一致）；`<slot :on-scroll="indicator.onScroll" />`；指示条不参与 FAB 层级（z-40，与 #319 相同）。
- **IllustList / NovelList 去接线**：删 `useScrollIndicator` import 与实例化、`ScrollIndicator` import 与模板标记、`dispose()`；`@scroll` 改 `@scroll="onScroll"`（scoped slot）；**删除是对称动作**——逐行对照确认（#323 对称性要求的延续）。
- **5 页接线**：Following / Bookmarks（双实例：插画 waterfall + 小说 single）/ UserHome（双实例）/ Watchlist / FollowList——每页 RefreshableList 改 scoped slot 模板 + `<list :scroll-event-throttle="0" @scroll="onScroll">`；每实例独立指示条（v-if 切 tab 场景仅活跃实例挂载，无双条）。
- **Bookmarks/UserHome 双实例**：两实例各自持有 indicator 状态，各自 scroll 信号；`removedIllustIds`/`:id` 变化导致整树重建（refreshEpoch++）时指示条随实例重建，无残留。
- **KeepAlive**：`App.vue` include = `['recommended','illusts','novels','me']`——illusts/novels 在缓存中；RefreshableList 随页面组件存活，`useScrollIndicator` 的 dispose 由 onUnmounted 自动注册——隐藏期间 500ms timer 触发仅写 refs，无副作用（行为与现状一致：目前 indicator 也在页面级 onUnmounted 清理，KeepAlive 下同样不触发）。
- **FollowList**：手写分页（无 createMixFeed），`<list>` 在 RefreshableList 内——指示条逻辑与其分页无关，只消费 @scroll 信号；`@scrolltolower` 保留并存（#323 先例）。

## User Stories

1. 作为 app-lynx 用户，我在 Following / Bookmarks / UserHome / Watchlist / FollowList 滚动时也能看到右缘滚动指示条，与插画/小说列表一致。
2. 作为代码维护者，我希望指示条逻辑集中在 RefreshableList 一处，页面零重复接线，后续新增页面开箱即得。
3. 作为维护者，我希望现有 IllustList/NovelList 行为（指示条出现/跟随/淡出）在公共层迁移后完全不变。
4. 作为用户，我希望 Bookmarks/UserHome 的插画与小说两个子列表各自有指示条且不双显。
5. 作为源码读者，我希望能从页面代码一眼看出「这个页面滚动行为由公共层兜底」，且公共层改动有单测覆盖（节流/淡出/几何计算已由 T1/T2 的 18 单测覆盖，不重复引入）。
6. 作为性能口径维护者，我希望公共层改动不劣化任何已测场景（逐页同会话 ABBA 无 >1pp 回退；novel 系已反超 webview 不追 ≥2pp）。

## Implementation Decisions

1. **载体**：Scoped slot 透传（`<slot :on-scroll="...">`），**不**用 defineExpose + 模板 ref（两者等价样板，slot 更少且天然兼容未升级父组件）；**不**用 provide/inject（无必要地全局化）。
2. **节流与淡出复用**：`useScrollIndicator` 原样复用（THROTTLE_MS=33 / HIDE_DELAY_MS=500 / null 信号不动可见性——语义与 #319 完全一致），零新原语；`calcScrollIndicator` 纯函数不动。
3. **throttle 必须显式**：所有改造 `<list>` 必须写 `:scroll-event-throttle="0"`（ADR-0110 勘误；默认 100 零派发）——5 页新增，Illust/Novel 已带不增。
4. **渲染可见性**：`ScrollIndicator` 显隐 = opacity（禁 v-if，ADR-0135）；位置 = 根容器内右缘 absolute；颜色/尺寸沿用（宽 2.4px、圆角 2px、rgba 语义色→内联）。
5. **不动范围**：`NovelDetail.vue` / `CommentOverlay.vue` / `SearchSheet.vue` 的 `<list>` **不经 RefreshableList**，不在范围；官方 MTS 滚动条（0 派发）不引入；webview 冻结；下拉刷新/FAB/回顶（back-to-top）逻辑不动；不顺便重构其它重复。
6. **红线测试**：`tests/unit.test.ts:1766-1850`（7 页清单 / `:refresh` 绑定 / 页面零自持刷新态 / `@back-to-top` / 实例计数 9）——T1/T2 改动后逐条核对该文件断言是否与「页面结构」相关（若断言 ScrollIndicator 渲染位置在页面内则须按新结构更新；若仅断言 list/refresh 红线则预期保持绿）。
7. **A11Y/受限卡**：指示条为纯视觉竖条，无交互、斜插级不影响遮罩 tap（#319 已验）；R18 遮罩页不改变。

## Testing Decisions

- **单元测试（node，零新增）**：指示条逻辑（节流/淡出/几何）已由 `calcScrollIndicator.test.ts` + `useScrollIndicator.test.ts` 覆盖（18 例）——公共层迁移不改变逻辑，只移动实例化位置；`tests/unit.test.ts` 红线核对见 Implementation Decisions 6；跑 `pnpm test:app-lynx`（738）与 `pnpm check:app-lynx` 全绿。
- **真机验收（两级口径，Q2 拍板）**：
  - **功能**：7 页 9 实例逐页验证——benchNav 深链直达优先（取 `--es benchNav` 值；缺直达的页（Watchlist/Bookmarks/UserHome/FollowList 未确认有直达）用 bench 分支 `lynx-bench-nav.sh` 坐标导航（OPPO profile 已有坐标）或 bench 分支扩展 benchNav（throwaway，不进 main））；滚动中采样（swipe+screencap 并发，ADR-0137 方法，像素阈值 r<200）确认指示条出现/跟随/淡出。
  - **性能**：逐页同会话 ABBA 相邻配对（bench/scroll-t0-306 分支 `bench-scroll.mjs`，不劣化口径 = **回退 ≤1pp**；novel 系已反超 webview（8.2% vs 20.9%）不追 ≥2pp 改善——#323 口径延续）；回归 = 738 单测 + check + 无 console 回归。
- **E2E**：不做 agent-browser spec（指示条 opacity 不可见性，#319 先例）；不新增 android-e2e（真机人工/bench 路径验收）。

## Out of Scope

- NovelDetail / CommentOverlay / SearchSheet 的非 RefreshableList `<list>`。
- MTS 主线程滚动条（0 派发，桥保留待上游，ADR-0135）。
- 速度感知图片降载（#318 已证伪划出）。
- 下拉刷新 / FAB / back-to-top 重构；其它重复项（一次只做指示条）。
- webview 客户端任何改动（基准冻结）。

## Further Notes

- 验收数据记录位置：T3 注释回填（bench JSONL + 功能采样证据），结论附 `docs/research/`（不在本 spec 强制）。
- 工具链：bench-scroll.mjs / lynx-bench-nav.sh / lynx-screen-analyze.py 在 `bench/scroll-t0-306` 分支（main 无——ADR-0136 约定）；T3 从该分支复跑，不可进 main。
- 「一次性覆盖 7 页」的回归成本 = 公共层改动全量回归，已在 Q2 验收口径内。

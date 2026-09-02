# Spec: NovelList 滚动指示条（app-lynx，#319 扩展）

> 票：#319 的 Out of Scope「NovelList 另开票」中的这张票
> 日期：2026-09-02
> 前缀：app-lynx-scroll-indicator-novel-list
> 模式：与 IllustList（#319 已实现，T1/T2 组件/原语已合入 main）逐行对称

## Problem Statement

小说列表（NovelList.vue，小说 tab 的 single 列表，推荐/关注两子 tab）滚动时**没有滚动位置指示**——与已实现的插画列表（IllustList）不一致。webview 客户端有滚动条、Lynx 应有，且「滚动中可见位置」是按跟手性主观轴的一部分。当前 NovelList 是唯一一个《跟手性对比场景》里还有滚动条的对照缺口（novel-single 是 #304 地图的面试场景之一）。

## Solution

NovelList 完全参照 IllustList 的 #319 实现：`<list>` 绑 `@scroll` + `scroll-event-throttle="0"`（滚动信号面），`useScrollIndicator` 原语驱动 `ScrollIndicator` 组件（右缘竖条，@scroll 60Hz 信号 → 33ms 节流 → 500ms 淡出）。**T1 纯函数（calcScrollIndicator）+ T2 组件/原语已合入 main，零新增组件**——改动仅 NovelList.vue 页面接线 ~20 行。

## User Stories

1. 作为 app-lynx 用户，我在小说列表滚动时能看到右缘滚动指示条，以便知道当前位置（与插画列表一致）。
2. 作为 app-lynx 用户，我停止滚动 500ms 后指示条淡出，以便不遮挡内容。
3. 作为 app-lynx 用户，我在小说列表推荐/关注两个子 tab 均能看到指示条（切换 tab 后同样生效）。
4. 作为代码阅读者，我希望 NovelList 的指示条接线与 IllustList **逐行对称**，以便维护认知一致（两处一起改）。

## Implementation Decisions

- **复用现有 seams（零新增组件）**：`calcScrollIndicator`（T1）+ `useScrollIndicator`/`ScrollIndicator`（T2）已在 main；NovelList 只做接线：
  - import `useScrollIndicator` + `ScrollIndicator`
  - `const scrollIndicator = useScrollIndicator()`
  - `<list>` 加 `:scroll-event-throttle="0"` + `@scroll="scrollIndicator.onScroll"`（注意：NovelList 当前的 `@scrolltolower="loadMore"` 保留，两者并存）
  - `</list>` 后、`</RefreshableList>` 前渲染 `<ScrollIndicator :top-px="scrollIndicator.topPx.value" :height-px="scrollIndicator.heightPx.value" :visible="scrollIndicator.visible.value" />`
  - onUnmounted 加 `scrollIndicator.dispose()`
- **位置锚点**：指示条在 RefreshableList（relative 容器）内——与 IllustList 相同（ADR-0131 定位锚点语义）。
- **双保险**：`__DEV__`（生产消除）与原生 BuildConfig.DEBUG 无关——指示条是产品功能非 bench 钩子，**正常打包**（生产也要显示），无条件包裹。
- **范围边界**：只改 NovelList 一个页面。其他 RefreshableList 系（Following/Bookmarks/Watchlist/UserHome/FollowList）**不在本 spec**——如需要另开票（避免 Speculative Generality）。

## Testing Decisions

- **单元测试**：NovelList 接线无新逻辑（沿用 T1/T2 的 18 个单测已覆盖计算/节流/淡出）；无新增纯函数 → **无需新增单测**（接线层是模板声明，tsc 校验）。
- **已有测试不回归**：run `pnpm test:app-lynx`（738 文件保持不变）。
- **真机验收（功能+不劣化）**：
  - 功能：debug 构建 + `--es benchNav novel` 直达小说列表 → 滚动 → 像素扫描确认右缘指示条渲染、跟随、淡出
  - 不劣化：novel-single 场景同会话 ABBA 配对（相邻 A 插值），jank 无 >1pp 回退（该场景已反超 webview 8.2% vs 20.9%，不追 2pp 改善）

## Out of Scope

- **上移 RefreshableList 公共层**（一次覆盖 7 页）：独立架构票，需 7 页逐页验证——本 spec 不顺手做。
- **NovelDetail**（小说详情正文滚动）：已有 ADR-0134 虚拟化 + MT 桥，非列表页，不在范围。
- **速度感知图片降载**（#318 候选①）：独立决策票。
- **其他 RefreshableList 系页面**指示条：另开票。

## Further Notes

- **验收数据**（#319 已证）：插画列表同形态 jank 0.1930 → 0.1131（-8pp）、P90 19.4 → 10-14.6ms——NovelList 目标是功能全 + 不劣化，不重复追 2pp（已反超 webview）。
- **对称性要求**：implementation 阶段需逐行对照 IllustList 的接线（import 顺序、模板位置、dispose 位置），保证两处 diff 几乎相同，降低维护成本。

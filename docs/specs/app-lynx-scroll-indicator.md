# Spec: 列表滚动指示条（app-lynx）

> 票：#318（决策已定）+ ADR-0135
> 日期：2026-09-02
> 前缀：app-lynx-scroll-indicator

## Problem Statement

用户在 Lynx 客户端（app-lynx）的列表（插画瀑布流为代表）滚动时，**没有滚动位置指示**——webview 客户端有原生滚动条，lynx 没有，且列表跟手性主观感受与 webview 有差距。需要在滚动中显示「当前位置」指示条，缩小与 webview 的视觉差，并改善滚动跟手性主观感知。

## Solution

在列表的 `<list>` 上绑定 `@scroll` + `scroll-event-throttle="0"`（滚动信号面，ADR-0110 勘误：throttle=100 零派发、throttle=0 每帧 ~60Hz 派发），驱动右缘滚动指示条：高度=视口/内容比例、top=位置比例、滚动中可见、停止 500ms 后淡出。**真机 ABBA 配对验证：jank 0.1930 → 0.1686/0.1131（-2.4~-8pp），P90 19.4ms → 10-14.6ms，drag 场景 -7pp——首个稳定越过 ≥2pp 止损线的修复（ADR-0135）。**

## User Stories

1. 作为 app-lynx 用户，我在插画列表滚动时能看到右缘滚动指示条，以便知道当前滚动位置（与 webview 一致）。
2. 作为 app-lynx 用户，我快速甩动列表时指示条跟随位置并以 ~30Hz 平滑更新，以便不增加卡顿感。
3. 作为 app-lynx 用户，我停止滚动 500ms 后指示条淡出不再遮挡内容，以便保持界面整洁。
4. 作为 app-lynx 用户，我在列表首屏（scrollTop=0）时指示条位于顶部且可见，以便位置感知正确。
5. 作为源码阅读者，我希望滚动指示条逻辑被抽象为模块（纯函数计算 + 轻量组件），而不是散落在页面里，以便复用与测试。
6. 作为开发/维护者，我希望能用单元测试验证指示条的高度/位置计算（视口/内容比例），以便防止几何回归。
7. 作为 app-lynx 用户，滚动指示条只出现在列表页（RefreshableList 系），不干扰详情页/弹层，以便不会错误遮挡内容。
8. 作为 app-lynx 用户，我在开启 R18 受限卡（显示遮罩）时指示条不遮挡受限内容交互。
9. 作为 M3 风格维护者，指示条视觉遵循 Fluent/M3 设计令牌（颜色用语义色，宽高符合规范），以便设计一致性。

## Implementation Decisions

- **信号面接入**：`<list>` 绑 `@scroll` + `scroll-event-throttle="0"`（dataload paylaod：`detail.{scrollTop, scrollHeight, listWidth, listHeight, deltaX, deltaY, eventSource}`）。
- **节流**：UI 更新 33ms 阈值（~30Hz），每帧 ~60Hz 事件为 BT 成本——回调内「计算+写 ref」必须轻量，禁止异步/重计算。
- **指示条计算（纯函数 seam）**：`calcScrollIndicator(detail: {scrollTop, scrollHeight, listHeight})` → `{top: number, height: number} | null`：
  - `height = max(24, listHeight * (listHeight / scrollHeight))`（最小高度 24px 防消失）
  - `top = listHeight * (scrollTop / scrollHeight)`
  - payload 缺 `scrollHeight`（≤0）→ 返回 null（无信号，保持隐藏——非静默降级，上游有值才会显示）
  - `listHeight` 缺失回退常量（原型用 580，取屏高约束下的保守值）
- **组件 seam**：`ScrollIndicator.vue` 轻量展示组件：
  - props: `topPx`, `heightPx`, `visible`
  - 渲染 `<view>` absolute right缘竖条：width 2.4px、radius 2px、rgba 内联色（Tailwind 透明度语法原生不生效）
  - 显隐 = opacity（0/1），**禁止 v-if**（v-if 每帧 flip 重建视图，真机教训）
  - 位置锚点 = 父容器（RefreshableList relative 容器内）
- **状态管理 seam**：`useScrollIndicator()` 原语（或页面内 ref 组合）：
  - `onScroll(e)` 处理：payload 校验 → 33ms 节流 → calcScrollIndicator → set refs → visible=true → 重置 500ms hide timer
  - `dispose()`：清理 timer（onUnmounted 调用）
- **范围**：第一落地 = IllustList（插画瀑布流，主战场，ADR-0135 目标场景）。NovelList / 详情页**不在本 spec**（已有 novel-detail 的 MT 桥信号，扩展另开票）。
- **视觉一致性**：指示条色用 M3 `surface-on-variant` 语义（内联 rgba 值从 tokens 换算——注意原生不认 Tailwind 透明度语法，用 rgba() 字符串）。
- **性能校验**：本改动不得引入 >0.5pp jank 回退（ABBA 配对基线 = bench/scroll-t0-306 分支的 A 系列）。

## Testing Decisions

- **单元测试（优先）**：`calcScrollIndicator` 纯函数——多类 payload（正常/`scrollHeight=0`/缺失`listHeight`/滚动到底 `scrollTop==scrollHeight`），断言 top/height 公式与 null 返回（oracle = 公式本身，从原型+官方 BT 版滚动条公式推导——**但公式来自原型已验证，oracle 需独立：官方 GalleryScrollbar 公式 `listH*(listH/scrollH)`、`listH*(scrollTop/scrollH)` 是独立来源**）。
- **状态原语测试**：`useScrollIndicator`（若拆出）——节流窗口内多次 onScroll 只更新一次；500ms timer 后 visible=false；dispose 清 timer（fake timers）。
- **手写 mock 字段**：mock 事件 payload 必须来自真机捕获的实际 payload 形状（探针日志实证字段：`scrollTop/scrollHeight/listWidth/listHeight/deltaX/deltaY/eventSource`），遵循契约测试用真实样例原则。
- **E2E/视觉**：不做（AI E2E 不易观测 opacity 指示条；真机 ABBA bench 即验收——沿 #306 的 T0 bench）。

## Out of Scope

- **速度感知图片降载**（#318 候选①）：独立 A/B（图片链路已有引擎级 lazy-load，增量待量化）。
- **滚动态 UI 降载**（候选②）、**MTS 滚动条**（主线程版，SDK 4.0.1 不派发——桥保留待上游）。
- **NovelDetail / novel-single 滚动条扩展**：另开票（该场景已有 MT 桥信号通道，且已反超 webview）。
- **feed 长度上限**（#310 已拍板不采纳）。
- **#311 决策重估**（MT vs BT 信号简化）：用户拍板不重估，NovelDetail 维持现状（BT @scroll 可用性只作为观察项）。

## Further Notes

- **真机验收**：合入前提 = bench/scroll-t0-306 分支 ABBA 配对 ≥2pp 改善或 ≤0.5pp 回退（jank）；主观 = OPPO R11s 双轮目测指示条出现/淡出/跟随。
- **ADR-0110 勘误**：spec 实现必须写 `scroll-event-throttle="0"`（默认/100 会零派发——原型教训）。
- **bench 工具链不进 main**：实现从 main 开始（原型改动在 prototype/scroll-c3 分支，含 benchNav 钩子——合入 main 时必须只搬滚动条改动，不带 bench 工具）。

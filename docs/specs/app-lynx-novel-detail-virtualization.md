# Spec：小说正文列表虚拟化与主线程滚动信号（app-lynx）

> 父决策：ADR-0134（2026-09-02）；选型 #311；spike #313（原型分支 prototype/vapor-eval 7e92665a 已验证）
> 术语：packages/app-lynx/CONTEXT.md「正文段落虚拟化」「主线程滚动信号」「输入派发地板」「主线程脚本（MTS）」

## Problem Statement

Pictelio Lynx 客户端的小说详情页，正文长文滚动体验明显差于 webview 客户端：滑动过程存在明显卡顿（卡顿随滚动深度加剧），长文阅读时内存占用高。用户在真机上反复感知到该差异，量化基线显示与 webview 差距最大（jank 14.2% vs 3.4%），且现状实现（全文一次性渲染至单个 scroll-view）经实测证实在深滚动时**持续劣化**（元素树单调增长），与官方「超三屏应改用 list」的指引相悖。

## Solution

小说正文改用 **`<list list-type="single">` 引擎虚拟化**承载（段落为 list-item，原生回收、按需创建可见区），使正文滚动负载随滚动深度保持稳定；并通过 **`:main-thread-bindscroll` 主线程滚动信号**复活追更询问的「≥70% 进度」判定，让滚动语义从「仅到底兜底」回到「进度或到底」双路。

- **正文渲染**：头部信息卡（`meta`）、段落（`p-<idx>`）、「— 完 —」（`end`）为 list-item；Vue `:key` 与 Lynx `:item-key` 双份一致；`estimated-main-axis-size-px` 按正文实际行高估算（精调项）；受限小说保留现有「头部+遮罩」独立分支，不经 list。
- **滚动信号**：`<list>` 上挂 `:main-thread-bindscroll`（MT 通道，真机派发实证），将 scrollTop 经主线程回调转译为追更询问所需的进度（≥70%），与 `@scrolltolower`（到底）双路；其余滚动感知能力保持现状（暂不引入新调用方）。
- **其余交互**：评论浮层、系列行、屏蔽/举报、返回守卫、追更弹窗全部保持现有行为（回归验证）。

## User Stories

1. 作为 Lynx 客户端用户，我想在小说详情页顺畅浏览长文，使滑动不再随深度劣化、体感追平 webview 客户端。
2. 作为用户，我想长文滚动时内存保持稳定，使低端/老设备（如 Android 9 R11s）长读到结尾也不因内存膨胀劣化。
3. 作为用户，我想长文正文首屏与滚动过程无白屏/空白区域，使阅读不中断。
4. 作为追更读者，我想在阅读进度达到「≥70% 或到达底部」且停留 ≥10s 后返回时收到追更询问，使追更提示落在真正读完的场景。
5. 作为追更读者，我想「暂不」选择后本会话不再重复询问，保持现状行为。
6. 作为受限内容读者，我想受限小说仍以「标题/作者信息可见 + 遮罩」形态展示，使 R18/R18G 开关语义不变。
7. 作为评论用户，我想在详情页正常打开评论浮层且正文滚动位置不丢失。
8. 作为作者关注者，我想在详情页看到系列信息行与已追更 chip 标记。
9. 作为用户，我想小说正文的段落排版（字号/行高/间距）与现状一致，不因虚拟化改动观感。
10. 作为产品方，我想追更询问语义文案与触发条件可被单元测试覆盖（进度计算/触发判定）。

## Implementation Decisions

1. **虚构化载体**：NovelDetail 正文替换为 `<list list-type="single" scroll-orientation="vertical">`；meta/段落/end 三段 list-item（item-key 规则 `meta` / `p-<idx>` / `end`；idx 为稳定段落序）。
2. **估算高度**：`estimated-main-axis-size-px` 以正文典型段落高度估算（实施时导入「段落行高估算」：`max(1, 段字数/行宽系数) × 行高 + 段间距`）——由 prototype 的固定 300px 精化为估算函数；该函数保持纯函数（node 单测可测）。
3. **MT 滚动信号**：`onNovelScrollMT`（`'main thread'` 指令 handler，`useMainThreadRef` 持有上一 scrollTop），转译为**进度事件** `prompt.notifyScroll(progress, reachedBottom)`；`progress = clamp((scrollTop - 0) / (scrollHeight - viewport), 0, 1)`（scrollHeight 以 scrolltolower/last event 的 detail 校准）；MT 回调进 BT 经 `runOnBackground` 或直接经**共享纯函数计算进度**（进度计算在 BT 侧从 MT 事件值重算——保持纯函数复用）。
4. **追更触发**：恢复「≥70% 或到底」双路；语义与 glossary 一致（系列作品/未追更/本会话未暂不/停留≥10s）。
5. **受限分支**：保留（`isRestricted(novel)` 短路，renders 头卡+遮罩；不经 list）。
6. **原型移植基线**：改动基于原型分支已验证实现（`prototype/vapor-eval` 7e92665a 的 NovelDetail），实施以「移植 + 精化」为姿态；不引入新抽象（list 薄调用）。
7. **注释/flag**：「正文段落虚拟化」与「MT 滚动信号」术语入 CONTEXT（已随 ADR-0134 落库）；不再保留 bench 插桩（BENCH_* 痕迹从正式实现移除）。

## Testing Decisions

- **只测外部行为**：渲染结构（list 元素/列表数量/受限分支分支样式）、进度计算与追更触发判定、MT 信号转译（scrollTop→progress 纯函数打磨）、估算函数。
- **测试模块**：`primitives/novelProgress.ts`（估算 + 进度纯函数，来自原型内的内联逻辑——内联为 primitives 纯函数以便 node 单测）；`pages/NovelDetail.vue` 的装配测试（mock 路由/store，断言 list/meta/end 结构存在、受限分支渲染、onNovelToBottom 通知）；watchlistPrompt 触发边界测试补充 ≥70% 路径（现仅到底路径测试存在）。
- **先例**：仓库 testing 惯例（packages/app-lynx/tests/ + 就近 `*.test.ts`；mock @/ 全路径——见 memory「vitest mock 路径坑」）；现有 watchlistPrompt 相关测试文件作为 prior art。
- **E2E**：不新增 agent-browser/android-e2e spec（真机回归由 bench/人工路径执行，列入实施验证清单）；若加，仅限 lynx 详情页结构 smoke（可选）。
- **验收**（沿用 spike 线，真机复测）：同文同深度 jank ≤10%、内存曲线平稳（±10%）、无白屏；追更 ≥70% 触发在真机可复现（MT 信号验证）；check/lint/fmt/build 全绿。

## Out of Scope

- 列表页（插画/小说 feed）的帧负载修复（#310 独立票，后续）。
- 推荐轮播 MTS 化（#304 迷雾区观察项，另行评估）。
- 滚动位置恢复/书签（需锚点 id，另列实施议题）。
- 超长文（>10 万字）专项内存曲线（实施阶段抽样即可，spike 已验 25.7k 字）。
- Vapor 迁移（挂起等上游发布）。
- webview 客户端任何改动（基准冻结）。

## Further Notes

- 实现将把原型分支 7e92665a 的权力点移植；原型中 `BENCH_*` 插桩、MtsDemo、IFR 配置保持由单独立项跟进（IFR 保留启用已在 ADR-0134 记录；MtsDemo 为原型验证产物，正式库不引入）。
- 上游跟踪：#302（cell 回收）正文场景实测健康；仍有长期跟踪事项（上游滚动事件/回收进展）。

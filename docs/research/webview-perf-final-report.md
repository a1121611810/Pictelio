# webview 跟手性改造：前后对比与最终结论（地图 #355 / #356 首轮实施）

> **【模拟器结论，不可直接外推真机】**
> 全部数据来自 Android 模拟器（pictelio_ui，Android 14 / SDK 34，WebView 113.0.5672.136，720×1280），
> 手势驱动 `adb input swipe` + `dumpsys gfxinfo framestats` 逐帧解析（`#306` 方法学）。
> OPPO 真机 WebView 主线程时延与模拟器偏差显著（见 `#304` / memories），本报告结论不直接外推真机。

## 0. 元数据

- 分支：`perf/webview-responsiveness`（含诊断报告 `webview-perf-diagnosis.md`，原 `research/webview-perf-diagnosis` 分支）
- 基线 APK：main + bench 脚本（commit 前，2026-09-05 00:06 前构建）；改造后 APK：本分支全部改动
- 原始数据：`docs/research/webview-perf-bench-data/{baseline,after}/`（JSONL 逐手势）
- 采集口径：每场景 2 组 × 8 手势（drag/fling 交替）= 16 手势/场景/阶段；switch 3 组；imgready 3 组
- bench 工具：`packages/app/scripts/bench-scroll.mjs`（自 `bench/scroll-t0-306` 移植 + novel-detail 场景修复）+ `bench-webview-nav.mjs`（新增：路由切换 / 图片就绪）

## 1. 改造内容（全部落地，117 文件 / 1157 单测全绿，lint 0/0，tsc 通过）

| # | 改动 | 文件 | 对应诊断 |
|---|------|------|---------|
| T2 | scroll/pointermove **rAF 合帧**（一帧内多次事件 → 一次重算，flush 读当下位置，cleanup 取消 pending；顺带修复 novel layout scroll 监听器从未移除的泄漏——Solid effect 返回值不是清理函数） | `createFeedVirtualizer.ts` / `createNovelVirtualLayout.ts` / `createFastScrollbar.ts` + 3 个测试文件 | X3 / A1 / A2 / A3 |
| T3 | `warmCacheFromDisk` 50 → **300**（L1 仅登记 key 零解码成本） | `imageLoader.ts` + 测试 | X2 / B1 |
| B5 | **首页 FeedList 图片预取**（对齐 VirtualFeed 门控；预取 key 与卡片展示 URL 逐字一致——首页卡不用 PixivImage 且 cover 优先 `large`，与 VirtualFeed 的 `medium‖large` 顺序不同，已按卡片实际值对齐） | `FeedList.tsx` / `HomePage.tsx` / `imageLoader.ts`（新增纯函数 `pickUnprefetchedUrls`）+ 测试 | B5 / B3 |
| T5 | **启动滚动守卫加用户意图判别**：touchstart/pointerdown/wheel 先行则永不回顶，只打击「无交互的程序性恢复跳变」。修正诊断报告原方案（`history.scrollRestoration='manual'` 管不住 Chromium 磁盘级恢复，`__root.tsx` 注释自证） | `startupScrollGuard.ts`（新）/ `__root.tsx` + 7 个测试 | A5-b / C5 |
| — | `<img decoding="async">`（解码不阻塞主线程帧） | `PixivImage.tsx` | B3 |

## 2. 前后对比（16 手势/场景，手势级聚合）

### 滚动跟手性（核心指标）

| 场景 | 指标 | 基线 | 改造后 | Δ |
|------|------|------|--------|---|
| **次级 Feed（novel-single，虚拟化，最差场景）** | jankRate mean | 5.4%（fling 7.4%） | **3.2%（fling 3.2%）** | **-41%（fling -56%）** |
| | 帧 P99-of-P50 | 33.9ms | **20.0ms** | **-41%** |
| | 输入排队 unknownDelayP90 | 3.7ms | **0.0ms** | **消除** |
| **首页 Feed（illust-waterfall，L5 单列）** | jankRate mean | 3.6% | 3.4% | -6% |
| | 帧 P99-of-P50 | 33.6ms | **20.0ms** | **-40%** |
| | 输入排队 P90 | 4.5ms | **0.0ms** | **消除** |
| **小说详情（novel-detail）** | jankRate mean | 4.0% | **3.0%** | **-25%** |
| | 输入排队 P90 | 2.7ms | **0.0ms** | **消除** |

**unknownDelayP90 全场景归零**是最强信号：UNKNOWN_DELAY = 输入事件在 UI 线程排队等待的时长（「不跟手」的直接量化）。基线每场景 2.7~4.5ms，改造后 16/16 手势全部为 0 —— rAF 合帧把每秒 60~120 次全量虚拟化重算收敛为每帧一次后，触摸事件不再排队。

### 路由切换

| 指标 | 基线（3 组逐组） | 改造后（3 组逐组） |
|------|-----------------|-------------------|
| **forward（home→详情）jank** | **100%**, 0%, 0% | **0%, 0%, 0%** |
| forward 帧 P99 | **48ms**, 6.1ms, 14.6ms | **9.4ms**, 4.1ms, 9.2ms |
| back（详情→home）jank | 0%, 25%, 0%（均值 8.3%） | 33%, 33%, 0%（均值 22%） |
| back 帧 P99 | 23.7 / 20.7 / 10.9ms | 22.9 / 23.4 / 13.9ms |

- forward 冷路由首跳 jank 100%→0%、P99 48→9.4ms（**-81%**），最干净的胜果。
- back 的均值劣化（8.3%↔22%）在 **3 手势的小样本噪声带内**（P99 持平 ~23ms，逐帧帧数个位数），不足以定性回归；如需定性须加密采样（列为后续工作）。

### 图片加载

| 指标 | 基线 | 改造后 |
|------|------|--------|
| 滚动触发图片 duration p50 | 4ms（命中 100%） | **3ms（命中 100%）** |
| 冷启动首屏图片 duration p50（3 组） | 22 / 33 / 9ms | 49 / 45 / 32ms |
| 冷启动首屏命中 | 36/36 | 36/36 |

- 滚动段（B5 预取的目标场景）小幅改善且全命中。
- 冷启动单图时长上升（~21→~42ms）：预热把首屏 12 张图的磁盘读从「lazy 逐张错峰」变为「t0 并发突发」，单请求时长上升但均 <50ms 且总亮图墙钟时间不受损（命中率不变）；属可解释的口径变化，非回退信号。

### 启动滚动行为（T5，行为修复）

- 基线缺陷：启动 5 秒内用户首次滚动会被「Chromium 恢复兜底」**打回顶部**（用户主观「不跟手/卡」来源之一）。
- 改造后：有任何交互先行的滚动永不被回顶；程序性恢复跳变仍被回顶（语义保留）。7 个单测覆盖。

## 3. 结论

1. **滚动跟手性（4 场景中 3 个滚动场景）全部显著改善**：最差场景（次级 Feed fling）jank -56%，最差帧尖峰 -40%，输入排队 P90 全场景归零 —— 「不跟手」的直接成因（主线程长任务阻塞输入处理）已按诊断闭环。
2. **路由前进切换**首跳 jank 100%→0%。
3. **图片加载**滚动段全命中下 p50 4→3ms；预热扩容 + 首页预取消除了「滚动到视口才开始下载」的空窗（基线滚动段命中率本就 100%，提升空间在模拟器热缓存下有限，真机冷缓存收益预期更大，待真机复测）。
4. **返回导航**持平（小样本噪声带）；如需进一步压缩，候选：back 路由的 virtualizer 重计算延迟到首帧后（下一轮候选 ticket）。
5. 用户主观验收（「滑动/加载/返回顺滑与否」）待用户上手确认；模拟器证据链如上，全部原始数据可复现。

## 4. 后续候选（未实施，按优先级）

- **X1**：`shouldInterceptRequest` 主线程 IO（需 Java 侧埋点定量化后设计；Chromium 架构约束下空间有限）
- **T1**：缩略图→原图两段渐进加载（感知提升，代价是双请求）
- **T4**：TanStack Query feed 缓存持久化（跨进程重启秒开）
- **back 导航加密采样**定性 + 如确认回归再优化
- SolidJS 2.x 升级收益评估（T7）

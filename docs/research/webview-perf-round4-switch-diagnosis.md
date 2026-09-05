# webview 四轮 B 线：switch 压线专项诊断报告（#360）

> **【模拟器结论，不可直接外推真机】** 全部实验在模拟器 pictelio_ui（Android 14 / WebView 113.0.5672.136 / SwiftShader 软渲染）上完成，应用版本 4.31.0（三轮构建）。
> 实验时间 2026-09-05。spec：`docs/specs/webview-perf-round4.md` §B。研究方案：会话内 /tmp/research-switch-jank-diagnosis.md。
> 原始数据：`docs/research/webview-perf-bench-data/round4-switch-e{0,1,2,3,3a,3b,3c,4,5}/`（E4 大 trace 已 gzip）。

## 0. 结论速览

三轮 B2 的定性「过渡动画×骨架渲染每帧超时 1-2ms 固定成本」**三重误读，前提不成立**：

1. **「每帧压线」是采样伪影**：36/36 条历史 switch 记录 `frames=1`（1800ms 窗口仅渲染 1 帧），jank% 粒度为 0/1，p99=p50=单帧值。
2. **「过渡动画」不存在**：PageTransition 是空壳（`PageTransition.tsx:6-16`，入场动画已移除）。
3. **jank 判定在本模拟器上必然全真**：空闲后一次性内容帧的完成时间地板 ≈17ms（注入 2×2px div 触发唯一一帧，true 16.95ms > deadline 16.67ms，E2c）——任何「切换后首帧」都会被判 jank，**jankTrueRate=100% 是测量必然，非应用回归信号**。

真实问题有两个（均与「压线」无关）：

- **back：home 全量 remount 的主线程长阻塞 ~220-320ms**（trace 归因：popstate/mount v8 任务 117ms + UpdateLifecycle 任务 191-206ms，内含单次 NotifyResizeObservers 178ms 与 **2306 次 ForcedStyleAndLayout** = FeedList 全量 remount 测量抖动）。该阻塞完全发生在 gfxinfo 帧统计视野外。
- **cold 首跳：详情骨架期真实可见**——修正点击目标后 cold illust-forward 56 帧中有 3 帧 true 118-124ms（骨架 shimmer background-position paint 动画期）。

## 1. 六个颠覆性发现

### 1.1 场景污染：bench switch 从未测过插画详情

点击选择器「文档序第一个含 img 的 cursor-pointer」实际命中 **SideNavShell 用户头像 BUTTON**（44×44，docIndex 50，远早于 feed 卡片）→ 导航到 `/me`。round1-3 与本轮 E0-E3 的全部「forward」数据实为 **home→/me→back**。E5 用修正选择器（真实插画卡）重测后画像完全改写（见 1.6）。

### 1.2 列映射错误：totalMs 测的是「到 SwapBuffers 为止」

Android 14 framestats 为 23 列：`c[15]=SwapBuffers`、`c[16]=FrameCompleted`（E0 标定实测）。bench 原解析用 c[15] 作完成时刻，**漏掉 5.6-28ms 的 GPU/显示完成尾部**。`c[2]/c[5]/c[9]` 恰好正确；`c[11]` 名义 FrameStartTime 但恒为 16666666（AOSP 值位交换怪癖），过滤器侥幸放行。另：PROFILEDATA 环形缓冲滞后漏帧（total=3/rows=2、1/rows=0 实录）。

### 1.3 jank 判定失效：一次性内容帧的完成地板 ≈17ms

连续动画期模拟器健康跑 61fps（true ~21ms，Choreographer 将 deadline 放宽至 33/50ms，完成延迟被流水线化掩盖）；**空闲后的一次性帧全额暴露**——E2c 注入 2×2px div 触发唯一一帧，true 16.95ms > 16.67ms deadline，也被判 jank。因此「切换后首帧 16-18ms」与平台地板无法区分，**停止对 switch jank% 做优化归因**。

### 1.4 真实成本 gfxinfo 不可见

E4 trace：back 主线程连续阻塞 ~220-320ms（117.3ms + 205.6ms 两块），构成如上；主线程 Paint 仅 0.8ms。gfxinfo 每窗口只见其后 1 个 paint 帧——**帧级指标与真实阻塞解耦**。

### 1.5 H2 证伪：CSS kill 三档对单帧 trueTotal 零影响

| 档 | forward 中位 | back 中位 |
|---|---|---|
| baseline | 17.99 | 17.88 |
| A 全动画禁 | 18.61 | 18.51 |
| B 仅 shimmer 禁 | 17.85 | 19.05 |
| C img display:none | 17.89 | 20.59 |

动画/shimmer/图片均非单帧成本来源。唯一图片信号是 cold 跳 outlier（baseline forward max 26.07 → 档 C max 6.90）。

### 1.6 forward 画像重写（E5 修正点击目标后）

- **warm illust-forward**：每窗口 11-13 帧（非历史认知的 1 帧）、零 longtask、首帧 true 17-19.5ms 微超 deadline（≈平台地板，不可归因应用）、后续帧 deadline 放宽 33.33ms。
- **cold illust-forward**：56 帧，其中 3 帧 bench 口径 102-112ms（true 118-124ms）= 骨架期真实可见（shimmer 是 background-position paint 动画，窗口内必产生大量帧——与历史 frames=1 互证：**骨架期从未落在旧 forward 窗口内**）。

## 2. 实验明细

| 实验 | 方法 | 关键数字 | 结论 |
|---|---|---|---|
| E0 | switch ×2 组 + 并行抓 raw framestats | bench口径→true口径：fwd 6.91→17.17（jank=True）、back 16.44→34.35 / 15.26→20.82 | 列映射证伪；raw 行数=summary 计数（H4 证伪） |
| E2 | CDP 注入 rAF 计数 + longtask observer | back 每组稳定 2 个 longtask（63-78 + 153-182ms ≈ 218-260ms）；forward 0 个 | back 阻塞真身定位 |
| E2b | 纯 rAF 循环 / shimmer 动画 / 静止 三态 | rAF 123 次：静止 gfxinfo=1、shimmer=126、纯 rAF=0 | gfxinfo 只计有像素变更的帧；H3 部分成立但不伤 switch（paint 帧计数正确，失效的是 jank 判定） |
| E2c | 空闲后注入 2×2px div | 单帧 true 16.95ms | 平台完成地板 ≈17ms 实锤 |
| E1 | 修采样窗口（删二次 reset）+ --groups 10 | forward 帧数 1×9+2×1、back 全 1；jankTrueRate 20/20 全 1 | H1 帧数论实锤、H5 证伪（无密集帧群）；round3「16-18ms」= summary 路径平台地板值 |
| E3 | CSS kill 三档 ×10 组 | 见 1.5 表 | H2 证伪 |
| E4 | CDP Tracing（trace-back / trace-forward / trace-forward-illust） | back 117.3+205.6ms；NotifyResizeObservers 178ms 单次；ForcedStyleAndLayout 2306 次；主线程 Paint 0.1-0.8ms | back 成本构成归因 |
| E5 | 修正点击选择器重测（pathAfter=/illust/149219997 确认） | 见 1.6 | forward 画像重写 |

## 3. 假设裁决表

| # | 假设 | 裁决 | 关键证据 |
|---|---|---|---|
| H1 | 帧数伪影+误读 | **帧数论实锤；超线机制改判** | 修窗口后仍 1-2 帧/窗口；但 16-18ms 是平台地板非应用工作量 |
| H2 | 图片 decode/raster 主导 | **证伪** | img-kill 零影响；trace paint 0.1-0.8ms；仅 cold outlier 与图相关 |
| H3 | 合成路径低估帧数 | **部分成立但不伤 switch** | 无像素变更 tick 不进 gfxinfo；失效的是 jank 判定而非帧数 |
| H4 | 动画泄漏/解析丢失 | **证伪** | raw 行数=summary 计数；shimmer 若在窗口内必有 100+ 帧 |
| H5 | mount 突发散布逐帧税 | **证伪** | 无密集帧群；mount 突发=back 的 2 个 longtask，不在 paint 帧 |

## 4. bench 脚本修复（packages/app/scripts/bench-webview-nav.mjs，最小 diff 向后兼容）

1. `parseFramestats`：+`trueTotalMs`（c[16] FrameCompleted）/`jankTrue`；`totalMs`/`jank` 保留原口径（历史可比）。
2. `summarize`：+`jankTrueRate`/`frameCount`/`frameTotalMs[]`/`frameTrueTotalMs[]`/`frameDeadlineMs[]`。
3. `sampleFrames`：删除内部二次 reset+250ms，forward 窗口对齐 back（完整覆盖 click 后 0-1800ms）。
4. back 记录补 `parsePath` 等字段与 forward 对齐。
5. 兼容性：`sampleFrames` 仅 switch 一个调用点；imgready/coldstart/intercept 零改动；JSONL 只增字段。
6. 点击选择器修正（E5 同款，随本修复固化）：img src 匹配 `/pixiv-img/` 且排除 `user-profile`——旧选择器实证命中 SideNavShell 头像（场景污染）；修正后 target 字段记 `illust-card`，与历史轮次数据不可直接对比。

## 5. 对历史结论的影响边界

- round1-3 的 switch 场景实为 **home→/me→back**（非插画详情）；该口径下轮内数据内部可比，但 **summary 与 profiledata 两解析路径语义不同 + 列映射错误 → 跨轮 p99 对比无效**。
- 一轮「路由前进首跳 jank 100%→0%」等 switch 数字需按本轮口径重新解读：jankTrueRate=100% 属测量必然， improvements 应以 longtask/trueTotal 分布为准复核（未列入本轮范围）。
- 滚动/冷启动/图片场景的结论不受本报告影响（不同采样路径、无本报告所列缺陷）。

## 6. 修复立项建议（仅建议，不在本轮实施）

- **P0**：~~bench 点击目标修复~~（已随本报告 §4-6 固化）；longtask/rAF 观测固化 + jankTrue 作主指标（脚本已支持）+ **真机复测**（SwiftShader 的完成延迟地板在真机大概率消失，其存废决定叙事）。
- **P0**：back 阻塞治理——home keep-alive/窗口化 + 排查 FeedList mount 的 ResizeObserver/测量抖动（单次派发 178ms、2306 次 forced style+layout）。JS 阻塞真机同样存在，与模拟器特化无关。
- **P1**：cold 首跳治理——详情首图阶梯 medium→large + shimmer 换 transform 版 `fluent-shimmer-sweep`（base.css:142-149 已有）。
- **P2**：停止对 switch jank% 做任何优化归因。

## 7. 数据归档

`round4-switch-e0/`（raw framestats 轮询 + JSONL）、`round4-switch-e1/`（修窗后 10 组）、`round4-switch-e2/`（含 e2-driver / e2b-calibration.jsonl / e2c-floor.jsonl 及校准脚本）、`round4-switch-e3{,a,b,c}/`、`round4-switch-e4/`（trace ×3，gzip + analyze 脚本）、`round4-switch-e5/`（修正目标 10 组）。

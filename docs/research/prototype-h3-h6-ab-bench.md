# Prototype：H3 翻页脉冲 / H6 参数 真机 A/B 实测（#310 候选收敛）

> 日期：2026-09-02
> 分支：`prototype/scroll-h3-b2`（基于 `bench/scroll-t0-306`，含 benchNav 工具链）
> 设备：OPPO R11s（69d1caa6，R18 开关开，与 rev2 基线同条件）
> 方法：bench-scroll.mjs T0 层（gfxinfo 聚合摘要，Android 9 走 parseSummary），
> illust-waterfall / novel-single 各 30 手势/轮（drag+fling 交替，3 组 × 10），
> 时间序 ABBA（A-B-B-A-B-A-B）配对检验，漂移用相邻 A 点线性插值基线。

## 候选与结论

| 候选 | 改动 | 结果 | 判定 |
|------|------|------|------|
| B1 增量渲染 | sync() 只 push 新增条目（去全量 map 换引用 / O(N) v-for diff） | 配对残差 -0.1pp / -0.1pp（两轮一致） | **无效，止损** |
| B2 lower-threshold 提前 | 2→6（waterfall）/ 5→10（single），翻页脉冲提前到滚动减速段 | 单测 -11.8pp；复测 +4.2pp | **未确认，止损**（不一致，按验收口径 C 不达标） |
| H6 参数 | NovelList `<list>` preload-buffer-count=10 + `<list-item>` estimated-main-axis-size-px=230 | 配对残差 -0.4pp（novel-single） | **无效，止损** |

## 关键机制复核（为何 B1 无效——源码级）

- vue-lynx `main-thread/dist/list-apply.js`：`flushListUpdates()` **本来就是增量上报**
  ——只处理 `reported → items.length` 区间（insertAction），并以 `listItemsReported` 游标记进度；
  `insertListItem()` 是尾部 push。BT 侧 `sync()` 的全量 map 换引用不会导致 MT 侧重发已有 item。
- Vue v-for 的 O(N) keyed diff 在 BT（后台线程）执行，不挤占 MT 帧预算（触摸/布局线程）；
  MT 侧真正的工作量 = 新 cell 物化（`componentAtIndex` → `__AppendElement` + `__FlushElementTree`），
  由滚动驱动按需拉取，与「数组引用是否换新」无关。
- B2 的脉冲时机理论成立但幅度不足：threshold 提前只改变「何时触发 scrolltolower」，
  物化脉冲本身不变；且复测失败说明单测差异在噪声内。

## 设备漂移（本会话最重要测量学发现）

- 相邻 A 点均值：A1=0.2129 → A2=0.3434 → A3=0.3427；novel-single A=0.3149 → A2=0.422。
- **漂移斜率 ≈ 4.3pp/轮（+10.7pp 跨 2 轮 novel-single）**——远大于 2pp 止损线，
  任何未用「同轮相邻 A 配对」的跨会话/跨批次对比都是噪声。
- 历史基线（oppo-summary 0.1929）与本次 A1 不可直接对比（须同设备同会话同条件）。
- 手法结论：ABBA 配对（B 残差 = B - 相邻 A 插值）是唯一有效口径；单轮单次对比判不了。

## 附：novel-single B 侧含 H6 参数，数据无差异化；illust-waterfall B1/B2 不含 H6（preload 仅 single/flow 生效，waterfall 用不到该杠杆）

## 处置建议（供 #310 拍板）

1. H3 应用层优化（批量/时机）已穷尽：B1 无效（机制已证伪）、B2 未确认 → **按验收口径 C 止损**。
2. 剩余应用层杠杆仅「feed 长度上限」（H1 SDK 死结的唯一对冲）——需用户拍板是否接受行为改变。
3. 跟手性差距的现实归因 = H5 双线程地板（48ms，SDK 层无解）+ H1（SDK 层无解，
   #302 上游跟踪）→ 本项目在 SDK 边界内已无可动杠杆，差距维持，等 #307 的 5 条重估触发。
4. H6 单测无 jank 收益（novel-single 本身已反超 webview），无证据支持动参数——关闭。

## 增补（2026-09-02 官方参照复测）

- **官方 gallery 探针**（prototype/scroll-probe 分支）：`<list>` + `@scroll` + `scroll-event-throttle="0"`
  真机派发实测 = 89 条/6.4s、中位间隔 18ms（~60Hz 每帧），payload 完整
  （scrollTop/scrollHeight/listWidth/listHeight/deltaY/eventSource=2）。
  **ADR-0110「list 零派发」的根因是 throttle=100（四路全零）而非 list 无事件**——
  官方 BT 版滚动条整个靠 @scroll 驱动；官方 MTS 版
  （:main-thread-bindscroll + 'main thread' 指令 + useMainThreadRef + runOnBackground）本轮复测仍 0 次
  （与 NovelDetail 2026-09-02 结论一致，MTS 保留待上游）。
- **waterfall estimated 补测**（prototype/scroll-estimated 分支）：卡高恒定 ≈270px
  （48.4vw 方图+固定文本区），官方公式退化为常量。同窗口 ABBA：A=0.1990 vs estimated=0.2471
  （+4.8pp）→ 无改善，与 H6 结论一致（estimated 只影响滚动条/布局提示，不改变原生物化路径）。
- **actionable 结论**：@scroll(throttle=0) 是可用杠杆（速度感知降载/滚动态 UI/滚动条），
  必须以 throttle=0 + BT 侧节流消费（每帧事件的 BT 成本实打实）；优先级高于已被止损的 B1/B2/H6。

## 测试方法勘误（2026-09-02 增补，用户反馈）

**滚动态 UI（指示条等）不可用「滚动后截图」验证**（详见 ADR-0137「滚动中采样」）——指示条只在滚动中显示（停止 500ms 淡出），
单帧截图在滚动结束后拍摄必然错过（曾误判「不渲染」，浪费多轮）。
**正确姿势（已验证）**：`adb shell input swipe ... 1000` 与 `adb exec-out screencap` **并发**
（滚动期间 visible=true 持续 >1s，连拍必命中；实测 8 帧中 2 帧命中，y 随 scrollTop 移动）。
扫描阈值：指示条为 2.4px 宽 + 35% alpha 半透明，扫「右缘 x 1000-1080 + r<200」（r<140 过严会漏）。
人眼连续观察与 agent 离散截图的差异是根因——agent 验证瞬态 UI 必须以「滚动中采样」为准。

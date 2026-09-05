# webview 性能三轮报告：B1/B2/B3/B5 前后对比与三阶段最终结论（#358）

> **【模拟器结论，不可直接外推真机】** 模拟器 pictelio_ui（Android 14 / WebView 113.0.5672.136）。
> 基线 = 二轮合并后的 main（round3-baseline）；改造后 = 本分支 B1+B3+B5（round3-after）。
> 原始 JSONL：`docs/research/webview-perf-bench-data/round3-{baseline,after}/`。

## 1. 各项结果（诚实呈现：一项假设被数据证伪）

### B1 thumb 绘制就绪卸载 —— 假设证伪，无滚动收益

| 指标 | 二轮后（thumb 常驻） | 三轮后（thumb 卸载） | 结论 |
|---|---|---|---|
| 首页 Feed 滚动 jank | 4.4% | 4.59% | **未回落**（噪声带内持平） |

**证伪结论**：二轮 +1.4pp（3.0→4.4%）的代价不是「thumb 层常驻」，而是**渐进加载模式本身**——滚动中每张新卡要先取 thumb（medium）再取 full（large），两次请求+两次解码，这与 thumb 层是否卸载无关。B1 仍有次要价值（稳态 DOM 更精简、无双层解码驻留、失败兜底语义保持），且实现经 review 四轮闭环合格，**保留**；但「回收滚动代价」的目标未达成。若要真正消除该代价，候选方向是「prefetch 已命中的卡跳过 thumb 直挂 full」（消除第二次加载），列为后续。

### B2 路由切换定性 —— 定性完成：与图片层无关的固定压线成本

| 指标 | 基线（8 组） | 改造后（10 组） |
|---|---|---|
| switch forward jank 100% 的组 | 7/8（均值 87.5%） | 9/10 |
| switch back jank 100% 的组 | 4/8（均值 50%） | 7/10 |
| forward / back 帧 p99 | 17 / 14.5ms | 16-17 / 15-23ms |

**定性结论**：加密采样证明这不是噪声——切换窗口内几乎每帧都超 deadline 1-2ms（p99 恒定 16-18ms 恰好压线 16.67ms）。**与 thumb/图片层无关**（B1 卸载后不变），基线（无本轮改动）同样存在。根因在别处：路由过渡动画 × 首屏骨架渲染的固定成本，属于独立问题域（PageTransition + 骨架树渲染），列为独立候选，不阻塞本批。

### B3 空快照守卫 —— 正确性修复落地

- 空快照（queries:[]）写回会覆盖最后有效持久化（logout 后在途 mutation settle、或全部 query GC 两条路径）→ persistClient 入口 no-op。
- review 复检确认 maxAge 7d 无死锁（timestamp 不刷新 → 第 7 天精确过期，语义正确）。
- 无性能指标影响；单测 +6。

### B5 + review P1：F3 截断写根源完整闭环

- writeFile 改 tmp+rename 原子替换（loader 侧）；review 审计发现 `prefetchImage` 仍直写后一并收敛——**双写方统一原子写纪律**，截断文件被当命中持久返回坏图的路径已不存在。
- 连带修复：`.tmp` 残留打挂 `getCachedKeys` 预热链路（P2）；`tmp.delete()` 失败静默（P3）。
- CI 新增 `android-unit-test` job（Java 防线首次进 CI；全新 checkout 模拟验证生成步骤完备）；可移植性 Assume 守卫。
- Java 112 用例 0 失败；lynx flavor 零 diff 保持。

## 2. 门禁与 review

vitest **121 文件 / 1210 用例**全绿 · Java testFull **112 用例** 0 失败 · lint 0/0 · tsc/fmt pass · lynx 编译通过。
code-review 四轮闭环：初审（1 P1 阻塞 + 2 P2 + 3 P3）→ 修复 → 复检（新 1 P1：CI 生成物缺失）→ 修复 + 本地全新 checkout 模拟 → 终审 **阻塞 0、可合并**。

## 3. 三阶段累计最终结论（用户目标：「改造后给到最终结论」）

| 阶段 | 主要成果 | 关键数字（模拟器） |
|---|---|---|
| 一轮（#355/#356） | scroll/pointermove rAF 合帧、预热扩容、首页预取、启动滚动守卫 | 最差场景 fling jank -56%；**输入排队 P90 全场景归零**；路由前进首跳 jank 100%→0% |
| 二轮（#357） | T4 Query 持久化、T1 渐进加载、X1 拦截链修复 | **冷启动 P50 -50.2%**（4261→2124ms）；F1 修复后全会话拦截 27 次、hit p50 0ms；代价=首页 +1.4pp（渐进模式固有，见 B1 证伪） |
| 三轮（#358） | B3 空快照守卫、B5+F1fix 原子写闭环、B2 定性、CI Java 防线 | 正确性收口：F3 截断写根除、持久化不被空快照覆盖；B1 假设证伪如实记录；switch 定性为独立问题域 |

**总评**：四类场景主观流畅目标的数据支撑——滚动跟手（输入排队归零+jank 减半）、冷启动（-50%）、图片（首图 -24%、拦截链微秒级命中）、导航（前进首跳修复；切换压线问题已定性、独立立项）。遗留见下。

## 4. 遗留候选（按优先级）

1. **真机复测**（用户延后中）——所有数字的最终验收。
2. **switch 压线超时独立诊断**——定性已完成，根因（过渡动画×骨架渲染）待专项。
3. **渐进模式滚动代价**——「prefetch 命中卡跳过 thumb」候选；或详情页同款 cacheReady 门控思路。
4. **#358 收尾记录**（review 留档）：prefetch 不触发 enforceCacheLimit；CI job 无 gradle 缓存（可加 actions/cache）；CACHE_DIR_NAME 常量双份；L1 命中 onDisplayLoad 断言 + 跨写方并发交错测试。
5. SolidJS 2.x 评估（T7，依赖升级线）。

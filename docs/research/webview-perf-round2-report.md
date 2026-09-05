# webview 性能二轮报告：T4 + T1 + X1 前后对比（#357）

> **【模拟器结论，不可直接外推真机】** 模拟器 pictelio_ui（Android 14 / WebView 113.0.5672.136，720×1280）。
> 基线 = 一轮改造后的 main（round2-baseline）；改造后 = 本分支 T4+T1+X1 全量（round2-after）。
> 原始 JSONL：`docs/research/webview-perf-bench-data/{round2-baseline,round2-after}/`。

## 0. 改造内容（已全部合入本分支，code-review 闭环零阻塞）

| 项 | 内容 | 关键文件 |
|---|---|---|
| T4 | feed Query 持久化：手写 Persister + localStorage（唯一新依赖 `@tanstack/query-persist-client-core@5.101.4`），9 个 feed key、debounce 5s、maxAge 7d、buster tq-feed-v1、配额梯子 | `feedQueryPersist.ts` + `main.tsx` + `authStore.ts` |
| T1 | 缩略图→原图渐进：`createProgressiveImage` 原语；首页卡双层 img（thumb=medium）；NovelRowCard 降档 square_medium；PixivImage 增量 thumbSrc；**预取 key 失配修复**（pickListImageUrl 收敛三处） | 8 组件 + 1 原语 |
| X1 | 拦截链：**F1 根因修复**（磁盘命中被注入 no-store → 补 immutable 头）；32MB 内存字节 LRU（下载/prefetch/异步回填三填充点）；PerfLog telemetry；ImageIntercept 抽取消灭 full/webview flavor 重复 | 6 Java 文件 + bench intercept 探针 |

门禁：vitest 121 文件 / 1219 用例全绿 · Java testFull 109 用例 0 failure · lint 0/0 · tsc 通过 · code-review 双轴复检 **阻塞 0**（修复 S-1 响应头防线 / S-2 logout 空快照回写 / S-3 圆角裁剪 / S-4 回退链）。

## 1. T4 —— 冷启动（主指标）

| 指标 | 基线 | 改造后 | Δ |
|---|---|---|---|
| **coldstart 首屏卡片就绪 P50** | **4261ms** | **2124ms** | **-50.2%** |
| coldstart 逐组 | 4261 / 4715 / 4145ms | 2182 / 2104 / 2175 / 2124 / 2081ms | 5 组全部 <2.2s，方差极小 |
| 就绪时已有图片数 | 84~86 | **161**（5 组一致） | 首屏可渲染图片 +92% |

机制：feed 数据从 localStorage 恢复（SWR 后台重验），feed API RTT 移出首屏关键路径；下限=auth RTT（本轮不动 auth）。**这是本轮最大的单项感知提升。**

## 2. X1 —— 拦截链（首次拿到硬数字）

| 指标 | 基线 | 改造后 |
|---|---|---|
| 拦截器调用总数（一次完整冷会话+3 fling） | 无数据（每次渲染必进，估数百次） | **27 次**（cold 27 + scroll 27 中同 URL 去重后实际极低——L2 接管重复视图） |
| hit durationMs p50 / p90 / p99 | 无数据（估 3-4ms，诊断 B1） | **0 / 1 / 8ms**（cold）；**0 / 1 / 3ms**（scroll） |
| src=mem / disk 分布 | — | disk=27，mem=0（默认 browserCacheEnabled=true 下 L2 接管了重复视图；内存 LRU 服务「关闭浏览器缓存」用户与 prefetch 热路径） |
| miss / err | — | 采样窗口内 0 次 |

F1 修复的直接证据：全会话仅 27 次拦截（此前每次图片渲染都要走一次 stat+open），命中耗时从毫秒级到 p50=0ms。

## 3. T1 —— 图片渐进加载

| 指标 | 基线 | 改造后 | 解读 |
|---|---|---|---|
| imgready cold durP50（3 组） | 49/37/30ms | **28/35/10ms** | 首个可见资源（缩略图）更快到达，p50 -24% |
| imgready cold durP90 | 50/42/31ms | 188/213/223ms | **符合渐进设计**：原图（large）在缩略图之后完成，p90 捕捉到的是 full 下载时长——用户先看到图（thumb），高清在 ~200ms 内补齐 |
| imgready scroll durP50 | 3/4/3ms | 4/4/4ms | 持平 |
| **首页 Feed 滚动 jank / P99** | **3.0% / 22.0ms** | **4.4% / 28.8ms** | **T1 的代价**：首页卡恒挂双层 img（thumb 常驻兜底），每卡多一层解码与合成。仍优于一轮前基线（3.59%/33.6ms） |
| 次级 Feed jank / P99 | 2.8% / 22.2ms | 2.5% / 20.4ms | 持平略优（该路径已有 blur-up，未受双层影响） |
| 小说详情 jank / P99 | 2.8% / 21.9ms | 2.8% / 22.5ms | 持平 |

**权衡结论**：T1 用首页滚动 +1.4pp jank（仍低于一轮改造前的 3.59%）换取冷启动图片首现 -24%、小说封面字节 -90%（square_medium）。**后续优化候选**：full 成功加载后卸载 thumb 层（保留 onError 恢复逻辑），可消除常驻双层的合成成本。

## 4. 路由切换（3 手势小样本，噪声带内不定性）

| 指标 | 基线逐组 | 改造后逐组 |
|---|---|---|
| switch forward jank | [0, 100, 0]% | [0, 100, 100]% |
| switch forward p99 | 6.3 / 17 / 11.4ms | 3.7 / 17 / 17ms |
| switch back jank | [0, 33, 33]% | [0, 100, 0]% |
| switch back p99 | 15.7 / 20.3 / 16.8ms | 5.0 / 23.1 / 15.5ms |
| scroll 恢复 | 3/3 | 3/3 |

间歇性 100% jank 组在基线与改造后均出现（每样本仅 ~10 帧，1-2 帧超时即 100%），p99 量级持平。**维持上轮结论：需加密采样才能定性，非本轮回归信号。**

## 5. 汇总

| 用户目标 | 结果 |
|---|---|
| T4 冷启动 | ✅ **-50.2%**（4261→2124ms），五组方差 <100ms |
| X1 拦截链 | ✅ F1 根因修复生效（全会话 27 次拦截、hit p50 0ms）；内存 LRU 作为关缓存路径兜底 |
| T1 渐进加载 | ✅ 冷启动首图 -24%、小说封面 -90% 字节；⚠️ 代价首页滚动 +1.4pp（仍优于一轮前），已列卸载 thumb 优化候选 |
| 无回归底线 | ✅ 次级 Feed/小说详情/输入排队（全 0）/滚动恢复 全部持平或略优 |

**code-review**：双轴审查（调用点完备性 + oracle/test strength）发现 1 阻塞（S-1）+ 2 P2 + 4 P3，全部修复并复检至 **阻塞 0、可合并**；新增防线：ImageIntercept 头规则测试、logout suppress 时序测试、overflow-hidden/decoding 断言。

## 6. 已知残留（记录性，均不阻塞）

1. logout 后在途 mutation 的空载荷键复活（review 复检新发现 P3，无数据泄漏，载荷恒空）。
2. S-5 图床开启时 prefetch 填充 key 不一致（mem-miss，仅优化损失）；S-6 磁盘缓存关闭路径仍写内存缓存（可辩解偏差）。
3. 首页 thumb 层常驻的合成成本 → 卸载 thumb 优化候选。
4. switch/back 导航 jank 定性需加密采样。

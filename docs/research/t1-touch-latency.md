# T1 触摸→JS 回调时延（真机 OPPO R11s，2026-09-02）

> 票：#312（父地图 #304「Lynx 滚动跟手性追平 webview」）
> 目的：为 H5（双线程跨线程派发延迟地板）提供直接测量；方案选型（#310/#311）的前置验证。
> **结论速览：真机实测触摸→JS 回调（touchstart → 首个 touchmove 到达 JS）lynx 中位 48ms（40–61，P90 58）vs webview 中位 30.5ms（25–43，P90 41）——lynx 的跨线程派发链比 webview 慢 1.6×、至少慢 2 帧（16.7ms/帧），且样本下限（40ms）仍高于 webview 中位。H5 证实存在「架构固有地板」。**

---

## 1. 方法

- **测量定义（双端同义）**：touchstart 事件到达 JS 的时刻 t0 → 首个 touchmove 事件到达 JS 回调的时刻 t1；`latency = t1 - t0`（Date.now()，双端同一 JS 时钟语义）。
- **场景**：小说正文（/novel/:id，用户主诉场景；lynx novel=点击首卡进入、webview=搜索点击 29026842）；注入 = `input swipe 600ms`；每端 8 次采样（组间回顶）。
- **lynx 实现**：`NovelDetail.vue` 根 view 的 `@touchstart`/`@touchmove` 插桩（节流一条/拖动）→ `console.log("[BENCH_T1] stage ...")` → logcat `lynx_console`。
- **webview 实现**：CDP 注入单行脚本（document touchstart/touchmove listener）→ `Capacitor/Console` tag → logcat。
- **重要实证（本轮新发现）**：
  1. 真机（OPPO R11s）**scroll-view 的 `@scroll` 也不派发**（此前 ADR 只实证 `<list>` 裁剪；本机 scroll-view 同裁）。追更进度「≥70%」信号在真机实际依赖 `@scrolltolower` 兜底（双路设计内建，功能不死但依赖降级路径）。
  2. webview 的 rAF 观测法**不可用**（合成器滚动不等待主线程，rAF 观测滞后 76ms 高估）——改用事件回调同义测量。
  3. UiAutomation `injectInputEvent` + framestats 对齐法：**双端时间戳域不可靠**（模拟器/真机 framestats 原始时间戳与 uptime 域差 6 倍/不可映射，Android 9 老格式尾列还是 duration 非时间戳）→ 放弃，仅保留注入器为未来设备备选。

## 2. 结果

| 指标 | lynx（8 样本） | webview（8 样本） |
| --- | --- | --- |
| 样本（ms） | 40, 48, 57, 48, 56, 61, 44, 50 | 28, 31, 33, 30, 26, 43, 41, 25 |
| 中位 | **48.0** | **30.5** |
| P90 | 57.6 | 41.8 |
| 最差 | 61 | 43 |
| 最好 | 40 | 25 |

## 3. 解读（哪些跟手感被解释、哪些没有）

- **H5 证实**：lynx 触摸事件「触达 JS」存在 **≥ 40ms 的下限地板**（≈2.4 帧 @60Hz），比 webview 慢 1.6×。对应官方定性（跨线程 + 延迟 unpredictable）——**真机坐实**。
- **适用的体感场景**：一切**需要 JS 实时响应触摸**的交互——按压态/涟漪、JS 驱动的动画（如推荐轮播的 translateX 跟手、收藏动画反馈）在这层会「慢半拍」；**推荐轮播的跟手性问题由此可获得机因（待真机人工校验轮播手感，迷雾区观察项）**。
- **原生滚动的列表/小说正文**：内容位移由原生 UI 线程承载（不经此 48ms 链）——它们的「不跟手」不来自本指标，而来自 **T0 帧负载差**（小说正文 jank 14.2% vs 3.4%、插画 feed 16.8% vs 8.8%；差距在长尾脉冲段，H1/H3 签名）与 UI 线程承压（触摸处理与渲染同线程）。**两层测量合并画像：帧负载是主因，48ms 跨线程地板是附加项（对 JS 驱动交互是硬地板）。**
- **方案含义**（交接 #310/#311）：任何「JS 逐帧驱动内容跟随」的优化在 lynx 上会被 48ms 地板抵消；优化应聚焦**降低原生侧帧负载**（cell 回收/翻页脉冲/图片策略）或**绕开 JS 驱动正路**（原生滚动由原生承载——保持现状即最优）。MTS 逃生门不可用（ADR-0115）→ 该地板在 SDK 层面无解，仅当 SDK 升级/修复（vue-lynx #302 跟踪）后重评。

## 4. Caveats

- 采样 8/端（设备当日状态；webview 端内容为搜索进入的 29026842，lynx 端为关注推荐首卡——内容不同但本测量只关心事件链，不依赖内容量）。
- Date.now() ms 级精度（无纳秒）；两端同定义可比。
- 注入手势为 `input swipe`（合成触摸），与真手指在派发链上的差异不确定（系统注入 vs 硬件路径可能略有差——量级判断可信）。
- 本插桩为 bench 分支代码（NovelDetail.vue 无条件 + 节流），**生产构建仍含（一行/拖动 log）**——仅存 bench 分支，不合并 main。

## 5. 交付物

- 原始数据：`docs/research/t1-data/t1_{lynx,webview}_novel-detail.jsonl`
- 工具：`bench-scroll.mjs` `t1` 子命令（双端自动导航+插桩+采集）；`BenchInputInjectorTest.java`（备选注入器）；`t1-video.py`（video 参考通道，模拟器录屏产物无效已放弃）
- 分支：`bench/scroll-t0-306`（本次提交包含本报告）

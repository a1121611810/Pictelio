# 列表场景滚动跟手性根因假设清单（RefreshableList 系：插画 waterfall + 小说 single）

> 日期：2026-09-01
> 票：#308（父地图 #304「Lynx 滚动跟手性追平 webview」）
> 方法：全部一手来源——仓库内 ADR / research 文档 / 源码（codegraph 取径）、vue-lynx 上游 issue、lynxjs.org 官方文档（WebFetch 取径，原文引用标注）；**无臆测条目，每条标注证据来源与「文献已证 / 待 bench 数据验证」状态**。
> 范围：app-lynx 的 RefreshableList 系列表场景——插画 waterfall `<list>`（`IllustList.vue`）与小说 single `<list>`（`NovelList.vue`）为代表；小说详情正文滚动另有专票，不在本文。
> 下游衔接：验证实验依赖 #305（基准方法学）/ #306（bench 搭建与首份基线）产出的量化尺子；本文第 4 节给出每个假设的证伪设计。

---

## 0. 痛点形态与时延构成模型

**痛点形态**（用户 2026-09-01 确认，#304）：**触摸响应延迟**——手指动了内容慢半拍。领域词典定义（`packages/app-lynx/CONTEXT.md`「滚动跟手性」词条）：分解为触摸响应延迟（手指移动→内容开始移动的时延）、帧跟随一致性（掉帧导致滞后/跳跃）、惯性曲线自然度三轴；对照基准 = webview 客户端同设备同内容。

**列表滚动的时延构成模型**（用于归因分析，每段标注管辖线程）：

```
手指触摸屏幕
  → [段A] 原生触摸派发 → 原生滚动容器位移（Android: RecyclerView/UIListAdapter，纯原生，不经 JS）
  → [段B] 新进入视口的 cell 物化：引擎 componentAtIndex 回调
       → BG 线程（Vue 组件创建 + v-for diff）→ ops 跨线程下发
       → MT 线程（__AppendElement + __FlushElementTree + 布局）
  → [段C] MT 线程逐帧工作：元素树 layout / draw（含触摸事件处理本身的帧预算）
  → [段D] 图片链路：lazy-load 触发 → 下载/解码（自研 ILynxImageService 线程池）→ bitmap 交付上屏
  → 内容上屏（人眼感知"跟手"的终点）
```

关键架构事实（上游文献）：

1. **Lynx 双线程**：MT = "Native elements · layout · rendering · Main Thread Script"；BT = Vue reconciliation（"Vue runs on the background thread; the main thread handles native rendering"，vue-lynx introduction.mdx，转引自 `docs/research/vue-lynx-deep-dive.md` §1.2）。
2. **事件默认走 BT，存在跨线程延迟**（lynxjs.org `guide/interaction/event-handling.html`，2026-09-01 取径）：BT 适用于 "When timely event response is not required"；MT 处理 "can avoid event delays caused by cross-threading"。
3. **官方对延迟形态的定性**（lynxjs.org `react/main-thread-script.html`，2026-09-01 取径）："events are triggered on the main thread, while regular JS event handlers can only be executed on background threads"；"the event trigger -> event handling -> rendering process will involve multiple thread switches"，结果是 "untimely responses and animations lagging behind gestures"；且延迟 "unpredictable"、低端设备更差、"will also increase as the complexity of the page increases"。
4. **官方逃生门 = Main Thread Script**（`main-thread:bind*` 同步 MT 处理事件）——但**本项目不可用**：ADR-0115 真机实证（emulator-5556，原生 SDK 4.0.1）main-thread 触摸绑定导致推荐页整块空白，移除即恢复（另见 `docs/research/vue-lynx-swiper-tutorial.md`「真机验证结论」）。
5. **段A 不经 JS**：`<list>` 滚动由原生容器驱动（Android `UIList extends AbsLynxList<RecyclerView>`，见 `docs/research/vue-lynx-masonry-feasibility.md` §14.1）。**因此"手指动了内容慢半拍"的直接嫌疑不在触摸→位移的派发本身，而在段B/段C/段D 对 MT 帧预算的挤占**——这是本文假设排序的第一性原理。

对照基准（webview 侧，冻结不动）：`packages/app/src/primitives/createFeedVirtualizer.ts`——TanStack Virtual 窗口虚拟化，DOM 恒为视口 + overscan 2（约 10–18 卡片），内存曲线 ≈ 常数；滚动监听是 window scroll（per-frame 可得），图片链路有 L1 已加载标记 + 浏览器调度。

---

## 1. 假设清单（按疑似贡献度排序）

### H1｜list cell 回收 no-op（vue-lynx #302）→ MT 元素树随滚动单调增长，逐帧 layout/draw 成本膨胀

**疑似贡献度：最高。状态：机制存在性文献已证；对跟手性的定量贡献待 bench 验证。**

**机制**：

- vue-lynx 框架侧 cell 回收是 no-op：`list-apply.ts` 中 `enqueueComponent` 即 `function enqueueComponentNoop(): void {}`，带显式注释 "No-op: element recycling tracked in #302"（上游 issue [Huxpro/vue-lynx#302](https://github.com/Huxpro/vue-lynx/issues/302)，2026-07-20 创建，0 comments，无 PR）。
- 回收分两层（#302 body + masonry 报告 §2/§14.3）：**原生层回收正常**（Android RecyclerView 回收原生 view）；**缺的是框架层 MT 元素树回收**——ReactLynx 有 `gRecycleMap` + hydrate 复用，vue-lynx 滚过的 cell 的 MT 元素树**永久存活**。
- 后果：滚动越深，MT 侧存活的元素/布局节点越多（段C 的遍历规模单调增长）→ 帧时长上升 → 触摸采样与首帧响应被推迟。与"越翻越卡、慢半拍逐渐明显"的体感形态吻合。
- BG 侧同源加重：vue-lynx 对 `<list>` 的 v-for 为**全部已渲染 item** 创建 Vue 组件实例（`node-ops.ts` 无条件创建），BG 堆也随数据量线性增长（5k 条约 5–20MB JS 堆估算，50k 崩溃实测）。

**证据来源**：`docs/research/vue-lynx-masonry-feasibility.md` §2（#302 状态 + 内存曲线推导）、§9/§10（Web 端 5k 可用 / 50k 崩溃实测）、§14.7（vue-lynx 侧 BG 全量 / MT 惰性 / 回收 no-op 的源码定位）；上游 issue #302。

**与对照组的差距形态**：webview 侧 DOM 节点数恒定（视口+overscan），Lynx 侧 MT 元素树单调增长——差距是**滚动深度的函数**，这是 H1 的可证伪签名。

**证伪方法（E1 滚动深度扫描）**：同设备同内容，分别在浅滚动（0–200 条）与深滚动（1000–1500 条）区间测主指标（触摸位移→内容首帧位移时延）+ 辅指标（帧时长分布 / jank 率）+ 原生内存（`dumpsys meminfo`）。
- H1 主导签名：延迟/jank/内存随滚动深度**显著单调劣化**；webview 对照同区间无劣化。
- 若延迟与滚动深度无关 → H1 降级（存在但非跟手性主因）。
- 注意区分：H1 是**渐进函数**（与翻页事件无关的持续劣化），H3 是**脉冲函数**（翻页时刻突发）——时间轴对齐即可分离。

---

### H2｜`<list>` 无 per-frame scroll、无 JS 滚动属性 → 优化信号盲区，应用层无法做滚动驱动的自适应降级

**疑似贡献度：高（作为"放大器/约束"，非独立根因）。状态：文献已证（本项目 T-spike 实证）。**

**机制**：

- ADR-0110 T-spike（四色探针，2026-08-24，原生 SDK 4.0.1 模拟器实证）：**`<list>` 对 JS 派发的滚动事件仅 `load` / `scrolltolower` / `scrolltoupper`（边界事件）**；`@scroll` / `@scrollend` / `@scrollstatechange` + `scroll-event-throttle="100"` 四路全测零派发。字节码佐证：`LynxListEvent.EVENT_SCROLL` 常量存在但受 `mEnableScrollEvent` 门控；per-frame scroll 是 scroll-view 的特性，list 事件面被裁剪。
- **文档与现实的分歧**（诚实标注）：上游官方文档（lynxjs.org `api/elements/built-in/list.html`，2026-09-01 取径）声称 `<list>` 有 `scroll` 事件、`scroll-event-throttle` "By default, the scroll event is called back every 200 ms"、`scrollstatechange` 四态。本项目实证在 4.0.1 上为零派发——**以本地实证为准**（ADR-0110 已裁定），该分歧本身值得 SDK 升级评估票复核。
- 后果：JS 层拿不到滚动位置/速度/方向 → 无法实现 webview 侧等价的"快速滚动时降载"策略（收缩 overscan、推迟图片、暂停动图）→ H1/H3/H4 的伤害无法被应用层缓解。同时 JS 侧无 `scrollTop` 类属性（ADR-0110 平台事实③），连"查询式"补偿也没有。
- 次生约束：原生桥补 scroll 信号 = per-frame bridge，违背 ADR-0106 已否决的性能反模式（"每帧高频 bridge 事件，性能否决"）；地图边界又预排除原生介入——**盲区在当前边界内无解，只能等 SDK 升级或绕开**。

**证据来源**：`docs/adr/ADR-0110-lynx-back-to-top-persistent.md`（平台事实实证）；`packages/app-lynx/src/components/RefreshableList.vue` 头注释（平台事实②③）；lynxjs.org list.html（官方声称面）；`docs/adr/ADR-0106-lynx-pull-to-refresh.md`（per-frame bridge 否决先例）。

**证伪方法**：不独立测量（盲区不产生延迟，它封杀缓解）。处置方式：作为修复方案设计的首要约束记录在案；间接验证点 = SDK 升级评估票若证实新版本 scroll 事件可用，盲区即破，H4 的"速度感知降载"类方案才成立。

---

### H3｜createMixFeed 分批渲染（pageSize=20）+ 页面 sync() 全量数组替换 → 每次翻页在 BG 做 O(N) 全量 diff、向 MT 突发 flush 20 棵卡片子树，N 随滚动增长

**疑似贡献度：高。状态：机制代码级已证；对跟手性的贡献待 bench 验证。**

**机制链**（逐环有源码坐标）：

1. 触发：`<list lower-threshold-item-count=2>`（waterfall，2 列即剩 1 行触发）/ `=5`（single）→ `@scrolltolower="loadMore"`（`IllustList.vue:188-197`、`NovelList.vue:176-183`）。**阈值贴底 → 快速甩动时翻页突发恰好落在拖拽中段**。
2. 双防抖：`fetchMore()` 入口冷却 3000ms + 节流 800ms + 一次性补触发 timer（`createMixFeed.ts:289-308`）。**澄清误归因点**：防抖本身是 O(1) 时间戳比较，不占 JS 线程；真正的负载在下一步。防抖对跟手性的真实影响是**把负载推迟到手势进行中**（甩动开始后 800ms–3s 才追加数据），而非消除负载。
3. 消费：优先同步消费 pending 队列 `rendered.push(...pending.splice(0, 20))`（无网络），耗尽才网络翻页（`createMixFeed.ts:319-322, 377-394`）。
4. 页面快照桥接：`sync()` 执行 `illusts.value = feed.value.items().map(...)`——**整个数组换新引用**（`IllustList.vue:57-69`、`NovelList.vue:52-64`）。
5. Vue keyed v-for diff O(N) + vue-lynx list adapter LIS diff（PR #292 重写后）→ ops 跨线程 → MT `__AppendElement + __FlushElementTree` 物化 20 棵卡片子树（waterfall 卡含图片/徽章/两行文本/收藏按钮，single 卡含标题/作者/元信息/3 标签）。
6. **N 单调增长**：`rendered` 只增不减（refresh 才清零），每次翻页的 BG diff 成本是已加载总量的线性函数——深滚动时翻页脉冲越来越重，与 H1 叠加（H1 加重段C，H3 加重段B）。

**证据来源**：`packages/app-lynx/src/primitives/createMixFeed.ts`（fetchMore/pending/双防抖/补触发）；`IllustList.vue` / `NovelList.vue`（sync() 全量替换 + list 属性）；`docs/research/vue-lynx-masonry-feasibility.md` §0/§14.7（list adapter 现状与 BG 全量创建）。

**证伪方法（E2 翻页脉冲对齐）**：bench 采样中打标记（console.timeStamp / logcat）记录 `fetchMore` 起止与 `sync()` 完成时刻，与帧时间轴对齐：
- H3 签名：`scrolltolower` 后 1–3 帧出现显著帧时长脉冲，且脉冲幅度随已加载条数（N）增长；短列表（N<40，不触发翻页）滚动全程无脉冲。
- 对照实验：同一 feed 分别测「翻页触发瞬间」vs「纯滚动无翻页区间」的帧时长分布，差值即 H3 贡献。
- 若脉冲存在但不随 N 增长 → diff 成本非主因（O(N) 签名不成立），降级为"20 卡 flush 常量成本"。

---

### H4｜图片加载策略（lazy-load + 数据分批）在快速甩动下的表现：批量入视口触发并发下载/解码，且无速度感知

**疑似贡献度：中。状态：链路代码级已证；快速甩动下的实际伤害待 bench 验证。**

**机制**：

- 现状策略（ADR-0060）：列表卡片 `<image lazy-load>`（真机引擎级懒加载，进视口附近才请求，决策 1）+ 数据分批 PAGE_SIZE=20（web-core 图片风暴兜底，决策 2，真机无副作用）。`SkeletonImage → CoverImage → <image :lazy-load>` 透传链（`SkeletonImage.vue:24-32`、`CoverImage.vue:140-149`）。
- 真机图片链路：**自研 `PictelioImageService`（ILynxImageService）**，非 Fresco——`build.gradle:242` 注释："图片服务（lynx-service-image/Fresco）不引入——i.pximg.net 需 Referer 头，Fresco 默认不传 customParam 为 header（403），自研 ILynxImageService（#54）"。实现要点：OkHttp 下载、`Executors.newCachedThreadPool()`（**无线程数上限**）、`ImageMemoryCache` 64MB LRU（`width*height*4` 计费）、解码采样上限 2048×2048。
- 快速甩动下的风险形态：大量 cell 同帧进入视口 → lazy-load 批量触发 → cachedThreadPool 并发下载/解码 → 解码后 bitmap 交付发生在 MT/UI 侧（段D 终点），与段C 共享帧预算；同时**无速度感知**（H2 盲区的直接后果）——webview 侧常见的"高速甩动时跳过/推迟图片"策略在 Lynx 侧无信号可实现。
- 对冲因素（诚实标注）：lazy-load 本身已是引擎级按需；64MB LRU + 磁盘缓存使命中路径免下载免解码；缩略图（square_medium 级）单张解码成本有限。因此疑似贡献低于 H1/H3。
- 对照 webview：`PixivImage` + `imageLoader.ts`（L1 已加载标记 LRU + 飞行中去重 + 浏览器自有调度）+ 虚拟滚动常数 DOM——滚动中图片压力恒定且有浏览器级动图片调度。

**证据来源**：`docs/adr/ADR-0060-lynx-feed-image-lazy-loading.md`；`packages/app-lynx/src/components/{SkeletonImage,CoverImage}.vue`；`packages/app/android/app/src/lynx/java/io/pictelio/app/PictelioImageService.java`（线程池/缓存/采样上限）；`packages/app/android/app/src/main/java/io/pictelio/app/ImageMemoryCache.java`（64MB LRU）；`packages/app/android/app/build.gradle:242`（自研服务缘由注释）。

**证伪方法（E3 冷热图对照）**：同设备同路径滚动两遍——第一遍冷图（清磁盘缓存后）、第二遍热图（图片已入 64MB LRU/磁盘缓存）：
- H4 签名：冷图遍的主指标与 jank 率**显著劣于**热图遍；帧时长脉冲与图片交付时刻对齐（可用 `PictelioImageService` logcat 标记）。
- 若两遍差异不显著 → 图片链路非瓶颈（缓存对冲成立），H4 降级。
- webview 对照组天然提供"成熟图片调度下该场景应达到什么水平"的参照系。

---

### H5｜Lynx 双线程触摸事件派发路径：触摸在 MT 触发、JS 处理在 BT 的跨线程往返是架构固有延迟，且 MTS 逃生门在 SDK 4.0.1 实证不可用

**疑似贡献度：高（结构性背景，"延迟地板"候选解释）。状态：文献已证（上游官方文档 + 本项目真机实证）；本项目列表场景的定量贡献待 bench 验证。**

**机制（触摸 → 引擎滚动 → JS 渲染的时延构成，对应第 0 节模型）**：

- **段A（触摸→原生位移）不经 JS**：`<list>` 滚动由原生 RecyclerView 驱动，纯原生路径。这意味着"内容跟随手指"的基础位移理论上无 JS 延迟——**若实测短列表仍有延迟地板，则指向引擎触摸派发/合成路径本身（段A/段C 的原生侧），属地图边界（原生介入预排除）之外的事实，需记录并上升用户拍板**。
- **段B（新 cell 物化）是跨线程链路**：`componentAtIndex` 是引擎调 BT 的 JS 回调 → BG Vue 组件创建 → ops 下发 → MT flush（`vue-lynx-masonry-feasibility.md` §14.2/§14.7）。滚动越快，单位时间物化请求越多，BT↔MT 往返越密集。
- **段C 的线程竞争**：MT 同时承担 native elements 的 layout/rendering（含触摸事件处理）与 ops flush——H1（元素树膨胀）与 H3（突发 flush）的工作量直接挤占触摸处理所在线程的帧预算。这是"渲染线程繁忙"与"触摸响应延迟"在本架构下的耦合点。
- **手势类交互走 BT 的官方定性**（`react/main-thread-script.html` 原文，2026-09-01 取径）："events are triggered on the main thread, while regular JS event handlers can only be executed on background threads"；"the event trigger -> event handling -> rendering process will involve multiple thread switches"，"resulting in untimely responses and animations lagging behind gestures"；延迟 "unpredictable"、"will also increase as the complexity of the page increases"。
- **逃生门已实证关闭**：官方解法 MTS（`main-thread:bind*` 同步 MT 处理）在原生 4.0.1 真机导致整页空白（ADR-0115；`docs/research/vue-lynx-swiper-tutorial.md`「真机验证结论」）。事件修饰符层面 `.prevent` 为兼容 no-op（vue-lynx 兼容矩阵，`vue-lynx-deep-dive.md`）。

**证据来源**：lynxjs.org `guide/interaction/event-handling.html` + `react/main-thread-script.html`（上游一手文档）；`docs/research/vue-lynx-deep-dive.md` §1.2（双线程模型转引）；`docs/adr/ADR-0115-app-lynx-recommended-carousel.md`（MTS 不可用实证）；`docs/research/vue-lynx-masonry-feasibility.md` §14（cell 物化链路源码坐标）。

**证伪方法（E4 短列表延迟地板实验——这是区分「触摸派发延迟」vs「渲染线程繁忙」的关键设计）**：

- 构造**静态短列表**（≤20 条、图片全预热、不触发翻页、无 #302 累积）——即剥离 H1/H3/H4 全部负载变量，只留架构固有路径：
  - 若此时主指标已显著高于 webview 对照 → **架构固有延迟（H5）有独立贡献**，"延迟地板"成立；
  - 若短列表延迟 ≈ webview、仅长列表/翻页/冷图场景劣化 → H5 贡献小，主因在 H1/H3/H4（渲染/物化繁忙）。
- 归因逻辑：**H5 预测"延迟地板恒定抬高"；H1/H3/H4 预测"延迟随负载变量（深度/翻页/冷图）增长"**。基线数据按两个模式分别拟合即可分离贡献。
- 补充信号：若 OPPO 真机的地板显著高于模拟器（官方文档定性"低端设备更差"），进一步支持 H5 的跨线程链路成分。

---

### H6（补充发现）｜`<list>` 未设 `estimated-main-axis-size-px` / `preload-buffer-count`：物化及时性与布局稳定性的应用层可调项

**疑似贡献度：低（对触摸延迟）；中（对"滚动中白 cell/物化不及时"观感）。状态：事实已证（代码 + 官方文档）；是否转化为跟手性贡献待 bench。**

**机制**：

- 现状核实（2026-09-01 读源码）：`IllustList.vue:188-197` 与 `NovelList.vue:176-183` 的 `<list>` **均未设** `estimated-main-axis-size-px` 与 `preload-buffer-count`。
- 官方文档（lynxjs.org list.html，2026-09-01 取径）：`estimated-main-axis-size-px` 设主轴占位尺寸，"strongly recommend" 接近真实尺寸；`preload-buffer-count` 控制视口外预加载节点数（"The larger the value … the more off-screen nodes can be preloaded"，代价是内存；推荐一屏；**仅 single/flow 有效，waterfall 不支持**）。
- 影响方向：缺估算尺寸 → 引擎对未物化 cell 无先验占位，快速滚动时布局校正与新 cell 物化更仓促（段B 压力前置到手势中段）；小说 single 列表本可用 `preload-buffer-count` 把物化提前到视口外，waterfall 插画列表无此杠杆。卡片实际高度可估（插画卡 = 48.4vw 方图 + 固定文本区；小说卡单行高约 168px 量级，PoC 已用过 168 作 estimated 值）。
- **边界声明**：本条更偏"修复方案候选"而非独立根因；列入清单是因为它是 H1/H3 的少数**应用层可动对冲杆**（不依赖 #302 / SDK 升级）。

**证伪方法**：E1/E2 基线中附带观察"滚动中白 cell（骨架未填）出现频率"；若白 cell 高频且与物化时刻对齐，本条升级为方案候选，交方案选型票处理（不属本票结论范围）。

---

## 2. 排序理由汇总

| 排名 | 假设 | 排序理由 |
|---|---|---|
| 1 | H1 回收 no-op | 唯一已被实测证明"随滚动单调劣化"的机制（两端内存曲线已证）；作用面 = MT（与触摸处理同线程）；与"越翻越卡"体感最吻合；应用层不可修（框架缺口 #302），必须通过 SDK/方案决策处置 |
| 2 | H5 双线程派发 | 文献已证的架构固有延迟 + 逃生门实证关闭；是"延迟地板"的候选解释；但预测形态是恒定地板而非渐进劣化，单独解释力不完整，需 E4 实验判定其份额 |
| 3 | H3 分批渲染/diff | 代码级确定的脉冲负载（O(N) diff + 20 卡 flush），且被防抖推迟到手势中段；单次脉冲规模有限（20 卡），需 E2 定量；与 H1 正交叠加 |
| 4 | H2 信号盲区 | 不直接产生延迟，但封杀全部应用层缓解路径（速度感知降载）；作为"根因"排第四，作为"修复约束"排第一；实证强度最高（T-spike 直接裁定） |
| 5 | H4 图片加载 | lazy-load 已是引擎级最优姿势，64MB LRU + 磁盘缓存 + 2048 采样上限有对冲；冷图脉冲存在但疑似贡献最低，E3 冷热对照可直接判 |
| 6 | H6 估算/预加载缺失 | 应用层可调对冲杆，主要影响物化及时性观感；列末位，交方案票 |

## 3. 验证方法总表（基线数据出来后的证伪设计）

| 实验 | 验证假设 | 关键变量 | H 成立的签名 | 证伪条件 | 指标来源（#305/#306 的尺子） |
|---|---|---|---|---|---|
| E1 滚动深度扫描 | H1 | 滚动深度（浅 0–200 vs 深 1000–1500 条） | 延迟/jank/内存随深度单调劣化；webview 无劣化 | 延迟与深度无关 | 主指标（触摸→首帧位移时延）+ gfxinfo 帧时长 + dumpsys meminfo |
| E2 翻页脉冲对齐 | H3 | 翻页事件时刻 vs 无翻页区间；N（已加载条数） | scrolltolower 后 1–3 帧脉冲，幅度随 N 增长 | 无脉冲，或脉冲与 N 无关 | 帧时长分布 + fetchMore/sync logcat 标记对齐 |
| E3 冷热图对照 | H4 | 图片缓存状态（冷 vs 热） | 冷图遍延迟/jank 显著劣于热图遍 | 两遍差异不显著 | 主指标 + jank 率 + PictelioImageService logcat |
| E4 短列表延迟地板 | H5（并归因 H1/H3/H4 份额） | 剥离全部负载变量（≤20 条/热图/无翻页） | 短列表延迟已显著高于 webview → 架构地板成立 | 短列表延迟 ≈ webview → 地板不成立，主因在负载侧 | 主指标绝对值双端对照 |
| E5（附带观察） | H6 | 白 cell 出现频率 | 白 cell 高频且与物化时刻对齐 | 白 cell 罕见 | 慢动作录屏 / 帧内容抽帧 |

**归因速查**：「触摸派发延迟」vs「渲染线程繁忙」的区分 = **E4 测地板、E1/E2/E3 测斜率**。地板高 → H5；斜率陡 → H1（深度斜率）/H3（事件脉冲）/H4（缓存状态）。

## 4. 对下游票的要求（交接说明）

- **#306 bench 设计请覆盖 E1–E4 四个实验面**（E5 附带即可）；内容 fixture 需支持"深度扫描"（≥1500 条数据集）与"冷热图"两种状态控制；双端同设备同内容同路径。
- **采集标记需求**：app-lynx 侧在 `createMixFeed.fetchMore`/`sync()` 加 logcat/console.timeStamp 标记（纯 tooling，不属功能改动）；原生侧标记（如需 FrameMetrics 桥）是否越界由 #305 裁定。
- **SDK 升级评估票**：请顺带复核上游文档声称的 `scroll`/`scroll-event-throttle`/`scrollstatechange` 在新版本是否真实派发（本项目 4.0.1 实证零派发，与官方文档矛盾）——若可用，H2 盲区解除，H4 类"速度感知降载"方案才成立。
- **边界提醒**：E4 若证实地板在原生触摸派发/合成路径（段A/C 原生侧），处置超出"应用层优化"边界，须按地图规则上升用户拍板。

---

## 5. 证据来源索引（全部一手，可核验）

**仓库内**：
- `docs/research/vue-lynx-masonry-feasibility.md`——§2/§9/§10/§14（#302 回收 no-op、内存曲线实测、componentAtIndex/enqueueComponent 源码坐标、Web 端物化差异）
- `docs/adr/ADR-0110-lynx-back-to-top-persistent.md`——`<list>` 无 per-frame scroll / 无 JS 滚动属性（T-spike 实证）
- `docs/adr/ADR-0060-lynx-feed-image-lazy-loading.md`——lazy-load + 数据分批策略与双端差异
- `docs/adr/ADR-0115-app-lynx-recommended-carousel.md`——MTS/main-thread 绑定在原生 4.0.1 不可用（真机实证）
- `docs/adr/ADR-0106-lynx-pull-to-refresh.md`——per-frame bridge 事件性能否决先例
- `docs/research/vue-lynx-deep-dive.md`——§1.2 双线程模型、事件修饰符兼容矩阵
- `docs/research/vue-lynx-benchmark-ifr.md`——IFR 是首帧杠杆非交互杠杆；交互杠杆在 Vapor/主线程方案
- `packages/app-lynx/src/primitives/createMixFeed.ts`——分批渲染/双防抖/补触发（L81-436）
- `packages/app-lynx/src/pages/IllustList.vue` / `NovelList.vue`——`<list>` 属性面（waterfall/single、threshold、无 estimated/preload）与 sync() 全量替换（L57-69 / L52-64）
- `packages/app-lynx/src/components/RefreshableList.vue`——头注释平台事实①-④
- `packages/app-lynx/src/components/{SkeletonImage,CoverImage}.vue`——lazy-load 透传链
- `packages/app/src/primitives/createFeedVirtualizer.ts`——webview 对照（TanStack Virtual、overscan 2、window scroll）
- `packages/app/android/app/src/lynx/java/io/pictelio/app/PictelioImageService.java` + `app/src/main/java/io/pictelio/app/ImageMemoryCache.java`——自研图片服务（cachedThreadPool、64MB LRU、2048 采样上限）
- `packages/app/android/app/build.gradle:238-244`——Lynx SDK 4.0.1 锁定、自研 ILynxImageService 缘由
- `packages/app-lynx/CONTEXT.md`——「滚动跟手性」词条（三轴定义、验收双轨）

**上游**：
- lynxjs.org `guide/interaction/event-handling.html`——BT/MT 事件处理分工与跨线程延迟定性
- lynxjs.org `react/main-thread-script.html`——"events are triggered on the main thread, while regular JS event handlers can only be executed on background threads" / "untimely responses and animations lagging behind gestures" / 延迟随页面复杂度增加
- lynxjs.org `api/elements/built-in/list.html`——官方声称的 scroll 事件面（scroll-event-throttle 默认 200ms）、estimated-main-axis-size-px 建议、preload-buffer-count 约束（仅 single/flow）——与 4.0.1 本地实证矛盾处以本地实证为准
- GitHub `Huxpro/vue-lynx` issue #302——enqueueComponent no-op（0 comments，无 PR）

**工具路由记录**（自检）：架构/机制背景 = 仓库 research 文档 + ADR（本域无 openwiki 对应页，app-lynx 不在 openwiki 覆盖主题内）；代码理解 = codegraph_explore（RefreshableList/createMixFeed/IllustList/NovelList/CoverImage/createFeedVirtualizer 均经 codegraph 取径）；上游文档 = WebFetch（Context7 MCP 本环境不可用，按「文档查询规范」降级条款取官方站点一手页面）。

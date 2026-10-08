# 内容切换即时性：预取与 keep-alive 事实核查（#373）

Research 子代理产出 · wayfinder 地图 #371 · 2026-09-06
三个问题：① 空闲预取的 API 风险面（外部）② 面板 keep-alive 的 WebView 内存事实（外部）③ feedQueryPersist 与预取/keep-alive 的交互语义（本地代码）。

---

## 一、空闲预取其余 feed 的 API 风险

### 事实：Pixiv App API 的限流/配额

- **Pixiv 无任何公开的官方 API 配额数字**（app-api.pixiv.net 本就是逆向的私有 App API，官方不提供文档）。第三方生态唯一的通用节流信号是 **HTTP 429**："When a user gets an error 429, it usually means that the user has reached or exceeded his request quota for a certain period of time"。（PixivUtil2 issue #1157：https://github.com/Nandaka/PixivUtil2/issues/1157）
- **"overusage" 会被 throttle**：PixivUtil2 社区讨论重度滥用（24/7 连跑数日、批量抓数百作者）会被限，有用户以 **600s 请求间隔**规避（极端爬虫场景，非交互客户端量级）。（PixivUtil2 issue #477：https://github.com/Nandaka/PixivUtil2/issues/477）
- 社区爬虫实践推荐**请求间随机 1-3s 延迟**降低封禁风险；429 = rate limit exceeded。（Chaosyn Pixiv API 参考：https://blog.chaosyn.com/en/posts/pixiv-crawler-common-api-reference/）
- gallery-dl 实践指南：pixiv 在约 **200 次下载后开始封堵**，建议加请求间隔；gallery-dl 提供 `sleep-requests` / `download-delay` / 按域名令牌桶（`--http-bucket-capacity`/`--http-bucket-rate`）专门应对。（指南：https://pnt.jacbex.com/gallerydl.html；官方选项文档：https://github.com/mikf/gallery-dl/blob/master/docs/options.md）
- PixivPy 作者自述开发测试中"撞了 N 次 Rate Limit"（https://pypi.org/project/PixivPy/）。

### 事实：第三方开源客户端有无预取/并发策略先例

- **Pixez（Notsfsssf/pixez-flutter）**：未找到任何"多路 feed API 预取"的一手证据。最接近的是功能请求 issue #455——用户建议进入详情页/大图时**向后预加载图片**（CDN 层图片预取，非 app-api 数据层预取），属社区诉求而非已文档化策略。（仓库：https://github.com/Notsfsssf/pixez-flutter；issue #455：https://github.com/Notsfsssf/pixez-flutter/issues/455）其网络架构公开分析聚焦重试/令牌管理/直连（https://blog.csdn.net/gitblog_00113/article/details/159913881）。
- **gallery-dl / PixivUtil2 / pixivpy** 均为下载器/库：单请求单资源 + sleep 节流，没有"feed 预取"概念可借鉴；它们的存在证明了 pixiv 侧节流的存在性，但触发量级（数百次）远高于交互式客户端。
- **结论级事实：没有找到"预取 feed 请求导致封号/限流"的公开案例**；公开案例全部是爬虫级（数百~数万次连续请求）触发。

### 事实：本地相关代码（影响请求数计算）

- feed 的 "all+merge" 模式下 `ensureLoaded` 对每个子查询并发发请求（`activeKeys()` 返回多 sub、`Promise.all`；createTQFeedStore.ts:283-299, 406-420）→ "5 路首页 feed × 1 页" 实际是 **5~8 个请求**（follow 类 tab 合并 public/private 两个子查询时为 2 个）。
- 项目已有 429 重试路径（`packages/app/tests/unit/api/client429Retry.test.ts`）与 401 自动刷新（Java 侧，见 AGENTS.md / openwiki api-layer）——节流信号的兜底机制已存在。

### 风险面评估（单会话多拉 5 路首页 feed）

- **量级对比**：预取总量 5~8 个请求（每页 30 条），与公开触发线（~200 次下载、600s 间隔爬虫）相差 **1.5~2 个数量级**；且发生在空闲时机、用户会话内。单次预取本身的限流风险接近可忽略。
- **真实的风险点不在单次预取，在叠加**：① 30s stale 过期回访触发的 infinite query 全页重放（见第三节 3b）+ 用户翻页 + 预取并发，同账号 token 下叠加可能构成短时突发；② 无官方配额数字 = 只能按社区观察保守设计，留不出"贴近上限"的余地；③ 节流/封禁是**账号级**（token 维度），影响全部功能而非仅预取。
- **对选型的含义**：空闲预取可行，但应错峰（一次一路、请求间 ≥1-2s 或每个 idle 窗口一路，避开用户操作并发），复用既有 429 退避；不建议 6 路同时 `Promise.all` 全并发。Pixez 无先例 = 无现成背书，风险论证需靠量级差距而非先例。

---

## 二、WebView 内面板 keep-alive 的内存事实

### 事实：Android WebView 的内存架构与约束（minSdk 28 全部命中）

- **Android 8.0（API 26）起 WebView 多进程**：renderer 运行在独立的沙箱进程（低内存设备除外）——本项目 minSdk 28，正常设备上 renderer 内存**不在 app Java 堆内**。来源：Android 官方《Manage and diagnose WebView memory》 https://developer.android.com/develop/ui/views/layout/webapps/manage-webview-memory （该文档 2026-08 由 platform-api 团队更新，正文同步此表述）
- **WebView 的大部分内存是 native 内存而非 Java 堆**：渲染图形、**DOM 树**、JS 运行时都分配在 native；Java heap dump 只能看到轻量 wrapper。（同上官方文档）
- **native 内存没有 maxHeap 式上限**，官方原话：可能"silently expand to a huge size (potentially gigabytes)"——填满物理 RAM + zRAM 后触发整机换页，**Low Memory Killer 先杀后台进程、劣化整机，最终杀前台 app**。即 WebView 内存失控的表现不是快速 Java OOM，而是**慢性整机内存压力**。（同上官方文档）
- **重 web 内容的内存尖峰主要落在 renderer 进程**；官方诊断分区中 `partition_alloc` 对应 **DOM 树、渲染缓冲、V8 堆**——"heavy web pages / media-rich DOM" 被点名为增长原因。（同上官方文档）
- **WebView renderer 崩溃即宿主 app 崩溃**：Chrome 多进程可丢弃/重启单个 tab 兜底，WebView 渲染器内存压力直接冲击宿主（"huge bitmap allocation is much more likely to fail in WebView than in Chrome"）。来源：Chromium 官方 issue 组讨论 https://groups.google.com/a/chromium.org/g/chromium-bugs/c/tbEo3GyvLhw ；WebView 空场景即有可观基线开销（https://issues.chromium.org/40433414）。
- **超阈值白屏而非崩溃**：内容超过渲染阈值时 WebView 可能整页放弃渲染（compositor/raster 内存不足），react-native-webview #2683 实测。（https://github.com/react-native-webview/react-native-webview/issues/2683）
- 社区观察（非官方规格）：部分设备 Chromium renderer 分配在 256/512MB 附近遇硬顶。（Unity 论坛实测帖 https://discussions.unity.com/t/android-chromium-unable-to-grow-allocated-memory-above-256mb-confirmed/818820）

### 事实：DOM 节点与已解码位图是内存主体

- **已解码位图 = width × height × 4 字节**，远大于编码文件体积，是 Android OOM 的头号驱动。（Android 官方《Bitmaps and memory》：https://developer.android.com/topic/performance/memory/guide/bitmaps）
- **DOM 节点在 native 堆**，"every DOM node is memory"（Chrome DevTools 官方文档：https://developer.chrome.com/docs/devtools/memory-problems ；Samsung Web 内存优化指南：https://developer.samsung.com/smarttv/develop/guides/web-app-memory-optimization-guide.html ，后者同时指出 background-image 也占解码位图内存）。
- 大图导致 WebView OOM 是长期经典问题。（https://stackoverflow.com/questions/7227372/large-images-in-webview-cause-out-of-memory）

### 事实：SPA keep-alive 的业界内存控制手段

- **Vue `<KeepAlive>`**：`max` prop 限制缓存实例数，超限按**近似 LRU** 销毁最久未访问实例（官方文档明示）；默认无上限。失活组件**移入 detached 容器**而非卸载——"not unmounted during deactivation"，DOM 与实例完整保留在内存。来源：https://vuejs.org/guide/built-ins/keep-alive.html
- **React 无内建 keep-alive**：`display:none` 缓存方案需自行实现上限/卸载策略；社区常见做法是窗口化（只保留最近 N 个面板）。
- **`display:none` 与 KeepAlive 的内存等价性**：display:none 的 DOM 仍挂在活动文档树（占节点内存、参与 style recalc 扫描，仅豁免布局与绘制）；KeepAlive 移出文档树。两者都保留解码位图缓存与节点内存——保活省的是重建成本，付出的是常驻内存，**省内存的不是"显隐方式"而是"上限与卸载"**。

### 对选型的含义

1. 项目背景事实：首页 feed 无虚拟化、`<For>` 全量渲染（FeedList.tsx:110）、卡片数随浏览无上限；6 面板常驻 = DOM 节点 × 6 + 解码位图 × 6 的**无界增长**，全部落在 renderer 进程 native 堆。失败形态是 LMK 整机压力 → renderer 被杀 → app 崩溃/白屏，**不可捕获、难归因**，与「低内存占用」全局硬约束直接冲突。
2. 若做 keep-alive，先例指向必须同时配两个上限旋钮：**面板级**（≤6 面板本身有限，非主要矛盾）与**卡片级**（每面板保留 N 张卡 + LRU 卸载最旧内容）；且"先虚拟化 FeedList、再谈常驻"的顺序更稳——虚拟化本身就把 DOM/位图水位与浏览深度解耦，比 display 常驻收益更根本。
3. display:none 方案不因"显隐"而省内存；不配上限的 keep-alive 只是把"销毁重建成本"换成"无界内存增长"，二者不对冲。

---

## 三、feedQueryPersist 持久化层与预取/keep-alive 的交互语义（本地代码事实）

> 本节全部为本地代码事实，来源：`packages/app/src/api/feedQueryPersist.ts`、`packages/app/src/stores/shared/createTQFeedStore.ts`、`packages/app/src/main.tsx`、`packages/app/src/components/home/FeedList.tsx`（经 codegraph explore 取回，`文件:行号` 均为当前源码行号）。

### 基础事实（后续推理的地基）

- 持久化范围谓词 `persistableFeedQuery`：仅 key 头段为 `feed` / `bookmarks` / `novel`（第二段 ∈ {recommended, follow_public, follow_private, bookmarks}）**且** `defaultShouldDehydrateQuery`（仅 success 态）才入持久化；error/pending 态不入缓存（feedQueryPersist.ts:46-63）。
- 写回链路：`restoreFeedCache()` 在 restore 完成后 `persistQueryClientSubscribe` 订阅全局 queryClient 缓存事件（feedQueryPersist.ts:321-326）；`persistClient` 做 **trailing debounce 5s**，timer 只在 null 时设定、窗口内事件仅更新 pending（feedQueryPersist.ts:220-224）→ 5s 窗口内 N 次缓存变更 = **1 次写盘**。
- 写盘是**全量快照覆盖**（`setItem` 整 key），非增量；上限 `MAX_SERIALIZED_LENGTH = 4.5MB`（UTF-16 码元，feedQueryPersist.ts:41），超限走截断梯子 `[∞, 3, 1]`（每 query 保留前 N 页，`pages.slice(0, N)`，feedQueryPersist.ts:66, 72-96）→ **第 1 页最优先保留**；末级仍超限则删 key + warn（feedQueryPersist.ts:110-119）。
- 6 个 feed store 的全部 tab 查询在 store 创建时就注册了 observer（`queryMap` 循环建全 tab 的 `createInfiniteQuery`，createTQFeedStore.ts:224-273），observer 常驻 app 生命周期 → **gcTime（30min，createTQFeedStore.ts:215）在会话内不会触发**，会话内数据不丢。
- `ensureLoaded` 只覆盖**当前 tab** 的 `activeKeys()`（由 `config.currentTab()` 派生，createTQFeedStore.ts:283-299, 406-420），内部 `Promise.all` 并发 `ensureInfiniteQueryData({staleTime: 30_000})`；目标 tab 的 `queryDefMap` 是 store 内部 Map，**不导出**。⇒ 预取未激活 tab 无法复用 `ensureLoaded`，须直接对 queryClient 以目标 tab 的 queryKey 调 `ensureInfiniteQueryData`（或临时切 currentTab）。
- `loading` 粘滞语义（createTQFeedStore.ts:360-369）：`isFetching || (activated && status==='pending' && !error)`；FeedList 骨架条件 `loading() && items().length === 0`（FeedList.tsx:139），内容区在 `items().length > 0 || refreshing || error` 时保持显示（FeedList.tsx:142）。
- `staleTime` 默认 30s（createTQFeedStore.ts:214，ensureLoaded 内也硬编码 30s，:416）。

### 3a. 预取结果会写入持久缓存吗？——**会**

订阅是全局 queryClient 级的，谓词只看 **queryKey 头段 + success 态**，与"谁触发的加载"无关。空闲时对未激活 tab 调 `ensureInfiniteQueryData`，数据一旦 success 且 key 在范围内（6 路 feed 的 key 全部命中谓词），下一次缓存事件即进 5s debounce → 落盘（feedQueryPersist.ts:50-63, 220-224）。**没有"仅激活 tab 才持久化"的开关。**

### 3b. 回访「直现」依赖哪个缓存？30s 过期后骨架会重现吗？——**内存缓存；骨架不重现**

- 会话内直现依赖 TanStack 内存缓存（observer 常驻 → 不 GC）。冷启动后未预取过的 tab 靠**持久恢复**（hydrate 进内存，main.tsx:58）。
- 30s staleTime 过期后回访：`ensureLoaded` → `ensureInfiniteQueryData` 触发后台 refetch；refetch 期间旧 data 保留 → `items().length > 0` → 骨架**不重现**，仅 `refreshing()`（isRefetching）为 true（createTQFeedStore.ts:379）。loading 的 pending 粘滞分支只在无数据时生效，不构成威胁。
- ⚠️ 伴生事实：TanStack v5 对 stale 的 infinite query refetch 经 infiniteQueryBehavior **重放全部已有 pageParams**——深翻页后的 tab 回访（>30s）会串行重拉 N 页。这是独立于预取的 API 面积放大点，选型时需一并考虑（如仅首页 stale 重验或收紧回访 refetch 策略）。

### 3c. 冷启动恢复窗口与失效场景

- 启动顺序：`bootstrap()` 先 `await initializeStartupPreferences()` + `syncInitAll()`，再 `render()`（main.tsx:51），随后 `void initializeAuth()`（:55）与 `void restoreFeedCache()`（:58）**并行、不 await**。恢复链路（getItem ≤4.5MB 单键 → `JSON.parse` → hydrate）全异步；`JSON.parse` 4.5MB 在低端 Android WebView 量级估算几十至几百 ms（估算值，未实测）。
- **恢复完成前切 tab 会落在骨架窗口**：此刻内存 query 为 pending 无数据，面板 `ensureLoaded` 发起真实网络请求 + 骨架出现（pending 粘滞）→ 明明有持久缓存却多花一次 API RTT。hydrate 有 `dataUpdatedAt` 守卫（仅持久化数据比内存新才落状态，feedQueryPersist.ts:303-305、main.tsx:56-57 注释）：在途请求尚无数据时旧数据先落、随后网络响应覆盖——数据正确性无虞，代价是**一次浪费的请求 + 短暂骨架**。窗口通常亚秒级，低端机 + 4.5MB 快照时放大。
- 失效场景矩阵：
  | 场景 | 行为 | 依据 |
  |---|---|---|
  | 首装 / 无 key | `restoreClient` 返回 undefined，正常拉取 | feedQueryPersist.ts:230-231 |
  | 超 7 天 maxAge | 核心 restore 按 timestamp 判过期 → removeClient，语义=无缓存 | :28-29, 307-315 |
  | buster 不匹配（`tq-feed-v1`） | 核心丢弃旧缓存 | :25-26 |
  | JSON 损坏 / 结构非法 | 删 key + warn，按无缓存 | :240-253 |
  | 登出 | `clearPersistedFeedsAndCache`：suppress 窗口 + removeClient + queryClient.clear + 二次 removeClient 兜底 | :340-349 |
  | localStorage 不可用 | 探测失败 warn 一次，读写双 no-op | :154-164, 185-193 |
  | 写盘配额爆 | 梯子 ∞→3 页→1 页，末级失败删整个 key + warn | :102-147 |
  | restore 抛错 | 外层 catch + warn（核心生产环境静默 re-throw） | :316-319 |

### 3d. 预取 × 7 天 maxAge / 5s debounce 的相互作用

- **写盘次数不被放大**：6 路预取的 success 事件几乎同时到达，trailing debounce 合并为 1 次写；timer 设定后窗口内新事件只更新 pending（feedQueryPersist.ts:220-224）。
- **单次 payload 体积被放大**：快照 = 全部范围内 query 的 dehydrate 全量覆盖写。6 路 × 首页 1 页（~30 条，每条含 tags/作者估算 2-6KB）≈ 0.4-1MB，距 4.5MB 上限有余量；与用户深翻页叠加后才可能触梯子。
- **截断对预取友好**：梯子保留前 N 页（slice 头部），预取的恰是各 feed 第 1 页 → 即使触发截断，预取数据是最后被牺牲的部分。
- **maxAge 只作用于 restore 判定**（:28-29）；预取刷新写入 timestamp → 顺带延长缓存跨会话有效窗口（预取收益的一部分，非风险）。
- 预取进行中用户切后台：`visibilitychange→hidden` / `pagehide` 立即 flush pending（feedQueryPersist.ts:290-298），只落已 success 的 query（pending 态不 dehydrate），语义安全。

---

## 结论速览

1. **API 风险（Q1）**：Pixiv 无公开配额数字，429 是唯一节流信号；公开限流案例全部是爬虫级（数百~数万请求）。单会话预取 5~8 个请求低 1.5~2 个数量级，风险本身可忽略；Pixez 等第三方客户端**没有** feed 级 API 预取先例（仅有 CDN 图片预取的功能请求），无法拿来背书。真正的风险在叠加场景（stale 全页重放 + 翻页 + 预取并发），建议空闲错峰（一次一路、间隔 ≥1-2s）并复用既有 429 退避。
2. **keep-alive 内存（Q2）**：minSdk 28 下 WebView renderer 是独立沙箱进程，DOM/位图/渲染缓冲全在 native 堆且**无上限**；失控表现为 LMK 整机压力 → renderer 被杀 → app 崩溃/白屏（不可捕获）。display:none 保活不省内存，省内存的是上限与卸载——若做常驻，必须配卡片级上限（Vue KeepAlive `max`/LRU 先例），且更根本的路径是先给 FeedList 虚拟化。
3. **持久化交互（Q3）**：(a) 预取结果**会**进持久缓存（谓词只看 key 头段 + success 态，feedQueryPersist.ts:50-63）；(b) 会话内直现靠内存缓存，30s 过期后回访只后台刷新、**骨架不重现**（items>0 短路骨架条件），但 stale infinite refetch 会全页重放；(c) 冷启动恢复与渲染并行（main.tsx:58），恢复完成前切 tab 会浪费一次请求 + 短暂骨架，失效场景（首装/7 天/buster/登出/配额/损坏/localStorage 不可用）全部有显式 warn 或明确无缓存语义；(d) 预取不放大写盘**次数**（5s trailing debounce 合并），放大单次 payload 体积（全量覆盖写），但截断梯子保前 N 页对第 1 页预取数据最友好；预取顺带刷新 7 天 maxAge 时间戳。
4. **一个实现层事实约束**：`ensureLoaded` 只覆盖当前 tab（activeKeys 派生自 currentTab），且目标 tab 的 queryDefMap 不导出——预取未激活 tab 需要新的入口（直接对 queryClient 调 `ensureInfiniteQueryData`），顺带要解决 queryKey 的跨 store 复制问题。

### 开放点（未解决）

- Pixiv 官方配额数字不存在公开来源，风险模型只能基于社区观察外推；无法排除账号级差异化限流。
- Pixez 源码级核查（是否存在隐藏的 feed 预取逻辑）未做——仅核到 issue/公开资料层。
- 未实测：低端 Android WebView 上 4.5MB JSON.parse 的实际耗时（决定 3c 恢复窗口的真实宽度）；keep-alive 后 6 面板的实测内存水位。
- TanStack v5 stale infinite query refetch 全页重放的行为描述基于 query-core infiniteQueryBehavior 的公开语义，未在仓库内做行为验证。

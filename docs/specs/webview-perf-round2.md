# webview 性能二轮 spec：T4 Query 持久化 + T1 渐进加载 + X1 拦截链路（#357）

> **【模拟器结论，不可直接外推真机】** 全部验收基于模拟器 pictelio_ui（Android 14 / WebView 113，720×1280）。
> 本文是实施唯一依据，参数与文件路径全部定死，实施者不做设计决策。三份研究设计的完整证据链（file:line 级）已由研究代理输出并归档于本文件 §5 摘要 + git 历史中的研究记录。

## 0. 基线（round2-baseline，2026-09-05 采）

| 指标 | 值 |
|---|---|
| coldstart 首屏卡片就绪（T4 主指标） | **P50 4261ms / P90 4715ms**（3 组） |
| imgready cold durP50 / scroll durP50（T1+X1 关联） | 37ms / 3ms（hit 率均 100%） |
| 三滚动场景 jankRate | 2.8~3.0%（一轮改造后稳态） |
| switch forward / back jank（小样本） | 33% / 22%（P99 11.4 / 16.8ms） |

## 1. T4 —— TanStack Query feed 缓存持久化

**决策（研究实证后定死）**：
- 依赖：仅新增 `@tanstack/query-persist-client-core@5.101.4`（与已装 `@tanstack/solid-query 5.101.4` 锁步，query-core 同版本自动去重）。**不用** PersistQueryClientProvider（restore 错误处理不合规：生产静默 re-throw）、**不用** sync-storage-persister（5.102.8 起 deprecated）、**不用** experimental_createQueryPersister（无 infinite query 语义）。
- 姿势：手写 Persister（~60 行）+ `persistQueryClientRestore` + `persistQueryClientSubscribe` 手动接线。
- 存储：**localStorage**（Capacitor `Bridge.java:584` 默认 `setDomStorageEnabled(true)` 已查证；同步读在首屏关键路径最优；防御式封装仿 `src/settings/backends/localStorage.ts`）。
- 范围谓词：`persistableFeedQuery` —— 仅 `["feed",…]`、`["bookmarks",…]`、`["novel", "recommended"|"follow_public"|"follow_private"|"bookmarks",…]` 且 `defaultShouldDehydrateQuery`（success）通过；userWorks/followList/search/__disabled__ 全排除。payload 估 1–3MB。
- 写回：trailing debounce **5000ms**（核心 subscribe 无节流，节流在 Persister.persistClient 内实现）+ `visibilitychange→hidden` / `pagehide` 立即 flush。
- 新鲜度：`maxAge = 7 天`，`buster = "tq-feed-v1"`（常量导出）。SWR 语义：恢复数据必 stale（staleTime 30s）→ `ensureLoaded` 后台重验，`isCached()` 防骨架屏闪现。
- 失败矩阵（全部 `console.warn("[feedQueryPersist] …")` 非静默）：损坏 JSON→删 key+warn；结构非法→同；restore 抛→外层 catch+warn（核心生产静默必须由包装补）；超 maxAge/buster 不匹配→核心自动删（语义=无缓存，不 warn）；**配额梯子**：>4.5MB→截 3 页重序列化→仍超→截 1 页→仍超→removeItem+warn（pages/pageParams 截断一致，`getNextPageParam` 取末页 next_url 安全）；localStorage 不可用→探测后 warn 一次、restore/save 双 no-op。
- 接线：`main.tsx` render 后 `void restoreFeedCache()`（与 `void initializeAuth()` 并行，hydrate 以 dataUpdatedAt 守卫不会旧盖新）；`authStore.logout()` 在 `queryClient.clear()` **前**加 `void clearPersistedFeeds()`。
- 新文件：`src/api/feedQueryPersist.ts`（导出 FEED_PERSIST_BUSTER / FEED_PERSIST_MAX_AGE / persistableFeedQuery / createFeedQueryPersister(storage?) / feedQueryPersister / restoreFeedCache / clearPersistedFeeds）+ `tests/unit/api/feedQueryPersist.test.ts`（注入内存 Storage，**真实 dehydrate 产物做 fixture**，10 用例：谓词 9 key 命中+排除、restore 往返、损坏 JSON、超 maxAge、buster 不匹配、空存储、restore 抛、debounce 合并+clear 取消、配额梯子、storage 不可用）。

**验收**：coldstart P50 相对基线 4261ms 显著下降（预期省一次 feed API RTT；下限=auth RTT，不会归零）；`imgsAtReady` 上升。单测全绿。

## 2. T1 —— 缩略图→原图渐进加载

**档位事实**：medium=`c/540x540_70/..._master1200`、large=`c/600x1200_90/..._master1200`（同源等比，互切零纵横比跳变）；square_medium=`c/250x250_80/..._square1200`（方裁切，仅方形/裁切框可用）。

**改造项（定死）**：
1. 新原语 `src/primitives/createProgressiveImage.ts`：`createProgressiveImage({ fullUrl, thumbUrl }) → { thumbSrc, displaySrc, onThumbError, onDisplayError, failed }`。状态机：L1 命中（`checkImageCache(full)`）→ 直挂 full 无渐进；miss+thumb 有效 → thumb 先行 + **`loadImage(full)` 预载（复用 inflight 去重，与 FeedList 预取同 Promise 合流；native 下走 prefetchImage 写盘）**→ resolve 后 URL 键守卫再切换；thumb 失败→卸载缩略层+warn；full 失败→停 thumb+warn；双失败→failed=true；无 thumb/thumb===full→单段直载=现状。full 到位前主 img 不挂载，thumb 层常驻不卸载（防白帧/兜底）。
2. `IllustSingleCard.tsx`：封面区改双层 img（thumb=medium absolute 底层 aria-hidden，full=large??medium 主层 relative），容器已有 aspect-ratio 不动，角标 z 序不动。
3. `NovelRowCard.tsx`：**降档单段** —— cover 改 `square_medium`（56px 方框 × DPR3.5 ≈196px < 250px，方框对方裁切），同步 `HomePage.tsx` 小说面板 `prefetchUrl` 改 `square_medium`（预取 key=展示 key 契约）。**行为变化点**：旧 large 缓存 key 一次性 miss，自然回填。
4. `PixivImage.tsx`：纯增量可选 prop `thumbSrc?: string`（原始 URL）与 `objectFit?`；传了才走渐进 wrapper，未传 DOM 与现状逐字节一致；接入 `novel/NovelCoverCard.tsx`（thumb=medium）。
5. **预取 key 失配修复（round-1 遗留）**：提取共享纯函数 `pickListImageUrl(illust, quality)`（`listQuality` 作参数注入），`ImageCard.tsx` / `GridCard.tsx` / `VirtualFeed.tsx:126` 三处共用——预取 key 恒等于展示 URL（修复 quality=large/original 时预热失效）。
6. **详情页明确不纳入**（证据：LazyDetailImage 的 cacheReadyFor 门控已保证渲染时字节在盘；插 thumb 会与 PRELOAD_WINDOW=6 争 maxRequestsPerHost=10，反而恶化翻页）。

**测试**：`tests/unit/primitives/createProgressiveImage.test.ts`（happy-dom + mock imageLoader，deferred promise 驱动状态机全矩阵）；`PixivImage.test.tsx` 新建（含「不传 thumbSrc → DOM 等价现状」回归保护）；`IllustSingleCard.test.tsx` 增补双层断言；`NovelRowCard.test.tsx` 既有断言**反转为 square_medium**；`pickListImageUrl` 纯函数单测（真实 image_urls fixture，oracle 溯源注明）。

**验收**：imgready cold durP50 显著下降（首屏从 large→medium/降档）；**hit 率口径变化须在对比报告注明**（渐进产生双资源记录，不可与基线直接比 hit 率）；全场景回归无劣化；R18 遮罩/角标 z 序/暗色 token 目测无回归。

## 3. X1 —— 拦截链路定量 + 内存热路径

**诊断修正**（证据：Android SDK javadoc）：`shouldInterceptRequest` 运行在 **WebView loader/IO 线程**（非 UI 线程）——真实危害是图片资源阻塞 loader worker + miss 时空窗 + 并发饱和，非直接 UI jank。
**根因新发现（F1）**：磁盘命中响应 headers=null → `OtaPlugin.ensureNoStore`（`OtaPlugin.java:438-451`）注入 `Cache-Control: no-store` → **Chromium 对磁盘命中永不缓存**，同 URL 每次渲染重进拦截器。这是「磁盘命中 3-4ms 热路径」的根源。

**改造项（定死）**：
1. **纯重构**：抽共享类 `src/webview/java/io/pictelio/app/ImageIntercept.java`（从 `MainActivityWebview.java:173-220` / `full/.../MainActivity.java:203-250` 逐字抽取 interceptImage+mimeFor+bytesResponse），两个 Activity 一行委托（full flavor 编译 webview 源集，自动同时生效；lynx 不编译该源集，零 diff）。
2. **telemetry** `PerfLog.java`：`interceptLine(url8, phase, src, durationMs, bytes)` 纯格式化（不门控，供单测精确断言）+ `logIntercept` 内 `BuildConfig.DEBUG` 门控（release 计时也包进 DEBUG 分支，零开销）。格式（单行 Log.i，tag `PictelioPerf`）：
   - `intercept url8=<8字符> phase=hit src=mem|disk durationMs=<n> bytes=<n>`
   - `intercept url8=<8字符> phase=miss durationMs=<n> bytes=<n>`
   - `intercept url8=<8字符> phase=err durationMs=<n> bytes=-1`
   埋点：命中/miss/异常三个 return 前结算；url8=`PixivImageLoader.keyToFilename(pixivUrl).substring(0,8)`。
3. **内存字节 LRU** `ImageBytesMemoryCache.java`（webview 源集，**不复用** Lynx 的 Bitmap LRU `ImageMemoryCache`）：进程单例、零 Context 引用，内部复用 main 源集泛型 `LruCache<String,byte[]>`；**MAX_BYTES=32MB**、**单条 ≤512KB**（天然缩略图/卡片进、原图排除）；`putBounded` 超限 no-op；`backfillFromFile` 走单线程 daemon executor + pending 去重（拦截线程绝不回读磁盘）；`clear()` 供清缓存联动。填充点：① miss 下载完成（字节已在手）② `PixivApiPlugin.prefetchImage` 写盘成功后（详情页预取热路径，价值最高）③ 磁盘命中异步回填。`ImageCachePlugin.clearCache` 末尾联动 `clear()`。
4. **磁盘命中补 immutable 头（F1 修复）**：磁盘命中返回改为与 bytesResponse 同规则 headers（`browserCacheEnabled` 时 `Cache-Control: public, max-age=31536000, immutable`；用户关浏览器缓存时不加，ADR-0090 语义保持）。内存命中 serve 用 ByteArrayInputStream + 同规则头。
5. **不动 `PixivImageLoader`**（main 源集波及 lynx；锁内下载是已测契约；等 miss 时长数据出来再立 X1-b/c：writeFile tmp+rename 原子化、enforceCacheLimit 移锁外）。
6. **bench**：`bench-webview-nav.mjs` 新增 `intercept` 子命令——每组 `logcat -c` → 冷启动段 dump → fling 段 dump，解析 `-v threadtime -s PictelioPerf`，JSONL `{scenario:"intercept", kind, group, url8, phase, src, durationMs, bytes, ts}`；`report` 扩展 `intercept/cold|scroll` 聚合（总数/hit 率/按 phase 的 p50/p90/p99/src=mem|disk 计数/miss bytes 均值）。

**测试**：`src/testFull/java/io/pictelio/app/ImageBytesMemoryCacheTest.java`（Robolectric sdk28 对齐既有惯例；9 用例含并发 8 线程不变量、backfill 成功/缺失/超限三路径）；`PerfLogTest.java`（四格式**精确字符串相等**，oracle=本 spec 字面量）。验证命令：`./gradlew testFullDebugUnitTest` + `assembleLynxDebug` 编译（flavor 隔离证明）。

**验收**：intercept 探针给出 hit(src=mem/disk)/miss/err 四桶分布——mem 命中 0→出现且 p50<1ms；磁盘命中总数下降（L2 接管）；miss p50/p99 持平（网络主导，拿到第一个硬数字）；imgready/全场景无回归；`dumpsys meminfo` Java Heap 增幅 ≤32MB。

## 4. 执行序与门禁

1. 研究（完成）→ 本 spec 提交 → 装 `@tanstack/query-persist-client-core@5.101.4`
2. 并行实施×3（文件集互不重叠）：T4（feedQueryPersist+main/authStore 接线）、T1（primitive+卡片+PixivImage+pickListImageUrl）、X1（Java+bench intercept）
3. 集成：grep 核验 → fmt → lint:all / check:all / test 全绿 → `pnpm build:android` → 验证 bundle
4. **完整 code-review**：子代理读仓库级 `.agents/skills/code-review/SKILL.md` 双轴（调用点完备性/blast radius + oracle/test strength）审全部 diff → 修复 → 复检至零阻塞
5. 复测全场景（round2-after）→ 完整对比报告 `docs/research/webview-perf-round2-report.md`（含 X1 intercept 分布表 + T4 coldstart + T1 imgready + 全场景回归，注明口径变化）→ 合并 main → 关 #357

## 5. 三份研究的关键证据索引（file:line 级结论的出处速查）

- T4：solid-query 5.101.4 锁步包存在性（unpkg 200）；`persist.js` subscribe 无节流/restore 生产静默 re-throw/`hydration.js` dataUpdatedAt 守卫；`Bridge.java:584` DomStorage 默认开；key 清单出处（recommendedStore.ts:53,58 / followStore.ts:35,40 / novelRecommendedStore.ts:24 / novelFollowStore.ts:36,41 / bookmarkStore.ts:30,46 / novelBookmarkStore.ts:38）；feed staleTime 30s（createTQFeedStore.ts:214,405-408）；refetchOnWindowFocus:false（queryClient.ts:33）；logout 清缓存点（authStore.ts:198）。
- X1：`MainActivityWebview.java:113-220` 全链路；`ensureNoStore` no-store 注入（OtaPlugin.java:438-451）；per-URL 锁范围（PixivImageLoader.java:155-165，锁内含同步下载+写盘+enforceCacheLimit）；prefetchImage 绕锁非原子写（PixivApiPlugin.java:149-175）；full/webview flavor 逐字重复（MainActivity.java:203-250 vs MainActivityWebview.java:173-220；build.gradle:52-67）；泛型 LruCache（main 源集 LruCache.java:17-98）；Android 单测走 full 变体（testFullDebugUnitTest 先例）。
- T1：首页裸 img（IllustSingleCard.tsx:30,53-59 / NovelRowCard.tsx:27-30,49-54）；次级 blur-up 先例（ImageCard.tsx:57-70 / GridCard.tsx:52-65）；listQuality 默认 medium（ImageCard.tsx:13-23 / settingsStore.ts:246）；VirtualFeed 预取 key 失配（VirtualFeed.tsx:126）；L1 快路径（imageLoader.ts:96-102,225-248）；详情不纳入证据（LazyDetailImage.tsx:43,69-116）。

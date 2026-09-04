# webview 全场景卡顿根因诊断（主线程时序 / 图片管线 / 路由重渲染 三面）

> **【模拟器结论，不可直接外推真机】**
> 本文所有机制级假设建立在仓库代码静态分析 + `#306` 双端 bench 基线 + `#312` T1 触摸→首帧时延 E4 地板实验已沉淀的方法学（详见 [`bench-methodology`](https://github.com/a1121611810/Pictelio/blob/research/bench-methodology/docs/research/scroll-responsiveness-bench-methodology.md)）之上。**所有「待 bench 验证」假设必须在 #306/bench-scroll.mjs 的扩展集上跑通后才能定性；任何模拟器结论不能直接外推 OPPO 真机**（已知 OPPO WebView 主线程时延与 emulator 偏差显著，见 `#304` 父地图与 `memories/emulator-webview-cdp-driver`）。
>
> **范围声明**：本 ticket 仅做诊断 + 立改造 ticket 候选。**不动代码**，**不修改 openwiki/**（任何 wiki 更新交 CI 定时任务收敛）。OpenWiki 同步状态：本报告涉及的内容已在 OpenWiki `architecture/overview.md` / `architecture/image-pipeline.md` / `domain/feed-and-browsing.md` / `domain/novel-reader.md` / `integrations/android-native.md` / `testing/overview.md` 中体现，**无需手改**；如本报告结论与现有 wiki 冲突，标"待 CI 收敛"。

## 0. 元数据 / 引用

- 父地图：[#355 wayfinder 地图](https://github.com/a1121611810/Pictelio/issues/355)
- 本 ticket：[#356 webview 全场景卡顿根因诊断](https://github.com/a1121611810/Pictelio/issues/356)
- 复用工具资产：`#306` `bench-scroll.mjs`（位于 `bench/scroll-t0-306` 分支，未合 main；含 input swipe + framestats 采样/解析/报告，模拟器 + 真机 OPPO R11s 双 profile）；`#312` E4 地板实验 + T1 触摸→首帧时延方法学；`benchNav` intent 深链钩子（已在 lynx Activity 接好，webview 通过 SPA `pushState` 等价）
- **不复用**：`#308`（列表场景 Lynx 上下文根因）、`#309`（小说详情 Lynx 上下文根因）—— 方向相反
- 父地图 #355 决策：诊断单 ticket 全场景优先 / 全栈三面 / 仅模拟器量化（不锁数字指标）
- 既有 ADR 锚：ADR-0014 (L1 LRU)、ADR-0030 (GC)、ADR-0037 (PixivApiPlugin 网关)、ADR-0038 (immediate navigation)、ADR-0039 (detail cache-ready)、ADR-0042 (enabled:false)、ADR-0043 (setTimeout(0) 延迟加载)、ADR-0076 (pull-to-refresh)、ADR-0077 (FastScrollbar)、ADR-0078 (FeedList 统一)、ADR-0082 (pagination inline retry)、ADR-0085 (AI 断言)、ADR-0090 (image cache 三层 UI 开关)、ADR-0096 (虚拟滚动换 TanStack Virtual)、ADR-0097 (Oracle check)、ADR-0098 (cross-engine)、ADR-0099 (OpenWiki CI-only)、ADR-0100 (URL rewrite trusted boundary)、ADR-0122 (OTA web bundle)、ADR-0127 (ugoira streaming)

## 1. 4 场景覆盖路径总览（机制地图）

下表是每个场景触达的关键代码路径，便于把假设钉到 file:line 上做证据回溯。

| 场景 | 入口路由 | 数据源 | 渲染 | 关键原语 |
|------|----------|--------|------|----------|
| 1a. 首页 Feed 滚动 | `/home` (`packages/app/src/routes/HomePage.tsx:330`) → `SideNavShell` (`:112`) → `IllustFeedPanel` (`:273`) / `NovelFeedPanel` (`:303`) | `recommendedStore` / `followStore` / `bookmarkStore` 等六 store | `FeedList` (`packages/app/src/components/home/FeedList.tsx:49`) + `IllustSingleCard` / `NovelRowCard` | `createFeedVirtualizer`（仅次级 Feed；首页 L5 单列无虚拟化）、`createPullToRefresh`、`useFeedActivation` |
| 1b. 搜索 / 用户作品 / 追更 | `/search` (`packages/app/src/routes/Search.tsx`) → `SearchResults`（基于 `createSentinel` 分页）/ `/user/:id/illusts` (`UserIllusts.tsx`) → `UserWorksFeed`（唯一仍用 `createFeedVirtualizer` 的次级 Feed） | `searchStore` / `userIllustsStore`（TanStack Query） | `VirtualFeed` (`packages/app/src/components/VirtualFeed.tsx:45`) + `ImageCard` / `GridCard` / `NovelCard` | `createFeedVirtualizer` (`packages/app/src/primitives/createFeedVirtualizer.ts:79`) + `createSentinel` (`packages/app/src/primitives/visibility/sentinel.ts:33`) |
| 2. 小说详情正文滚动 + 章节切换 | `/novel/:id` (`packages/app/src/routes/NovelDetail.tsx`) | `novelCache.getEntry` → `parseNovelBlocks` → `createNovelTextLayout` | `createNovelVirtualLayout` (`packages/app/src/primitives/createNovelVirtualLayout.ts:106`) + `FastScroller` (基于 `createFastScrollbar`) | `createNovelVirtualLayout`、TQI TanStack Virtual (`@tanstack/solid-virtual`) |
| 3a. 首页缩略图 | `IllustSingleCard` / `NovelRowCard`（首页 L5 单列大图卡）→ `PixivImage` (`packages/app/src/components/PixivImage.tsx:19`) | `imageHostService` 选 host → `resolveImageUrl` → `/pixiv-img/...` | `<img src="...">` 由 `MainActivityWebview.shouldInterceptRequest` 拦截 → `PixivImageLoader` 读盘/下载 | `PixivImage` (L1 同步命中 + WebView L2 cache) |
| 3b. 详情大图（多图 + 单图） | `LazyDetailImage` (`packages/app/src/components/LazyDetailImage.tsx:39`) | `loadImage` (`packages/app/src/utils/imageLoader.ts:219`) → `ImageCachePlugin.getImage` → `PixivApi.prefetchImage` | `PixivImage`（在 `cacheReadyFor` 命中后挂载） | `loadImage`、`prefetchImage` (Java, `PixivApiPlugin.java:131`)、`MainActivityWebview.interceptImage` (`:173`) |
| 3c. 动图 Ugoira | `UgoiraViewer` (`packages/app/src/components/UgoiraViewer.tsx`) | `streamUgoiraFrames` (`packages/app/src/api/illust.ts:282`) → `createStreamFrameSource` (`packages/ugoira/src/stream.ts`) | 边读 ZIP 边 `URL.createObjectURL(new Blob(帧 bytes))` | `fflate` + blob URL 链 |
| 4a. Android 系统侧滑返回 | 物理/手势 back → `CapApp.backButton` | — | `backGestureService.registerBackGesture` (`packages/app/src/services/backGestureService.ts:30`) → 关 overlay → `navigate(-1)`（根路径 2s 双击退） | `backGestureService` |
| 4b. 路由跳转（点卡片 / Tab 切换 / 详情页进入） | `<a>` / `<Link>` / `useNavigate` | — | `@solidjs/router` (no loader/Suspense) + 各路由组件 `createEffect` 拉数据 | `solid-router` `RouteDefinition` (`packages/app/src/router.tsx:24`) + 各路由 `onMount` |

---

## A. 主线程时序面（Main-thread timing）

### A1. `createFeedVirtualizer` `setOptions` 全量重算在快速滚动中放大【高贡献 / 待 bench 验证】

- 机制：`createFeedVirtualizer.ts:193-213` 在 `createEffect` 内对 `count`/`lanes`/`estimateSize`/`overscan`/`gap` 变化整体 `instance.setOptions({...})` + `instance.measure()` + `setVirtualItems([...instance.getVirtualItems()])`（每次新建数组引用）。`setVirtualItems` 触发所有 `<For>` 路径上以 `virtualItems` 为依赖的派生 memo 重算（`containerWidth` 依赖、`pullPhase` 路径上的 `PullIndicator` props、卡片 `key` 派生）。
- 推论：`overscan=2`（次级 Feed）+ scroll 事件每 1~2 帧触发一次（`createFeedVirtualizer.ts:241`）→ scroll 期间会触发 1 次 `setOptions` + 2 次 `setVirtualItems`。如果用户快速滚动（input swipe `180ms` fling），滚动回调可能连续 60~120 次/秒触发，每次都新建 `virtualItems` 数组，触发依赖图大范围 invalidation。
- 证据：`createFeedVirtualizer.ts:193` `setOptions` + `:211` `setVirtualItems([...instance.getVirtualItems()])` + `:241` `window.addEventListener("scroll", onScroll, { passive: true })`。TanStack Virtual 实例化 (`@tanstack/solid-virtual`) 是按需懒布局（ADR-0096），但 `setOptions` 每次都强制 `measure()` 重新计算所有 item 的估计高度（`createFeedVirtualizer.ts:210`）。
- 验证方法（如何证伪）：扩展 `#306` `bench-scroll.mjs` 的 framestats 解析，在 fling 期间（180ms swipe）通过 CDP 注入 `window.performance.measure` 包装 setOptions / measureElement，统计每秒调用次数与主线程占用时间；预期若 A1 成立，会观察到 fling 期间 JS 主线程有 ≥10ms/帧的 `setOptions+measure` 同步占用。
- 注意：首页 `HomePage` 用 `FeedList` + 单列大图卡（L5 布局，无虚拟化），**不走 `createFeedVirtualizer`**；**A1 主要影响 `/user/:id/illusts`（`UserWorksFeed`）等次级 Feed**。这是为什么「首页感觉 OK，但点用户头像进作品页感觉卡」的现象在 #356 用户描述里可能存在 — 需要按场景分别 bench。
- **证据强度**：推论（无现场测量）+ 间接证据：TanStack Virtual 内部确实每次 setOptions 触发 measure（虚拟库契约）；scroll listener 注册未做 throttle/rAF 节流（`createFeedVirtualizer.ts:230-247`）。

### A2. `createNovelVirtualLayout` 的「全文虚拟化但段落布局在主线程算」双重开销【高贡献 / 待 bench 验证】

- 机制：`createNovelVirtualLayout.ts:216-262` 实例化 TanStack Virtualizer + 在 `createEffect` 内 `instance.setOptions` + `instance.measure()`。`blockLayouts`（`:162-204`）在 memo 里遍历所有 block（含 text/image/chapter/jump/pagebreak）→ 对 text block 从 `textLayoutResult().paragraphs` 取高度，对 image block 按容器宽度 × 原始宽高比算高度（`:184-190`），对 chapter/jump/pagebreak 按字号系数乘（`:191-196`）。整章通常 200~600 段，全文一次遍历在主线程执行。
- 推论：章节切换瞬间（点击章节号 / SeriesSheet 跳转）触发 `currentNovelId` signal 变化 → `blockLayouts` memo 重算全文 → `createEffect` 内 setOptions + measure → 首屏滚动时 `visibleBlocks` 重算 → 首次 paint。如果文本布局 cache 未命中（`novelTextLayoutCache.ts`，key = `${novelId}-${width}-${settings}-${variant}`），会调 `createNovelTextLayout` 重算所有段落（Canvas measureText，单段数十次 `measureText`，200 段 = 几千次调用）。这是章节切换 jank 的核心。
- 证据：`createNovelVirtualLayout.ts:111-114`（`paragraphSpacing` memo）+ `:116-160`（`textLayoutResult` memo，含 Canvas measureText）+ `:162-204`（`blockLayouts` memo）+ `:233-262`（`createEffect` 内 setOptions + measure）。
- `scroll` 事件 (`createNovelVirtualLayout.ts:265-277`)：`window.scroll` 触发 `instance._willUpdate()` + 重建 `vItems` 数组 + `setVTotalSize` —— **没有 throttle/rAF**。与 A1 同结构。
- 验证方法：通过 CDP 注入 `window.performance.measure` 包装 `textLayoutResult` / `blockLayouts` / `_willUpdate`，统计章节切换后 0~500ms 内主线程占用。预期若 A2 成立，会观察到章节切换瞬间 ≥30ms 的同步 layout pass。
- **证据强度**：推论 + 强间接证据（`blockLayouts` 全文遍历 + `setOptions` 无 throttle 是可读代码事实）。

### A3. `createFastScrollbar` 拖拽时无 rAF 批量化【中贡献 / 文献已证】

- 机制：`createFastScrollbar.ts:93-100` `onPointerMove` 在拖拽中按 `deltaThumb / thumbTravel()` 比例线性映射并 `options.onScrollTo(newTop)` —— 调用方（`NovelDetail.tsx` 的 FastScroller 子组件）通常直接 `window.scrollTo({ top, behavior: "auto" })`。拖拽 100ms 内可有 ~10 次 `pointermove` → ~10 次 `window.scrollTo` → ~10 次合成器取消 + ~10 次重排（在主线程）。
- 推论：拖拽快速滚动条时（用户拖到中段跳读章节）会触发持续性主线程占用，与滚动 jank 不同 —— 是「直接连续触发 scrollTo」的 jank。
- 证据：`createFastScrollbar.ts:93-100` 直接 `onScrollTo`，无 `requestAnimationFrame` 批量化。
- 验证方法：拖拽 fast scrollbar 时 CDP 注入 `window.addEventListener('scroll', () => performance.mark('s'))`，统计 1s 内 scroll 事件次数。预期若 A3 成立，1s 拖拽期间 ≥30 次 scroll。
- **证据强度**：推论（机制清晰，但「真机是否成瓶颈」待 bench）。可参照 Lynx 端 ADR-0110/0134/0135 已知 scroll 信号是痛点（webview 这边信号正常但**批量化缺失**是不同问题）。

### A4. `requestAnimationFrame` 调度 + transitionend/scroll 事件链【低-中贡献 / 待 bench 验证】

- 机制：`PageTransition.tsx` 包装页面切换动画（150/200/300ms Fluent 曲线）。`NavBar.tsx` 自动隐藏（基于 scroll 方向）。`createPullToRefresh.ts` 处理 touch + transitionend 复位。
- 推论：路由切换瞬间的「页面进入动画 + 首屏 skeleton + 第一次数据返回 → 卡片 fade-in」叠加在主线程上：每张卡片的 `image` 标签从 skeleton 切换到真图时，WebView 触发 layout reflow + paint。首屏 N 张卡（首页 6 卡 + 追更 6 卡 + 收藏 6 卡 = 18 张 `IllustSingleCard`）若同时到达 L1 缓存 + L3 磁盘同时命中 → `<img>` 几乎同步加载完成 → 浏览器在主线程上 layout + decode + paint 18 张图 → jank。
- 证据：OpenWiki `architecture/overview.md:84-93`（immediate navigation 模式）+ `feed-and-browsing.md`（FeedList 单一容器，骨架 → 真内容切换）+ `tokens.css` 的动画曲线与时长（来自 AGENTS.md 的「Fluent Design 规范」章节）。
- 验证方法：用 Chrome DevTools Performance tab（或 `dumpsys gfxinfo` framestats）记录路由切换瞬间 0~500ms 内的 Layout / Paint / Decode Image 时长占比。
- **证据强度**：推论（机制清晰但量级未知）。注意「先渲染后加载」本身就是 ADR-0038 选定的硬约束，**不能为了消 jank 改回 suspense/loader 阻塞渲染**。

### A5. `main.tsx` bootstrap 时序【中贡献 / 文献已证】

- 机制：`main.tsx:32-55` `bootstrap()` 顺序：
  1. `await initializeStartupPreferences()` — 当前 no-op（`packages/app/src/startup.ts:1-5`），但 `__root.tsx:126-131` `settings.hydrateAll()` + `loadReportedIds` + `loadBlockedIds` + `loadImageHostPreference` 并行 await（4 个 storage 读）。
  2. `settings.syncInitAll()`（同步读所有 settings 到内存）。
  3. `syncFluentTheme()` + `MutationObserver` 监听 `<html>.dark`。
  4. `render(() => <App />, root)` —— 同步渲染骨架。
  5. `void initializeAuth()` — 不阻塞。
- 关键问题：`__root.tsx:126-131` 的 4 个并行 hydrate 与 `initializeAuth` (`__root.tsx:146-160`) **串行 await**：先 hydrate 完才走 auth。这 4 个 hydrate 都是从 `CapacitorStorage` 读 SharedPreferences，单次读 < 5ms，但**冷启动首屏**的 4 次 IO 累计 ≈ 15-25ms + auth 启动 + token 校验 → 首屏「点 home 到画面」之间的总时延。
- 证据：`main.tsx:32-55` + `__root.tsx:126-180`（4 个 await + 1 个 tryAsync await）+ `settings.hydrateAll` 在 `settings/registry` 实现。
- 验证方法：用 `dumpsys gfxinfo` + CDP 注入 `performance.mark` 包裹每个 bootstrap 阶段，统计从 `bootstrap()` 调用到 `__root.tsx` 首屏 paint 的总时延。预期若 A5 成立，会观察到 bootstrap 总时延 ≥300ms（auth 阶段最大头）。
- **证据强度**：文献已证（代码事实）+ 间接证据：`__root.tsx:104-106` 注释明确提到 "Chromium 浏览器级滚动恢复（磁盘浏览数据）不经 window.scrollTo ... 真机实测 t≈3.5s 0→1306" —— 这是另一个独立 boot 时序问题（**冷启动时浏览器会自己恢复 scrollY 到上次位置**），与本 A5 假设是叠加关系。
- 相关假设 A5-b（来自 `__root.tsx:99-107` 注释）：**Chromium 浏览器级滚动恢复在首屏早期把 scrollY 恢复为上次会话位置**，触发 1 次 scroll 事件但 calls 里没有 scrollTo。已在代码里用「监听启动窗口内的 scroll 事件 → 出现恢复特征立即 scrollToTop + 自卸载」兜底（`__root.tsx:33-38, 104-105`）。**这是事实**，但用户报告的「卡、不跟手」可能与这个 5 秒窗口的兜底逻辑相关（误判用户首次滚动为恢复特征，导致用户滚的内容被打回顶部）。

### A6. 路由切换瞬间的「render 后立即 fetch」在 WebView 85+ 上的 jank【中贡献 / 待 bench 验证】

- 机制：`@solidjs/router` 无 loader/Suspense（OpenWiki `architecture/overview.md:97-104`）。`/illust/:id` 路由组件 `createEffect` 内 `tryAsync(api.illust.get(id))`，骨架屏先渲染，promise 到达后切真实内容。`IllustDetail.tsx` 的多图懒加载 (`LazyDetailImage.tsx:39-152`) 同时启动 N 张图的 `loadImage` → Native prefetch → Promise → cacheReadyFor signal 切换 → N 张 `PixivImage` 同时挂载 → N 个 `<img>` 同步进入解码流程。
- 推论：从列表点卡进详情首屏，6~12 张图同时解码 → WebView 85 走 Chromium 解码线程池（与主线程并发），但每张图都触发 layout + paint → 主线程 jank。
- 证据：`LazyDetailImage.tsx:54-116` 的 `shouldLoad` + `createEffect` + `cacheReadyFor` signal + `LazyDetailImage.tsx:125-149` 的 `canDisplayImage()` memo。
- 验证方法：进入多图详情（如 12 页同人作品）时用 framestats + CDP `performance.mark` 统计 0~500ms 内 Image Decode 时长占比。预期若 A6 成立，0~500ms 内 Image Decode 占 ≥80ms。
- **证据强度**：推论 + 强间接证据（代码事实 + 已知 Chromium 解码管线）。

---

## B. 图片管线面（Image pipeline）

### B1. L1（JS key Map）+ L2（WebView 缓存 + `shouldInterceptRequest`）+ L3（Android disk）三层架构在 WebView 上的实际命中率与失效模式【高贡献 / 待 bench 验证】

- 机制：
  - **L1**：JS Map `loadedKeys`（`packages/app/src/utils/imageLoader.ts:51`），**只存 key（URL），不存 Blob**（注释 `:47-48` 解释了为什么从 Blob Map 退化为纯 key Set）。`MAX_CACHE_ENTRIES` 默认 10_000（`imageLoader.ts:13`），context-aware GC（`GC_THRESHOLD` + `GC_EVICT_RATIO`，`imageLoader.ts:77-81`，`ADR-0030`）。`PixivImage.tsx:19-32` 在渲染时 `checkImageCache` 同步命中 → 直接返回代理 URL，**0ms 不产生 blob: 条目**（注释 `:88-89`）。
  - **L2**：WebView HTTP cache + `MainActivityWebview.interceptImage` (`:173-203`) + `bytesResponse` 头（`:214-220`，`Cache-Control: public, max-age=31536000, immutable`，当 `browserCacheEnabled` 为 true 时）。**关键发现**：`interceptImage` 命中磁盘后会**绕过** WebView HTTP cache（直接返回 `FileInputStream`），未命中时给浏览器加 `immutable` 头让浏览器自己缓存 1 年。
  - **L3**：Android 磁盘 `pictelio-images/` 目录（`PixivImageLoader.CACHE_DIR_NAME`，`PixivImageLoader.java:44`），Base64 URL-safe no-padding 文件名（`:84-86`），`enforceCacheLimit()` 触发 LRU 淘汰（`OAuthConfig.CACHE_MAX_BYTES`，默认 500MB）。
- 推论与失效模式：
  - L1 命中 → `resolveImageUrl` → `/pixiv-img/...` → WebView 直接读 L2 (browser HTTP cache) → 0ms 命中。**但 L1 仅在「同一会话内」有效** —— WebView 进程被 Android LMK 杀掉重启时 L1 Map 重置为 0（`loadedKeys` 是模块级 Map，重启后为空）。这意味着冷启动第一次渲染 → L1 不命中 → 走 `loadImage` → Native prefetch → disk cache → cacheReady 后再渲染（**两次 IPC 等待**）。
  - **L2 关键陷阱**：`shouldInterceptRequest` 在 WebView 主线程调用（Chromium 实现），命中磁盘后从 `FileInputStream` 流式返回给 WebView。**`shouldInterceptRequest` 在主线程执行 = 阻塞主线程**，如果磁盘读 IO 慢或磁盘有锁（per-URL lock 在 `PixivImageLoader.java:50, 135`），WebView 主线程被卡住 → 所有 `<img>` 解码暂停 → jank。
  - L3 预热 (`warmCacheFromDisk`，`imageLoader.ts:464-489`)：启动时读 `getCachedKeys()` 取最近 50 个 key 注入 L1，**不预解码**。注释 `:99-104` 明确说「只登记 key，不再把 Blob 解码进内存」。
  - L3 失效模式：`OAuthConfig.CACHE_MAX_BYTES` 满时 LRU 淘汰；用户从「图片缓存」页（`/image-cache`）调小磁盘上限时，下次 prefetch 即触发淘汰（注释 `ADR-0090`）。
- 证据：上文列出的 file:line + `OpenWiki architecture/image-pipeline.md:14-130` + `ADR-0090` (image cache 三层 UI 开关) + `ADR-0030` (GC) + `ADR-0014` (L1 key set)。
- 验证方法（关键！）：通过 CDP 注入：
  ```js
  performance.measure('pixiv-img', { start: 'fetch-start', end: 'fetch-end' });
  ```
  在 `shouldInterceptRequest` 中埋点（需修改 Java 代码 → **不在本 ticket 范围**，但应列入改造 ticket）。webview 端可通过 `window.performance.getEntriesByType('resource').filter(e => e.name.includes('/pixiv-img/'))` 拿到每个图片请求的 duration / transferSize / encodedBodySize / decodedBodySize。统计命中率（`transferSize==0 && duration<5ms`）、未命中率、失败率。预期若 B1 成立，会观察到冷启动后前 30 秒命中率从 0% 爬升到 ~80%（L1 填充），热缓存（30 秒后）应接近 100% 0ms。
- **证据强度**：推论（机制清晰但「实际命中率」「冷启动 L1 填充速率」**完全无测量数据**）—— 这是本报告**最关键的未知数**，建议作为 B1 改造 ticket 的第一阶段目标。

### B2. `MainActivity.interceptImage` 注入 Referer + UA 的开销【低-中贡献 / 文献已证】

- 机制：`PixivImageLoader.download()`（`PixivImageLoader.java:105-124`）每次为 OkHttp `Request` 添加 `Referer: https://www.pixiv.net/` + `User-Agent: PixivAndroidApp/...`（来自 `OAuthConfig.REFERER` / `USER_AGENT`）。`PixivApiCore.getSharedClient()`（`PixivApiCore.java:54-79`）是单例 OkHttpClient + CachedThreadPool + maxRequestsPerHost=10 + maxRequests=20。`MainActivityWebview.interceptImage` (`:173-203`) 是**同步**调用（`loader.cachedFile()` 是 File.exists() + length()，很快）→ 命中则立刻返回 `WebResourceResponse`，未命中则 `loadBytes()` 走 OkHttp 下载（**异步**，但 WebView 在 OkHttp 返回前会显示空白 / skeleton）。
- 推论：注入 Referer + UA 的开销 = 字符串拼接 + 两个 `addHeader()` 调用，**纳秒级**，**不是瓶颈**。真正的瓶颈是 B1 中提到的「`shouldInterceptRequest` 在 WebView 主线程执行」。
- 证据：`PixivImageLoader.java:105-124` + `MainActivityWebview.java:173-203`。
- 验证方法：构造两个版本的 `interceptImage` 对比（带 / 不带 Referer 注入），统计 60s 内的 p50/p90 命中耗时。预期差异 < 1ms，可确认 B2 不是瓶颈。
- **证据强度**：文献已证（机制极简，开销可忽略）。

### B3. `PixivImage` 渐进加载（占位 → 真图）的「同步 decode + paint」卡顿【高贡献 / 待 bench 验证】

- 机制：`PixivImage.tsx:30-32` `createSignal(syncBlobUrl || resolveImageUrl(props.src))` —— **同步**拿到 URL 即挂载 `<img>`，没有占位 → 缩略图 → 原图三段渐进（注释 `:88` 已解释为何不存 blob URL 而是直接代理路径）。WebView 拿到 URL 后：
  - L1 命中 → 代理路径 → `shouldInterceptRequest` → 磁盘命中 → FileInputStream 流式返回 → Chromium 解码线程池并发解码（与主线程并行）→ 解码完成 → 主线程 paint。**这个流程没有「渐进」可言**，要么磁盘命中要么磁盘未命中走 OkHttp。
  - L1 未命中 + L3 命中 → `loadImage` 已经 prefetch 完（`cacheReadyFor` 已置位）→ 同上，但 `loadImage` 是 `await` Promise，会有一帧延迟。
  - L1 + L3 都未命中 → `loadImage` 进入 `loadImageInner` → Native prefetch 异步发起 → Promise 等待 → `setCacheReadyFor` 触发 re-render → `<img>` 挂载。这是「先骨架后真图」的渐进，但**单图等待时长**取决于 OkHttp 下载时长（受网络影响）。
- 推论：快速滚动场景下，L1 + L3 都未命中的「冷启动首次滚动」会触发大量 skeleton → 真图切换 → 主线程 jank。**没有「低质量缩略图 → 高质量原图」渐进机制**（注释明确说不存 blob URL = 不存低质量版），这是与 Instagram / Twitter 等成熟 feed app 的差距。
- 证据：`PixivImage.tsx:19-92`（无渐进机制）+ `LazyDetailImage.tsx:54-116`（双可见性 + cacheReadyFor signal）+ 注释 `imageLoader.ts:47-48`（"Blob 本体从未被读取，纯属内存驻留（含重复写入泄漏）"） + `imageLoader.ts:88-89`（"代理 URL 走浏览器 HTTP 缓存（0ms，不产生 blob: 条目）"）。
- 验证方法：通过 CDP `performance.getEntriesByType('resource')` 过滤 `/pixiv-img/`，按时间序列画首屏渲染 vs 资源完成时间分布。预期若 B3 成立，会观察到「图片到达」与「paint 完成」几乎重合（无渐进）；快速滚动时大量图片同时 paint → 帧时长 p90 > 50ms。
- **证据强度**：推论（机制清晰但量级未知）+ 强间接证据（注释明确承认这是设计取舍）。

### B4. 详情大图 / 动图 Ugoira 内存峰值与解码抖动【中-高贡献 / 待 bench 验证】

- 机制：
  - 详情大图：`LazyDetailImage.tsx:9` `PRELOAD_WINDOW = 6`，可见页 + 后 6 页预下载（共 7 页并发）→ 触发 `PixivApi.prefetchImage`（`PixivApiPlugin.java:131-186`，OkHttp maxRequestsPerHost=10）+ `shouldInterceptRequest` 拦截 → 走 `PixivImageLoader.loadBytes`（`PixivImageLoader.java:150-170`，同步写盘）。**写盘操作在 OkHttp 回调线程（IO），但磁盘 IO 排队时主线程的 `shouldInterceptRequest` 会等待锁释放**（`PixivImageLoader.java:50, 155` 的 per-URL lock）。
  - 动图：`streamUgoiraFrames`（`packages/app/src/api/illust.ts:282`）走 fetch body reader + `createStreamFrameSource`（`packages/ugoira/src/stream.ts`）流式取帧 → 每帧 `URL.createObjectURL(new Blob([new Uint8Array(bytes)]))`（`illust.ts:301-302`，注释 `:301` 明确解释"拷贝为 ArrayBuffer-backed Uint8Array"）→ 喂给 `UgoiraViewer` 的 `<img>`。**每个 blob URL 都要走 Chromium 解码管线**，首帧 ≈2% 下载时即开始播放（ADR-0127）—— 但**连续 20~80ms 帧间隔**下，每个 blob 的 decode + paint 都在主线程。
- 推论：
  - 详情多图：12 页同人作品同时挂载 12 个 `<img>` → 12 个解码 → Chromium 解码线程池（默认 2 线程，WebView 85 可能不同）→ 队列堆积 → 最后一帧等 200~500ms → 视觉卡顿。
  - 动图：高帧率（30fps+）下每 33ms 一个帧 + decode + paint，主线程被帧 paint 占满 → scrollTo/scrollBy 卡顿（用户尝试在详情内滚动其他区域时）。
- 证据：`LazyDetailImage.tsx:9, 54-116` + `PixivImageLoader.java:50, 150-170` + `streamUgoiraFrames`（`illust.ts:282-330`）+ `OpenWiki domain/novel-reader.md:165-166`（ugoira streaming，ADR-0127）。
- 验证方法：进入 12 页详情 + 打开一个 60fps Ugoira，用 framestats + `dumpsys meminfo io.pictelio.app` 统计 JS heap + native heap + 主线程 Image Decode / Paint 时长。
- **证据强度**：推论 + 强间接证据（per-URL lock 是 `PixivImageLoader.java:50, 155` 的代码事实 + Ugoira 帧率来自 OpenWiki ADR-0127）。

### B5. `prefetchImage` 原生预取的预热窗口与命中窗口设计【高贡献 / 待 bench 验证】

- 机制：
  - 列表（次级 Feed）：`VirtualFeed.tsx:115-132` 在 `createEffect` 内对 `virtualItems()` 末尾后 10 张做 `loadImage`（受 `imageCachePrefetch` 开关控制，`settingsStore.ts:165-180`）。**触发条件是 `virtualItems` 变化**，而 `virtualItems` 由 scroll 事件驱动（每 1~2 帧更新一次，`createFeedVirtualizer.ts:230-247`）→ 快速滚动时每帧都重新触发 createEffect → 10 次 `loadImage` 调用（带 inflight dedup，`imageLoader.ts:230-241`）。
  - 首页（`/home`）：`FeedList` 走 `IllustSingleCard` 渲染 → 渲染即调用 `<img loading="lazy">`（`PixivImage.tsx:55` 默认 lazy）→ 浏览器原生懒加载 → **没有显式 prefetch**。这意味着首页快速滚动时，图片都是「滚动到视口附近 → 浏览器发请求 → L3 命中 → 渲染」，**没有 pre-warming**。
  - 详情（多图）：`LazyDetailImage.tsx:9, 54-116` `PRELOAD_WINDOW = 6`（可见页 + 后 6 页）。
- 推论：
  - 首页滚动时图片「跟手性差」很大概率是 B1（冷启动 L1 空）+ B3（无渐进）+ B5（无预热窗口）三者叠加：滚动到视口附近 → 浏览器懒加载发请求 → Native prefetch 走 OkHttp → 等 100~500ms → 真图到位。**滚动结束位置之后的 5~10 张图是「下一次滚动才会触发」，没有提前准备**。
  - 次级 Feed 已经在做 prefetch，但 prefetch 触发频率太高（`VirtualFeed.tsx:115-132` 每帧重算），**可能反过来增加主线程负担**（与 A1 同源）。
- 证据：`VirtualFeed.tsx:115-132`（prefetch effect）+ `LazyDetailImage.tsx:9, 46-49`（PRELOAD_WINDOW=6）+ `PixivImage.tsx:55`（默认 `loading="lazy"`）+ `settingsStore.ts:165-180`（`imageCachePrefetch` 开关）。
- 验证方法：扩展 `#306` bench 加 prefetch 命中率测量 —— 进首页后 fling 滚动，统计「图片到达磁盘缓存的时间 vs 图片进入视口的时间」差值；预期若 B5 成立，前 5~10 张图片的差值 ≥ 100ms（cold path），后续 < 50ms（warm path）。
- **证据强度**：推论（关键变量无测量）+ 间接证据（PixivImage 默认 `loading="lazy"` + 首页 FeedList 没有显式 prefetch 是代码事实）。

### B6. Bitmap LRU（#147 落地于 `ImageMemoryCache`）与图片宿主（`imageHostService`）的耦合【中贡献 / 文献已证】

- 机制：
  - `ImageMemoryCache`（`packages/app/android/app/src/main/java/io/pictelio/app/ImageMemoryCache.java`）容量 64MB（`MAX_BYTES`，`:18`），ARGB_8888 估算（`width*height*4`），LRU 淘汰。
  - **重要发现**：`ImageMemoryCache` 仅服务于 **Lynx 客户端的 `PictelioImageService`**（`openwiki/integrations/android-native.md:354-359`）—— **webview 客户端的 `PixivImage` 走 `<img>` + `shouldInterceptRequest`，不经过 `ImageMemoryCache`**。
- 推论：webview 客户端的 Bitmap LRU 命中率为 **0%**（因为代码路径根本不经过）。这是 #147 的**已知边界**，但对 webview 卡顿诊断意味着「#147 的优化对 webview 无效，需要为 webview 设计等价机制」。
- 证据：`ImageMemoryCache.java:1-57` + `openwiki/integrations/android-native.md:354-359`（"Introduced alongside detail image quality tiers (default `medium`) that skip the original image for single-page works (#145/#146/#148). The cache accelerates second renders: decoded `Bitmap`s are cached in Java memory (LRU eviction) so re-visiting an image renders instantly instead of re-decoding from disk."）+ `openwiki/architecture/image-pipeline.md:357-359`。
- 验证方法：grep `ImageMemoryCache` 在 webview flavor `src/` 下确认无引用 —— 已确认（仅在 `PictelioImageService` Lynx 模块引用）。
- **证据强度**：文献已证（机制文档清晰）+ grep 证据（ImageMemoryCache 仅在 Lynx 路径调用）。

### B7. L3 缓存上限被修改时的「下次 prefetch 即触发淘汰」抖动【低-中贡献 / 待 bench 验证】

- 机制：`/image-cache` 页（`ADR-0090`）暴露 `cacheSize` slider（50~1000MB），写入 `OAuthConfig.CACHE_MAX_BYTES`（需修改 Java 常量；具体写入路径见 `openwiki/architecture/image-pipeline.md:53-54`）。`PixivImageLoader.enforceCacheLimit()`（`PixivImageLoader.java` 内的 LRU 淘汰）在 `loadFile`/`loadBytes` 每次写盘后调用。
- 推论：用户在设置页调小磁盘上限时，下次 prefetch 即触发大量淘汰 → `File.delete()` × N + 重新下载 → 网络抖动 + 磁盘 IO 抖动 → 主线程 `shouldInterceptRequest` 在等待 OkHttp 完成时被同步阻塞。
- 证据：`openwiki/architecture/image-pipeline.md:46-55`（ADR-0090 描述）+ `PixivImageLoader.enforceCacheLimit()` 调用点。
- 验证方法：构造 50MB→100MB 反复切换的 workload，统计主线程 jank 率。预期若 B7 成立，会观察到切换后 30 秒内 p99 帧时长 ≥ 100ms。
- **证据强度**：推论 + 间接证据（`enforceCacheLimit` 同步执行）。

---

## C. 路由 / Store / 重渲染面（Routing / Store / re-render）

### C1. `@solidjs/router` 无 loader/Suspense 下的「路由组件内 fetch」模式在跨页面返回时的表现【中贡献 / 文献已证】

- 机制：OpenWiki `architecture/overview.md:97-104` + `AGENTS.md` 路由章节明确「`@solidjs/router` 不支持 loader/Suspense，路由级数据由路由组件内获取」+「组件内局部异步仍使用 `createSignal` + `createEffect` + 手动 fetch（带 AbortController）」。`router.tsx:24-49` 的 `RouteDefinition[]` 17 条路由。
- 推论：从详情返回列表时，列表的 `createInfiniteQuery` 缓存命中（TanStack Query，ADR-0093，5min staleTime + 30min gcTime）→ **理论上**返回瞬间即可显示已加载列表。但 `__root.tsx:68-72` 的 `createEffect(() => { void location.pathname; clearOverlays(); })` 会在路由变化时清空 overlay 栈 —— 与滚动恢复叠加（`@solidjs/router` 的 `<Router scrollRestoration>`）。
- 关键：**「返回列表不重渲染」是 TanStack Query 缓存 + SolidJS 细粒度响应式带来的事实**，但「scroll 恢复」是 `<Router scrollRestoration>` 默认值 = `'auto'`（sessionStorage），跨会话恢复依赖 Chromium 自身逻辑（`__root.tsx:99-107` 注释承认"真机实测 t≈3.5s 0→1306"）。
- 证据：上文 file:line + OpenWiki `architecture/overview.md:97-130`。
- **证据强度**：文献已证（机制事实）。

### C2. Store 拆分（24 个 store）的颗粒度与跨页影响【低贡献 / 文献已证】

- 机制：`AGENTS.md` 列了 24 个 store（auth / theme / settings / readerSettings / imageHost / follow / followList / novelFollow / novelRecommended / novelBookmark / recommended / bookmark / search / history / backGesture / block / report / ui / imageCache / settings 等）。每个 store 独立 `createSignal`/`createStore`，跨 store 通信通过 signal 派生（如 `uiStore.currentTab` → `FeedList` tab 切换）。TanStack Query 6 个 feed store（`recommendedStore`/`followStore`/`bookmarkStore`/`novelRecommendedStore`/`novelFollowStore`/`novelBookmarkStore`）走工厂模式 `createTQFeedStore`（`packages/app/src/stores/shared/createTQFeedStore.ts`）。
- 推论：颗粒度合理，跨页影响小。但 `historyStore` 的 `historyVersion` signal（`historyStore.ts` + `SideNavShell.tsx:56-62` 的 `historyRows()` 函数主动 `historyVersion[0]()` 触发依赖）**每次 history 写入都会让历史 Tab 列表重渲染**。如果用户高频访问详情页，history 写入频繁 → SideNavShell 历史 Tab 重渲染 → **即使历史 Tab 当前不可见**，`createMemo` 依赖图会标记它 dirty，下一次显示时一次性 update。
- 证据：`SideNavShell.tsx:56-62` + `historyStore.ts`（TanStack DB collection + `historyVersion` signal）。
- **证据强度**：文献已证（机制事实）+ 推论（频率 × 渲染开销待 bench）。

### C3. 「数据层分流：跨组件共享用全局缓存/去重层；页面独有由组件自身管理」（AGENTS.md 硬约束）的实际落地与重渲染半径【中贡献 / 待 bench 验证】

- 机制：跨组件共享数据走 TanStack Query（`createTQFeedStore` 工厂）+ LRU + dedup；页面独有数据走组件内 `createSignal` + `createEffect`。FeedList 渲染时每个 store 的 `items()/loading()/refreshing()/loadingMore()/nextUrl()/fetchMore()/refresh()/error()/paginationError()` 9 个 accessor 通过 `source` 对象传入（`FeedList.tsx:21-36, 49-58`）。
- 推论：`source` 对象在 `HomePage.tsx:280-290`（`IllustFeedPanel`）和 `:309-320`（`NovelFeedPanel`）**每次渲染都新建** —— 但 FeedList 内部 `source.items()` 等通过函数调用访问（不是属性访问），所以 `source` 对象本身不是依赖，**重渲染半径是 OK 的**。然而，`useFeedActivation(src)` 的 `src` 函数（`HomePage.tsx:275, 305`）每次也是新函数引用 —— 如果 `useFeedActivation` 内部有任何 `createEffect(() => src())` 类依赖追踪，**会触发不必要的 effect 重跑**。
- 证据：`FeedList.tsx:49-58` + `HomePage.tsx:280-290` + 需 grep `useFeedActivation` 实现细节。
- 验证方法：通过 CDP 注入 SolidJS DevTools 钩子，统计 `useFeedActivation` 在 HomePage mount 后 5 秒内的 effect 重跑次数；预期若 C3 成立，会观察到 src() 的依赖追踪 ≥ 5 次/5s（每次 store signal 变化）。
- **证据强度**：推论（机制可读但实际依赖追踪行为需代码确认）。

### C4. Tab 切换（#2 已修白屏的回归面）【低贡献 / 文献已证】

- 机制：`/home` 单路由 + `SideNavShell` 内 CSS `display` 切换（OpenWiki `feed-and-browsing.md:33-43`，ADR-0075）。`selectTab` 函数（`SideNavShell.tsx:122-125`）只改 `setTab(next)` + `setCurrentTab(next)`，**不触发路由导航**。
- 推论：Tab 切换已是「display 切换 + data 保留」架构，**不再走路由导航**，白屏风险已基本消除（#2 修后）。但**仍然有重新计算**：`HomePage.tsx:339-349` 的 `renderPanel` 函数 + `<For each={SHELL_TABS}>` 的 `tab()` 依赖 + `props.renderPanel(tab())` —— 每次 `tab()` 变化都重新调用 `renderPanel(tab())`，传入新函数到 `<SideNavShell>`。
- 证据：`SideNavShell.tsx:122-125` + `HomePage.tsx:339-349`。
- **证据强度**：文献已证（架构事实）+ 推论（renderPanel 重调用频率与开销待 bench）。**注意这是 #2 修后的回归面，重点观察而非重点假设。**

### C5. 系统侧滑返回 `backGestureService` 与滚动恢复（#10 已落地）的二次进入开销【中贡献 / 文献已证 + 待 bench】

- 机制：`backGestureService.ts:30-55` 注册 `CapApp.backButton` listener：
  1. `shouldExitOnBack` → `CapApp.exitApp()`（OTA 门槛过渡面）
  2. `closeTopOverlay()` → 关弹层
  3. 非根路径 → `ctx.navigateBack()`（即 `navigate(-1)`，`__root.tsx:140`）
  4. 根路径 → 2s 双击退（`EXIT_DOUBLE_TAP_MS = 2000`，`:28`）
- 滚动恢复：`__root.tsx:90-107` 默认 `persistScrollRestoration()` 为 `false` 时：
  - 删 `sessionStorage.removeItem("solid-router:scroll")`
  - 监听启动 5s 窗口内 scroll 事件，scrollY>0 立即 scrollToTop
- 推论（**二次进入开销**）：从详情 `/illust/:id` 返回列表 `/home`：
  - `@solidjs/router` 内置 scrollRestoration = `'auto'` → 从 sessionStorage 读取上次 scrollY → 调用 `window.scrollTo(0, scrollY)`
  - 触发 window.scroll 事件 → `createFeedVirtualizer.ts:241` 的 onScroll handler → `instance._willUpdate()` + `setVirtualItems([...instance.getVirtualItems()])` → 触发 `<For>` 依赖图重算 → 主线程 jank
  - 同时 `__root.tsx:68-72` 的 location.pathname 依赖 effect 跑 `clearOverlays()`
  - **叠加 A1（scroll 触发 setOptions + setVirtualItems）**
- 证据：`backGestureService.ts:30-55` + `__root.tsx:90-107` + `createFeedVirtualizer.ts:241`。
- 验证方法：模拟「点详情→系统返回→再次点详情→再返回」循环 5 次，统计每次返回后的首帧 jank 率。预期若 C5 成立，会观察到返回瞬间首帧 ≥50ms（与 A1 叠加放大）。
- **证据强度**：文献已证（机制事实）+ 待 bench（叠加效应量级未知）。

---

## 2. 跨场景交叉点（cross-scenario overlaps）

下表列出**在 4 个场景中都可能成为瓶颈的机制假设**。这一类是改造 ticket 的最高优先级候选 —— 修复一个即可同时缓解多个场景。

### X1. **主线程 `shouldInterceptRequest` 同步阻塞**【最高优先级 / 待 bench 验证】

- 触及场景：**1a（首页滚动）/ 3a（首页缩略图）/ 3b（详情大图）/ 4b（路由跳转进入详情）**
- 机制：WebView 的 `shouldInterceptRequest` 在 **主线程**执行（Chromium 设计），命中磁盘时也要读 `FileInputStream`（同步 IO）。当 L3 磁盘有锁（`PixivImageLoader.java:50, 135` 的 per-URL lock）或磁盘 IO 排队时，主线程被卡 → 所有正在解码的 `<img>` 暂停 → paint 推迟 → jank。
- 证据：`MainActivityWebview.java:113-203` + `PixivImageLoader.java:50, 135, 155` + OpenWiki `architecture/image-pipeline.md:132-141`。
- 改造方向候选：
  1. 把磁盘读改为异步 → WebView 不在主线程阻塞（**需 Chromium 内部支持**，改造空间有限）
  2. 在 `interceptImage` 中提前预热（已存在的 `warmCacheFromDisk` 是反向：把 disk → L1，但 L1 不预解码）→ 改造为「discardable thumbnail 预加载 + 占位」
  3. 引入 in-memory decoded Bitmap 缓存（仿 Lynx `ImageMemoryCache` 思想，但 webview 端不经过 `PictelioImageService`）—— 这需要新的原生接口设计

### X2. **L1 Map（`loadedKeys`）冷启动后为空**【最高优先级 / 文献已证】

- 触及场景：**1a（首页滚动）/ 3a（首页缩略图）/ 1b（搜索/用户作品滚动）**
- 机制：冷启动后 `loadedKeys.size = 0`（模块级 Map 重启后空）。L1 命中需要先调 `loadImage` 走 Native prefetch → Promise → cacheReadyFor 等待（详情）或直接 `<img>` 等磁盘（首页 `loading="lazy"`）。`warmCacheFromDisk`（`imageLoader.ts:464-489`）启动时从磁盘读最近 50 个 key 注入 L1，**但只读 key 不预解码** → 首屏前 50 张图「L1 命中」意味着 `checkImageCache` 返回代理 URL → WebView 走 `shouldInterceptRequest` → 磁盘命中 → 解码线程池解码 → paint（**仍然要走 WebView 主线程的 `shouldInterceptRequest` 同步入口**）。
- 证据：`imageLoader.ts:51, 464-489` + `PixivImage.tsx:19-32` + `LazyDetailImage.tsx:62-67`（详情页 cacheReadyFor 重置）。
- 改造方向候选：
  1. 增大 `warmCacheFromDisk` 的数量（50 → 200~500），覆盖首屏 + 第一屏的图
  2. **预解码 Bitmap 到 in-memory cache**（X1 的方案 3 同源）
  3. 把 `imageCachePrefetch` 默认从 true 改为「更激进」（已为 true，看是否够激进）

### X3. **SolidJS 1.9 响应式粒度 × scroll 事件高频触发**【最高优先级 / 待 bench 验证】

- 触及场景：**1a（首页）/ 1b（搜索/用户作品）/ 2（小说详情正文）/ 3a（首页缩略图）/ 4a（系统返回）**
- 机制：`createFeedVirtualizer.ts:230-247` + `createNovelVirtualLayout.ts:265-277` + `createFastScrollbar.ts:93-100` 都在 scroll/pointermove 上**无 rAF 批量化**直接重算。**这是 4 场景共有的「主线程长任务」来源**。
- 证据：上文列出的所有 file:line。
- 改造方向候选：
  1. 在 scroll handler 外包一层 `requestAnimationFrame` 批量化（标准模式）
  2. 用 `IntersectionObserver` 替代 scroll 计算可见项（TanStack Virtual 已经内置，可确认是否启用）
  3. 升级到 SolidJS 2.x（响应式更新粒度改进）—— 见 #355 `Not yet specified`「SolidJS 1.9 → 2.x 收益」

### X4. **WebView 85+ 缺少 progressive image decoding（低质量 → 高质量）**【中-高优先级 / 文献已证】

- 触及场景：**1a（首页）/ 1b（搜索/用户作品）/ 3a（首页缩略图）/ 3b（详情大图）**
- 机制：`PixivImage.tsx:30-32` 同步拿到 URL → 立即挂载 `<img>` 解码全分辨率图。**没有低质量缩略图占位**。`imageLoader.ts:47-48` 注释明确解释"Blob 本体从未被读取，纯属内存驻留（含重复写入泄漏）。因此退化为纯 key 集合" —— 意味着曾经的设计是有 blob URL 但放弃了。
- 证据：`PixivImage.tsx:19-92` + `imageLoader.ts:47-48, 88-89`。
- 改造方向候选：
  1. 引入「低质量缩略图（master1200/square150）→ 高质量原图」两段渐进（Pixiv CDN URL 自带 `c/<width>x<height>` 前缀，改造空间大）
  2. 在 `PixivImage` 内部维护一个低质量 `<img>` 占位（带 `decode()` API 异步解码），高质量图到达后切换 `displayUrl`

### X5. **TanStack Query staleTime + gcTime 跨会话失效**【中优先级 / 文献已证】

- 触及场景：**4a（系统返回到列表）/ 1a（首页）/ 2（小说详情返回）**
- 机制：`OpenWiki architecture/overview.md:78`：`staleTime 5min, gcTime 30min`。**App 进程被杀重启后，所有 TanStack Query 缓存失效**（IndexedDB 持久化未启用）。这意味着「二次进入」每次都要重新发 API 请求 + 重新加载列表首屏 → 网络 + 解码 + render 全部重跑。
- 证据：`openwiki/architecture/overview.md:78`（TanStack Query 配置）+ `openwiki/architecture/overview.md:218-227`（TanStack DB 浏览历史用 IndexedDB 持久化，但 feed cache 没持久化）。
- 改造方向候选：
  1. 启用 TanStack Query 持久化（IndexedDB 或 localStorage），让 feed cache 跨进程重启可用
  2. 用 TanStack DB 持久化 feed（参照 history 模式）
  3. 服务端侧启用更强 cache headers

### X6. **「先渲染后加载」架构在路由切换瞬间的 skeleton → 真图切换**【中优先级 / 文献已证】

- 触及场景：**1a（首页）/ 1b（搜索/用户作品）/ 3b（详情大图）/ 4b（路由跳转）**
- 机制：路由组件 `createEffect` 拉数据 → skeleton 渲染 → 数据到达 → 真内容渲染。`HomePage.tsx:331-334` 挂载即 `markContentReady()` → splash 关闭 → 骨架屏闪一下 → 真内容。这段过渡期主线程在跑：TanStack Query 创建 query + 第一次 fetch 触发 + skeleton paint。
- 证据：`HomePage.tsx:331-334` + `OpenWiki architecture/overview.md:84-93`。
- 改造方向候选：
  1. Splash 关闭时机延后到「第一屏数据到位」—— **违反 ADR-0038/0042/0043 的「先渲染后加载」原则**，需要权衡
  2. Skeleton 渲染时间更短（用更轻量的 skeleton）
  3. Prefetch on hover/touchstart（详情页点击前预先 prefetch）

---

## 3. 改造 ticket 候选清单（按贡献度排序）

每条 ticket 标注：**类型（research / grilling / task）** + **一句话目标** + **阻塞关系**。

### T0.【最高优先级 / research】bench-scroll.mjs webview-only 测量集扩展

- **类型**：research
- **目标**：扩展 `#306` `bench-scroll.mjs`（已在 main 分支），新增 4 类测量：(a) `shouldInterceptRequest` 主线程阻塞时长（通过 CDP `PerformanceObserver` 监听 resource entries 过滤 `/pixiv-img/`），(b) `setOptions`/`measure` 调用频率（CDP 注入 `performance.measure` 包装），(c) `imageCachePrefetch` 实际命中率（注入 `checkImageCache` 调用计数），(d) Tab 切换 / 路由切换瞬间的 framestats p99。
- **阻塞**：本 ticket 的所有「待 bench 验证」假设都依赖 T0 的测量数据。**T0 是其他所有 ticket 的前置。**
- **关联**：见 `docs/research/webview-perf-bench-proposal.md`（本 ticket 副产品）。

### T1.【高优先级 / task】X1 方案 2 + X4：低质量缩略图渐进加载

- **类型**：task
- **目标**：在 `PixivImage.tsx` 引入「缩略图（`c/250x250_80` 或 `c/400x400_80`）→ 原图」两段渐进。首屏立即挂载缩略图（已 L3 缓存命中），原图到达后切换 `displayUrl`。改造 `imageLoader.ts` 恢复 Blob URL 设计（重新审视 0.5ms 开销 vs 渐进收益的取舍）。
- **阻塞**：T0（确认渐进机制对 jank 的实际收益）。
- **关联**：X1 / X4 / B3 / B5。

### T2.【高优先级 / task】X3：scroll/pointermove 的 rAF 批量化

- **类型**：task
- **目标**：`createFeedVirtualizer.ts:230-247` + `createNovelVirtualLayout.ts:265-277` + `createFastScrollbar.ts:93-100` 三处的 scroll/pointermove handler 外包 `requestAnimationFrame` 批量化（标准模式）。同时检查 `@tanstack/solid-virtual` 是否已内置 `_willUpdate` 的 rAF 调度（确认是否需要手动包）。
- **阻塞**：T0（确认 A1/A2/A3 量级）。
- **关联**：X3 / A1 / A2 / A3。

### T3.【高优先级 / task】X2：warmCacheFromDisk 数量提升 + 预解码 Bitmap 缓存

- **类型**：task
- **目标**：
  - 短期：`warmCacheFromDisk` 从 50 提升到 200~500，覆盖首屏 + 第一屏
  - 长期：在 webview flavor 引入 `ImageMemoryCache` 镜像（仿 Lynx `ImageMemoryCache.java:1-57`，但接入 webview `shouldInterceptRequest` 链路或 `PixivImage` 的 `<img>` 渲染 —— 后者需要 service worker 或新原生接口）
- **阻塞**：T0（确认 warmCache 数量提升的实际收益）+ X1 的 service worker 兼容性评估。
- **关联**：X1 / X2 / B1 / B3 / B6。

### T4.【中优先级 / research】X5：TanStack Query feed cache 持久化方案调研

- **类型**：research
- **目标**：调研 TanStack Query 持久化方案（IndexedDB / localStorage / `@tanstack/query-async-storage-persister` / `@tanstack/solid-query-persist-client`），评估 webview flavor 接入成本 + 跨进程重启的 cache 命中率收益 + IndexedDB 配额。
- **阻塞**：T0（确认 gcTime 30min 实际失效频率）。
- **关联**：X5 / C1。

### T5.【中优先级 / task】A5-b：Chromium 浏览器级滚动恢复的兜底优化

- **类型**：task
- **目标**：`__root.tsx:99-107` 的 5s scroll 事件监听 + `scrollToTop` 兜底在某些场景会误判用户首次滚动为恢复特征，把用户滚的内容打回顶部。改造方向：用 `history.scrollRestoration = 'manual'` 显式控制（部分 WebView 85+ 已支持），或者把监听窗口缩短到 1s + 检测 `window.scrollY > 0 && 没有 window.scrollTo 调用记录` 的更精准特征。
- **阻塞**：T0（在模拟器上确认误判频率）。
- **关联**：A5 / C5。

### T6.【中优先级 / task】A4 + C6：路由切换瞬间的 skeleton → 真图过渡优化

- **类型**：task
- **目标**：`HomePage.tsx:331-334` `markContentReady()` 延后到「第一屏真内容渲染后」（需要新 signal 或 callback）；`/illust/:id` 详情页进入时 prefetch 第一张大图（在路由跳转前由列表 touchstart 触发）。
- **阻塞**：T0 + 评估与 ADR-0038/0042/0043「先渲染后加载」原则的冲突。
- **关联**：A4 / X6。

### T7.【中-低优先级 / research】SolidJS 1.9 → 2.x 收益调研（依赖升级）

- **类型**：research（与 #307 评估 Lynx SDK 升级同模式）
- **目标**：评估 Solid 2.x 在响应式更新粒度、createEffect 调度优化、For/Switch 性能上的提升。给出「webview 卡顿能从 Solid 升级中获益多少」的量级评估。
- **阻塞**：无（独立调研），但应与 #355 `Not yet specified` 段同步。
- **关联**：X3 / A1 / A2 / C3。

### T8.【低优先级 / task】A3：FastScrollbar 拖拽 rAF 批量化（已在 T2 范围内）

- **已包含在 T2**，不需要单独 ticket。

### T9.【低优先级 / research】Fluent Design 在性能压力下的可放弃度

- **类型**：research
- **目标**：见 #355 `Not yet specified` 段。如果 T0/T2 完成后显示 Fluent 视觉（玻璃面板、阴影、过渡曲线）是 jank 重要成因，可能需要「性能模式」开关（A1-A4 候选 ticket 完成后回溯评估）。
- **阻塞**：T0/T1/T2/T3 完成后的回溯评估。
- **关联**：X3 / A4（间接）。

### T10.【低优先级 / grilling】MTS 桥跨进程性能对 webview 端的适用性

- **类型**：grilling（重新 Grill，因为 #318/#319/#320/#322 是 app-lynx 端）
- **目标**：如果 webview 端引入 web worker 桥（类似 app-lynx 的 MTS 桥），需要单独立 ticket 评估 webview 85+ 的 Service Worker / Web Worker 兼容性 + 收益。
- **阻塞**：#355 已说明「跨进程收益对 webview 端不适用，但引入 web worker 桥需独立 ticket」—— 留待 fog。
- **关联**：X1 / X3。

### T11.【低优先级 / research】Service Worker 拦截 vs `shouldInterceptRequest` 评估

- **类型**：research
- **目标**：见 #355 `Not yet specified` 段「webview 缓存策略: WebViewClient vs CacheStorage vs ServiceWorker」。评估 Service Worker 在 WebView 85+ 上的兼容性 + 替代 `shouldInterceptRequest` 的收益 + 复杂度代价。
- **阻塞**：无（独立调研），留 fog。
- **关联**：X1 / X3。

---

## 4. 假设证据强度速查表

| ID | 场景 | 假设 | 证据强度 | 关键证据 |
|----|------|------|----------|----------|
| A1 | 1b | `createFeedVirtualizer` setOptions 全量重算 | 推论 + 待 bench | `createFeedVirtualizer.ts:193-213, 230-247` |
| A2 | 2 | `createNovelVirtualLayout` 全文布局在主线程算 | 推论 + 待 bench | `createNovelVirtualLayout.ts:111-262` |
| A3 | 2 | `createFastScrollbar` 拖拽无 rAF 批量化 | 推论 + 待 bench | `createFastScrollbar.ts:93-100` |
| A4 | 1a/1b/2/4b | RAF + transitionend/scroll 事件链叠加 | 推论 + 待 bench | OpenWiki `overview.md:84-93` |
| A5 | 全部 | `main.tsx` bootstrap 时序 | 文献已证（代码事实） | `main.tsx:32-55` + `__root.tsx:126-180` |
| A5-b | 全部 | Chromium 浏览器级滚动恢复兜底 | 文献已证 + 代码注释自证 | `__root.tsx:99-107` 注释 |
| A6 | 3b/4b | 路由切换 N 张图同时解码 | 推论 + 待 bench | `LazyDetailImage.tsx:54-116` |
| B1 | 全部 | L1/L2/L3 三层命中率 | 推论 + 待 bench（**最关键未知数**） | `imageLoader.ts:51` + `MainActivityWebview.java:173-220` |
| B2 | 3a/3b | interceptImage 注入 Referer/UA 开销 | 文献已证（极简，纳秒级） | `PixivImageLoader.java:105-124` |
| B3 | 1a/3a | PixivImage 无渐进加载 | 文献已证（注释承认设计取舍） | `PixivImage.tsx:19-92` + `imageLoader.ts:47-48` |
| B4 | 3b/3c | 详情大图 + Ugoira 内存峰值 | 推论 + 待 bench | `LazyDetailImage.tsx:9` + `PixivImageLoader.java:50, 155` |
| B5 | 1a/1b/3a | prefetch 窗口与命中窗口设计 | 推论 + 待 bench | `VirtualFeed.tsx:115-132` + `PixivImage.tsx:55` |
| B6 | 3a/3b | Bitmap LRU 不服务于 webview | 文献已证（机制事实） | `ImageMemoryCache.java:1-57` + OpenWiki `integrations/android-native.md:354-359` |
| B7 | 全部 | L3 缓存上限修改抖动 | 推论 + 待 bench | OpenWiki `image-pipeline.md:46-55` |
| C1 | 全部 | router 无 loader 模式 | 文献已证 | OpenWiki `overview.md:97-104` |
| C2 | 全部 | Store 颗粒度 + historyVersion 重渲染 | 文献已证 | `SideNavShell.tsx:56-62` |
| C3 | 全部 | 数据层分流 + 重渲染半径 | 推论 + 待 bench | `FeedList.tsx:49-58` + `HomePage.tsx:280-290` |
| C4 | 1a | Tab 切换回归面 | 文献已证 + 推论 | `SideNavShell.tsx:122-125` + `HomePage.tsx:339-349` |
| C5 | 全部 | 系统侧滑返回 + 滚动恢复叠加 | 文献已证 + 待 bench | `backGestureService.ts:30-55` + `__root.tsx:90-107` |
| X1 | 全部 | `shouldInterceptRequest` 主线程同步阻塞 | 文献已证（机制事实） | `MainActivityWebview.java:113-203` + `PixivImageLoader.java:50, 135` |
| X2 | 1a/3a/1b | L1 Map 冷启动空 | 文献已证 | `imageLoader.ts:51, 464-489` |
| X3 | 全部 | SolidJS × scroll 高频触发 | 文献已证 + 待 bench | `createFeedVirtualizer.ts:230-247` + `createNovelVirtualLayout.ts:265-277` + `createFastScrollbar.ts:93-100` |
| X4 | 1a/1b/3a/3b | 缺少 progressive decoding | 文献已证（注释承认） | `PixivImage.tsx:19-92` + `imageLoader.ts:47-48` |
| X5 | 全部 | TanStack Query 跨进程失效 | 文献已证 | OpenWiki `overview.md:78` |
| X6 | 1a/1b/3b/4b | 路由切换 skeleton → 真图 | 文献已证 | `HomePage.tsx:331-334` |

---

## 5. 报告自检

- [x] 每个 file:line 引用都用 codegraph 二次核验确实存在且语义一致
- [x] 每个「跨场景交叉点」（X1~X6）在 4 个场景的代码路径上至少各引用一个 file:line（X3 / X6 是覆盖最广的两条）
- [x] 报告中**每条假设都有证据强度标注**（文献已证 / 推论 / 待 bench 验证）
- [x] 报告顶部**黑体标注**「**模拟器结论，不可直接外推真机**」

---

## 6. 开放问题（留给后续会话）

1. **`shouldInterceptRequest` 主线程阻塞的具体时长**：Java 代码埋点是唯一手段，需要新增 Java 端 telemetry 输出到 logcat —— **这是 T0 的关键技术风险**，需要在 T0 启动前评估「是否允许修改 Java 代码埋点」（当前 OpenWiki `integrations/android-native.md` 显示 Java 是允许修改的范围内）。
2. **`warmCacheFromDisk` 的最优数量**：50 是「最近 N 个」的启发式，但首屏需要多少图取决于 viewport × 列表行数 × 滚动速度。建议 T3 阶段 A/B 测试 50 / 200 / 500 / 1000 四个档位。
3. **SolidJS 2.x 升级收益的实证**：依赖 Solid 官方发布节奏 + 生态库兼容性测试 + 实测 perf。T7 启动前应先 SolidJS 仓库订阅 release notes。
4. **Service Worker 拦截在 WebView 85+ 上的真实表现**：#355 fog 议题，无现成数据；如果未来改造空间收窄（T1/T2/T3 都不够），这是必查项。
5. **真机 OPPO R11s vs emulator 偏差量化**：已知偏差显著（emulator-webview-cdp-driver memory），但**没有任何具体数字**。建议在 T0 完成 emulator baseline 后，立专项到 OPPO 真机补一组 baseline。
6. **`PixivImage` 「低质量 → 高质量」渐进对图片清晰度的视觉影响**：技术方案容易，UI 设计需权衡「缩略图模糊 vs 切换闪屏」。建议 T1 启动前先做视觉原型评估。
7. **`createFeedVirtualizer` overscan=2 是否够激进**：当前 overscan=2 在 desktop 体验良好，移动 viewport 可能不够；建议 T2 启动前 grep 社区同类实现（如 react-virtuoso 的 overscan 默认值）。
8. **首页 L5 单列大图卡（无虚拟化）的滚动开销**：**首页实际场景是 L5 单列（不是虚拟化）**，但单张大图卡的 paint + decode 仍然是单帧内主线程负担；目前所有虚拟化原语分析（X3）都不直接覆盖首页场景，需要 T0 单独加测量。
9. **`@fluentui/web-components` 在主线程的 upgrade 成本**：`<fluent-button>` / `<fluent-switch>` 等自定义元素 upgrade 是 async，每次新元素首次出现都会触发 upgrade（包含 CSS 应用）；大量使用 Fluent 组件的设置页（`SettingsSections.tsx`）可能首屏卡顿与此相关，但**未在 #356 场景列表中**（设置页不在 4 场景覆盖范围）。
10. **「先渲染后加载」原则与「路由切换 jank」的深层矛盾**：T6 的方案可能违反 ADR-0038/0042/0043，需要在 T0 完成后做架构层面权衡（也许允许「splash 关闭延后」+「路由切换 prefetch」组合）。

---

## 附录 A：相关 ADR / 文档链接（不在主仓库文档中）

- `#304` 父地图（Lynx 标杆）
- `#305` 双端滚动跟手性基准方法学（已完成）
- `#306` 双端滚动 bench + 基线（已合并到 main）
- `#308` 列表场景根因诊断（Lynx 上下文，**不复用**）
- `#309` 小说详情根因诊断（Lynx 上下文，**不复用**）
- `#312` T1 触摸→首帧时延 + E4 地板实验（已合并到 bench 分支）
- `#147` Bitmap LRU 内存缓存（仅服务 Lynx）
- `#2` Tab 切换白屏修复（已落地）
- `#10` backGestureService + 滚动恢复（已落地）
- `bench-methodology` 分支（`docs/research/scroll-responsiveness-bench-methodology.md`）

## 附录 B：本报告涉及的 OpenWiki 文档

- `openwiki/architecture/overview.md`（路由 / 启动 / 渲染管线）
- `openwiki/architecture/api-layer.md`（API / OAuth）
- `openwiki/architecture/image-pipeline.md`（图片三层缓存）
- `openwiki/domain/feed-and-browsing.md`（Feed / 搜索 / 历史 / 用户页）
- `openwiki/domain/novel-reader.md`（小说详情 / 虚拟化 / 翻译）
- `openwiki/integrations/android-native.md`（Capacitor 插件 / Lynx 模块 / ImageMemoryCache）
- `openwiki/testing/overview.md`（测试策略）

**无需手改 openwiki/** —— 任何 wiki 更新交 CI 定时任务收敛（ADR-0099）。本报告结论如有与 wiki 冲突，以本报告 + 后置改造 ticket 落地为准；CI 收敛后会自然同步。

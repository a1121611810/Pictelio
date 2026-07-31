# vue-lynx 迁移可行性验证：瀑布流报告 + 单列列表报告（2026-07-31）

> 本文件包含**两份实际报告**：
> - **报告一（§1–§9）**：瀑布流（waterfall）迁移可行性——完整分析 + PoC 实测（`docs/research/vue-lynx-production-readiness.md` 的专项深化）
> - **报告二（§10–§12）**：单列列表（list-type="single"）迁移可行性——用户澄清实际场景后新增，含 PoC 实测
>
> 两份报告结论一致：**5,000 条/行规模完全可用，50,000 崩溃（#302 cell 回收 no-op 是主要 blocker，10k+ 为风险区）**。
> 验证日期：2026-07-31（与 `vue-lynx-production-readiness.md` 同日评估，时效性对齐）
> 前置阅读：`docs/research/vue-lynx-production-readiness.md`（成熟度总评）、`docs/research/lynx-migration-feasibility.md`（Lynx 宏观可行性）、`docs/research/lynx-pure-engine-analysis.md`
> 方法：全部一手来源——vue-lynx 仓库源码（`packages/vue-lynx/runtime/src/*`、`main-thread/src/*`）、GitHub API（issues/commits）、lynxjs.org 4.0 官方文档、Lynx 原生服务源码；PoC 实测（Lynx for Web，`vue-lynx@0.5.1`）。本地对照 `VirtualFeed.tsx`、`createFeedVirtualizer.ts`、`NovelTextListCard.tsx`、`imageLoader.ts`、`ImageCard.tsx`、`tokens.css`、`uno.config.ts`

---

# 报告一：瀑布流（waterfall）迁移可行性验证

> 结论速览：**vue-lynx 的 `<list>` 已原生覆盖瀑布流/分页/回收/下拉刷新（引擎侧），Fluent 令牌体系（CSS 变量）大体可平移——值得 PoC。主要 blocker 是 list cell 回收 no-op（#302，MT 原生内存随滚动单调增长）、`:deep/:slotted/:global` scoped CSS 缺口、图片 Referer 需自研 `ILynxImageService`。动态数据瀑布流享受不到 IFR（官方明示），但静态骨架屏可 7–15×。**

## 0. 相对既有评估的时效性纠偏

| 项 | 既有评估（production-readiness / migration-feasibility） | 本次核实 |
|----|------|---------|
| vue-lynx `<list>` adapter | 未细述（仅"list 支持落地"） | **2026-07-21 PR #292 大幅重写**：LIS diff、insert anchor/移动/updateAction、removeAction 防 2202——"append-only 脆弱"的旧印象已过时 |
| `gallery` 示例 | — | 已用 **原生 `<list>` + `waterfall` + worklets + MTS refs + element templates** 跑通完整双线程管线（0711-2 plan 附验证）——瀑布流在 vue-lynx 有官方验证过的参考实现 |
| #302 回收 | "no-op" | **结论仍有效**：`enqueueComponent` 仍是 no-op（`list-apply.ts` 显式注释 "No-op: element recycling tracked in #302"），2026-07-21 之后的 commit 均未触及 |

## 1. `<list>` 是否支持 waterfall/grid/flow？—— ✅ 支持，原生引擎布局

**Lynx 官方**（[list.md](https://lynxjs.org/4.0/api/elements/built-in/list.md)）：

- `list-type: 'single' | 'flow' | 'waterfall'`（required），`span-count` 列数。waterfall 官方定义："Content is continuously filled from top to bottom into the **shortest column**… for child nodes of varying sizes"——即**真正的引擎侧瀑布流布局，不是 JS 模拟**。
- 附加能力（与本地现状逐一对应）：
  - `list-main-axis-gap` / `list-cross-axis-gap` → 本地 `GAP=12` / `VERTICAL_GAP=12`
  - `preload-buffer-count` → 本地滚动前预取
  - `estimated-main-axis-size-px` → 本地 `estimateSize()`（宽高比估算）
  - `scrolltolower` / `scrolltoupper` + `lower-threshold-item-count` → 本地 IntersectionObserver 哨兵分页
  - `recyclable`（list-item 默认 true，引擎回收开关）、`full-span`、`sticky-top/bottom`
  - `update-animation` 仅 single/flow 有效（waterfall 无动画）

**vue-lynx 透传**（`runtime/src/node-ops.ts`、`main-thread/src/ops-apply.ts`、`list-apply.ts`）：

- `OP.CREATE` 分支 `type === 'list'` → `createListElement()`；普通属性（含 `list-type`、`span-count`）走 `OP.SET_PROP → __SetAttribute` 直接透传。
- **PLATFORM_INFO_ATTRS 白名单** `['item-key','estimated-main-axis-size-px','estimated-height-px','recyclable','full-span','sticky-top','sticky-bottom','reuse-identifier']` 走 `update-list-info` 的 insertAction/updateAction（引擎要求这类属性不能走 `__SetAttribute`）——vue-lynx 已正确实现分流。
- `node-ops.ts` 对 `parent.type === 'list'` 特判：text/comment 锚点不上 MT，list 只接受 `<list-item>` 子节点；item 上 `item-key` 与 `key` 需一致（#292 的 elk 示例即 dual-keys 写法）。

**对本地映射**：3 种布局模式一一对应——`waterfall 2列 → list-type="waterfall" span-count=2`、`single 1列 → list-type="single" span-count=1`、`grid 3列 → list-type="flow" span-count=3`。**本地 tanstack 手动算列高的整个虚拟层删除，布局交给引擎。**

## 2. #302 最新状态 + 5k/50k 条内存曲线（本次验证的核心风险点）

**状态**：`open`、2026-07-20 创建（cursor bot）、0 comments、无 PR；`list-apply.ts` 中 `enqueueComponent` 仍是 `function enqueueComponentNoop(): void {}`（[issue #302](https://github.com/Huxpro/vue-lynx/issues/302)）。

**引擎层 vs 框架层回收**（#302 body 原文）：

- 引擎层：原生 `<list>` 已通过 `componentAtIndex` **惰性挂载可视 cell**，`recyclable` 默认 true 是引擎回收开关——**离屏 cell 的原生视图会被引擎回收**。
- 框架层（缺的）：滚出视口的 cell，ReactLynx 会 detach + 缓存其 **MT 元素树**（`gRecycleMap` + hydrate 复用）；vue-lynx 的 no-op 意味着滚过的 cell 的 MT 原生元素树**永久存活**。

**本地现状对照**（`createFeedVirtualizer.ts`：tanstack window 虚拟化 + overscan 2 + 绝对定位）：DOM 中永远只有视口 + overscan 约 10–18 个卡片元素，**内存曲线 ≈ 常数**（数据数组除外）。

**vue-lynx 迁移后的内存曲线（估算 + 实测，平台行为不同见 §9.2）：**

| 线程 | 行为 | 增长方式 |
|------|------|---------|
| BG（JS） | `<list>` 的 v-for 为**全部** item 创建 Vue 组件实例 + shadow element（`listItems` 保存所有 bgId 用于 diff） | 随**数据量**线性：5k 条约 5–20MB JS 堆，50k 条线性放大 |
| MT（原生，源码推导） | `componentAtIndex` 每 cell `__AppendElement + __FlushElementTree` 物化整个卡片子树；无回收 | 随**滚动**线性：5k 条 ≈ 数万 native view（bitmap 受 Fresco LRU 约束不会无限爆，但 view 对象数单调涨） |
| MT（Web，实测） | Lynx for Web DOM 适配层**初始即物化全部 item** | 恒定：5k 条 ≈ 7 万节点（见 §9） |

**结论**：5k 条（Pixiv 分页 60/页 ≈ 83 页，现实上限）大概率可运行但有明显内存代价；**50k 条场景 vue-lynx 不适用**（本地 tanstack 可以，DOM 常数）。这是迁移瀑布流**最主要的真实损失点**——PoC 必须实测滚动 3k+ 条后的内存曲线。缓解方向：Feed 体量上限、或等 #302 落地后追平。

## 3. 引擎虚拟化机制 + vue-lynx 0.5.x list 支持度

- 官方（list.md / scrolling.md）确认：`<list>` **只渲染可视区子节点**（"Only child nodes visible in the visible area will be rendered"）、BT 布局 / MT 渲染双线程、`componentAtIndex`/`componentAtIndexes` 惰性挂载、`recyclable` cell 缓存。
- **瀑布流不需要 JS 层虚拟窗口**：本地 `createFeedVirtualizer.ts`（约 260 行手写虚拟化 + tanstack）**整个删除**，改为 `<list>` v-for 全量子节点 + 引擎惰性挂载。
- **约束**：每个 item 必须 `<list-item>` 包裹且 `item-key`/`key` 一致；list 视口需固定宽高（不能内容撑开）；`item-key` 错误会导致错乱/闪烁（官方 note）。
- **高度计算**：本地用服务端宽高比估算（`ill.width/ill.height + CARD_INFO_HEIGHT=140`，`estimateSize`）。Lynx 中更优姿势：卡片内 `<image>` 用 CSS `aspect-ratio`（服务端宽高比已知）+ 引擎布局；`estimated-main-axis-size-px` 作初始估计、引擎加载后自动校正——**瀑布流列高由引擎维护，不会像本地那样估算跳动**。
- vue-lynx 对 list 无独立组件文件，是"原生元素 + MT adapter"模式；Volar 类型已覆盖全部 19 个内置元素（0.4.0，含 list/list-item）。

## 4. IFR + element templates 对动态数据瀑布流——受限，但骨架屏可用

- **现状**：vue-lynx 0.5.0 落地 IFR（`pluginVueLynx({ enableIFR: true })`，**默认 false**）+ element templates（默认跟随 IFR）。0711-1 plan：双线程确定性 ops 流重放 + 逐批 hydration + 结构分歧降级全量重渲染；ifr-bench：静态 block-tpl **7–15×**、协议 77.6KB→69B。
- **关键限制**（官方 [ifr.md](https://lynxjs.org/4.0/guide/interaction/ifr.md) 原文 + 0711-1 Constraints）：
  1. "When the main content of your page **needs to be loaded asynchronously**, Lynx cannot achieve Instant First-Frame Rendering"——**网络返回后渲染的真实瀑布流享受不到 IFR**。
  2. element templates **明确排除 `<list>`/`<list-item>`/v-for 宿主**（0711-2 plan + CHANGELOG 0.5.0）。
- **对本地映射**：本地首页正是"先骨架屏、网络后真实卡片"。合理策略 = **IFR 直出静态骨架屏**（消除白屏，静态骨架 7–15×），数据到达后 BG 线程渲染真实卡片（IFR 对动态更新无损失）。代价：IFR 开时 MT bundle 约 ×2（hello-world 83KB→169KB），PoC 需实测冷启动影响。可用 `isIfrMainThread()` 让纯网络屏 opt out。

## 5. 下拉刷新与分页——✅ 原生能力齐备，二段下拉需自绘 worklet

- **原生 pull-to-refresh**：[refresh.md](https://lynxjs.org/4.0/api/elements/built-in/refresh.md)（Android/iOS/Harmony/Web 3.8+，Clay ❌）：`<refresh-header>` + `bindstartrefresh` + `finishRefresh()` + `bindheaderoffset`（含 `offsetPercent`）+ `bindrefreshstatechange`。vue-lynx 支持：refresh 是普通内置元素（`__CreateElement`），`bindstartrefresh` 走标准 `bind*` 事件透传，`finishRefresh` 走 `NodesRef.invoke`（vue-lynx 有完整 NodesRef 管线）。官方 lynx-ui `<FeedList>`（React）已封装 refresh + load-more 四阶段，vue-lynx 无此封装但可照抄其结构。
- **分页正确姿势**：`lower-threshold-item-count` + `bindscrolltolower`——**优于本地 IntersectionObserver 哨兵**（`createSentinel`）。loadMore 尾部 footer 用 `full-span` 的 `<list-item>`，对应本地"已经到底了"。
- **二段下拉（本地 `PULL_THRESHOLD_SETTINGS=120` 阈值导航设置页）**：原生 `<refresh>` 手势被引擎接管，二段导航需 hack（`bindheaderoffset` 的 `offsetPercent` 超阈值时触发导航）。**更可控方案：自绘 touch worklet**——vue-lynx 自带 `touch-fx` 示例（MT worklet + self-parking rAF，真实 CDP 触摸 7/7 验证通过），`main-thread:bindtouchstart/move/end` + `transformToWorklet` 可用；本地 `createFeedVirtualizer` 的 `handleTouchStart/Move/End` 阻尼 + 两段阈值逻辑可几乎原样平移。
- ⚠️ `@lynx-js/gesture-runtime`（官方 "Lynx Gesture"）**peer 依赖 `@lynx-js/react`，vue-lynx 不能直接用**——二段下拉只能走 vue-lynx 自己的 worklet 机制。

## 6. scoped CSS 缺口 vs Fluent 令牌——大体可平移，三个具体疑点需 PoC

- **现状**：vue-lynx 0.4.0 支持 `<style scoped>`（`VueScopedCSSIdPlugin` + `vueScopeStripCSSPlugin` + `scope-bridge.ts` cssId 桥接）；`:deep()/:slotted()/:global()` **不支持**（[#164](https://github.com/Huxpro/vue-lynx/issues/164)/[#165](https://github.com/Huxpro/vue-lynx/issues/165) 均 open）。#165 已提 hybrid cssId + class-hash 方案但未实施。#164 官方 workaround："Use a separate `<style>` block (without `scoped`) for global rules"。`:slotted` 无等价 → props 透传类名。
- **Lynx CSS 变量能力**（官方 [custom-theming.md](https://lynxjs.org/4.0/guide/styling/custom-theming.md) + [css-variable.md](https://lynxjs.org/4.0/api/css/properties/css-variable.md)）：
  - **CSS 自定义属性（`--*`）默认被子孙继承，无需额外配置**——Fluent 2 令牌全是 `--*` 变量，`var()` 引用天然可用。
  - `enableCSSInheritance`（普通属性继承，默认 false）+ `customCSSInheritanceList`；`enableCSSInlineVariables`（inline style 的 `--*`，默认 false）；`enableCSSSelector`（类选择器，默认 true）。vue-lynx plugin 全部透传（`plugin/src/index.ts`）。
  - 主题切换两种官方姿势：祖先类切换（`.theme-light/.theme-dark` 定义变量）或 `lynx.getElementById('root').setProperty({...})`——本地 `themeStore`/`themeApplier` 直接映射。
- **对本地映射（tokens.css + uno.config.ts）**：
  - ✅ 可平移：`:root` 令牌 → `<page>`/根元素 CSS 变量定义；全部 `var(--colorXxx)` 引用。
  - ✅ vue-lynx 官方支持 Tailwind v3（`@lynx-js/tailwind-preset`），UnoCSS 输出的**静态原子类**可编译进 bundle——但需过 Lynx CSS 子集过滤。
  - ⚠️ **三个具体疑点（PoC 必测）**：
    1. `backdrop-filter` **不存在**——本地 `surface-glass`/`surface-appbar` 的 `backdrop-blur-[30px]` 需改用原生 `<blur-view>`（[blur-view.md](https://lynxjs.org/4.0/api/elements/built-in/blur-view.md)，Android/iOS/Harmony 4.0+，Web ❌，flatten=false + android-capture-target）或半透明背景。
    2. `clamp()`/`vw` 单位的 `--fontSizeBase*` 流体预 flight（uno.config.ts preflights）需验证 Lynx 支持度，不行则换 rpx/px。
    3. `hover`/`:active`/`focus-visible`/`::placeholder` 伪类在 Lynx CSS selector 引擎的支持度（本地大量 `hover:text-*`、`focus-visible:outline`）——Lynx 有类切换主题但伪类支持需实测。

## 7. 图片能力——Fresco 缓存可替代 L2/L3，Referer 必须自研 image service

- **缓存机制**（官方 [image.md](https://lynxjs.org/4.0/api/elements/built-in/image.md) + `lynx_service_image/LynxImageService.java`）：默认实现基于 **Fresco**——内存缓存（`getBitmapMemoryCache`）+ 磁盘缓存（`prefetchToDiskCache`）；`prefetchImage` 支持 `CACHE_DISK`/`CACHE_BITMAP`；`canParseUrl` 接受 file/content/asset/data:。
- **Referer/代理映射**：`LynxImageService.java` 确认 `fetchImage → ImageUtils.getFrescoImageRequest(...)` **不把 customParam 作为 HTTP header 传给 Fresco**；官方推荐自定义 `ILynxImageService`（可复用本地 OkHttp 网关 + 磁盘缓存逻辑）。另有 `MediaResourceFetcher`（`shouldRedirectUrl`/`isLocalResource`）可把 `/pixiv-img/` 协议 URL 重定向到本地资源，但**不带 header 注入**。结论与既有评估一致：**Referer 注入必须自研 `ILynxImageService`**（现状 Android `shouldInterceptRequest` 的 OkHttp 逻辑直接复用）。
- **占位/渐进加载（本地 ImageCard 依赖）**：
  - ✅ `placeholder` 属性 + `bindload`/`binderror`——本地 "blur-up 缩略图 + 主图淡入"可映射为 placeholder=square_medium + 主图 onLoad 切 opacity。
  - ✅ `blur-radius`（图片自身高斯模糊）+ CSS `filter: blur` + transition。
  - ✅ `auto-size`（按原图比例自适应）、`prefetch-width/height`、`image-config: RGB_565`（缩略图省内存）。
  - ✅ **ugoira 动图**：Lynx `<image>` 原生支持 `autoplay`/`loop-count`/`pauseAnimation`/`stopAnimation`（Fresco 动画）——本地 JS 帧播放的 `UgoiraViewer` 可用原生动图替代（加分项）。
  - ⚠️ 无 blurhash 原生支持（`setImagePlaceHolderHash` 已 `@Deprecated`；用 placeholder + blur-radius 模拟）。
- **L1/L2/L3 映射**：L1（JS 已加载标记 LRU `loadedKeys`）→ 可降级为"去重/预取标记"或删除（Fresco 内存缓存替代）；L2（WebView/磁盘缓存 `ImageCachePlugin`）→ Fresco 磁盘缓存替代；L3（CDN）不变；滚动预取 +10 → `prefetchImage` + `<list>` `preload-buffer-count`。

## 8. 瀑布流可行性总评

**逐能力映射表（本地 → vue-lynx → 结论）：**

| 本地能力 | vue-lynx 对应物 | 缺口/可平移 | workaround |
|---|---|---|---|
| tanstack 窗口虚拟化 + 绝对定位 | `<list>` 引擎惰性挂载 + recyclable | **可平移（更好）**：引擎管布局，删掉手写虚拟化；代价是 BG 全量 v-for + MT 无回收 | #302 落地前限制单次 feed 体量 |
| waterfall 2列 / grid 3列 / single 1列 | list-type waterfall/flow/single + span-count | **可平移**：一一对应 | — |
| 卡片高度估算（宽高比 + info 高） | aspect-ratio + estimated-*-px（已透传） | **可平移**，引擎自动校正 | — |
| IntersectionObserver 分页哨兵 | lower-threshold-item-count + scrolltolower | **可平移（更简单）** | — |
| 二段下拉（120px 阈值导航设置页） | `<refresh>` + headeroffset；或自绘 MT touch worklet | **可平移（自绘更可控）**；gesture-runtime 是 React 专属 | 本地 touch 阻尼逻辑移入 worklet |
| Fluent 2 令牌（CSS 变量） | var() + 默认继承 + enableCSSInlineVariables/Inheritance/Selector | **基本可平移** | backdrop-blur→`<blur-view>`；clamp/vw 需实测；hover/focus 伪类需实测 |
| scoped + :deep 渗透 | `<style scoped>` 支持，:deep/:slotted/:global 缺失 | **缺口** | 全局非 scoped 样式块；props 传类名 |
| 图片 L1/L2/L3 + blur-up + ugoira | Fresco 内存/磁盘缓存 + placeholder + blur-radius + 原生动图 | **部分可平移**；Referer/代理需自研 | 自定义 ILynxImageService（OkHttp 复用） |
| IFR 首屏 | 0.5.x IFR + element templates | **受限**：动态瀑布流无 IFR；骨架屏可 7–15× | 骨架屏走 IFR，数据到后 BG 渲染 |

**一句话结论**：**值得做 PoC**——vue-lynx 的 `<list>` 已原生覆盖瀑布流/分页/回收/下拉刷新（引擎侧），官方有 elk 无限流与 gallery-waterfall 两个验证过的参考，Fluent 令牌体系（CSS 变量）大体可平移；**主要 blocker 是 list cell 回收 no-op（#302）→ 超长瀑布流 MT 原生内存随滚动单调增长，以及 `:deep/:slotted/:global` scoped CSS 缺口与 Referer 图片服务自研**。

**PoC 应重点验证三件事：**
1. **内存曲线**：滚动 3k/5k 条时内存与卡顿（对照本地 tanstack 常数曲线，验证 #302 实际伤害、判断是否可接受上限）；
2. **Fluent 令牌覆盖**：`enableCSSSelector`/`enableCSSInheritance`/`enableCSSInlineVariables` + 全局样式块能否覆盖 tokens.css 与 UnoCSS 输出（含 `clamp`/`hover`/`backdrop` 三个具体疑点）；
3. **双线程一致性**：骨架屏 IFR + 网络数据后渲染的行为一致性（0711-1 确定性约束在真实异步数据下的表现）。

## 9. 瀑布流 PoC 实测（2026-07-31，Lynx for Web）

> 按 §8 建议做了最小 PoC：`create-vue-lynx` 脚手架 + `vue-lynx@0.5.1` + `@lynx-js/rspeedy@0.13.6` + `@lynx-js/web-core@0.23.1`，`<list list-type="waterfall" span-count="2">` + 5k 条确定性假数据（宽高比 0.25–4 模拟 Pixiv 分布），rspeedy web 预览 + Playwright（系统 Chrome headless）自动化滚动采样。工程在 `/tmp/vlpoc/my-app`（throwaway，未入库）。

### 9.1 采样结果

**5,000 条（约 1.67M px 总高），滚动 38,400px（≈2,300 卡片）：**

| 指标 | 行为 |
|------|------|
| DOM 节点数 | **恒定 70,575**（含 5,000 个 `list-item` + 15,000 `x-view` + 5,000 `x-image` + 10,136 `x-text`）——滚动不增长也不回收 |
| JS 堆（`performance.memory`） | 基线 36MB，滚动中 27–56MB 波动（GC 正常），**无单调增长** |
| 滚动 | 每步 800px 正常推进，全程无卡顿采样（headless 无 GPU 合成，流畅度需真机复核） |

**50,000 条：** 主线程长时间无响应（evaluate ≥30s 排队超时），渲染进程最终**崩溃**（约 109s）。Web 端 50k 条不可用。

### 9.2 关键修正：Web 端行为 ≠ 原生端（§2 表述需要区分平台）

- **原生端（源码推导，未实测）**：`componentAtIndex` 惰性挂载 + `enqueueComponent` no-op → 滚过 cell 的 MT 元素树**随滚动线性增长**（研究代理基于 `list-apply.ts` 的推导）。
- **Web 端（本次实测）**：Lynx for Web 的 DOM 适配层**初始即物化全部 5,000 个 item 的元素树**（70,575 节点，`list-item` 全在 DOM），滚动恒定——**没有"随滚动增长"问题，问题变成"初始全量创建成本"**。
- **两端共同点**：元素树都不回收（#302 在两端都成立），差别只在创建时机（Web 前置全量 / 原生随滚动摊派）。

### 9.3 结论更新（对照 §8 的 PoC 问题 1）

| 问题 | 实测答案 |
|------|---------|
| 5k 条是否可用？ | **✅ 可用**（Web）：7 万节点初始物化 + 滚动流畅 + GC 稳定；原生端预期更优（惰性挂载，view 数随滚动增长但 5k 规模可承受） |
| 50k 条是否可用？ | **❌ 不可用**（Web）：主线程卡死 + 渲染进程崩溃；原生端未实测，但 50k 的 BG 全量组件实例 + MT 全量元素树在两端都不现实 |
| #302 实际伤害多大？ | **伤害是"元素树不回收"，但 5k 规模内实测可承受**（Web 恒定 7 万节点，原生线性增长到 5k 量级）；**10k+ 才是风险区** |

**修正建议**：§2 的"5k 条明显内存代价 / 50k 不适用"维持，但需加平台限定——Web 端 5k 的代价是**初始物化**（首屏变慢）而非滚动增长；本地 tanstack 方案 DOM 恒为视口+overscan（约 10–18 卡片，源码推导约 1k 节点量级），在"节点数"维度上本地方案仍显著占优，但 vue-lynx 的收益是引擎级布局/滚动性能与免手写虚拟化。

---

# 报告二：单列列表（list-type="single"）迁移可行性验证

> 用户澄清：实际场景不是瀑布流，而是**简单列表**——上图下文卡片 或 左图右文行（对应项目 `NovelTextListCard`/图片列表形态）。基于报告一的同一 PoC 工程，改 `list-type="single"` + `estimated-main-axis-size-px="168"`（固定行高）重测。

## 10. 单列列表 PoC 实测（2026-07-31，Lynx for Web）

### 10.1 采样结果（5,000 行左图右文：140×140 缩略图 + 标题 + 作者 + 元信息 + 收藏按钮）

| 指标 | 行为 |
|------|------|
| DOM 节点数 | **恒定 130,568**（≈26 节点/行：list-item + RowInner + Thumb + Info + 5 个 text + Heart）——滚动到**底部 900,000px（≈5,400 行）全程不增长不回收** |
| JS 堆 | 48–83MB GC 波动，无单调增长 |
| 滚动 | wheel 被引擎 clamp（每帧 ≤1600px）；直接设 `scrollTop` 深跳 0→900k px 引擎正确响应，无卡顿采样 |
| `estimated-main-axis-size-px` | 固定行高下引擎预知布局，行高稳定（对比瀑布流的估算跳动） |

**50,000 行压力：** 加载成功（节点 1,305,432 ≈ 130 万，JS 堆 435MB，scrollHeight 34M px），滚动 50% 后于约 112s **渲染进程崩溃**（vs 瀑布流 50k 在加载阶段即主线程无响应）。5k→50k 为严格线性放大（13 万→130 万节点、~70MB→~435MB）。

### 10.2 单列列表 vs 瀑布流（同 5k 数据）

| 维度 | waterfall（报告一 §9） | single（本次） |
|------|----------------|----------------|
| 节点数 | 70,575（≈14/卡） | 130,568（≈26/行）——text 多 |
| 5k 可用性 | ✅ | ✅（滚到底无增长） |
| 50k | ❌ 崩溃 | ❌ 崩溃（数据更完整：130 万节点 + 435MB） |
| 布局 | 引擎列分配（最短列填充） | 固定行高 + `estimated-*`，更简单稳定 |

## 11. 单列列表结论

1. **单列列表（上图下文/左图右文）可行性高于瀑布流**：`list-type="single"` 是 Lynx list 最基础模式，行高固定 → `estimated-main-axis-size-px` 精确、引擎布局最稳定、无列分配复杂度。
2. **5k 行（Pixiv 分页 60/页 ≈ 83 页，现实上限）完全可用**：节点/堆恒定、滚到底流畅、无回收需求下也不崩。
3. **10k+ 是风险区，50k 明确不可用**：130 万节点 + 435MB 触发渲染进程崩溃——与瀑布流结论一致，**且这是两端通病（BG 全量 v-for + MT 元素树不回收 #302）**，与本地方案（DOM 恒为视口+overscan）的差距在"行数上限"而非 5k 内体验。
4. **对 Pictelio 的实践建议**：小说列表（NovelTextListCard 形态）与图片列表在 5k 内可平移；若预期 feed 增长超 1 万行，需等 #302 或限制单次加载体量。

## 12. 两份报告的公共结论与剩余待验证

**公共结论**：单列列表与瀑布流在 **5k 规模内实测可行**（DOM 恒定、GC 稳定、滚动流畅）；**10k+ 是风险区、50k 明确崩溃**（#302 cell 回收 no-op 是核心 blocker，两端通病）。本地 tanstack 方案在"DOM 节点数"维度仍显著占优，但 vue-lynx 的收益是引擎级布局/滚动性能与免手写虚拟化。

**剩余待验证（PoC 未覆盖）：**
1. **Fluent 令牌覆盖**：`enableCSSSelector`/`enableCSSInheritance`/`enableCSSInlineVariables` + 全局样式块能否覆盖 tokens.css 与 UnoCSS 输出（含 `clamp`/`hover`/`backdrop` 三个具体疑点，见 §6）；
2. **双线程一致性**：骨架屏 IFR + 网络数据后渲染的行为一致性（0711-1 确定性约束在真实异步数据下的表现，见 §4）；
3. **原生端内存**（本次仅实测 Web）：`componentAtIndex` 惰性挂载 + no-op 回收下 5k 条的 MT 原生 view 数（§9.2 为源码推导）。

---

# 报告三：Lynx `<list>` 虚拟滚动与按需加载机制分析（2026-07-31）

> 问题：Lynx 的 `<list>` 能做到虚拟滚动吗？按需加载吗？还是这些都需要自己写逻辑？
> 结论速览：**虚拟滚动、按需 attach cell、cell 回收、滚动到底部触发——全部是引擎内置能力（BT/MT/原生三层配合），开发者无需自写；唯一必须自写的是"数据加载"（请求下一页 + 追加数组 + hasMore 状态）与把数组 map 成 `<list-item>`。** vue-lynx 侧同样内置，唯一缺口是 framework-side cell 回收 no-op（#302，见 §2）。Web 端注意差异：DOM 全量物化，靠 CSS `content-visibility` 跳过离屏渲染。

## 13. 核心结论：内置 vs 自写清单

| 能力 | 内置 or 自写 | 证据 |
|---|---|---|
| 虚拟滚动（只渲染可视区 cell） | **内置**（引擎 + 原生容器） | list.mdx "Only child nodes visible in the visible area will be rendered"；Android `RecyclerView` / iOS `UICollectionView` 原生虚拟化 |
| 按需创建 cell 内容（componentAtIndex） | **内置**（引擎驱动 BT 惰性 attach + flush） | ReactLynx `element-template/runtime/list/list.ts` L225-309 |
| cell 回收 / 复用 | **内置**（原生回收；ReactLynx 另有 JS 侧回收池） | `recyclable` 属性；`enqueueComponent`/gRecycleMap；Android `recycleChild` |
| 滚动到底部事件触发（scrolltolower） | **内置**（`lower-threshold-item-count` + 事件） | list.mdx |
| **加载更多 = 请求下一页 + 追加数组 + 更新 state** | **自写**（必须） | list.mdx load-more 示例全部手写；lynx-ui 只封 footer 状态 |
| 把数组 map 成 `<list-item>` + 设 `item-key` | **自写**（必须） | 所有示例均手写 |

## 14. 机制详解

### 14.1 虚拟滚动——引擎内置

- 官方文档（[list.md](https://lynxjs.org/4.0/api/elements/built-in/list.md)）："The `<list>` component is a high-performance scrollable container that optimizes performance and memory usage through **element recycling and lazy loading**"；Usage 第 1 点 "Only child nodes visible in the visible area will be rendered."；滚动指南 [scrolling.mdx](https://github.com/lynx-family/lynx-website/blob/main/docs/en/guide/ui/scrolling.mdx#L112-L114)："`<list>` … can adopt an **on-demand loading way, rendering only the content in the visible area**."
- 引擎实现（viewport-based，各平台原生容器决定）：
  - **Android**：`UIList extends AbsLynxList<RecyclerView>`，`UIListAdapter extends RecyclerView.Adapter`——`getItemCount()` 返回全量条数，但只有可视区 + preload 的 position 被系统调用 `onCreateViewHolder/onBindViewHolder`（`platform/android/lynx_android/.../ui/list/UIList.java:72`、`UIListAdapter.java:26/480`）；
  - **iOS**：`LynxUICollection` 基于 `UICollectionView`，`cellForItemAtIndexPath:` + `dequeueReusableCell` 系统按需物化（`LynxCollectionDataSource.m:246-249`）；
  - **Web**：见 §14.6（DOM 全量 + CSS `content-visibility`）。

### 14.2 componentAtIndex——引擎驱动按需 attach

- `componentAtIndex(listID, cellIndex, operationID)` 是**引擎在原生 list 需要某个 cell 时主动调用 BT 的 JS 回调**，把该 index 的 list-item 挂到节点树并下发布局。
- ReactLynx 运行时（`packages/react/runtime/src/element-template/runtime/list/list.ts`）：`componentAtIndex` → `attachListItemAtIndex` → `__InsertNodeToElementTemplate` + `__FlushElementTree(item.ref, {triggerLayout:true})`；每个 list-item 在 BT 只有轻量记录 `{uid, ref, templateKey, platformInfo}`，`attached:false`，只有被引擎请求的 index 才 flush 到 MT（L225-309、L407-422）。
- Android 转发链：`ListNodeInfoFetcher.renderChild(listSign,index,operationId)` → `AbsLynxList.renderChild()` 在 `onBindViewHolder` 时调用（`UIListAdapter.java:359-391`）。

### 14.3 cell 回收——引擎内置

- `recyclable` 属性（默认 `true`）："Declared on the `<list-item>` node to control whether the node can be recycled… set to `false`, the `<list-item>` will not be recycled when it is scrolled out of the viewport of `<list>`."
- **原生层回收**：Android `onViewDetachedFromWindow` → `recycleHolderComponent()` → `mList.recycleChild()`（`UIListAdapter.java:464-476`）；iOS `dequeueReusableCell` 系统复用池（`LynxCollectionDataSource.m:269-270`）。回收的是**原生 view 树（UIComponent）**。
- **JS 侧（framework-side）回收**：引擎回收 cell 时调 `enqueueComponent(listID, sign)`。ReactLynx snapshot 架构用 `gSignMap`/`gRecycleMap` 建 JS 实例回收池（`snapshot/list/list.ts:256-276`），下次 `componentAtIndex` 优先 `hydrate` 复用。**vue-lynx 此处是 no-op（#302）——引擎回收正常，但 MT 元素树不回收**（详见 §14.7）。

### 14.4 按需加载（load-more）——事件内置，数据必须自写

- 官方姿势：设 `lower-threshold-item-count` + 绑 `bindscrolltolower`，回调里追加数据 + `hasMoreData` 状态切 footer——**示例代码里数据生成/追加、hasMore 判断全部是开发者手写**。
- 官方属性说明："Triggers a `scrolltolower` event once when the number of remaining displayable child nodes at the bottom of `<list>` is less than `lower-threshold-item-count`."
- 官方封装（lynx-ui）：`lynx-ui-list` 只是 `<list>` 属性透传（不实现数据加载，`packages/lynx-ui-list/src/index.tsx:467-472`）；`lynx-ui-feed-list` 封装刷新/回弹、`hasMoreData ? loadMoreFooter : noMoreDataFooter` 尾部 list-item 与 `changeHasMoreStatus()`，**仍不含"请求下一页/追加数据"逻辑**（`packages/lynx-ui-feed-list/src/index.tsx:366-388`）。vue-lynx 无对应高层封装。

### 14.5 scroll-view vs list——超三屏官方建议必须用 list

- `<scroll-view>` 官方文档 "Performance Optimization Suggestions" 原文："`<scroll-view>` **creates all of its child nodes at once**… `scroll-view` **lacks any reuse mechanism**… **For data exceeding three screens, use `<list>`**"（[scroll-view.html](https://lynxjs.org/4.0/api/elements/built-in/scroll-view.html)）。
- 指南："`<scroll-view>` is used to display a small amount of data in a simple and intuitive way."
- **对本地映射**：几百行以内的简单静态列表可先用 scroll-view；**任何会增长/分页的 Feed（本地推荐/关注/小说列表）必须用 `<list>`**——scroll-view 无回收、全量创建，长列表会内存爆炸。

### 14.6 Lynx for Web 差异——DOM 全量物化 + CSS `content-visibility`（解释 §9/§10 实测的节点恒定现象）

- Web 端 `<list>` 是自定义元素 `x-list`（`@lynx-js/web-elements`）：**所有 list-item 作为 children 全部存在于 DOM**（`XList.getVisibleCells` 直接用 `this.children` 遍历所有 `LIST-ITEM`，`packages/web-platform/web-elements/src/elements/XList/XList.ts:220-253`）。
- 虚拟化靠 CSS：`list-item { display:none; content-visibility:auto; contain: layout paint; contain-intrinsic-size: none auto var(--estimated-main-axis-size-px, 100cqh) }`；`recyclable="false"` 时改 `content-visibility: visible`（`x-list.css:35,63-74`）。`XList` 监听 `contentvisibilityautostatechange` 维护可见 cell 映射（`XList.ts:271-328`）。
- **含义**：Web 端不是"引擎只 layout 可视区"，而是"DOM 全量、浏览器只对可视区做 layout/paint"；`estimated-main-axis-size-px` 通过 `contain-intrinsic-size` 给离屏项占位。**这与原生端（只创建可视区原生节点）的物化策略不同——Web 端 DOM 节点数问题不能靠引擎根治**（§9/§10 实测：5k 行 13 万节点恒定、50k 崩溃，正是这个原因）。
- **对迁移方**：若目标含 Web 端，超长列表仍需**数据层分页控制**（只往数组放当前需要的页）来控 DOM 规模；原生端无此问题。

### 14.7 vue-lynx 侧——BG 全量、MT 惰性、framework 回收 no-op

- **BG 线程全量创建**：vue-lynx 是标准 Vue 3 custom renderer，`v-for` 在 render 时为**每个 list-item 创建完整 Vue 组件实例与 ShadowElement**（`runtime/src/node-ops.ts:236-258` 无条件创建，list 无特殊惰性处理）。
- **MT 不物化 cell**：`nodeOps.insert` 对 list 子节点走 OP.INSERT，MT 端 `ops-apply.ts` 对 `isListParent` 走 `insertListItem`（只维护 `listItems` 数组 + `update-list-info` diff），**不 `__AppendElement`**（`main-thread/src/ops-apply.ts:140-156`）。
- **componentAtIndex 正确接线**：`list-apply.ts` 通过 `__CreateList(pageUniqueId, componentAtIndex, enqueueComponent, {}, componentAtIndexes)` 注册；`componentAtIndex` 里 `__AppendElement(list, item)` + `__FlushElementTree(item, ...)` 惰性挂 cell（`list-apply.ts:160-224,252-266`）。
- **enqueueComponent 是 no-op**：`function enqueueComponentNoop(): void {}`（#302）。即：**原生虚拟化/回收照常工作，但滚过的 cell 的 MT 元素树不回收**——与 §2/§9.2 结论一致。

## 15. 对本地实现（tanstack 手写虚拟化）迁移的含义

1. **迁到 Lynx 原生端**：本地 `createFeedVirtualizer.ts`（约 260 行手写虚拟化 + tanstack，只渲染视口 + overscan 2）**整体删除**——虚拟化、overscan/preload（`preload-buffer-count`）、回收、瀑布流/列表布局都是引擎提供的，只需 `data.map(... => <list-item :key :item-key>)` + 绑 `lower-threshold-item-count`/`bindscrolltolower`。
2. **唯一保留且必须自写的业务逻辑**：数据分页加载（请求、去重、追加、hasMore、loading/no-more footer）——这正是当前 WebView 方案里已经在写的那部分，可原样平移。
3. **Web 端注意**：DOM 节点全量物化（content-visibility 优化 layout/paint，不减 DOM 节点数），超长列表仍需数据层分页控 DOM 规模（§9/§10：5k 可行、50k 崩溃）。
4. **vue-lynx vs ReactLynx**：虚拟化与懒 attach 同样内置可用；但 framework-side 回收缺失（#302）→ 极长 feed 内存表现差于 ReactLynx，且 Vue 侧全量创建组件实例的首屏开销更高——**大列表场景控制首屏数据量（分页自写）仍是必要的**（与 §12 一致）。

---

## 附录：信息来源（一手索引，全部可核验）

- vue-lynx 源码：`github.com/Huxpro/vue-lynx` — `packages/vue-lynx/runtime/src/{node-ops,flush,shadow-element}.ts`、`packages/vue-lynx/main-thread/src/{ops-apply,list-apply}.ts`、`packages/vue-lynx/plugin/src/index.ts`、PR #292（list adapter 重写，2026-07-21）、issue #302/#164/#165、plans/0711-1（IFR）、0711-2（element templates）、CHANGELOG 0.5.0、`touch-fx`/`gallery` 示例
- Lynx 官方文档：`lynxjs.org/4.0/api/elements/built-in/{list,refresh,image,blur-view,scroll-view}.md`、`lynxjs.org/4.0/guide/{interaction/ifr.md,styling/custom-theming.md,styling/text-and-typography.md}`、`api/css/properties/css-variable.md`、`github.com/lynx-family/lynx-website/blob/main/docs/en/guide/ui/scrolling.mdx`
- Lynx 原生服务：`lynx_service_image/LynxImageService.java`、`ImageUtils.java`（Referer 不传 header 的证据）
- Lynx 虚拟化实现（报告三）：`platform/android/lynx_android/.../ui/list/{UIList,UIListAdapter,ListNodeInfoFetcher}.java`（RecyclerView）、`platform/darwin/ios/lynx/ui/list/lynx_collection/{LynxUICollection,LynxCollectionDataSource}.m`（UICollectionView）、`packages/react/runtime/src/{element-template,snapshot}/runtime/list/list.ts`（componentAtIndex / gRecycleMap）、`packages/web-platform/web-elements/src/elements/XList/{XList.ts,x-list.css}`（Web content-visibility）、`core/renderer/dom/list_component_info.{h,cc}`（estimated size / diff_key 复用判定）、`packages/lynx-ui-{list,feed-list}/src/index.tsx`（官方封装边界）
- 本地对照：`packages/app/src/components/{VirtualFeed,NovelTextListCard,ImageCard}.tsx`、`primitives/createFeedVirtualizer.ts`、`utils/imageLoader.ts`、`styles/tokens.css`、`uno.config.ts`
- PoC 实测：`/tmp/vlpoc/my-app`（vue-lynx 0.5.1 + rspeedy 0.13.6 + web-core 0.23.1）、`/tmp/vlpoc/{run-deep,run-50k,run-poc}.mjs`（Playwright 采样）
- 交叉参考：`docs/research/vue-lynx-production-readiness.md`、`docs/research/lynx-migration-feasibility.md`、`docs/research/lynx-pure-engine-analysis.md`

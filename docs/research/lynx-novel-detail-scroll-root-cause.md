# Lynx 小说详情滚动根因假设与无测量环境虚拟化路径

> 调研日期：2026-09-01 · 关联：issue #309（父地图 #304「Lynx 滚动跟手性追平 webview」）
> 痛点形态：**触摸响应延迟**（手指动了内容慢半拍，2026-09-01 用户确认），场景 = app-lynx `NovelDetail.vue`（全文一次性 v-for 进单个 `<scroll-view>`，无虚拟化）
> 方法：本仓库源码/ADR（codegraph + 精读）+ Lynx 官方文档 + lynx-family/lynx 源码 + pretext 0.0.8 包源码，全部一手来源

## 结论速览

**根因假设排序**（疑似贡献从高到低，详见 §2）：

1. **H1 全文一次性挂载的节点/布局体量**（scroll-view 官方明示"一次性创建全部子节点、无回收机制、可能 OOM，超三屏应改用 `<list>`"）——布局、绘制、文本光栅化全部 O(全文)，UI 线程帧时间随文本长度膨胀。
2. **H2 滚动的线程模型差**（webview = Chromium 合成器线程滚动，触摸不经主线程；Lynx scroll-view = 原生 UI 线程驱动，UI 线程被 H1 占满时直接表现为"手指动了内容慢半拍"）——H1 是负荷源，H2 是传导路径。
3. **H3 进入页面/章节切换的全量文本布局长帧**（首帧与首次滚动的体感卡顿源，非稳态主因）。
4. **H4 附加节点（头部信息卡/受限遮罩/评论入口）**——常数级体量，贡献低；且 lynx 端正文**无内嵌图片节点**（`fetchNovelText` 只提取纯文本），"内嵌图片"根因候选对 lynx 端不成立。
5. **H5 双端差异**：web-core 预览与原生 LynxView 渲染路径不同，量化与验收须以原生为准。

**虚拟化路径可行性初判**（详见 §4）：

- 源码注释"无 canvas/measureText，pretext 不可迁移"**成立且被低估**——pretext 0.0.8 除 canvas 外还硬依赖 `Intl.Segmenter`，而 Lynx 官方明示 Intl 全系未实现（双重硬阻塞）。
- 但"无测量环境"前提**已被推翻**：Lynx 原生提供 **`lynx.getTextInfo()`**（后台/主线程均可、同步、px 测量 + maxWidth 分行，lynx 仓库 initial commit 即存在，4.0.1 可用），另有 `<text bindlayout>` 布局回调可作校准通道。
- 两条主路径：**A. scroll-view 内按段落窗口化**（@scroll per-frame 已实证可作信号源，保留追更进度语义，推荐先行 spike）；**B. 改 `<list list-type="single">` 引擎虚拟化**（零测量依赖，但丢失 per-frame scroll → 追更"进度 ≥70%"信号断供，且 vue-lynx cell 回收 no-op（#302）内存随滚动单调增长）。B 的风险集中在功能回归与上游缺口，A 的风险集中在估算精度与跨线程挂载时延。

---

## 1. 背景与对照基准

### 1.1 验收双轨与对照实现（冻结）

- 量化基线（帧指标）+ 真机主观验收（模拟器 + OPPO）；对照方 = webview 客户端（同设备同内容，**冻结不动**）。
- 「滚动跟手性」三轴（`packages/app-lynx/CONTEXT.md` 词条）：触摸响应延迟 / 帧跟随一致性 / 惯性曲线自然度。本票痛点 = 第一轴。

### 1.2 webview 基准侧机制（为什么它快）

- **离线行高测量**：`packages/app/src/primitives/createNovelTextLayout.ts` 用 `@chenglou/pretext` 逐段落做纯算术布局——`prepare()`（canvas measureText 一次性量出 segment 宽度并缓存）+ `layoutNextLine()` 纯算术分行；产出每段 `offset/height/lineCount/lineRanges`，并做两项 Android WebView 补偿（容器宽度 ×0.97、段高 +2px）。
- **可见块挂载**：`packages/app/src/primitives/createNovelVirtualLayout.ts` 包 `@tanstack/solid-virtual` 的 `Virtualizer`（overscan 5），**DOM 中只存在视口 + overscan 的块**；图片块按 `width/height` 元数据换算高度，chapter/jump/pagebreak 块按比例常数高度；布局结果按 `novelId+宽度+字体设置+译文 variant` 进 LRU（`novelTextLayoutCache`）。
- **滚动线程模型**：浏览器滚动由合成器（compositor）线程驱动，触摸输入不依赖主线程空闲——这是 webview"跟手"的结构性来源。

### 1.3 lynx 侧现状（被诊断对象）

`packages/app-lynx/src/pages/NovelDetail.vue`：

- 正文 = `paragraphs` computed（`text.split(/\n+/)` 全文切分）经 `v-for` **一次性全部渲染**为 `<text class="text-body-large leading-[44rpx] ... mb-4 block">`（模板 L226-228），外层单个 `<scroll-view scroll-orientation="vertical">`（L183-189）。注释自标：「MVP：整段渲染，不做行级虚拟化（无 canvas/measureText，pretext 不可迁移）。超长文本由 scroll-view 引擎滚动承接」（L91-92）。
- 节点构成：头部信息卡（标题/作者/字数/系列行/评论入口，常数个节点）+ 正文 N 个 `<text>` + 尾部「— 完 —」。受限小说短路不拉正文（`isRestricted` → spacer + `RestrictOverlay`），**遮罩态不存在长文本问题**。
- 滚动事件：`@scroll="onNovelScroll"` + `@scrolltolower`。`onNovelScroll` 每帧只做 `computeReadProgress`（纯算术）+ `notifyScroll`（写两个**非响应式**普通变量，`createWatchlistPrompt.ts` L92-95）——**JS 侧每帧工作量极小，不会反向制造渲染压力**。
- lynx 端正文**无图片**：`fetchNovelText`（`src/api/novel.ts` L116-121）经 `extractNovelTextFromHtml` 从 `/webview/v2/novel` HTML 中正则提取 `window.pixiv.novel.text` 纯文本，不解析 `[uploadimage]` 标记，自然无 ImageBlock。

---

## 2. 根因假设清单（按疑似贡献排序）

> 证据等级：**实证**（本仓库真机/模拟器/字节码验证）＞**官方**（lynxjs.org 文档）＞**上游源码**（lynx-family/lynx）＞**推断**（机制演绎，待基准票量化）。

### H1（最高疑似）：全文一次性渲染的节点体量与超长文本布局成本

**机制**：`<scroll-view>` 一次性创建全部子节点、**无任何回收机制**。Pixiv 长篇小说正文可达数万~十万字、数百~上千段落 → 数百~上千个 `<text>` 节点全量存在于渲染树；每个 text 节点都要完成原生文本布局（Lynx Android 文本经 `android.text.Layout` 分行，`UIText.java` / `FlattenUIText.java` 双形态），滚动时 UI 线程的 measure/draw 遍历与文本光栅化/纹理内存随全文线性增长。

**证据**：
- **官方**：`<scroll-view>` 文档原文——"creates all of its child nodes at once, potentially causing severe first-screen load times"、"lacks any reuse mechanism"、内容多"may consume an exceptionally large amount of memory, possibly causing OOM"，并明示"数据超过三屏应使用 `<list>` 优化性能"（lynxjs.org/api/elements/built-in/scroll-view）。
- **官方**：滚动指南明示 `<list>` 的相对优势即"on-demand loading, rendering only the content in the visible area"（lynxjs.org/guide/ui/scrolling）。
- **本仓库源码**：`NovelDetail.vue` L226 全文 `v-for`；对照 webview `createNovelVirtualLayout.ts` L216-227 TanStack Virtualizer 只挂可见块（overscan 5）。
- **旁证**（同平台体量问题的既有实证）：`docs/research/vue-lynx-masonry-feasibility.md`——vue-lynx `<list>` 在 5k 条可用 / 10k+ 风险 / 50k 崩溃（cell 回收 no-op，issue #302），说明 Lynx 渲染栈对节点体量的敏感度已被本仓库实证过。
- **官方**（帧归因方法论）：流畅度分析页确认 Android 帧时间 = UI 线程 `Choreographer#doFrame` + RenderThread `DrawFrames` 之和，滚动是"对帧节奏最敏感的场景"，长帧根因首位即"UI 线程阻塞——布局/测量堆积"与"重度布局与绘制"（lynxjs.org/guide/performance/analysis-performance/analysis-fluency）。

**量化验证（交基准票 #305/spike）**：Trace 采集同小说 webview vs lynx 稳态滚动帧时间；变量 = 正文长度（短篇 ~5k 字 / 长篇 ~10 万字）与段落数；若帧时间随文本长度显著劣化则 H1 坐实。

### H2：触摸延迟的线程模型传导链

**机制**：触摸 → 内容的链路两端结构不同：

- **webview（基准方）**：Chromium 合成器线程滚动——触摸输入由 compositor 直接消费，主线程繁忙也不影响滚动跟手。
- **Lynx scroll-view**：滚动由原生 UI 线程承接（`UIScrollView.java` 的 `AndroidScrollView` 内嵌，`onScrollChanged` 每帧回调）；UI 线程同时承担全部文本节点的 layout/draw。**H1 把 UI 线程帧时间拉爆时，触摸到内容位移的延迟直接放大**——"手指动了内容慢半拍"。
- JS 侧事件链是另一条路：触摸/滚动事件默认「主线程 → 后台 → 主线程」跨线程往返（ADR-0115 平台事实①，低端设备可感知卡顿）。当前页面 @scroll 处理器工作量极小（§1.3），故**事件链不是本场景主因**；但它封死了"JS 逐帧驱动内容跟随"类优化（除非 MTS 可用，见 §4.4）。

**证据**：
- **上游源码**：`UIScrollView.java` `onScrollChanged(l,t,oldl,oldt)` → `mEnableScrollEvent` 门控下 `sendCustomEvent(...EVENT_SCROLL)`（lynx-family/lynx，Android），逐帧派发到 JS 后台线程；滚动本体在 UI 线程完成。
- **实证**：ADR-0115 平台事实①（双线程触摸往返，低端可感知）；ADR-0109 字节码实证 `LynxScrollEvent` payload 含 `scrollTop/scrollHeight/...`。
- **推断**：webview 合成器滚动为浏览器公共架构事实；两端差异对"触摸响应延迟"轴的贡献需基准票分离测量（见 §5）。

### H3：进入页面/章节切换的全量文本布局长帧

**机制**：正文到达后一次性挂载全部段落 → 首帧前引擎须完成全文分行布局（官方称"severe first-screen load times"）。这是**进入页面时延与首次滚动前长帧**的来源，也放大低端机（OPPO / Android 9 画像）的 ANR 风险；对稳态滚动跟手性为间接贡献（大纹理/视图集驻留抬高 GC 与内存压力）。

**证据**：官方 scroll-view 文档（同 H1）；`docs/research/vue-lynx-benchmark-ifr.md` §6 实测 Android 9 全面慢于 Android 34（2–5×），低端正反馈放大器已实证存在。

### H4（低疑似）：受限遮罩等附加节点 / 内嵌图片

- 头部信息卡 + 遮罩 + 弹层均为**常数级**节点（<20），对滚动帧时间贡献可忽略；且受限小说不拉正文（遮罩态无长文本）。
- **内嵌图片：lynx 端不存在**——`fetchNovelText` 只产纯文本（§1.3）。该候选只对 webview 端成立（`ImageBlock` 按元数据预换算高度，且被虚拟化挡在视口外），对 lynx 端根因**排除**。

**证据**：`NovelDetail.vue` L219-229；`src/api/novel.ts` L99-121。

### H5：双端差异（测量口径约束，非独立根因）

web-core 预览的 scroll-view 是 DOM 实现，与原生 LynxView 的滚动/渲染路径不同；既有 ADR 多次记录双端行为不一致（ADR-0123 pointer-events、web-core 0.23.1 缺 `boundingClientRect` 链式方法、`auto-size` 未实现等）。**根因量化与验收必须锚定原生 LynxView**（模拟器 + OPPO 真机），web-core 数字只能作参照。

---

## 3. 「无 canvas/measureText，pretext 不可迁移」断言复核

### 3.1 断言成立，且被低估（双重硬阻塞）

pretext 0.0.8 源码（`node_modules/@chenglou/pretext/src/measurement.ts`）：

1. **canvas 硬依赖**：`getMeasureContext()`（L36-50）只认 `OffscreenCanvas` 或 `document.createElement('canvas').getContext('2d')`，两者皆无则 `throw 'Text measurement requires OffscreenCanvas or a DOM canvas context.'`；每 segment 宽度 = `ctx.measureText(seg).width`（L66）。Lynx 后台线程无 DOM、无 canvas → 阻塞①。
2. **Intl.Segmenter 硬依赖**：字素分割走 `new Intl.Segmenter(undefined, { granularity: 'grapheme' })`（L119-124）。Lynx 官方国际化指南明示："**the Intl API is not implemented in Lynx**"（Intl.PluralRules/NumberFormat/DateTimeFormat 均需 polyfill，Intl.Segmenter 同样缺席）；PrimJS（QuickJS 系）后台线程 ES 上限 ES2015（官方 scripting-runtime 文档）→ 阻塞②。本仓库 webview 侧的 `isPretextSupported()` 检测项恰为这两者（`packages/app/src/primitives/isPretextSupported.ts`），与源码依赖一一对应。

补充：`navigator.userAgent` 有 no-navigator 回退（L77-86），emoji 修正的 DOM 探针有 `document` 守卫（L142-146）——这两处不阻塞。**结论：`pretext 不可迁移`在当前版本（0.0.8）成立。**

### 3.2 但「无测量环境」前提已过时：Lynx 自有测量通道

| 通道 | 形态 | 可用性证据 | 限制 |
|---|---|---|---|
| **`lynx.getTextInfo(text, {fontSize, fontFamily?, maxWidth?, maxLine?})`** | **同步**返回 `{ width(px), content(分行字符串数组) }`；后台线程（BTS）与主线程脚本（MTS）**双侧可用** | lynxjs.org `/api/lynx-api/lynx/lynx-get-text-info` 与 `/api/lynx-api/main-thread/lynx-get-text-info`；lynx-family/lynx 仓库 initial commit（2025-03-04）即含 `core/public/text_utils.h` + Android 实现 `text_utils_android.cc` + JS 桥 `js_libraries/lynx-core/src/modules/nativeModules/textInfo.ts` → **当前原生 4.0.1（`build.gradle` L238 等）可用** | fontSize/maxWidth 仅 px；fontFamily 仅内置字体（**不支持 font-face 自定义字体**）；不支持 letterSpacing/fontWeight；`maxLine:1` 时省略 content |
| `<text bindlayout>` 布局事件 | 文本完成布局后回调：`detail = { lineCount, lines:[{start,end,ellipsisCount}], size:{width,height} }` | lynxjs.org `/api/elements/built-in/text#layout`；上游 `UIText.java` `dispatchLayoutEventIfNeeded()`（绑定了 layout 事件才派发） | 必须先渲染（**事后校准**通道，不能预测）；未渲染文本无文档支持的离屏测量用法 |
| `lynx.createSelectorQuery().select().invoke({method:'boundingClientRect'})` | 异步拿元素矩形 | 本仓库实证可用（`GlassCard.vue` L50-70 注释：原生标准 API；web-core 0.23.1 缺链式方法、invoke 通道可用）；ADR-0107 注 SelectorQuery 为废弃通道（对 scroll-to-index 而言） | 异步、逐元素，不适合全文批量测量；官方在废弃轨道上 |
| canvas / measureText | 无 | —— | Lynx 无此 API（断言成立） |

**web-core 双端差异（必须注意）**：web-core 0.23.1 的 `lynx.getTextInfo` 是 **stub**——无 `LynxTextInfoModule` 实现时回退 `{width: text.length}`（`@lynx-js/web-core` 产物 `lynx-core-chunk.js`，产物源码实证）。即 getTextInfo **仅原生可用**，web-core 预览得到的是字符数伪宽度。任何消费方需 `typeof`/`width>0` 探测 + web-core 降级（预览环境可直接用浏览器 canvas measureText，或退化估算）。

**类型接入**：app-lynx 的 `lynx` 全局类型是仓库自维护的最小声明（`src/rspeedy-env.d.ts` 的 `LynxGlobal` 接口），用 getTextInfo 需在该接口补 `getTextInfo?(...)` 可选签名（原生有、web-core 有 stub、单测环境无 → 必须可选链）。

---

## 4. 无 canvas/measureText 环境下的正文虚拟化可行路径

### 4.0 信号源核查：scroll-view @scroll per-frame 成立

- **上游源码实证（Android）**：`UIScrollView.onScrollChanged` 是 Android View 的逐帧滚动回调，`mEnableScrollEvent` 门控下逐帧 `sendCustomEvent(EVENT_SCROLL)`；Android 路径无 throttle 裁剪（`scroll-event-throttle` 关键字仅出现于 iOS `LynxUIScrollView.m`、list 类型与 clay 层）。
- **本仓库实证链**：ADR-0109 字节码实证 payload（scrollTop/scrollHeight/deltaX/deltaY）；ADR-0110 平台事实② = per-frame scroll **只被 `<list>` 裁剪**（`mEnableScrollEvent` 门控 + T-spike 四路零派发），scroll-view 不在裁剪面内。
- **残余不确定性**：追更 spec §7 自标 scroll-view 原生 @scroll "可用性未实测"（功能已上线但有 scrolltolower 权威兜底，per-frame 派发频率未单独量化）。**路径 A 的 spike 第一项即量化原生 scroll-view @scroll 实际派发频率**（每帧/节流/丢帧）。

### 4.1 路径 A：scroll-view 内按段落窗口化（推荐先 spike）

**形态**：保留 `<scroll-view>`；正文改为「上占位 spacer（高度=上方段落总高）+ 可见窗口段落 v-for（视口±overscan）+ 下占位 spacer」；@scroll per-frame 驱动窗口滑动（scrollTop → 二分定位起始段落 → 更新窗口 ref）。对照 webview `createNovelVirtualLayout` 的 spacer 语义，但用估计/测量高度替代 pretext。

- **优点**：保留 per-frame @scroll（追更进度 ≥70% 信号不断供）；不动列表框架（不碰 #302）；节点体量从 O(全文) 降到 O(视口)——直击 H1。
- **风险**：
  - R-A1 **跨线程挂载时延**：窗口更新 = 后台线程 Vue 更新 → ops 过 bridge → 主线程建节点。快速 fling 时新窗口可能晚于滚动到位 → 短暂空白。缓解：overscan 加大 + 只在跨越段落边界时更新（非每帧 setState，对齐 ADR-0109 D3 阈值穿越翻转原则）；spike 实测 fling 极端场景。
  - R-A2 **spacer 高度依赖估算/测量精度**（见 §4.3）；总滚动高度误差表现为滚动条比例漂移与定位偏差，可用 bindlayout 逐段校准收敛。
  - R-A3 scroll-view 的 `initial-scroll-to-index`/锚定行为在窗口重建时的稳定性需 spike（章节内跳转、阅读进度恢复场景）。
- **JS 侧成本**：当前 @scroll 处理器已实证轻量（纯算术 + 普通变量写入）；窗口化后每帧最多一次小数组 v-for 更新，vue-lynx VDOM 点状更新能力覆盖（benchmark 文档 §4.1：vdom 点状更新 e2e ~3.45ms 量级，30k 阶梯内可用；Vapor 更快但实验性，不依赖）。

### 4.2 路径 B：改 `<list list-type="single">`，段落即 list-item（引擎虚拟化）

**形态**：每段落一个 `<list-item item-key="p-N">`，布局/回收交给引擎（官方：list "只渲染可视区内容"，引擎 `componentAtIndex` 惰性挂载）。**零测量依赖**——总行高由引擎按实际布局维护，`estimated-main-axis-size-px` 只影响滚动条初始比例。

- **优点**：彻底消掉测量问题；官方推荐的超三屏场景正解；9 个列表实例的 RefreshableList 链路已在本仓库生产验证（ADR-0104/0107）。
- **风险（重）**：
  - R-B1 **per-frame scroll 信号断供**（ADR-0110 实证：list 仅 load/scrolltolower/scrolltoupper）→ 追更询问的「滚动 ≥70%」条件失去信号源，只剩"到达底部"单路——**功能语义回归**，需产品拍板（改判定或接受到底才弹）。
  - R-B2 **vue-lynx cell 回收 no-op（上游 issue #302，本仓库 masonry 调研实证仍在）**：滚过的 cell 的 MT 原生元素树永久存活，内存随滚动单调增长。小说段落是轻 text cell（比卡片 cell 轻得多），数百~两千段落在 5k"可用"包络内，但超长连载 + 低端机组合需内存实测。
  - R-B3 正文内联结构与 list-item 语义的适配（段落选中/复制、受限遮罩、头部卡进 list 需 full-span item 或移出 list）。
- **结论**：技术上成立但代价集中在功能回归（R-B1）与上游缺口（R-B2）；除非路径 A spike 失败，不建议首选。

### 4.3 测量/估算三选一与精度风险

| 方案 | 精度 | 成本 | 风险 |
|---|---|---|---|
| **M1 `lynx.getTextInfo` 逐段精确测量**（fontSize px + maxWidth=内容宽 → `content.length` = 行数 → 段高 = 行数×行高 px） | 高（原生排版引擎实测分行） | 同步调用 ×N 段，全文一次性 ~数百次同步测量（spike 需测总耗时；可分帧/分块摊销，先测首屏窗口+渐进后台测量） | 仅内置字体、无 letterSpacing/fontWeight（当前正文样式 `text-body-large` 默认字重，命中可用域）；**web-core stub** → 双端分叉，预览端降级浏览器 canvas 或估算；长段（maxLine 上限/截断行为）需 spike 验证 |
| **M2 字数 × 字号系数估算**（行宽 ≈ fontSize 全角宽 → charsPerLine = ⌊内容宽/fontSize⌋，行数 = ⌈字数/charsPerLine⌉） | 日文正文（全角 CJK 为主）**高精度**；含半角拉丁/数字串、emoji、行末标点挤压时偏离 | 零测量成本 | 误差单向可修正：段落挂载后 `bindlayout` 回报真实 `lineCount`/`size` → 修正该段高度并重排后续 offset（渐进校准）；webview 端 `buildFallbackLayout`（`createNovelVirtualLayout.ts` L60-104）即同思路先例 |
| **M3 M1+M2 混合**：估算先行（即时出窗口），getTextInfo/bindlayout 校准回填 | 高（收敛后=精确） | 实现复杂度最高 | 校准引发的高度修正 = scroll 锚定抖动，需锚定补偿（记录校准前锚段落，修正后回算 scrollTop——scroll-view 无 JS setScrollTop 精细通道，可用 `initial-scroll-offset`/属性通道 spike；或仅在未进入视口的段落上做预校准规避） |

**推荐**：路径 A 的 spike 以 **M1（原生）+ M2（web-core/降级）** 起步——M1 的可用域恰好覆盖当前正文样式（内置字体、无字重/字距定制）；若 M1 实测耗时或截断行为不达标，退 M2+bindlayout 校准。

### 4.4 MTS（main-thread script）路径评估：当前不可用

MTS（`'main thread'` 指令 + `main-thread:bindscroll` + `useMainThreadRef`）理论上可在主线程逐帧驱动窗口挂载，消掉 R-A1 跨线程时延；官方 ReactLynx 文档机制完整。**但本工具链实证不可用**：ADR-0115 T5 真机验证——vue-lynx + 原生 4.0.1 上加 `main-thread-*` 绑定导致组件整块空白，裁定不可用；ADR-0110 亦无 worklet 支持证据。**结论：不纳入方案，跟踪上游（SDK 升级评估票可顺带重验）**。getTextInfo 的 MTS 可用性（官方双线程文档）因此也暂不可消费，按 BTS 使用即可。

### 4.5 可行性初判汇总

| 路径 | 技术成立 | 主要风险 | 建议 |
|---|---|---|---|
| A. scroll-view + 段落窗口化（@scroll 驱动，M1/M2 测量） | ✅ 信号源/测量通道均有实证 | fling 空白（R-A1）、估算精度（M2）、web-core getTextInfo stub | **首选，进 spike** |
| B. `<list single>` 引擎虚拟化 | ✅（引擎能力官方明示） | 追更进度信号断供（R-B1）、#302 内存单调增长（R-B2） | 备选；A 失败或 SDK 升级消解 #302 后再评估 |
| C. 分块窗口化（N 段/块，块粒度窗口） | ✅ | 同 A 但更粗粒度、空白粒度更大 | A 的降载变体，spike 内对比 |
| D. MTS 主线程窗口化 | ❌（ADR-0115 T5 实证不可用） | —— | 排除，跟踪上游 |

---

## 5. 交后续票的验证清单

1. **量化归因（基准票 #305 衔接）**：Trace/帧指标分离 H1（稳态帧时间随文本长度的曲线）与 H2（触摸→首帧位移延迟，两端同机对比）；控制变量 = 文本长度、段落数、机型（Android 34 模拟器 + OPPO）。
2. **路径 A spike 必验**：
   - 原生 scroll-view @scroll 实际派发频率与丢帧（per-frame 断言的最后一环实证）；
   - `lynx.getTextInfo` 全文测量总耗时（10 万字量级）、长段 maxLine 行为、与真实渲染行数的吻合度（bindlayout 对拍）；
   - fling 极端速度下窗口挂载时延与空白表现（overscan 调参）；
   - web-core 降级路径（canvas 可用性检测 → 估算）双端一致性。
3. **路径 B 预验（若启用）**：追更语义回归评审（"≥70% 或到底"→"仅到底"）；长篇章滚动内存曲线（#302 缺口）。
4. **SDK 升级评估票联动项**：MTS 可用性重验（路径 D 解封）、list per-frame scroll（`mEnableScrollEvent` 门控在新版是否放开）、#302 cell 回收落地状态。

---

## 6. 证据索引

**本仓库**：
- `packages/app-lynx/src/pages/NovelDetail.vue`（L91-92 MVP 注释、L183-189 scroll-view、L226-228 全文 v-for、L75-89 滚动处理）
- `packages/app-lynx/src/api/novel.ts`（L99-121 纯文本提取）
- `packages/app-lynx/src/primitives/createWatchlistPrompt.ts`（L92-95 notifyScroll 轻量）、`watchlistPrompt.ts`（L40-57 computeReadProgress 与 payload 注释）
- `packages/app-lynx/src/components/GlassCard.vue`（L50-70 boundingClientRect invoke 通道注释）
- `packages/app-lynx/src/rspeedy-env.d.ts`（lynx 全局最小类型声明）
- `packages/app-lynx/CONTEXT.md`（滚动跟手性词条、pointer-events 平台约束）
- `packages/app/src/primitives/createNovelTextLayout.ts`（pretext 布局）、`createNovelVirtualLayout.ts`（TanStack Virtual + buildFallbackLayout 估算先例）、`isPretextSupported.ts`
- `packages/app/android/app/build.gradle`（L238 等：lynx 4.0.1）
- `docs/adr/ADR-0109`（LynxScrollEvent payload 字节码实证）、`ADR-0110`（list 无 per-frame scroll 实证、平台事实②）、`ADR-0115`（双线程触摸往返、MTS T5 否决）、`docs/specs/app-lynx-novel-series-watchlist.md` §7（@scroll 原生未量化自标注）
- `docs/research/vue-lynx-masonry-feasibility.md`（#302 回收 no-op、5k/10k/50k 包络）、`docs/research/vue-lynx-benchmark-ifr.md`（Android 9 低速画像、线程边界成本）
- `node_modules/@chenglou/pretext/src/measurement.ts`（canvas 硬依赖 L36-50/L66、Intl.Segmenter L119-124）
- `node_modules/@lynx-js/web-core` 0.23.1 产物 `lynx-core-chunk.js`（getTextInfo → LynxTextInfoModule，缺席回退 `{width: text.length}`）

**Lynx 官方文档（lynxjs.org）**：`<scroll-view>`（一次性创建/无回收/OOM/超三屏用 list）、`guide/ui/scrolling`（list 按需渲染可视区）、`<text>`（bindlayout 事件 payload）、`api/lynx-api/lynx/lynx-get-text-info` 与 `api/lynx-api/main-thread/lynx-get-text-info`（BTS/MTS 双侧、签名与限制）、`guide/inclusion/internationalization`（"Intl API is not implemented in Lynx"）、`guide/scripting-runtime`（PrimJS/QuickJS、BT ES2015/MT ES2019）、`guide/performance/analysis-performance/analysis-fluency`（帧时间=UI doFrame+RenderThread DrawFrames、长帧根因）、`react/main-thread-script`（MTS 机制）

**上游源码（lynx-family/lynx，经 gh api）**：`UIScrollView.java`（onScrollChanged 逐帧 EVENT_SCROLL 派发、mEnableScrollEvent 门控）、`UIText.java`/`FlattenUIText.java`（文本双形态、EVENT_LAYOUT 派发条件）、`core/public/text_utils.h` + `core/renderer/utils/android/text_utils_android.cc` + `js_libraries/lynx-core/src/modules/nativeModules/textInfo.ts`（getTextInfo 自 initial commit 2025-03-04 存在，覆盖 4.0.1）、`js_libraries/types/types/common/lynx.d.ts`（CommonLynx.getTextInfo 签名 L85）

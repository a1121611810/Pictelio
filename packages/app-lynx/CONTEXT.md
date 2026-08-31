# Pictelio app-lynx 上下文

app-lynx 是 vue-lynx 客户端 MVP（登录 / 推荐 / 插画 / 小说 / 收藏 / 用户主页 / 更新 / 错误页），渲染目标是 LynxView 真机与 web-core 预览。本上下文记录列表浏览、受限内容与分页的领域语言。

## 术语

### 受限内容（Restricted content）

**受限条目（restricted item）**：
`x_restrict` 为 1（R-18）或 2（R-18G）且设置中对应开关（`showR18` / `showR18G`）未开启的作品。由 `settingsStore.isRestricted()` 判定。列表**全量渲染**受限条目（不过滤、不删除），以受限卡呈现；开关打开后遮罩即时消失，无需重新请求。
_Avoid_: 被挡住、隐藏条目、过滤条目

**受限卡（restricted card）**：
列表中受限条目的占位卡：scrim 半透明底 + R-18 / R-18G 徽章 + 文案「受浏览限制，不予显示」。显式固定高度（与普通卡等高）、内容居中、无交互（不跳详情、点击不穿透）。插画条目为方形受限图区（`h-[48.4vw]`），小说条目用 `RestrictedNovelCard`（全站统一高度）。
_Avoid_: 遮罩卡（与遮罩的 absolute 覆盖模式语义不同）

**遮罩（overlay）**：
`RestrictOverlay` 组件的 absolute 覆盖模式（铺满父容器），用于详情页正文等「内容仍渲染、遮罩盖其上」的场景。列表卡一律用流内受限卡模式，**禁止**在 list-item 内使用 absolute 遮罩（真机高度测量异常，会撑满内容区）。

### 覆盖层与命中测试（Overlay & hit-testing）

**平台约束（ADR-0123，不可变）**：
原生 LynxView（lynx `4.0.1`）的 hit-testing **不识别 `pointer-events` CSS 属性**（官方 3.5 才引入、4.0.1 实机仍不生效；2026-08-30 真机/模拟器双重实证）。`pointer-events: none` 的全屏透明层依旧命中触摸，会**吞掉其下页面全部点击**。web-core（浏览器）行为正常——**双端行为不一致，穿透/遮挡改动必须以原生验证为准**。术语详见 `docs/adr/glossary-app-lynx-hit-testing.md`。

**全屏层规则（full-screen layer rule）**：
渲染树中的**全屏元素必须是交互面（带 `@tap` 句柄）**，否则必须从命中测试移除——实现手段只有两种：**`v-if` 条件渲染**（关闭态不渲染，最常用）或**零尺寸盒**（`absolute` 钉在 (0,0) 无尺寸，只作定位锚点，子元素 vw 定位仍正常渲染）。_Avoid_: 全屏/全宽元素 + `pointer-events-none` 指望穿透（原生不生效 → 吞点击）。对照正确模式：`RefreshableList` 的 scrim（`v-if="menu.isOpen"` + `@tap`）、`CommentOverlay`/弹窗 backdrop（均带 `@tap`）。

**定位锚点（positioning anchor）**：
原生 LynxView 把「最近的 view 祖先」当作 absolute 子元素的定位锚点（即使该祖先未设 position，与 Web 回退到视口的语义不同，模拟器实测偏离）。因此覆盖层元素的绝对定位一律用 **left/top vw + translate 居中**（vw 为视口基准，从锚点 (0,0) 起算恒等于视口坐标）；**禁止**在非全屏父盒内用 `right/bottom`（按父盒边缘解析 → 元素跑出屏幕，实测 FAB 消失）。

### 作品标识（Work indicators）

**动图（Ugoira）/ 多图（Multi-page）**：
跨上下文共享概念，判定条件与 app 侧一致（`type === 'ugoira'` / `page_count > 1`，独立判定、允许并存、动图在前）。详见 `packages/app/CONTEXT.md`。

**类型徽章行（Type badge row）**：
列表卡片上标识动图/多图的流内徽章行，位于图片下方、标题上方，仅在有标识时渲染。M3 assist-chip 形态：unicode 图标 + 文字（`▶ 动图` / `⧉ N 图`）、`bg-secondary-container`、`text-label-medium`、`md-shape-small` 圆角。图标沿用 NavigationBar 的 unicode 符号约定（Lynx 无图标库）。统一由公共组件 `IllustTypeBadgeRow` 渲染，各瀑布流页面接入。
_Avoid_: 图上 absolute 角标（list-item 内 absolute 真机高度测量异常，见「遮罩」词条）、各页面散写徽章

**标签胶囊行（tag chip row）**：
推荐轮播滑页 scrim 区的标签行（ADR-0118）——M3 assist-chip 形态（同「类型徽章行」：`bg-secondary-container` / `text-label-medium` / `md-shape-small` 圆角），文本 `translated_name || name` 带 `#` 前缀；**最多 3 个，超出折叠为「+N」**，单行不换行；插画与小说统一展示；**纯展示不可点**（app-lynx 无搜索路由）。
_Avoid_: 全量标签堆叠、可点击标签（无搜索页）、省略号截断

### 分页（Pagination）

**混合分页 feed（mixed pagination feed）**：
`createMixFeed` 深模块——把多路远程分页源（插画/小说）交替合并成单一渲染流，向调用方隐藏双防抖（throttle 800ms + cooldown 3s）、竞态代（generation）、去重、分批渲染（pageSize=20）、翻页优先级、15s 超时、空页防护。**所有列表页**（推荐/插画/小说/关注/收藏/用户主页/追更）统一经它分页，页面只做 ref 快照桥接（sync）。合并模式：`merge` 选项——默认 `'ratio'`（固定比例交替，其余列表页），推荐页传 `'time-merge'`（时间交叉合并，ADR-0115）。
_Avoid_: 手写 loadMore、页面内双防抖/竞态/空页防护

**按钮分页（button pagination / 翻书分页）**【废弃 2026-08-30，ADR-0115】：
推荐页**曾用**的分页形态（ADR-0114）——列表**永远只显示当前页**，由 FAB menu 的「上一页 / 下一页」切页；切页 = 整树重建（epoch）+ 从页顶看，回顶成为翻页的自然语义。绕开 vue-lynx `<list>` 增量渲染失效的框架 bug。推荐页改单卡轮播（ADR-0115）后弃用，改「无限滑流」。
_Avoid_: 在推荐页再次使用（历史语义，勿引入代码与文档）

**页缓存（page cache）**【废弃 2026-08-30，ADR-0115】：
按钮分页（已废弃）下「上一页」的数据来源——Pixiv API 无 `prev_url`，已拉取页面数据缓存于内存，「上一页」即时返回缓存页而不重新请求。推荐页弃用按钮分页后该词条为历史语义（`createPagedFeed` 亦随 ADR-0115 删除）。
_Avoid_: 在推荐页再次引入「上一页」缓存语义

**时间交叉合并（time-merge）**：
多路分页源（推荐页 = 插画 + 小说）按作品 `create_date` 降序交叉合并的混合方式（app 端 `recommendedStore` 的 sortByDate + mergeAndSort 语义），替代固定比例交替（ratio 4:1）。推荐页经 `createMixFeed(merge: 'time-merge')` 使用（ADR-0115），其余列表页保持默认 ratio。页内全量展示各路之和（不截断——按时间排序后截断会丢数据）。
_Avoid_: 固定比例交替、截断取前 N

**分页到底态（end-of-feed）**：
所有分页源耗尽（`nextUrl` 为 null）且列表非空时的状态。列表底部 footer 显示「没有更多了」，`scrolltolower` 不再触发请求。
_Avoid_: 到底后报错、静默空白

**内联分页错误（inline pagination error）**：
分页（fetchMore）失败时在**列表底部**显示的错误提示，保留已加载内容，`nextUrl` 保留供滚动自动重试。与首屏错误（顶部整页提示）相对——两者槽位分离（createMixFeed 的 `error()` / `pageError()`）。
_Avoid_: 分页错误显示在列表顶部、清空已加载内容

**推荐轮播（recommended carousel）**：
推荐页的形态（ADR-0115）——不再是列表，而是**单卡轮播**（卡片浏览器）：一滑页 = 一个作品（插画或小说），沉浸式全 bleed 大图卡，信息叠底部渐变 scrim（标题 / 作者 / 类型徽章 / 收藏按钮 / 字数）。点卡进详情（按 kind 前缀 `/illust/` | `/novel/`）。作品类型 = 插画 + 小说混合，统一封面卡模板。
_Avoid_: 原瀑布流列表、整页轮播（一滑页 = 一页多卡）

**无限滑流（infinite slide stream）**：
推荐轮播的加载方式（ADR-0115）——滑近末尾自动 `fetchMore` 下一批，可一直往下滑，**无「上一页/下一页」按钮**（取代按钮分页）。与列表的「无限滚动」是不同渲染形态：此处的滑动由触摸+translateX 驱动，不依赖 `<list>` 增量渲染。
_Avoid_: 按钮分页、自动轮播（不自动播）

**受限跳过（skip restricted）**：
推荐轮播对受限条目的处理（ADR-0115，与列表的「受限卡」不同）——受限条目**不在可视滑页流中占位**（渲染层把 `isRestricted` 条目过滤掉）；数据层仍加载。开关切换时因数据仍在 feed 里，重算过滤即可显示/隐藏，**无需重请求**。
_Avoid_: 受限卡（列表形态）、列表渲染策略（全量渲染受限条目）

**swipe 轮播 / 自研轮播（hand-rolled swipe carousel）**：
推荐轮播的实现技术（ADR-0115，参照 vue.lynxjs.org/zh/guide/tutorial-swiper.md）——**非原生 `<swiper>` 元素**，而是手写。**⚠️ 2026-08-30 T5 真机验证修订**：官方教程的「主线程脚本」（`'main thread'` 指令 + `useMainThreadRef` + `:main-thread-bindtouch*`）在 Android 原生 LynxView 上会致组件整块渲染空白（判定不可用），故实现改用**后台线程**方案：触摸 `@touchstart`/`@touchmove`/`@touchend`（后台线程）+ Vue 响应式 `:style` 绑定 translateX（不直接 DOM 访问），slide 宽/吸附/位移全程 px（`SystemInfo.pixelWidth/pixelRatio`），松手 `requestAnimationFrame` 吸附翻页。详见 ADR-0115「T5 验证修订」与 `docs/research/vue-lynx-swiper-tutorial.md`。
_Avoid_: 原生 `<swiper>`、`main-thread-*` 绑定（本仓库原生不可用）、硬编码 vw 宽（应 px）、依赖 tsc/vitest 验证构建合法（见「script-setup 禁 export」）

**单刷新 FAB（single refresh FAB）**：
推荐轮的刷新入口（ADR-0115）——一个 M3 刷新 FAB（56dp、primary-container、icon `⟳`），从列表的「FAB menu（刷新/回顶/上一页/下一页）」退化为**单按钮**（仅推荐页）。其余列表页仍用 FAB menu（见「列表操作」）。
_Avoid_: 推荐页保留 prev/next/回顶菜单项、下拉刷新手势

**封面比例显示（cover proportional display）**：
推荐轮播滑页封面的显示规则（ADR-0118）——图片**贴顶、宽度占满滑页、高度按原图比例**（不裁切、不变形）；显示高度用作品元数据预计算（插画 `width/height`、小说方形封面按 1:1），不等图加载。**超高图**（按比例高度 ≥ 滑页可视区高）回退 `aspectFill` 裁切（不溢出、无页内滚动）。小说封面同规则。底部渐变 scrim 信息区保持在屏幕底部（图短时图与 scrim 之间露出 surface 背景）。
_Avoid_: 全 bleed `aspectFill` 铺满整屏（图被裁）、`widthFix` 式底部裁切、页内滚动

**轮播吸附阈值（snap threshold）**：
推荐轮播松手翻页判定（ADR-0118，替代 ADR-0115「吸附最近页 round 50%」语义）——拖过 **1/3 屏宽**松手即翻页、未过回弹；叠加 **fling 甩动判定**：快速滑动（位移短但速度超阈值）即使未到 1/3 也沿速度方向翻页，慢拖仍按阈值。上一张/下一张对称生效，吸附动画保留。
_Avoid_: 50% 阈值（旧语义）、纯位置判定无 fling、位移放大跟手

**沉浸骨架（immersive skeleton）**：
推荐轮播首载骨架（ADR-0118）——按滑页布局的骨架：上部全宽 shimmer 图区 + 底部 scrim 区域文字条（标题/作者/徽章位），取代「加载中…」文字。触发 = **渲染流为空即显**（不依赖 loading 标志，冷启动请求前立即出现）；已有数据时刷新不闪骨架；失败换整页错误提示。与「图片三态」的图级骨架（CoverImage 内 shimmer）不同层：本词条是**页级首载占位**。
_Avoid_: 纯文字加载态、依赖 loading 标志的显隐时机、刷新时闪骨架

**轮播 scrim 页面级遮罩（carousel page-level scrim overlay）**：
推荐轮播的 scrim 是**页面级固定遮罩**（`absolute bottom-0`，位于 CarouselSwiper 之后、按当前页 index 显示当前条目的标签/标题/作者/收藏），**而非**每 slide 内各渲染一份——真机 LynxView 对被 `translateX` 平移的 flex-row **非首 slide** 内的 `<text>` **永不渲染**（仅图片/`<view>` 正常；重挂载换 key、改 `display:linear`、改绝对→流内布局均无效；绿像素检测证实第 2+ 页 title 全屏无渲染；web-core 正常）。抽为页面级遮罩后文字不再落入被平移的 flex-row，各页均可渲染、随 index 更新。**权衡**：遮罩覆盖底部，底部 scrim 区不响应滑动（真机 `pointer-events` 对触摸不生效），滑动需从上部图片区发起；点卡进详情由遮罩 `@tap` 承担（收藏按钮 `@tap.stop`）。
_Avoid_: 在轮播 slide 内渲染 `<text>` 承载的 scrim（真机非首 slide 文字不渲染）、依赖 `pointer-events` 让遮罩穿透滑动（真机无效）

### 追更（Series watchlist）

**追更询问（watchlist prompt）**：
系列小说详情页的返回守卫询问。触发条件全部命中才弹：小说是系列作品、未追更、本会话未「暂不」、页面停留 ≥10s，且（滚动进度 ≥70% **或**到达底部）。弹出时机 = **按返回键时**（返回守卫拦截），不是到底自动弹（已否决的语义）。「追更」加入追更列表后继续返回；「暂不」继续返回且本会话不再询问；返回键关弹窗 = 留在详情页且本会话不再询问。系列追更状态预取失败（状态未知）时保守不弹。
_Avoid_: 二次确认（口语别名，勿入代码与文档）、到底自动弹窗

### 列表操作（List actions）
列表页唯一的浮动操作入口（M3 FAB menu），固定于列表容器右下角。常态为一个刷新 FAB（56dp，primary-container）；点击后 FAB 变身为 close button（图标 ✕，同尺寸原位），浮出 scrim，并从 FAB top-trailing edge 展开两个 medium-button 规格菜单项：「刷新」「回顶」。执行任一操作后自动收起。双端同构（LynxView / web-core 同一实现与动画）。
_Avoid_: 堆叠 FAB、speed dial、下拉刷新手势（已废弃，ADR-0107）、页面自持刷新态

**刷新旋转（refresh spin）**：
刷新进行中的视觉反馈：↻ 图标在主 FAB（或菜单中的刷新项图标）持续旋转（1s/圈），与禁用态/忙碌态共同构成「可见刷新过程」（ADR-0108）。刷新结束图标复位。双端同构。
_Avoid_: 无动画静默刷新、JS 计时器驱动旋转、骨架遮罩

**重建回顶（rebuild-to-top）**：
`<list>` 不派发 per-frame scroll、无 JS 可触发滚动属性（ADR-0110 平台事实）时的回顶实现：点击「回顶」触发页面 list `:key` 重建，新列表起始于顶部。由 `RefreshableList` 的 `@back-to-top` 事件驱动。
_Avoid_: 滚动阈值显示、JS 逐帧驱动回顶、常驻轮询 timer

**RefreshableList**：
列表操作容器组件（深模块），本上下文唯一合法的列表刷新/回顶入口承载者。接口仅两件：`:refresh` 函数 prop（页面传入幂等刷新函数）与默认 slot（放现有 `<list>`）。内部持有刷新态、M3 FAB menu 展开态、互斥规则、旋转与展开动画、回顶防重入；**页面禁止自持刷新态**。9 个列表实例统一消费。
_Avoid_: 页面直接渲染刷新按钮、复活独立 Fab 组件（Fab.vue 已删除）、下拉刷新手势、页面写 `<refresh>` 标签

### 作品交互（Work interactions）

**收藏动效（bookmark animation）**：
BookmarkButton 切换收藏的双向即时视觉反馈（M3 规范内形态）：收藏 = state-layer 环向外扩散 + 心形 spring 弹入填红；取消收藏 = 环向内收拢（「收回」语义）+ 心形下沉回稳褪灰。乐观触发（点按即播，失败静息回滚），change 事件在动画播完后才上抛（动画完成态）。详见 ADR-0112。
_Avoid_: 等 API 成功再播动画、粒子爆发、失败时播反向动画

### 图片三态（Image states）

**图片三态（image state）** / **沉浸封面（CoverImage）**：
图片加载的骨架（skeleton） / 图片（image） / 失败+重试（failed）三态；由深模块 `CoverImage` 统一承载（小接口 `src`、`layout: 'full' | 'box'`、`retry?`、`lazyLoad?`）。`RecommendedCover`（全 bleed，`layout="full"`）与 `SkeletonImage`（盒适配，`layout="box"` 的便捷封装）均经它渲染，避免各组件再抄三态。三态推导纯逻辑（`deriveCoverState` / `withRetryQuery` / `deriveRetryState`）保留在 `src/utils/coverImage.ts`（node 单测可测）。
_Avoid_: 各组件自写图片三态状态机/模板

**骨架（skeleton / shimmer）**：
「图片三态」中的加载中态——`<image>` 未触发 `@load` 时叠于图上层的 shimmer 微光占位（`shimmer` 类、`bg-surface-container-high`），避免空白等待；`deriveCoverState(loaded=false, failed=false)` 推导。进入「图片」态（`@load`）后隐藏。
_Avoid_: 加载中纯空白、固定灰块而无微光

**失败重试（failed + retry）**：
「图片三态」中的失败态——`<image>` `@error`（或空 `src` 直接判定，避免 `<image src="">` 不触发 `@error` 而无限骨架）后显示「图片加载失败」+ 重试按钮；点击经 `deriveRetryState` 从**干净 base src** 重建（附加一次性 `retry=<ts>` cache-bust，防 `&retry` 累积）并复位回「骨架」，仅重载该图，不整页刷新。失败态优先于其他态（`deriveCoverState` 互斥规则）。
_Avoid_: 失败后永久 shimmer、重试用已带 retry 的 `imageSrc`（累积 `&retry`）、失败态无「重试」入口

### 客户端（Client）

**动图播放管线（ugoira playback pipeline）【2026-08-31 新增】**
ugoira（Pixiv 动图）在 lynx 客户端从「元数据 → 帧数据 → 帧渲染 → 帧调度」的完整链路。**原生 LynxView 模式**（`isNativeMode()` 真）与 **web 模式**（Vite 代理 fetch）管线形态不同：
- **原生模式 = Java 解压写盘管线（unpacked pipeline）**：JS 只调 `PictelioApi.ugoiraExtract(zipUrl, framesJson, cb)` 拿「帧 file:// URL 列表」；zip 下载、解压、写盘全在 Java 侧（`cache/ugoira/`），帧二进制零进 JS 堆（ADR-0037 语义）。渲染复用 `<image>` + `PictelioImageService`（`canParseUrl`/`loadAndDeliver` 放行 `file://` 帧）。
- **web 模式 = JS 解压管线（zip pipeline）**：fflate 全量解压或 Range 流式取帧（`/pixiv-img` 代理 + Range 头），帧转 base64 data URL（`bytesToDataUrl`），`<image>` 按 `meta.delay` 切换。
_Avoid_：「双端同一管线」——实测（原型报告 `docs/research/ugoira-native-pipeline-proto.md`）证明 data URL 在自研 ImageService 架构下原生模式不可用（OkHttp 拒绝 `data:` scheme），双端管线分叉是架构事实，不是实现分歧。

**帧文件 URL（frame file URL）**：
解压写盘管线产出的帧引用形态：`file:///data/user/0/io.pictelio.app/cache/ugoira/frame_N.{png|jpg}`。仅原生模式存在；`<image>` 经 `PictelioImageService` 的 file:// 分支直接读盘渲染，不经过 OkHttp。
_Avoid_：base64 data URL 用于原生模式（实测不可用，见上）

**动图帧调度（frame scheduler）【2026-08-31 修订】**
`UgoiraViewer` 内按 `meta.delay` 驱动的 `setTimeout` 循环切换（`playFrom`/`stop`），帧数据驻留内存（web 模式）或逐个 `<image>` 加载（原生模式）。卸载竞态防护：AbortController + `disposed` 标志，卸载后丢弃帧数组与定时器（issue #138 同款）。
_Avoid_: 调度器中混入帧渲染时序（渲染层问题见「动图帧呈现」）

**原生流式渐进（native streaming playback）【2026-08-31，ADR-0128】**
原生模式首次播放的渐进形态：Java 侧「流式下载 → ZipInputStream 边读边解压边写盘 → 按批交付
帧 URL 列表」，JS 经拉模式状态机（`ugoiraExtractStream` 启动 → `ugoiraExtractStreamPoll` 拉批 →
`ugoiraExtractStreamCancel` 中止）增量拿帧，播放器到列表尾部**等待新帧**（done 后循环）。
与全量路径（`ugoiraExtract`）并存：缓存命中（帧完整）时流式启动一次 poll 全量交付；失败/中断
保留已写盘帧（下次命中）。与 app 侧「流式取帧/渐进播放」（ADR-0127）语义对齐：都是「首批帧
就绪即播」，区别在本端数据源为 Java 流式写盘（file:// 帧，二进制零进 JS 堆，ADR-0037 保持）。
_Avoid_: 用共享包 `createStreamFrameSource` 做原生渐进（LynxFetchModule 无流式 body + 渲染要求 file:// 落盘，JS 拿不到流）

**动图帧呈现（frame presentation）【2026-08-31，跨上下文】**
帧切换时「把当前帧画到屏幕」的渲染层行为。Lynx `<image>` 默认在**新一次加载发起前清除已展示的图片资源**——帧切换快于解码（ugoira delay 20~80ms）时画面在「图↔空白」间高频交替（播放闪烁）；官方属性 `defer-src-invalidation`（default false）改为**新加载成功后才清除旧图**，即官方给出的闪烁解法（lynxjs.org `<image>` 文档原文；2026-08-31 原型实测：基线 325 帧中 4 次空白过渡，加属性后 374 帧 0 空白，证据见 `docs/research/ugoira-playback-flicker-range-proto.md`）。
**⚠️ 必须 `:defer-src-invalidation="true"` 布尔绑定**：裸属性 `defer-src-invalidation` 被 vue-lynx 模板编译器产出为 `""`（空字符串），原生 `<image>` 按 truthy 判断不生效（真机回归实测：首次合入裸属性写法后真机仍「图↔空白」闪烁，改布尔绑定后 116 帧全部 dt<delay 零空白，commit `a1e9c00`；编译产物断言由 `src/components/ugoiraViewerTemplate.test.ts` 机器防线把守）。
_Avoid_: 换双 `<image>` 层叠/onLoad 门控（实测引入隐藏层首载停滞 + 帧间隔膨胀 25%，收益与属性相同）；用 `v-if` 换帧重建元素（放大重载开销）；写裸属性 `defer-src-invalidation`（编译为 ""，真机不生效）

**帧提取模式（frame extract mode）**：
`ugoiraMode` 设置项的两个取值：`fflate`（默认，JS 全量解压）与 `range`（Range 流式取帧）。**当前仅 web 模式生效**——原生模式走解压写盘管线，`ugoiraMode` 对其无意义；设置项保留用于 web 模式（Me 页切换）。web 模式 range 失败（非 206 / 长度不符 / 网络错）自动**降级 fflate** 并 `console.warn`（禁止静默降级，2026-08-31 与 app 侧对齐）。
_Avoid_: 混淆「流式取帧」与「Range 流式取帧」——共享包 `createStreamFrameSource`（ADR-0127，走全量 200 通道增量解压）本端暂不消费（原生走 Java 解压写盘、web 保持全量），语义见 `packages/app/CONTEXT.md`

**代理路径与原生 fetch（proxy path vs native fetch）【2026-08-31 新增】**：
`/pixiv-img/` 相对路径在原生 LynxView 模式下**不是合法 fetch 目标**（LynxFetchModule 拒绝无 scheme URL，issue #218）；原生模式的图片/文件下载 URL 必须是绝对 CDN URL（`https://i.pximg.net/...`）且**必须带 `Referer: https://app-api.pixiv.net/` 头**（无 Referer → 403，原型 A 方案实测）。


**双域名 URL（double-host URL）**：
原生模式下绝对 `next_url` 未归一化产生的错误 URL：`apiBase + 绝对URL`，Pixiv 返回 404。`rewriteUrl` 原生分支负责把绝对 Pixiv URL 剥离域名成相对路径（含 query）。跨上下文共享概念，详见根 `docs/adr/glossary-search-pagination.md`。
_Avoid_: 把绝对 next_url 原样传给原生模块

**受限条目 level 派生（restrict level derivation）**：
`x_restrict === 2 ? 2 : 1` 的徽章级别映射，收敛在 `RestrictedNovelCard` 组件内部（接口只收 `item`），调用方不重复该表达式。

### 构建约定（Build conventions）

**script-setup 禁 export（SFC no-export）**：
app-lynx 的 `<script setup>` 块**禁止使用 ES module `export`**（含命名导出与 `export default`）——vue-lynx 的 `<script setup>` SFC 编译器不识别该构造，会使 `rspack-vue-loader` 的 `resolveScript` 返回 null，导致 `rspeedy build` / `pnpm build` 失败。注意：`tsc`（`pnpm check`）与 `vitest` 都只按纯 TS 处理 `<script setup>` 内容，**不会**拦截此错误，因此"测试全绿"不代表能构建。组件需把子模块能力对外提供时，直接引用底层纯函数模块（如 `primitives/swiperMath.ts`），不要经组件 re-export。详见 ADR-0116。
_Avoid_: 在 `<script setup>` 里写 `export { ... }` / `export default`；依赖 tsc/vitest 校验构建合法

### 放射导航（Radial navigation）

**放射导航 FAB（radial nav FAB）**：
全局唯一的右下角悬浮 FAB，是导航中枢；点按展开成「双层环」放射菜单，替代底部 M3 `NavigationBar`（4 tab）与各顶层 tab 页自己的刷新 FAB。仅在 4 个顶层 tab 页（推荐/插画/小说/我的）显示。详见 ADR-0120、`docs/adr/glossary-app-lynx-radial-nav-fab.md`。
_Avoid_: 底部导航栏、浮动按钮、feed 分页 FAB（见下）

**双层环（double ring）**：
放射菜单几何结构——**外环**=4 导航 tab（`NAV_TABS` 事实源，当前 tab 高亮）、**内环**=页面动作项（刷新/回顶/翻页），同角度双半径锚定在 FAB 右下。B 方案定稿形态（A 单弧扇出、C 混合均否决）。
_Avoid_: 单弧扇出 8 项（手机屏拥挤）

**页面动作桥（page action bridge）**：
顶层页以 `usePage(routeName, actions)` 把 `{refresh?, backToTop?, extras?}` 注册进放射 FAB（按路由名作键，KeepAlive 安全）；模块读**激活页**那份进内环。非 tab 页不注册，保留各自 `RefreshableList` 的 FAB。
_Avoid_: 全局事件总线

**feed 分页 FAB（button-pagination FAB）**：
与放射导航 FAB 区分——`RefreshableList` 内为分页/回顶提供的 FAB 菜单（`FabMenuExtraItem`：上一页/下一页/刷新/回顶），仅**非 tab 页**保留；tab 页切换 `:fab="false"` 关闭它，动作经页面动作桥上抛到放射 FAB。

**环项尺寸基准（ring size basis）**：
放射菜单各圆环项尺寸按 **vw 缩放 + 375dp 设计宽**（`1vw=3.75px`）换算，以统一 M3 尺寸（56dp 圆=`14.93vw`、24dp 图标=`6.4vw`、12sp 文字=`3.2vw`）。与 app-lynx 全项目 vw 缩放约定一致，375dp 屏上精确等于 M3 尺寸。_Avoid_: 固定 dp（破坏全局 vw 一致性）。

**放射菜单项 56dp 圆（B 方案定稿）**：
外环导航项为 **56dp 圆形**（`14.93vw`），圆内 24dp 图标（`6.4vw`）+ 12sp 文字（`3.2vw`）；内环动作项保持 **40dp 圆**（`10.67vw`）+ 24dp 图标。B 方案（大圆）为原型三变体定稿形态。_Avoid_: 48dp 圆（圆内文字被裁/贴底）。

**展开层叠序（expanded stacking order）**：
FAB 展开后菜单项须**浮于遮罩之上**：`遮罩(z-10) < 菜单项(z-20) < 主 FAB(z-30)`（同一 **z-40 外层**内）。ADR-0123 起外层为**钉在 (0,0) 的零尺寸盒**（只作定位锚点、不参与命中测试），遮罩与菜单项整层 `v-if="view.isOpen"` 条件渲染（关闭态渲染树无全屏元素 → 页面点击不被吞）；主 FAB 常显于其内。修复前（ADR-0123 之前）菜单项无 z-index 被遮罩压住且点不到；ADR-0121 时期外层为常显全屏容器，ADR-0123 改为零尺寸盒 + 条件渲染。

**外环扫角约束（outer sweep bound）**：
外环导航项扫角**不过 FAB 水平线**（`OUTER_END` 收在约 `-88°`）。修复前 `-100°` 使末端项越过 -90°（cos 变负）往屏幕下方走，在贴底 FAB 上探出屏幕底边。

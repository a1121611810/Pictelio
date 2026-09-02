# LynxJS 内置 `<image>` 元素官方文档调研（2026-09-02）

> 用途：为「列表滚动中图片加载」场景（#318 速度感知图片降载探针）提供文档级事实依据。
> 方法：逐段通读主来源（中/英两版）→ 沿页内链接跟随相关文档（list / scroll-view / 资源预加载 / MediaResourceFetcher / Lynx Service / 曝光能力 / LazyComponent / 性能分析）→ 与 app-lynx 自研图片链快速对照（不展开代码分析）。
> 术语以英文版为准记录。

## 来源清单（访问日期：2026-09-02）

| # | URL | 说明 |
|---|-----|------|
| 1 | https://lynxjs.org/next/zh/api/elements/built-in/image.md | 主来源·中文版（35 KB，已逐段读完） |
| 2 | https://lynxjs.org/next/api/elements/built-in/image.md | 主来源·英文版（默认语言，无 `/en/` 前缀；`/next/en/...` 为 404） |
| 3 | https://lynxjs.org/next/zh/api/elements/built-in/list.md | `<list>` 懒加载/预加载 |
| 4 | https://lynxjs.org/next/zh/api/elements/built-in/scroll-view.md | `<scroll-view>`（元素）性能优化建议 |
| 5 | https://lynxjs.org/next/zh/api/lynx-api/lynx/lynx-request-resource-prefetch.md | `lynx.requestResourcePrefetch` 预加载 API |
| 6 | https://lynxjs.org/next/zh/api/lynx-native-api/lynx-media-resource-fetcher/should-redirect-url.md | MediaResourceFetcher（URL 重定向） |
| 7 | https://lynxjs.org/next/zh/guide/start/integrate-with-existing-apps.md | Lynx Service / LynxImageService 宿主注入 |
| 8 | https://lynxjs.org/next/zh/guide/interaction/visibility-detection/exposure-ability.md | 曝光能力（文档明示用于 UI 懒加载） |
| 9 | https://lynxjs.org/next/zh/ui/components/lazy-component.md | lynx-ui `<LazyComponent>`（曝光驱动渲染，可调 visibility margin） |
| 10 | https://lynxjs.org/next/zh/ui/components/scroll-view.md | lynx-ui `<Scrollview>` 组件（内置 LazyComponent 懒加载） |
| 11 | https://lynxjs.org/next/zh/guide/performance/analysis-performance/analysis-fluency.md | 流畅度分析（帧/丢帧/图片资源治理官方表述） |
| 12 | https://lynxjs.org/next/zh/llms-full.txt | 全量文档包（用于交叉检索：blur-sampling 归属、`trailNewImage` 引用、性能节流表述等） |

---

## 1. `<image>` 属性总览（来源 #1/#2「属性」章节）

**显示前置条件**（使用指南）：必须设置非空 `src`，且至少满足其一——`width`/`height` > 0，或 `auto-size`。`<image>` 是空元素（不支持子节点）。

| 属性 | 类型/取值 | 默认值 | 最低版本（英文版） | 行为 |
|------|----------|--------|------|------|
| `src` | `string`，必填 | undefined | 0.2 | 图片 URL；英文版注明支持 http/https/base64；中文版注明支持格式 `png/jpg/jpeg/bmp/gif/webp`，**不支持 svg**（需自定义元件） |
| `mode` | `'scaleToFill' \| 'aspectFit' \| 'aspectFill' \| 'center'` | `scaleToFill` | 0.2 | 裁剪/缩放模式：默认拉伸填满；aspectFit 保比例完整可见；aspectFill 保比例短边填满（可裁剪）；center 不缩放居中 |
| `placeholder` | `string` | – | 1.4 | 占位图路径，使用限制与 `src` 相同 |
| `blur-radius` | `string` | `0px` | 0.2 | 高斯模糊半径（image 元素无配套降采样参数） |
| `prefetch-width` / `prefetch-height` | `string` | `0px` | 1.4（Android/iOS） | **排版宽高为 0 时也能发起请求**：「image 的尺寸为 0 时不加载，设置 prefetch 后可以加载」。用于提前加载场景，建议与真实排版尺寸一致 |
| `cap-insets` | `string`（上右下左四值） | `0px 0px 0px 0px` | 1.4 | 9patch 可拉伸区域，不需要原图真是 9patch。⚠️ 中英文档不一致：中文版「需要是具体数值，不支持百分比和小数」，英文版写 "in percentage or decimal"——以英文语义为准（允许百分比）但存在文档矛盾 |
| `cap-insets-scale` | `number` | 1 | 1.4 | 调整 cap-insets 拉伸像素位置缩放 |
| `loop-count` | `number` | 0（= 无限循环） | 1.4 | 动图播放次数 |
| `image-config` | `'RGB_565' \| 'ARGB_8888'` | `ARGB_8888` | 1.4（Android/Desktop 标注） | **bitmap 内存格式**：ARGB_8888 每像素 32 bit 含 alpha；RGB_565 16 bit 省内存但**丢透明度**、可能影响 border-radius（建议圆角放父 view + clip-radius）、不推荐 aspectFit 模式。文档附内存算式（1024×768 为例：w×h×bpp/8）。中文版说明 PC 平台自 3.5 起支持 |
| `auto-size` | `boolean` | false | 2.6 | 无宽或高时，图片下载成功后按原图宽高比**重算元素尺寸**（尺寸随图片数据回调更新） |
| `defer-src-invalidation` | `boolean` | false | 2.7 | src 切换时：默认**先清除旧图再发起新加载**；true 则新图加载成功后才清除旧图（防闪烁）——**文档明确：list 等有视图节点复用的场景不建议开启** |
| `autoplay` | `boolean` | true | 2.11 | 动图加载完成后是否自动播放 |
| `tint-color` | `color` | – | 2.12 | 非透明像素染色 |

**事件**（英文版版本标注）：`bindload`（0.2；中文版明确：**图片发起了请求且成功后触发，输出图片宽高** `detail.width/height`）、`binderror`（0.2；中文版含 `errMsg/error_code/lynx_categorized_code`）、`bindstartplay`/`bindcurrentloopcomplete`/`bindfinalloopcomplete`（3.7；动图播放事件，finalloopcomplete 需设置 loop-count）。

**方法**（SelectorQuery `invoke`，2.11）：`pauseAnimation` / `resumeAnimation`（不重置 loop-count）、`stopAnimation`（重置 loop-count）、`startAnimate`（英文版标注 **deprecated**）。

**结论（问题 1）**：加载/解码/渲染相关属性= `src` / `mode` / `placeholder` / `blur-radius` / `prefetch-*` / `image-config` / `auto-size` / `defer-src-invalidation` / `tint-color` / 动图组。**元素级不存在** `quality`、`decoding`、`cache`、`lazy-load`、`loading`、`max-size`、`resize`、`scale` 属性（中英文版均已核对，属性表无此任何一项）。

---

## 2. 懒加载机制（问题 2）

关键结论：**`<image>` 元素没有元素级 lazy-load 属性**（当前文档版本属性表不存在；`/next` 文档为当前最新）。懒加载由三类机制承担：

### 2.1 `<list>`：引擎级「只渲染可视区」+ 回收（来源 #3）

- 文档原话：「`<list>` 的宽高代表了其可视区域的大小……**只有在可视区域内可见的子节点才会被渲染**」；APISummary：「高性能的可滚动容器，通过**元素回收和懒加载机制**优化性能和内存使用」。
- `preload-buffer-count`（默认 0）：控制「提前加载 list 外节点的个数」，值越大屏外预渲染越多但内存越大；建议取一屏节点数；**仅 `list-type='single'/'flow'` 生效**（waterfall 无此参数）。
- 配套：`lower-threshold-item-count` 分页哨兵、`recyclable`（list-item 默认 true）。

即：**list 内的 `<image>` 天然是"接近可视区才创建/请求"**（引擎裁剪 + 回收保证），这就是"视口外不请求"的主要保证。

### 2.2 `<scroll-view>`：无懒加载、无复用（来源 #4）

- 元素文档原话：「`<scroll-view>` 会**一次性创建所有的子节点**，这有可能导致首屏耗时非常严重。可以通过曝光事件驱动它仅创建可见的子节点」；「没有任何复用机制，内容过多可能 OOM；**数据超过 3 屏时尽可能使用 `<list>`**，或根据曝光事件自行模拟 VisualizedList 逻辑」。

### 2.3 曝光能力：官方推荐的"UI 懒加载"手段（来源 #8/#12）

- 曝光能力文档明言用途：「实现诸如埋点上报、**UI 懒加载**的需求」。
- 机制：节点加 `exposure-id` 属性 → 可见性变化触发 `exposure`/`disexposure`（GlobalEventEmitter 或 `binduiappear`/`binduidisappear`）；`exposure-scene`、`exposure-area`（曝光比例阈值）、`exposure-screen-margin-*`/`exposure-ui-margin-*`（**提前触发距离**，Android/iOS 需 `enable-exposure-ui-margin`）。
- 检测任务本身可调：`lynx.setObserverFrameRate`（曝光检测频率）、`lynx.stopExposure`/`lynx.resumeExposure`（BTS/MTS）。
- ⚠️ 注意 `enable-exposure-ui-margin=true` 会改变 `exposure-screen-margin-*` 行为，「**可能导致可滚动容器的懒加载失效**」（view 属性文档原文）。

### 2.4 lynx-ui `<LazyComponent>` / `<Scrollview>`（来源 #9/#10）

- `<LazyComponent>`：**自身曝光后才渲染其内容**，用于优化首屏；`bottom='200px'` 等 visibility margin 让内容**提前 200px 进入视口前挂载**（示例明示 "items mount up to 200px before entering the viewport"）。这是**渲染级**懒加载（内容 mount/layout 时机），不是图片请求级。
- lynx-ui `<Scrollview>`：内置 LazyComponent 懒加载能力的滚动容器（用于优化首屏耗时）。

### 2.5 请求时机相关的元素门控与主动预取

- **零尺寸门控**（#1/#2）：image 元素尺寸为 0（无 width/height 且无 auto-size，或尺寸为 0）时**不发起请求**；`prefetch-width/height` 可突破该门控提前请求。
- **`lynx.requestResourcePrefetch`**（#5）：前端主动预加载 image/video/audio/font，**预加载后以 `uri` 作为 key 传给 `<image>` 的 `src`** 才能命中缓存：
  - `params.priority`（仅 image）：`high` / `medium` / `low`（默认 low）——**high 会阻塞图片库中其他图片请求**；
  - `params.cacheTarget`（仅 image）：`disk`（默认）/ `bitmap`（预解码保留内存；**注：Android bitmap 缓存暂不能生效**）；
  - iOS 图片预加载需打开 image 组件的 **`trailNewImage` 开关**（该属性被本 API 文档引用，但 image 元素主页面**未列出**，应为未文档化/平台私有属性）；
  - 失败码含 `32102: Image prefetch helper 不存在` / `32103: Resource service 不存在`（依赖 Lynx Service）。

### 2.6 `lazy-load` 属性的事实核查

- 仓库 ADR-0060 声明「`lazy-load` 属性是 Lynx 引擎级能力，真机 LynxView 有效」；但**当前官方文档 image 属性表无此属性**，亦无可信源码证据。web 侧确凿：`@lynx-js/web-elements` 的 x-image `observedAttributes` 不处理 `lazy-load`，且 0.11.2（PR #2186）起移除内部 `<img>` 默认 `loading="lazy"`（此前 #1056 加过）。
- 结论：**`lazy-load` 在文档层面不存在**；真机"视口外不请求"由 list 引擎级渲染裁剪保证（ADR-0060 自身亦承认「原生 list 有引擎级 item 回收，真机只加载视口附近 ~10 张」）。探针/方案不应把 `lazy-load` 当作文档契约。

---

## 3. 解码 / 降采样 / 内存控制（问题 3）

- **格式级内存**：`image-config`（`ARGB_8888`/`RGB_565`，见 §1）是唯一的**文档级内存控制属性**——前端可全局/单图切换 16 bit 半内存（代价：无 alpha、圆角受影响、aspectFit 黑边风险）。
- **没有** `max-size` / `scale` / `resize` / `decoding` 等元素级属性；尺寸重绘只有 `auto-size`（按原图调整元素尺寸，不是降采样）。
- **文档表述中的"降采样"属于其他元素与通用性能建议**：
  - `<blur-view>` 元素的 `blur-sampling`（默认 6，Android）：模糊区域降采样比例（"先缩小模糊再放大还原"，提升性能）——不是图片解码采样；
  - 性能指南（#11）：「图片与资源加载：**解码、下采样、纹理上传**卡在关键帧；异步没真正隔离，或未使用占位与预加载」→ 治理建议「**限制尺寸与体积**，使用占位与预加载；解码与纹理上传尽量前移或并行；按需加载与缓存复用」。
- **采样控制的真正入口在宿主侧**：`LynxImageService`（见 §4）是替换式图片库服务（默认 Android Fresco / iOS SDWebImage），采样/尺寸控制能力由所用图片库决定（如 Fresco 可按目标尺寸下采样），是宿主应用可控层。
- 性能指南的帧预算口径（#11）：Trace 中以 `Choreographer#doFrame`（UI 线程）+ `RenderThread#DrawFrames` 累加判定丢帧：**≥32ms 红 / 16–32ms 橘 / <16ms 绿**；滑动场景对节奏最敏感，长帧段要与图片对应，区分「主线程拥塞 / 渲染提交延迟 / **资源加载与解码插入关键路径**」。

---

## 4. 缓存与自定义图片服务（问题 4）

- **没有元素级/前端级 cache 属性**（无 `cache`、无 `loading` 策略属性）。
- **官方缓存接口 = Lynx Service 的 `LynxImageService`（宿主注入口）**（#7）：
  - Android：`implementation "org.lynxsdk.lynx:lynx-service-image"` + Fresco 系依赖（fresco / animated-gif / animated-webp / webpsupport / animated-base / okhttp）；`Application#onCreate` 中 `LynxServiceCenter.inst().registerService(LynxImageService.getInstance())`，Fresco 通过 `ImagePipelineConfig`（`PoolFactory`/`PoolConfig`）定制；
  - iOS：`LynxService` podspec `Image` 子模块 + SDWebImage 5.15.5 + SDWebImageWebPCoder；
  - 文档明确：**「如果宿主 APP 需要使用其他图片库，可以自定义 image-service 并移除默认依赖」**——自定义图片加载/缓存实现是官方支持的扩展点（实现 `LynxImageService` 接口注册即可）。
- **URL 层扩展点**：`MediaResourceFetcher`（Android/iOS 2.8、HarmonyOS 3.4，**Web 不支持**）：`isLocalResource`（是否本地处理）+ `shouldRedirectUrl`（路径改写），用途：静态资源加速、自定义协议、保护敏感路径——不提供缓存能力。
- **预加载缓存**：`requestResourcePrefetch` 的 `cacheTarget: disk | bitmap`（§2.5），资源留在内存或磁盘并由 `src` 承接；**Android 上 bitmap（内存解码）缓存暂不生效**（文档原注）。

---

## 5. 动图 / 多图 / 视频（问题 5）

- 动图（GIF/WebP）是 `<image>` 的正式能力：`src` 支持 gif（*.gif 在属性章节格式清单中）；`loop-count`（0=无限）、`autoplay`；`pauseAnimation`/`resumeAnimation`/`stopAnimation` 方法（2.11，`startAnimate` 已 deprecated）；`bindstartplay`/`bindcurrentloopcomplete`/`bindfinalloopcomplete` 事件（3.7）；动图解码由宿主图片库承担（Fresco `animated-gif`/`animated-webp` 依赖）。
- **多图/视频不在此文档**：`<image>` 无多帧序列（ugoira 类 zip 帧）支持说明；`requestResourcePrefetch` 支持 `video`/`audio`/`font` 类型（video 用 `preloadKey` 传给 `<view-engine>`），说明视频/多媒体走其他组件。
- 没有官方「动态图降档」或「帧率/清晰度调节」表述。

---

## 6. 滚动性能 / 帧预算 / 请求节流的官方表述（问题 6）

- #11（analysis-fluency.md）确凿表述：
  - 丢帧根因「图片与资源加载：解码、下采样、纹理上传卡在关键帧」→ 表征「GPU 或 RenderThread 队列积压，与图片尺寸或数量相关」；
  - 治理「限制尺寸与体积，使用占位与预加载；解码与纹理上传尽量前移或并行；**按需加载与缓存复用**」；
  - 「JS 与 Bridge：切分长任务，减少同步调用；**使用节流与批处理**，避免高频消息压迫 UI 节奏」。
- 官方**没有**「图片请求节流」「按滚动速度降载」「frame budget 属性」之类的元素级/引擎级能力；唯一的优先级通道是 `requestResourcePrefetch` 的 `params.priority`（high 会阻塞其他请求，警示非必需勿用 high）。
- list 侧性能旋钮：`preload-buffer-count`（预渲染屏外节点数）、`recyclable`、`estimated-main-axis-size-px`（估算尺寸减少测量）。

---

## 7. 与 app-lynx 图片链对照（背景归档，不展开）

事实核对（快速 grep 确认）：
- 基线：ADR-0060（2026-08-04）——推荐页 90 条 → 91 张图 2ms 窗口全量请求；方案 = `lazy-load` 透传 + 数据分批渲染（web-core 预览下 x-list 不做虚拟化、x-image 忽略 lazy-load、IntersectionObserver 不可用）。
- 自研链（`packages/app/android/app/src/lynx/java/io/pictelio/app/PictelioImageService.java` 等）：OkHttp + `Executors.newCachedThreadPool()`（无线程上限）+ `ImageMemoryCache`（64MB LRU，`MAX_BYTES = 64L*1024*1024`，字节按 w*h*4 估算）+ `MAX_DECODE_DIMENSION = 2048` + `inSampleSize` 2 的幂采样 + 前端 `setSampleSize(Object, int)` 接口。

对照结论：
1. **自研链恰好落在官方扩展点上**：文档规定的自定义路径就是「宿主实现/替换 `LynxImageService`」——本仓库的做法符合官方支持的模式，而非绕过引擎。
2. **文档能力 vs 自研**：官方默认实现（Fresco/SDWebImage）自带内存/磁盘缓存与按显示尺寸下采样，但文档不承诺参数化接口；自研链的 64MB LRU/2048 采样/线程池策略对文档而言是**超出自研的精细化**（文档层无同等旋钮）。`requestResourcePrefetch`（priority/cacheTarget）+ `image-config: RGB_565` + `preload-buffer-count`/曝光 margin 是文档层有、而当前 app-lynx 未利用的能力。
3. **`lazy-load` 属性**：ADR-0060 依赖它做真机懒加载，但它在当前文档中不存在（§2.6）——应视为「未文档化/未经确认」，真机按需性由 list 回收兜底。
4. **app-lynx 的 web-core 预览缺口在文档层面同样明确**：MediaResourceFetcher 不支持 Web、x-image 不处理 lazy-load、IntersectionObserver 模块未注入——即「引擎级能力不会自动带到 web 预览」，官方文档口径与此一致（scroll-view 元素页直接建议用 list 或曝光模拟）。

---

## 8. 对 #318 速度感知图片降载探针/方案的启示

**文档级可利用（方案/探针可直接使用的 API）：**
- `bindload`/`binderror`：JS 侧唯一"加载完成"时间戳来源（bindload 明确在"发起请求且成功"后触发并带宽高；`load` 粒度 ≈ 请求+图片库 decode 完成，取决于 Fresco/SDWebImage 语义，**无法拆分网络/解码两段**）。
- `requestResourcePrefetch`：可在 JS 侧**精确埋发起时间戳**，并有 `priority`（high 阻塞其他请求——可作"降载"信号放大/收缩）与 `cacheTarget: disk|bitmap`；注意**Android bitmap 内存预解码暂不生效**、iOS 预加载需 `trailNewImage`（未文档化）。
- 曝光事件 `exposure`/`disexposure` + `exposure-screen-margin-*` 与 `preload-buffer-count`：可观测/调节"提前多少距离触发加载"，与滚动速度对齐（margin/预取距离 = 速度函数）。
- `image-config: RGB_565`：文档级"高速滚动降内存"粗粒度旋钮。
- 性能分析官方方法论：Android 端 Trace（`Choreographer#doFrame` + `RenderThread#DrawFrames`，≥32ms 红）——**解码耗时证据链应来自 Trace/宿主打点，而非 JS 时间戳**。

**文档未覆盖、需自研：**
- **解码时间戳不可从 JS 观测**：解码发生在引擎侧（Fresco/SDWebImage/PictelioImageService），JS 只能拿到"完成"事件；"滚动速度 × 请求/解码时间戳对齐"中**解码侧打点必须在自研 LynxImageService 实现内**（fetch 完成时间 vs decode 完成时间，PictelioImageService 是现成埋点位置；这也正是官方允许的自定义点）。探针若要区分"请求发起（JS 可控）→ 请求完成（bindload）→ 解码完成（仅服务层可观测）"三段，建议在服务层记录 RequestFinished/DecodeFinished 两个时间戳再上抛。
- **按滚动速度降载/节流**：文档没有"取消低优先级请求、动态降采集"的元素级接口；`priority` 只在预取 API 里出现，`<image>` 常规请求无优先级通道。速度感知策略（高速滚动→低优先级/复用缓存/跳过解码）需在服务层实现，前端通过曝光 margin / 分批渲染 / preload-buffer-count 配合。
- **帧预算控制**：无元素级 frame-budget 或 throttle 属性；"节流与批处理"仅停留在性能建议层面，需自行实现。

**探针设计的直接提示：**
1. 探针的"图片请求时间戳"应以 `requestResourcePrefetch` 发起点 + 服务层 hook 为准；`bindload` 只做辅助校验。
2. "解码时间"在 Android 上不可用 `cacheTarget:bitmap` 路径隔离（文档明示暂不生效），隔离解码成本只能靠服务层（如牺牲一个采样档位对比 decode 耗时）或 Trace。
3. `lazy-load` 不能作为真机契约写入探针假设（文档不存在）；"视口外不请求"的对照基线应挂在 list 回收 + `preload-buffer-count` + 曝光 margin 上。
4. 中英文档矛盾点（cap-insets 百分比语义）与未文档化属性（trailNewImage）需在探针实现前用真机发版验证，避免测试断言建立在自洽 mock 上。

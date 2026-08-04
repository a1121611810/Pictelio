# ADR 0060: 推荐页图片按需加载——lazy-load 属性 + 数据分批渲染（web-core 图片加载风暴防护）

## 状态

已采纳（web-core 预览 + 真机 LynxView 双端生效）

## 分类

技术决策 / Bug 修复 / 性能 / 跨端契约

## 日期

2026-08-04

## 背景

`packages/app-lynx` 推荐页（`Recommended.vue`）登录后出现**图片加载风暴**：一次 `illust/recommended` 请求返回 90 条（Pixiv 服务端行为，主 app 同样收到 90 条，靠虚拟滚动无感），随后 **91 张缩略图在同一毫秒（2ms 窗口内）全部发起请求**（HAR `clipboard-20260804-093150.577037-000001.har` 实测）。

### 根因链（与 4ce313e 修复的 API 翻页风暴是**两个独立问题**）

| 层 | 行为 | 证据 |
|---|---|---|
| API 层 | 参数与主 app 完全一致（`content_type=illust&filter=for_ios`，无 per_page），服务端返回 90 条 + next_url | HAR 响应体 90 个唯一 id |
| `SkeletonImage.vue` | 注释明确「图片始终渲染（容器有确定高度 → 触发加载）」——**无懒加载**，依赖 list 组件回收 | `d170b64` 引入时设计如此 |
| web-core `x-list` | **不做 item 虚拟化**：`XListWaterfall.js` 遍历 `this.#dom.children` 全量布局，模板无 content-visibility，90 个 list-item 全部挂载 DOM | `@lynx-js/web-elements@0.12.7` 源码 |
| web-core `x-image` | `observedAttributes` 仅 `src`/`placeholder`/`blur-radius`/`crossorigin`/`referrerpolicy`，**不处理 `lazy-load` 属性**；且 0.11.2 起主动移除默认 `loading="lazy"`（#2186） | `XImage/ImageSrc.js`、CHANGELOG |
| web-core `createIntersectionObserver` | 依赖 `IntersectionObserverModule`，但 `createNativeModules.js` 只注册 `bridge` + `LynxExposureModule`，**该模块未注入，调用即抛错** | web-core 源码 |
| vue-lynx 组件运行环境 | 组件逻辑跑在 background thread（`ShadowElement` 是纯 JS 抽象树，无 DOM API），**组件内拿不到真实 DOM 做浏览器 IO** | `shadow-element.d.ts` |

**结论**：`lazy-load` 属性是 Lynx 引擎级能力，**真机 LynxView 有效**（且原生 list 有引擎级 item 回收，真机只加载视口附近 ~10 张）；但 web 预览（`__web_preview`，`@lynx-js/web-core`）下 list 全量渲染、lazy-load 无效、IO 不可用 → **91 张图全量加载**。用户抓 HAR 的环境正是 web-core 预览，必须双端覆盖。

## 决策

### 1. 列表图片加 `lazy-load` 属性（真机引擎级懒加载）

`SkeletonImage.vue` 新增可选 `lazyLoad` prop，透传到 `<image :lazy-load>`。**列表卡片与 list 内头像**（Recommended / Following / Bookmarks / UserHome / FollowList）传 `lazy-load`；**首屏即需场景不传**（详情大图、用户信息卡头像、个人中心头像、动图播放器）。

- 真机 LynxView：引擎级懒加载（进入视口附近才请求）✅
- web-core：该属性被忽略（元素层不支持）→ 由决策 2 兜底

### 2. 推荐页数据分批渲染（web-core 兜底，核心防护）

`Recommended.vue` 引入 `PAGE_SIZE = 20` + `pendingIllusts` 队列：

- `fetchFirstPage`：一次拿回全部数据，但只把**前 20 条**塞进 `illusts`（DOM 只挂载 20 个 item），其余入 `pendingIllusts`。
- `loadMore`：滚动到底**先同步消费 pending**（splice 20 条，无网络请求），pending 耗尽才请求 `next_url`；翻页结果同样分 20 条进 list、剩余入 pending。
- 既有防护全部保留：800ms 节流 + 3s 冷却、空页防护、R18/R18G 过滤、`watch(isLoggedIn)`/`onActivated` 幂等补拉。

效果：web-core 预览下首屏图片加载数从 91 → 20，滚动到底才追加下一批；真机无副作用（list 回收 + lazy-load 已按需，分批只影响 DOM 挂载数量）。

## Considered Options

- **仅加 `lazy-load` 属性（方案 A，否决其单用）**：真机有效，但 web-core 预览（用户验收环境）下该属性被 XImage 忽略，91 张图仍全量加载——不解决用户看到的问题。
- **组件级 IntersectionObserver（否决）**：vue-lynx 组件在 background thread 无 DOM API；`lynx.createIntersectionObserver` 依赖未注入的 `IntersectionObserverModule`（web-core 调用即抛错）。双端均不可行。
- **API 层 `per_page=30` 限制（否决）**：治标不治本——主 app 同样拿 90 条但靠虚拟滚动无感；且 Pixiv recommended 的 next_url 是「续拉」不是「翻页」，限制 per_page 会绕开 next_url 机制引入分页 bug。
- **数据分批渲染（采纳）**：web-core 下唯一可行路径（不依赖引擎能力，只控制 DOM 挂载数量），真机无副作用。

## Consequences

- web-core 预览推荐页首屏图片请求：91 → 20（`PAGE_SIZE`），滚动追加。
- 真机行为不变（list 回收 + lazy-load 已按需），分批仅控制 DOM 挂载量。
- `PAGE_SIZE` 是单一常数，调整即改首屏/每批挂载量；过小增加滚动请求次数，过大回到全量加载。
- **web-core 预览 ≠ 真机行为的又一实例**：dev 预览正常不代表真机正常（本 ADR 是反向——web 预览比真机差），验证图片加载量必须在 web-core 抓 HAR 与真机各做一次。
- 其他列表页（Following / Bookmarks / UserHome）目前只有 lazy-load 防护；其数据量通常 ≤30 条/批，若 Pixiv 也返回大页可复用本 ADR 的分批模式。

## 相关

- ADR-0045（scrolltolower 无限加载——4ce313e 修复的 API 翻页风暴，与本 ADR 的图片风暴是**两个独立问题**，勿混淆）
- ADR-0051（R18/R18G 过滤，分批数据同样过滤）
- 术语：`glossary-feed-image-loading.md`（图片按需加载术语表）、`glossary-web-core-pitfalls.md`（web-core 全量渲染对照）
- 实施提交：`fix(app-lynx): 推荐页图片按需加载（lazy-load + 数据分批渲染）`

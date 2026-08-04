# Feed 图片按需加载术语表

> 范围：`packages/app-lynx` 推荐页及列表页的图片加载策略——区分「按需加载」与「全量加载」两种形态，以及它们与运行环境（真机 LynxView / web-core 预览）的关系。配套 ADR：[ADR-0060-lynx-feed-image-lazy-loading.md](./ADR-0060-lynx-feed-image-lazy-loading.md)、[ADR-0045-lynx-scrolltolower-infinite-loading.md](./ADR-0045-lynx-scrolltolower-infinite-loading.md)。

## 核心术语

| 术语 | 定义 |
|------|------|
| **按需加载（on-demand loading）** | 只有进入视口（或视口附近）的图片才发起网络请求的加载策略。理想形态下，90 条数据首屏只请求可见的 ~10 张图。主 app（pictelio-app）通过 VirtualFeed 虚拟滚动 + LazyImageCard 实现；app-lynx 通过本 ADR 的 lazy-load 属性 + 数据分批渲染逼近。 |
| **图片加载风暴（image loading storm）** | 一次拿到 N 条数据后，N 张图在同一时刻全部发起请求的现象（HAR 实测 91 张图落在 2ms 窗口内）。根因是渲染层把全部 item 挂载进 DOM 且图片无懒加载——**与 API 翻页风暴（scrolltolower 无限请求 next_url，ADR-0045）是两个独立问题**，勿混淆。 |
| **数据分批渲染（batched rendering）** | app-lynx 的 web-core 防护策略：API 一次拿回全部数据，但只把前 `PAGE_SIZE`（20）条塞进 list（DOM 只挂载 20 个 item），其余入 pending 队列；滚动到底先同步消费 pending，耗尽才请求 next_url。效果：web-core 下首屏图片请求数 91 → 20。 |
| **pending 队列（pendingIllusts）** | `Recommended.vue` 中已从 API 拿到但尚未进入 list 的插画数组。`loadMore` 优先 `splice(0, PAGE_SIZE)` 消费它（同步、无网络请求），队列空才翻页。 |
| **PAGE_SIZE** | 首屏渲染 + 每批追加的条数常数（当前 20）。同时控制 DOM 挂载数量与滚动追加粒度；过小增加滚动请求次数，过大回到全量加载。 |
| **lazy-load 属性** | Lynx `<image>` 的引擎级懒加载属性（官方 list 内图片最佳实践）。**真机 LynxView 有效**；**web-core 预览被 XImage 忽略**（`observedAttributes` 无此属性，0.11.2 起还移除了默认 `loading="lazy"`）——web-core 下必须靠数据分批渲染兜底。 |
| **引擎级 item 回收（list item recycling）** | 真机原生 LynxView 的 list 组件只创建视口附近的 list-item、滚出即销毁。这是真机天然「按需」的根源，也是 `lazy-load` 属性之外的第二道防线。**web-core 的 x-list 没有此机制**（`XListWaterfall.js` 全量遍历 children 布局）。 |
| **web-core 全量渲染** | `@lynx-js/web-core` 预览下 list 不做 item 虚拟化，90 个 list-item 全部挂载 DOM。配合无懒加载的 image → 图片加载风暴。web-core 预览比真机更差（真机有 item 回收），是「web 预览 ≠ 真机」的又一实例（方向与 ADR-0056 相反）。 |

## 决策速查

| 场景 | 防护 | 真机 | web-core 预览 |
|------|------|------|---------------|
| 列表卡片/头像（Recommended / Following / Bookmarks / UserHome / FollowList） | `lazy-load` 属性 | ✅ 引擎级 | ❌ 被忽略 |
| 推荐页大量数据（90 条） | 数据分批渲染（PAGE_SIZE=20 + pending 队列） | ✅ 无副作用 | ✅ 首屏 91→20 张 |
| 首屏即需（详情大图、用户信息卡、个人中心头像、动图播放器） | 不传 lazy-load | — | — |
| API 翻页风暴（scrolltolower 无限请求） | 800ms 节流 + 3s 冷却 + 空页防护（ADR-0045） | ✅ | ✅ |

## 相关术语表

- `glossary-web-core-pitfalls.md`——web-core 渲染行为差异总表（本术语表的「web-core 全量渲染」是其中一条缺陷的应用实例）
- `glossary-app-lynx-native.md`——原生 LynxView 契约（number 属性绑定、item-key 等）
- `glossary-detail-image-loading.md`——详情页多图加载（同属图片加载领域，关注的是预加载窗口而非 feed 按需）

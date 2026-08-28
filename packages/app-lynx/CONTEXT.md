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

### 作品标识（Work indicators）

**动图（Ugoira）/ 多图（Multi-page）**：
跨上下文共享概念，判定条件与 app 侧一致（`type === 'ugoira'` / `page_count > 1`，独立判定、允许并存、动图在前）。详见 `packages/app/CONTEXT.md`。

**类型徽章行（Type badge row）**：
列表卡片上标识动图/多图的流内徽章行，位于图片下方、标题上方，仅在有标识时渲染。M3 assist-chip 形态：unicode 图标 + 文字（`▶ 动图` / `⧉ N 图`）、`bg-secondary-container`、`text-label-medium`、`md-shape-small` 圆角。图标沿用 NavigationBar 的 unicode 符号约定（Lynx 无图标库）。统一由公共组件 `IllustTypeBadgeRow` 渲染，各瀑布流页面接入。
_Avoid_: 图上 absolute 角标（list-item 内 absolute 真机高度测量异常，见「遮罩」词条）、各页面散写徽章

### 分页（Pagination）

**混合分页 feed（mixed pagination feed）**：
`createMixFeed` 深模块——把多路远程分页源（插画/小说）按比例交替合并成单一渲染流，向调用方隐藏双防抖（throttle 800ms + cooldown 3s）、竞态代（generation）、去重、分批渲染（pageSize=20）、翻页优先级、15s 超时、空页防护。**除推荐页外的列表页**（插画/小说/关注/收藏/用户主页）统一经它分页，页面只做 ref 快照桥接（sync）。推荐页已迁移到「按钮分页」（见下）。
_Avoid_: 手写 loadMore、页面内双防抖/竞态/空页防护

**按钮分页（button pagination / 翻书分页）**：
推荐页的分页形态（ADR-0114）——列表**永远只显示当前页**，由 FAB menu 的「上一页 / 下一页」切页；切页 = 整树重建（epoch）+ 从页顶看，回顶成为翻页的自然语义。绕开 vue-lynx `<list>` 增量渲染失效的框架 bug（双端实证：items 数据增长但新条目不进布局）。与无限滚动相对。
_Avoid_: 无限滚动、滚动自动翻页、增量拼接

**页缓存（page cache）**：
按钮分页下「上一页」的数据来源——Pixiv API 无 `prev_url`，已拉取的页面数据（含各源游标与合并结果）缓存于内存（上限 `maxCachedPages`，默认 5 页），「上一页」即时返回缓存页而不重新请求。
_Avoid_: 重新请求上一页、游标回退重拉

**时间交叉合并（time-merge）**：
多路分页源（推荐页 = 插画 + 小说）按作品 `create_date` 降序交叉合并成一页的混合方式（app 端 `recommendedStore` 的 sortByDate + mergeAndSort 语义），替代固定比例交替（ratio 4:1）。页内全量展示各路之和（不截断——按时间排序后截断会丢数据）。
_Avoid_: 固定比例交替、截断取前 N

**分页到底态（end-of-feed）**：
所有分页源耗尽（`nextUrl` 为 null）且列表非空时的状态。列表底部 footer 显示「没有更多了」，`scrolltolower` 不再触发请求。
_Avoid_: 到底后报错、静默空白

**内联分页错误（inline pagination error）**：
分页（fetchMore）失败时在**列表底部**显示的错误提示，保留已加载内容，`nextUrl` 保留供滚动自动重试。与首屏错误（顶部整页提示）相对——两者槽位分离（createMixFeed 的 `error()` / `pageError()`）。
_Avoid_: 分页错误显示在列表顶部、清空已加载内容

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

### 客户端（Client）

**双域名 URL（double-host URL）**：
原生模式下绝对 `next_url` 未归一化产生的错误 URL：`apiBase + 绝对URL`，Pixiv 返回 404。`rewriteUrl` 原生分支负责把绝对 Pixiv URL 剥离域名成相对路径（含 query）。跨上下文共享概念，详见根 `docs/adr/glossary-search-pagination.md`。
_Avoid_: 把绝对 next_url 原样传给原生模块

**受限条目 level 派生（restrict level derivation）**：
`x_restrict === 2 ? 2 : 1` 的徽章级别映射，收敛在 `RestrictedNovelCard` 组件内部（接口只收 `item`），调用方不重复该表达式。

### 构建约定（Build conventions）

**script-setup 禁 export（SFC no-export）**：
app-lynx 的 `<script setup>` 块**禁止使用 ES module `export`**（含命名导出与 `export default`）——vue-lynx 的 `<script setup>` SFC 编译器不识别该构造，会使 `rspack-vue-loader` 的 `resolveScript` 返回 null，导致 `rspeedy build` / `pnpm build` 失败。注意：`tsc`（`pnpm check`）与 `vitest` 都只按纯 TS 处理 `<script setup>` 内容，**不会**拦截此错误，因此"测试全绿"不代表能构建。组件需把子模块能力对外提供时，直接引用底层纯函数模块（如 `primitives/swiperMath.ts`），不要经组件 re-export。详见 ADR-0116。
_Avoid_: 在 `<script setup>` 里写 `export { ... }` / `export default`；依赖 tsc/vitest 校验构建合法

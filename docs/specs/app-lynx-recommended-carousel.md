# Spec: app-lynx 推荐页改单卡轮播（自研 swipe）+ 移除 T0-DIAG

- 状态：draft（Grill 已收敛，待用户确认后进实现）
- 日期：2026-08-30
- 关联：`docs/adr/ADR-0115-app-lynx-recommended-carousel.md`、`docs/specs/app-lynx-feed-pagination-buttons.md`（被取代的按钮分页）、ADR-0104（createMixFeed 收敛）、ADR-0108（FAB 旋转）、ADR-0111（FAB menu）、ADR-0112（bookmark 动画）、`packages/app-lynx/CONTEXT.md`

## 1. 背景与根因

推荐页当前是 **2 列瀑布流 `<list>` + 按钮分页**（ADR-0114，`createPagedFeed`），由插画 / 小说两路按 `create_date` 时间交叉合并。用户希望**换一种形式**：不再做列表，改为**单卡轮播**（卡片浏览器）。

同时，推荐页及其它页面顶部有一条 **T0-DIAG 临时诊断横幅**（`App.vue` 渲染 `t0Lines`，text `#7CFC00` 黄绿字），由 `src/debug/t0Diag.ts` 的 `t0log` 驱动。该通道头部注释明确「修复验证完成后整体删除本文件与所有引用」——临时诊断工具，用户要求**不要显示**，且与本次改版重叠，一并移除。

**形态决策（Grill 确认）**：推荐页从「2 列瀑布流列表」改为「单卡轮播（卡片浏览器）」——一滑页 = 一个作品（插画或小说），沉浸式全 bleed 大图卡，左右滑动切换；无限滑流（滑近末尾自动加载下一批）；不自动播放；受限条目跳过；保留单个刷新 FAB。

## 2. 产品行为（推荐页）

### 2.1 轮播形态（单卡 / 沉浸 / 混合 / 不自动播）

- **一滑页 = 一个作品**（`MixFeedItem`，插画或小说），整页是一个可左右滑动的「卡片浏览器」。**不做整页多卡**（一滑页 = 一页多卡）也不做瀑布流。
- **沉浸式全 bleed 大图卡**：封面图铺满滑页（边缘到边缘，无留白），信息叠加在**底部半透明渐变 scrim** 上：标题 / 作者 / 类型徽章（动图/多图，ADR-0113）/ 收藏按钮（ADR-0112）/ 字数（小说）。小说卡用封面图 full-bleed + 标题/作者/字数，与插画卡同构。
- **作品类型 = 插画 + 小说混合**，统一封面卡模板（沿现状 `loadRecommended` / `loadRecommendedNovels` 两源）。
- **不自动播放**，纯手动左右滑。

### 2.2 滑动与加载（无限滑流）

- 用户左右滑切换上一张 / 下一张；松手**自动吸附到最近一张**（带缓动动画）。
- **无限滑流**：当 `currentIndex` 接近已加载条数末尾（如 `items.length - threshold`）时触发 `feed.fetchMore()` 追加下一批，可一路滑下去。**无「上一页 / 下一页」按钮**（取代按钮分页）。
- **上一张**：回到已加载的上一张（无需请求；加载过的条目保留在内存流中，天然支持回滑）。
- 无自动播放，无循环。

### 2.3 受限内容（跳过）

- 受限条目（`isRestricted(item.data)`，即 `x_restrict` 1/2 且对应开关未开）**不在可视滑页流中占位**——渲染层把受限条目从可视流中**过滤掉**（数据层仍照常加载）。
- 设置开关切换时：因受限数据仍在 feed 流中，**重算过滤**即可显示 / 隐藏，**无需重请求**（与列表「开关打开即显示」一致）。

### 2.4 刷新（单刷新 FAB）

- 保留**一个**刷新 FAB（M3：`primary-container` 底 + `on-primary-container` 图标、56dp、icon unicode `⟳`（U+27F3，经验证：Material Symbols 原生字体渲染为多个未验证面叠加，回退 unicode）、保留旋转动画 ADR-0108）。
- 点击刷新 → 清流重载、回第一张。
- **移除**：FAB menu（上一页/下一页/回顶）、原 `RefreshableList` 的菜单机制（推荐页）；其他列表页的 `RefreshableList` + FAB menu **不变**。

### 2.5 页面状态

- 正文区顶部 TopAppBar「推荐」保留（title-large、surface）。
- 首载（无数据）加载中：骨架占位（沉浸卡规格骨架）。
- 滑近末尾触发 `fetchMore` 加载中：静默追加，不打断当前滑页；加载失败：当前滑页保留 + 错误提示 + 可重试（非静默降级，`console.warn` + 显式错误态）。
- 内容耗尽（两路 `nextUrl` 均空）：滑到末尾后无更多内容（可显示轻量「已到底」提示）。

## 3. 技术设计

### 3.1 自研 swipe 轮播（显示层核心技术）

**不采用原生 `<swiper>` 元素**，按 vue.lynxjs.org `/zh/guide/tutorial-swiper.md` 手写（该教程即为自研 wheel 的方法论，且其技术栈与性能目标契合）：

- **布局**：滑页容器 `<view class="swiper-container">` 用 Lynx `display: linear` + `linear-orientation: horizontal` 水平排布子滑页（原生性能优于 flex）；外层 `swiper-wrapper` 定宽 `flex:1 width:100%`。
- **触摸驱动**：`touchstart` / `touchmove` / `touchend`。为**消除跨线程延迟**（Lynx 双线程：默认触摸事件经「native→后台线程→跨线程→主线程」往返，高频滑动卡顿），事件处理器标记 `'main thread'` 指令 + `useMainThreadRef`，并在主线程通过 `containerRef.setStyleProperties({ transform: translateX(offset) })` 直改。
- **吸附翻页**：松手用主线程 `requestAnimationFrame`（`useAnimate` + `easeInOutQuad`）插值 `offset` 到 `calcNearestPage` 最近页，平滑吸附。
- **索引同步 / 指示器**：主线程 `updateOffset` 计算当前页索引，经 `runOnBackground(onIndexUpdate)(index)` 桥接到后台线程响应式 `currentIndex`，驱动指示器（圆点/进度胶囊）；点指示器跳页经 `runOnMainThread(updateOffset)(offset)`。
- **能力组织**：抽为组合式函数（`useSwiperOffset` / `useSwiperStyle` / `useAnimate`）或一个 carousel 深模块（页面薄、逻辑可测、主线程函数可独立编译）。
- **tap vs drag 区分**：沉浸卡需点进详情 / 收藏，但拖动不应误触发 tap——需判定（如位移阈值 / 时间阈值 / Lynx 原生 tap 语义），确保「滑动≠点击」。

### 3.2 数据层：createMixFeed 扩展 `merge: 'time-merge'`

- 推荐页数据源从 `createPagedFeed`（按钮分页）**改回 `createMixFeed`**（增长流 + `fetchMore` + 双防抖 + 竞态代 + 去重 + 分批渲染 + 15s 超时 + 空页防护，ADR-0104 已确立的深模块）。
- **新增合并模式选项** `merge?: 'ratio' | 'time-merge'`：默认 `ratio`（其余 7 个列表页不变）；推荐页传 `'time-merge'`（保留推荐页「时间交叉合并」语义——`mergeByTime` 按 `create_date` 降序交叉合并，from app 端 `recommendedStore` 的 sortByDate + mergeAndSort，替代现状 ratio 4:1）。
- 时间合并下：两路各自拉页 → 按 `create_date` 降序稳定合并 + 按 `key` 去重（页内去重；跨页全局 seen 保持 createMixFeed 现状）。`create_date` 缺失沉底 + `console.warn`（非静默降级）。
- 无限滑流的触发点：页面观察 `currentIndex`（经指示器同步回调），接近 `items().length - threshold` 时调用 `feed.fetchMore()`（复用 createMixFeed 双防抖，天然防高频）。
- **createPagedFeed 删除**：推荐页不再使用，其无其他消费者 → 删除 `src/primitives/createPagedFeed.ts` + 单测；`mergeByTime` 纯函数保留（被 createMixFeed 复用）。

### 3.3 受限过滤

- 渲染层逻辑：可视滑页流 = `feed.items().filter((it) => !isRestricted(it.data))`。
- 数据层不感知受限（照常加载全部）；过滤只在渲染边界做，开关切换即重算，免重请求。
- 注意：`isRestricted` 依赖 `settingsStore` 响应式开关，过滤需随开关变化触发重渲染（`watch` / `computed`）。

### 3.4 移除 T0-DIAG 整条通道

- 删除 `packages/app-lynx/src/debug/t0Diag.ts`。
- 移除所有 `t0log` 调用：`src/pages/Recommended.vue`、`src/pages/NovelDetail.vue`、`src/primitives/createWatchlistPrompt.ts`、`src/primitives/createMixFeed.ts`、`src/router.ts`。
- 移除「我的」页（`src/pages/Me.vue`）的「导出诊断日志」入口（`t0Export` / `t0HasLogs`）。
- 移除 `App.vue` 的 `t0Lines` 横幅 `<view>` + 相关 import。
- 后果：真机日志取证通道空窗（后续如需诊断另建方案，不阻塞本次）。

### 3.5 渲染约束（硬约束）

- 先渲染后加载：进入推荐页先渲染骨架，再发请求；无路由级阻塞。
- 竞态防护：`fetchMore` / 刷新用 createMixFeed 的 generation 代 + AbortController；页面过滤/指示器回调防旧响应覆盖。
- 数据层分流：共享推荐数据经 createMixFeed（局部单例，页面管理生命周期）；过滤只为渲染用，不写回 feed。

## 4. 测试

### 单测（node，新建/修改）

| 用例 | 断言（oracle） |
|------|----------------|
| createMixFeed `merge:'time-merge'`：两路首载 → 时间交叉合并排序 + 去重 | 排序按 `create_date` 降序（构造交叉时间数据）；oracle = app 端 mergeAndSort 语义 |
| createMixFeed time-merge 下 `fetchMore` 追加 + 索引游标传递 | 游标正确传递（fetchPage 收到该路 next_url）；双防抖/到期补发行为与 ratio 模式一致 |
| createMixFeed time-merge 下 `create_date` 缺失 | 沉底 + `console.warn`（非静默降级） |
| 受限过滤纯函数：`items().filter(!isRestricted)` | 过滤正确；开关翻转后重算结果变化（contrived 数据驱动） |
| swipe 吸附计算 `calcNearestPage` / 边界 clamp | 纯函数，round 最近页 + `[upperBound, 0]` 钳制 |
| tap-vs-drag 判定 | 位移阈值内 = tap（进详情），超阈值 = drag（不进详情） |
| createPagedFeed 删除 | 无残留导入（`pnpm check:app-lynx` 覆盖） |
| t0log / t0Diag 引用清零 | 全仓 grep 无 `t0log`/`t0Lines`/`t0Diag` 引用 |

### 验证闭环

- 单测全绿 + `pnpm check:app-lynx` + `pnpm lint:app-lynx`。
- **web-core 预览实测**：左右滑 / 吸附 / 指示器同步 / 滑近末尾自动加载 / 点卡进详情 / 点收藏 / 受限条目不出现 / 开关切换受限即时显示 / 刷新回第一张 / FAB 只有一个刷新。
- **模拟器 + 真机实测**：Swiper 核心技术为 Lynx 主线程脚本——**原生需验证** `display: linear` + `useMainThreadRef` + 主线程 `requestAnimationFrame` + `runOnBackground`/`runOnMainThread` 在 LynxView 是否可用；tap-vs-drag 真机手感；滑动流畅度（无卡顿）。
- 真机手动 checklist 交付用户逐项打勾（沿用既有验证闭环要求，用户确认真机通过前不得宣称完成）。

## 5. 验收条件

- 推荐页不再是瀑布流列表：整页为可左右滑动的单卡轮播；每滑页一张作品卡（插画/小说统一沉浸模板）。
- 左右滑动流畅（主线程驱动，无明显延迟）；松手自动吸附最近一张（缓动）。
- 滑近末尾自动加载下一批，可连续向下滑（无「上一页/下一页」按钮）。
- 受限条目（R18/R18G）不占据滑页；设置开关打开后即时显示，无需重新请求。
- 不自动播放（停留不自动换图）。
- 刷新 = 单个 FAB（icon `⟳`），点击清流重载回第一张；无 FAB 菜单/回顶/分页项。
- 点卡进正确详情（`/illust/$id` / `/novel/$id`）；动图/多图徽章、收藏按钮、作者、字数齐全。
- 推荐页顶部 T0-DIAG 绿色横幅消失（所有页面），「我的」页无「导出诊断日志」入口。
- 其余 7 个列表页（插画/小说/关注/收藏×2/用户主页/追更）行为不变（仍 createMixFeed ratio + FAB menu）。

## 6. 排除项（后续迭代）

- 其余列表页改为轮播：本轮只改推荐页。
- 原生 `<swiper>` 元素：不采用（改用自研 swipe）。
- 真机 Material Symbols 图标字体渲染：多个未验证平台面叠加，本轮回退 unicode `⟳`；后续可另立平台探测 ticket。
- 「上一张」的无限回溯缓存上限：本轮滑过的条目保留在 feed 流（createMixFeed 自然累积），不做专门 LRU 裁剪（后续按需）。
- 指示器是否显示 / 形态（圆点 vs 进度胶囊）：实现期按「局部圆点 / 进度胶囊」定，避免无限滑流下全量圆点无限增长。

## 7. Ticket 拆解（to-tickets，2026-08-30）

| # | Ticket | 内容 | 前置 | 波次 |
|---|--------|------|------|------|
| T0 | 移除 T0-DIAG 整条通道 | 删 `t0Diag.ts` + 清 5 文件 `t0log` + 删「我的」导出入口 + 删 `App.vue` 横幅 | 无 | 波 1 |
| T1 | createMixFeed 扩展 `merge:'time-merge'` + 单测 | §3.2 合并模式 + mergeByTime + 去重 + oracle 断言 | 无 | 波 1 |
| T2 | 删除 createPagedFeed | 移除该深模块 + 单测 + 清残留引用 | T1（推荐页已切走） | 波 1 |
| T3 | 自研 swipe 轮播组件/组合式函数 | §3.1 display:linear 布局 + 主线程触摸 + translateX + RAF 吸附 + 指示器 + tap-vs-drag | 无 | 波 1 |
| T4 | Recommended.vue 重写为轮播 + 受限过滤 + 单刷新 FAB | §2 产品行为 + §3.3 受限过滤 + 无限滑流接线 | T1, T3 | 波 2 |
| T5 | 验证闭环 | 单测全绿 + check + web-core 实测 + 模拟器/真机 | T0,T4 | 波 3 |

并发策略：波 1 = T0 / T1 / T3 并行（数据层、显示层、清理互不依赖）；T2 依赖 T1；波 2 = T2 + T4；波 3 = T5。每 ticket 走 TDD + 自测 + code-review。

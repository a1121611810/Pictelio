# ADR-0115: app-lynx 推荐页改单卡轮播（自研 swipe）+ 移除 T0-DIAG

- 状态：accepted
- 日期：2026-08-30
- 关联：ADR-0114（被替换的按钮分页/翻书分页）、ADR-0104（分页收敛 / createMixFeed）、ADR-0107（epoch 重建 workaround）、ADR-0108（FAB 旋转）、ADR-0111（FAB menu）、ADR-0112（bookmark 动画）、`packages/app-lynx/CONTEXT.md`（分页：按钮分页 / button pagination；新增「推荐轮播」词条）
- 来源：grill-with-docs 会话——用户拍板去掉推荐页列表，改单卡轮播；逐项确认（单卡/混合/无限/沉浸/跳过受限/不自动播/单刷新 FAB/图标 `⟳`）；图标字形曾验证原生 icon font 需赌多个未验证平台面，回退 unicode。

## 背景

推荐页此前形态为**双列瀑布流 `<list>` + 按钮分页（翻书）**（ADR-0114）。该形态是上一轮为绕开「`<list>` 增量渲染失效 + 无 JS 滚动接口」两个框架级 bug 而定的 workaround。本轮用户明确要求**彻底改变推荐页的表现形式**：

> 推荐页不再做列表，改为**轮播图**形式展示；唯一硬性要求是符合 Material Design 3。

同时处理一个遗留的临时诊断通道：推荐页顶部呈现的**绿色字诊断日志**（`App.vue` 渲染的 `t0Lines` 横幅，颜色 `#7CFC00`）是 **T0-DIAG 临时诊断通道**的产物，其自身头部注释即标明「修复验证完成后整体删除本文件与所有引用」。用户要求不再显示该日志。

**方案决策（Grill 确认）**：把推荐页从「列表」改为**自研 swipe 单卡轮播**——一张滑页 = 一个作品，横向滑动换下一个；技术实现参照他人贡献的 `vue.lynxjs.org/zh/guide/tutorial-swiper.md` 教程（**手写 swipe 轮播**，非原生 `<swiper>` 元素），用 Lynx 主线程脚本实现零延迟拖拽 + 吸附翻页。同时整条移除 T0-DIAG。

## 平台事实（本轮引用的既有与教程实证）

1. **Lynx 双线程架构**：触摸事件默认在后台线程处理，每次 `touchmove` 都要「主线程 → 后台 → 主线程」跨线程往返，低端设备上可感知卡顿。教程方案用 **`'main thread'` 指令 + `useMainThreadRef`** 让触摸处理器直接跑在主线程，消除往返 → 零延迟拖拽。
2. **Lynx `display: linear`**：`linear-orientation: horizontal` 是 Lynx 专用高性能水平布局，相比 `display: flex` 在原生渲染引擎性能更好。教程用它水平排布滑页。
3. **主线程脚本限制**：主线程函数用 `useMainThreadRef`（`.current` 访问，非 Vue `.value`）；主线程与后台线程函数不能直接互调，需 `runOnBackground`（主→后台）/ `runOnMainThread`（后台→主）桥接；主线程函数可**自动捕获可序列化的后台线程值**；主线程**函数**类型的 prop 需用 `main-thread-` 前缀。
4. **适配翻页/动画**：松手吸附用主线程 `requestAnimationFrame`（`useAnimate` + `easeInOutQuad`），避免跨线程「动画帧更新」延迟。
5. **教程链接真相**：`tutorial-swiper.md` 在 vue.lynxjs.org 是「商品详情页图片轮播」教程，教会**手写一个 swipe 轮播**，而非原生 `<swiper>` 元素的使用说明。因此推荐页轮播 = 自研 swipe 组件，不依赖原生 `<swiper>`。
6. **图标字体渲染（上一轮验证，web-core 实测）**：`@font-face` + Material Symbols **codepoint** 在 web-core 能渲染，但 ligature 文本不生效（须用 codepoint）；**原生 LynxView 字体渲染是独立未验证面**，且单文件 bundle 的字体资源解析 / data-URI / Android cleartext 均为叠加的未验证平台面。为换一个 FAB 刷新图标去赌多个未验证面，性价比过低。

## 决策

1. **整条移除 T0-DIAG**：
   - 删除 `packages/app-lynx/src/debug/t0Diag.ts`；
   - 清除所有 `t0log` 调用（`packages/app-lynx/src/pages/Recommended.vue`、`pages/NovelDetail.vue`、`primitives/createWatchlistPrompt.ts`、`primitives/createMixFeed.ts`、`router.ts`）；
   - 移除「我的」页（`pages/Me.vue`）的「导出诊断日志」入口（`t0Export`/`t0HasLogs`）；
   - 移除 `App.vue` 的 `t0Lines` 横幅及其 import。
   - 理由：临时诊断通道，自标「修复验证完成后整体删除」；且与推荐页改版重叠，趁重写一次清干净。

2. **推荐页形态：列表（瀑布流）→ 单卡轮播（卡片浏览器）**：
   - 一滑页 = 一个作品（插画或小说），横向滑动切换下一个；
   - 视觉 = **沉浸式全 bleed 大图卡**（封面图边缘到边缘铺满），信息叠底部渐变 scrim（标题 / 作者 / 类型徽章 / 收藏按钮 / 小说字数）；
   - 点卡进详情（按 `item.kind` 前缀 `/illust/` | `/novel/`）；
   - 不自动播放（纯手动滑动）。

3. **作品类型：插画 + 小说混合**，统一封面卡模板（小说用封面图 full-bleed + 标题/作者/字数），沿用时间交叉合并的混合口径。

4. **加载：无限滑流**——滑近末尾自动触发 `fetchMore()` 拉下一批，可一路滑下去；无「上一页/下一页」按钮。FAB 退化为**单刷新按钮**（非菜单），图标 unicode **`⟳`（U+27F3）**，保留旋转动画。推荐页移除 prev/next 分页菜单项、回顶、以及原 FAB menu 机制。**其他列表页的 FAB menu / RefreshableList 保持不变。**

5. **受限内容：跳过受限滑页**——渲染层把 `isRestricted(item.data)` 的条目从**可视滑页流**中滤掉；**数据层仍照常加载**（不删）；开关切换时因数据仍在 feed 里，重算过滤即可恢复，**无需重请求**。与「列表页全量渲染受限卡」策略不同（此为推荐页专属决策，用户确认）。

6. **自动播放：不自动播**，纯手动滑动。

7. **实现技术 = 自研 swipe 轮播**（非原生 `<swiper>`，参照 `vue.lynxjs.org/zh/guide/tutorial-swiper.md`）：
   - `display: linear` + `linear-orientation: horizontal` 水平排布滑页（每张 = 一个全宽卡）；
   - 主线程触摸处理：`'main thread'` 指令 + `useMainThreadRef`，`setStyleProperties({ transform: translateX(px) })` 直改容器样式；
   - 主线程 `requestAnimationFrame`（`useAnimate` + `easeInOutQuad`）实现松手**吸附到最近页**的缓动动画（`calcNearestPage` = `round(offset / itemWidth)`）；
   - `runOnBackground`（主→后台）同步当前索引到指示器 / `runOnMainThread`（后台→主）点指示器跳页；
   - 能力抽象为组合式函数（`useSwiperOffset` / `useSwiperStyle` / `useAnimate`）或一个 carousel 深模块，组件保持薄。

8. **数据层：扩展 `createMixFeed` 支持 `merge: 'time-merge'` 选项**：
   - 新增合并模式选项；推荐页传 `merge: 'time-merge'`，其他页保持默认 `ratio`（4:1）不受影响；
   - 推荐页从 `createPagedFeed` 改回 `createMixFeed`（增长流 + `fetchMore`），**保留推荐页「时间交叉合并」语义**（CONTEXT 记录为取代 ratio 的既定决策：按 `create_date` 降序交叉合并）；
   - **删除 `createPagedFeed`（无消费者）** 连同其单测；`mergeByTime` 纯函数**保留**、被 `createMixFeed` 复用（time-merge 模式）。

9. **渲染约束（即时导航硬约束）**：先渲染后加载、竞态代防护、AbortController、数据层分流；受限过滤只作用于渲染层。

## 被考虑的方案

- **原生 `<swiper>` 元素**：教程未用（教程本身教手写 swipe），且原生 swiper 在 vue-lynx 的支持度/自定义程度不确定。改用自研 swipe（主线程更可控、性能更好）。否决。
- **保留按钮分页（翻书）**：与单卡轮播的「流畅连续滑」体验直接冲突（每 N 张一批需手动切批），违背「不再做列表」的意图。否决。
- **纯插画**：丢失小说内容广度，且与主 App 的混合推荐行为不一致。否决（保持混合）。
- **保留 FAB menu（刷新/回顶/上一页/下一页）**：单卡轮播下「回顶」几乎无价值（手动滑回即可、刷新即回开头）；FAB 从菜单退化为单按钮更贴合沉浸看图。否决（推荐页），其他列表页保持。
- **`createPagedFeed` 继续**：其语义是「页式缓存/翻书」，与无限滑流（增长流 + fetchMore）不符。改用 `createMixFeed`（time-merge）。否决。
- **原生 icon font 渲染色**：需赌「单文件 bundle 字体资源解析 + data-URI @font-face + Android cleartext + 原生字体引擎」多个未验证平台面（验证成本 = 整轮重编 APK），为换一个刷新图标性价比过低。回退 unicode `⟳`（低风险、原生已全站用 unicode 符号族、视觉已很贴近 Material refresh）。否决。
- **M3 `content carousel`（带 peek 的多卡条）**：一屏可见多张卡 = 仍是「卡片网格改横向滚动」，偏离「不再做列表」；用户明确选**单卡沉浸**。否决（本轮）。

## 后果

**正面**：
- 推荐页变成沉浸式看图、无限连续浏览（背景线程滚动，非零延迟但可用）；
- 受限内容策略透明（跳过而非隐藏文案），开关打开即刻恢复、无需重请求；
- `createMixFeed` 统一承载所有列表页（含推荐页），数据层收敛、时间合并语义保留；
- 移除 T0-DIAG 清掉临时诊断通道，符合其「验证后整体删除」的自标注。

**负面**：
- 失去瀑布流信息密度（一次只见一张）——产品决策，Grill 已确认接受；
- 需处理 **tap-vs-drag 判定**（沉浸卡可点详情/收藏，需区分点击与拖动，避免拖动误触发跳转）；
- 受限「跳过」导致该批推荐数量少于预期（滑到末尾更快触发加载）；
- 主线程零延迟方案在原生不可用，退而求其次用后台线程（见下方修订）。

### ⚠️ T5 真机验证修订（2026-08-30，判定不通过）：主线程方案不可用，改后台线程

本 ADR 原决策的 **「主线程脚本 + `:main-thread-bindtouch*`」在 Android 原生 LynxView 上经真机（emulator-5556）验证确认不可用**——加回 4 个 `main-thread-*` 绑定，即使已内联标 `'main thread'` 的 helper、统一 px、单数 `setStyleProperty`、内容容器 `flex flex-col`，推荐页仍**整块空白**；移除绑定即恢复正常渲染。详见 `docs/research/vue-lynx-swiper-tutorial.md` §「真机验证结论」。

**修订后的实现**：轮播改用**后台线程**方案——
- 触摸 `@touchstart`/`@touchmove`/`@touchend`（后台线程）；`translateX` 经 Vue 响应式 `:style` 绑定；
- `itemWidth` 用 px（`SystemInfo.pixelWidth/pixelRatio`），slide 宽 `itemWidth+'px'`；
- `calcNearestPage`/`clampOffset` 从 `swiperMath.ts` 直接 import（后台线程无 MT 打包限制）；
- 内容容器须 `flex flex-col`（否则 `.swiper-wrapper{flex:1}` 不拉伸、高度塌缩为 0 → 空白）。

代价：拖拽非零延迟（主线程方案的本意）。已在模拟器验证渲染 + 滑动 + 点卡进详情 + 单刷新 FAB（详见研究文档）。若后续 Lynx 主线程支持度提升，可再评估切回主线程（零延迟）。

**待验证项（实现期闭环，web-core + 模拟器 + 真机）**：
- 单测：`createMixFeed` time-merge 合并排序（oracle = app 端 `mergeAndSort` 语义）、`merge: 'time-merge'` 分支、受限过滤恢复（开关切换即恢复）、去重/竞态/超时在 time-merge 分支；
- `pnpm check:app-lynx` 类型检查通过；
- **web-core 预览实测**：滑动位移/吸附翻页/指示器同步/点指示器跳页/滑动到末尾自动 fetchMore（无限滑流）、tap-vs-drag 不误触详情；
- **模拟器 + 真机**：自研 swipe（`display: linear` + `useMainThreadRef` + 主线程 RAF）在原生 LynxView 是否可用（主线程脚本为 Lynx 特性，需验证原生支持）；`⟳` 图标旋转动画正常；
- 移除 T0-DIAG 后，真机日志取证通道空窗——后续如需排障，用既有 lynx-native 日志（`LynxLogService`）能力，不再用 UI 横幅。

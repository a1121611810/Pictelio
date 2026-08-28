# ADR-0119: app-lynx 推荐轮播 scrim 改页面级遮罩（真机非首 slide 文案不渲染修复）

- 状态：accepted
- 日期：2026-08-28
- 关联：ADR-0115（推荐轮播）、ADR-0118（打磨 R2）、`packages/app-lynx/CONTEXT.md`（「轮播 scrim 页面级遮罩」「遮罩」词条）、`packages/app-lynx/src/pages/Recommended.vue`（scrim）
- 来源：真机 bug——推荐轮播滑到**非首页**时，底部 scrim（标题/标签/作者/收藏）在**真机原生 LynxView** 上**不渲染**（web-core 正常）。

## 背景

ADR-0115 单卡轮播 + ADR-0118 打磨 R2 后，用户反馈：**轮播滑动到非第一页，下面的文案内容看不见**。

调查（模拟器 + 真机 + 可靠验证）：
1. **web-core 正常**：scrim 文案随滑页移动、逐页不同——排除代码数据/逻辑 bug。
2. **真机必现、模拟器不触发**：首个初判（用 OCR 读截图）误以为"修复有效"，但**OCR 会读到图片上自带文字**，结论不可靠；改用**绿像素检测**（把标题临时渲染为亮绿，图片里没有这种 UI 绿）后确证：**第 1 页标题渲染（绿像素>0），第 2+ 页全屏绿像素=0（标题完全不渲染）**。
3. **判伪枚举**（均无效）：slide 内 scrim 改流内布局（非 absolute）、scrim 用 key 重挂载（settle 后强制重排版）、轮播容器改 `display:linear`（反而连首屏 `<text>` 也不渲染）。**唯一有效**：把 scrim 抽到**页面级固定遮罩**（文字不再落入被 `translateX` 平移的 flex-row）。
4. **根因**：真机 LynxView 对被 `translateX` 平移的 flex-row **非首个子元素**内的 `<text>` **永不渲染**（仅图片/`<view>` 正常；重挂载/换布局/换 key 均不触发其排版；web-core 正常，属平台差异）。

## 决策

**推荐轮播的 scrim 改为页面级固定遮罩**（不再每 slide 内渲染一份）：

- 滑页内只留图片（`RecommendedCover`），去掉 slide 内的 scrim。
- 在 CarouselSwiper 之后、内容容器内加 `absolute bottom-0 left-0 right-0` 的**页面级 scrim 遮罩**，按当前页 index（`currentIndex` → `currentItem = visibleItems[currentIndex]`）显示当前条目的类型徽章/标签/标题/作者/收藏（或小说字数）。
- 遮罩 `@tap` 点卡进详情；收藏按钮 `@tap.stop` 不冒泡。

**为什么不保留 slide 内 scrim**：真机对 `translateX` 平移的 flex-row 非首子元素内 `<text>` 不渲染，且任何节点生命周期/布局调整（重挂载、`linear`、流内）都无法使其渲染；只有把 `<text>` 移出该上下文（页面级遮罩）才可渲染。scrim 本就在屏幕底部（ADR-0118「scrim 信息区保持在屏幕底部」），抽为页面级遮罩与该设计一致。

**权衡（已知）**：
- 遮罩为固定覆盖层，**覆盖底部 scrim 区域、该区域不响应滑动**——真机 `pointer-events` 对触摸事件不生效，无法穿透到 swiper；滑动需从上部图片区发起。
- 点卡进详情由遮罩 `@tap` 承担（不再依赖图片区 tap）。

## 被考虑的方案

- **slide 内 scrim 改流内布局**（绝对→流内）：只改 scrim 定位，未触及 `<text>` 在非首 flex-row 子元素内不渲染的根因，真机无效。否决。
- **slide 内 scrim 用 key 重挂载**（settle 后强制重排版）：真机上重挂载后 `<text>` 仍不渲染（绿像素=0）。否决。
- **轮播容器 `display:linear`**（Lynx 原生水平布局）：反而连首屏 `<text>` 也不渲染（绿像素=0）。否决。
- **遮罩 `pointer-events:none` 穿透滑动**：真机不生效。否决。

## 后果

**正面**：非首 slide 的 scrim 文案在真机正常渲染（OCR 底部 scrim 区逐页确读：各页标题/标签/作者/收藏均渲染且随页更新）。
**负面**：底部 scrim 区不响应滑动（须从图片区滑动）——已知权衡；`<text>` 从 slide 内移到页面级遮罩，几何/层叠语义变化需核对「超高图 cover 回退时 scrim 叠图底、短图时下方露出背景」的视觉一致。渲染行为归 web-core + 真机验证闭环；node 单测无可测缝（原生渲染行为），以真机手动清单覆盖。

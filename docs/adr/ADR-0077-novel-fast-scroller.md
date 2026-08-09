# ADR-0077: 小说详情 FastScroller（可拖拽滚动条 + 章节预览）

- 状态：accepted
- 日期：2026-08-09
- 关联：ADR-0072（小说阅读器 A2 化）、ADR-0076（首页下拉刷新——同为 window 滚动增强）、glossary-ui-cards.md

## 背景

小说详情页（`/novel`）正文用 **window 滚动 + 虚拟化**（TanStack Virtual，`useWindowScroll: true`）。右侧滚动条是浏览器原生 6px 细条（`base.css` `::-webkit-scrollbar`），用户反馈"太小"且想要**拖拽加速**：慢慢拖慢慢滚、快速拖快速滚、按住持续加速。

调研结论（两份联网调研合并）：
- **移动 WebView 原生滚动条触屏不可拖拽**（`::-webkit-scrollbar-thumb` 仅鼠标输入生效，MDN/WebKit 官方确认）；且 **window/document 滚动条由 Android 系统绘制，CSS 加宽无效**——必须 JS 自绘。
- 阅读类 App（微信读书/番茄小说）采用**自研 overlay 极细进度条**：平时淡显、按压展开可拖、拖拽弹章节预览气泡。
- Android 系统级 FastScroller（`FastScroller.java` 官方源码）核心算法：**thumb 位移比例线性映射** `scrollingBy = (thumb位移/轨道长) × (总滚动范围 − 可见高)` → `scrollBy`——慢拖慢滚/快拖快滚天然成立，无需额外速度算法。
- Flutter `Scrollbar(interactive: true)` 官方可拖；RN 无内置需自绘。

## 决策

1. **自研原语 `createFastScrollbar`**（`src/primitives/createFastScrollbar.ts`），不引入第三方库（OverlayScrollbars 虽成熟，但引入新依赖 + 定制视觉成本高；自研轻量、可单测、与项目设计系统契合）。
2. **overlay 形态**：右侧 ~10px 细条，平时半透明淡显；指针按压/拖拽时加宽变亮；内容小于视口时不显示。
3. **thumb 几何**（仿 FastScroller）：`thumb高 = 视口高² / 内容高`（clamp 最小 24px）；`thumb偏移 = scrollTop/(内容高−视口高) × (轨道高−thumb高)`。
4. **拖拽语义**：**位移比例线性映射**——`pointerdown` 捕获 thumb → `pointermove` 计算 thumb 位移 → `onScrollTo(映射后的 scrollTop)`；`touch-action: none` 防止与页面手势冲突。
5. **章节预览气泡**：拖拽时中央显示当前章节名（利用已有 ChapterBlock 解析 + 虚拟布局的块位置索引，`chapterAt(scrollTop)` 返回章节标题）；无章节块的小说不弹。
6. **应用范围**：仅小说详情页（最长滚动场景、用户痛点所在）；验证手感后再考虑推广。

## 被考虑的方案

- **CSS 加宽原生滚动条**（`::-webkit-scrollbar`）：对 window 滚动无效（系统绘制）、触屏不可拖拽——否决。
- **OverlayScrollbars 库**（body 模式 + dragScroll）：功能成熟，但新依赖 + 覆盖其样式定制视觉成本高；自研原语接口更小——否决。
- **隐藏滚动条纯手势**（feed 流式）：不满足用户"抓滚动条拖拽"诉求——否决。

## 后果

- 正面：滚动条可抓可拖、慢拖慢滚/快拖快滚（比例映射天然成立）、章节预览提升长文导航；纯前端、window 滚动零布局改动、虚拟化兼容。
- 负面：滚动条区域约 10px 位于阅读区右侧，可能轻微遮挡（淡显缓解）；需与下拉刷新（ADR-0076，window 顶部手势）共存——拖拽仅在 thumb 上触发，互不干扰。

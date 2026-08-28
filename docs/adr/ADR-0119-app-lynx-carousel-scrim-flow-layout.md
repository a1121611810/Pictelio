# ADR-0119: app-lynx 推荐轮播 scrim 改流内布局（原生非首 slide 文案不渲染修复）

- 状态：accepted
- 日期：2026-08-28
- 关联：ADR-0115（推荐轮播）、ADR-0118（打磨 R2）、`packages/app-lynx/CONTEXT.md`（「轮播 scrim 流内化」「遮罩」词条）、`packages/app-lynx/src/pages/Recommended.vue`（滑页 scrim）
- 来源：真机/模拟器 bug——推荐轮播滑到**非首页**时，底部 scrim（标题/标签/作者/收藏）在**原生 LynxView** 上**不渲染**（web-core 正常）。

## 背景

ADR-0115 单卡轮播上线后（含 ADR-0118 打磨 R2），用户反馈：**轮播滑动到非第一页，下面的文案内容看不见**。

调查（模拟器复现 + web 对照 + OCR 确读）：
1. **web-core 正常**：scrim 文案随滑页移动、逐页不同（实测 slide 1 可见时其文案出现在视口正确位置）——排除代码数据/逻辑 bug。
2. **原生复现**：模拟器上非首页的 scrim 文本区为空（第 1 页正常）；用 Vision OCR 确读第 1 页有完整文案（title/tags/author/bookmark），第 2 页为空。
3. **差异归因**：改动仅在本地**渲染层**（scrim 由 `absolute bottom-0` 改为流内），原生行为随之修复。

## 决策

**推荐轮播滑页的 scrim 改用流内布局**，不再用 `absolute bottom-0`：

- slide 根：`relative bg-surface-container-lowest` → `relative flex flex-col bg-surface-container-lowest`
- 在 scrim 前插入 `<view class="flex-1 min-h-0" />` 弹性占位，把流内 scrim 推到容器底部
- scrim：`absolute bottom-0 left-0 right-0 ...` → 去掉绝对定位，改为流内块（保留 `px-6 pt-[24vw] pb-[10vw]` 与 `--md-scrim-overlay` 渐变）

**为什么不保持 absolute**：原生 LynxView 对被 `translateX` 平移的 flex-row **非首 slide** 内的 `absolute bottom-0` 子元素**文本渲染缺失**（真机复现；web-core 正常，属平台差异）。这与仓库已有的「遮罩」词条（原生 list-item 内 absolute 高度测量异常）同源——**原生对 absolute 定位于 flex/translate 容器内的关键内容不可靠**。转流内后，scrim 成为普通流内块，规避该平台陷阱。

**视觉不回归**：
- `width-fill`（宽满高按比例，图能容纳）：图片流内于顶部，`flex-1` 占位，scrim 流内于底部（在 surface 背景上）——符合 ADR-0118「图短时下方露出背景」设计。
- `cover`（超高图回退 aspectFill）：图片 `absolute inset-0` 铺满滑页，scrim 流内叠其底部——沉浸视觉不变。

## 被考虑的方案

- **保持 absolute 不动**：bug 持续（原生渲染缺失）。否决。
- **absolute 但改锚点/加显式高度**：治标不治本，且原生 absolute 在多 slide 平移下不可靠。否决。
- **只测页面重新渲染（强制重挂载）**：引入不必要的刷新抖动，未触及根因。否决。

## 后果

**正面**：非首 slide 的 scrim 文案在原生正常渲染（模拟器实测第 1/2/3 页均有各自完整文案，OCR 确读）；流内布局天然规避原生 absolute 陷阱。
**负面**：scrim 由 absolute 改流内，几何/层叠语义变化——需在 web-core 与模拟器核对「超高图 cover 回退」时 scrim 叠图底、以及「短图」时 scrim 下方露出背景的视觉一致。渲染行为归 web-core + 模拟器/真机验证闭环；node 单测无该平台回归的可测缝（原生渲染行为），故无单测，以模拟器手动清单覆盖。

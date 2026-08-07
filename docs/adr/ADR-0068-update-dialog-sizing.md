# ADR 0068: 更新弹窗尺寸规范——85vh 上限 + 更新内容区自适应滚动 + 清单 changelog 完整保留

## 状态

已采纳（2026-08-07）

## 分类

UI 规范 / 更新展示 / 版本清单契约

## 日期

2026-08-07

## 背景

更新弹窗（`StartupUpdateDialog`，webview 客户端温和更新策略的展示载体）展示**版本清单**的 changelog 时，长更新内容显示不完整，用户无法查看完整更新说明：

1. **UI 层**：弹窗卡片无高度上限（内容多时整体超出屏幕被裁），changelog 区固定 `max-h-[25vh]`——长内容只显示视口高度 1/4，用户以为"被截断、不能滚"；Android WebView 滚动条默认 overlay 隐藏，加剧"无滚动条"感知。
2. **数据层**：发布脚本 `release.mjs` 写 `version.json` 的 `changelog` 字段时截断到前 200 字符（`plan.notes.slice(0, 200)`）——即使 UI 修好，内容源本身不完整，长 release notes 永远显示不全。

## 决策

### 1. 弹窗最大高度 = 可视范围 85%（`max-height: 85vh`）

弹窗宽度保持 `min(85vw, 360px)`（已是移动端舒适阅读宽度）；高度以 `max-height: 85vh` 为上限。内容少时弹窗保持紧凑自适应（不撑满），内容多时最高占可视高度 85%，不超出屏幕。

### 2. 更新内容区自适应剩余空间 + 独立滚动（系统默认滚动条）

弹窗卡片为 flex 列布局：标题 / 正文 / 按钮 `flex-shrink: 0` 固定；**更新内容区** `flex: 1` + `min-height: 0` + `overflow-y: auto`——弹窗达到 85vh 上限后，内容区自动占满剩余空间并独立垂直滚动，标题与按钮始终可见。滚动条使用**系统默认**（Android WebView overlay 行为，滚动时短暂显示），不强设固定高度、不强制显示滚动条轨道。

### 3. 版本清单 changelog 完整保留（截断上限 200 → 5000 字符）

`release.mjs` 写入 `version.json` 的 `changelog` 截断上限从 200 字符放宽到 5000 字符，保证常规 release notes（含 commit 链接）完整显示。同一清单服务双端（webview 更新弹窗 + lynx 强制更新页），两端同时受益；5000 字符上限防极端长文案撑大清单文件。

## 备选方案

- **强制显示滚动条**（`overflow-y: scroll` + 自定义滚动条样式）：否决——Android WebView 的 overlay 滚动条显示行为由系统控制，CSS 无法可靠强制常显；系统默认已可滚动，满足"方便滚动查看"诉求。
- **固定 changelog 高度**（如 40vh）：否决——内容少时浪费空间、内容多时仍不足；flex 自适应更贴合内容驱动的高度。
- **弹窗宽高都按 85% 缩放**：否决——宽度 360px 已是移动端舒适阅读宽度，加宽无收益且破坏视觉比例。
- **changelog 不设截断上限（完整写入）**：否决——极端长文案会无限撑大清单文件；5000 字符覆盖正常 release notes 长度，留有余量。

## 影响

- `packages/app/src/components/StartupUpdateDialog.tsx`：弹窗加 `max-h-[85vh]`；更新内容区 `max-h-[25vh]` → `flex-1 min-h-0 overflow-y-auto`；标题/正文/按钮 `flex-shrink-0`。
- `packages/app/scripts/release.mjs`：changelog 截断上限 200 → 5000。
- 术语表：`docs/adr/glossary-update-check.md` 更新「更新弹窗」「版本清单」条目 + 新增「更新内容区」术语。
- 无共享检查层（`@pictelio/update-check`）改动——changelog 仍是纯文本契约，双端渲染不变。

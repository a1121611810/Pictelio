# ADR-0074: A2 视觉语言按 Win11 / Fluent 2 官方规范修正（A2 Win11 Correction）

- 状态：accepted
- 日期：2026-08-08
- 关联：ADR-0069（A2 视觉语言起源）、ADR-0070/0071/0072/0073（各页 A2 化）、glossary-ui-cards.md

## 背景

A2 视觉语言在设置页原型定稿时被定义为「无边框 + 大圆角（`--borderRadius2XLarge` 12px）+ 单级柔和阴影（`--elevation2`）」，随后铺开到 /me、/home、/illust、/novel。用户反馈"方案偏离了 Win11 的做法"，对照微软官方规范核实，**三个核心维度均偏离**：

| 维度 | 已落地的 A2 | Win11 / Fluent 2 官方 | 判定 |
|------|-----------|----------------------|------|
| 卡片圆角 | `2XLarge` 12px | 顶层容器/大容器 **8px** | ❌ 大 50% |
| 卡片边框 | 刻意去边框 | **1px 细边框标识容器**（Fluent 2 Shapes 原文："Borders identify the bounding container on unfilled shapes, like cards"） | ❌ 反了 |
| 阴影 | `elevation2` 投影 | Win11 设置页卡片无投影，靠边框 + 背景分层 | ❌ 多余 |

**官方依据**：
- Windows 11 Geometry（learn.microsoft.com）：8px = 顶级容器（窗口/flyout/dialog），4px = 页内元素（按钮/列表底板）；直边相接不圆角。
- Fluent 2 Shapes（fluent2.microsoft.design）：rectangle 为默认形状（按钮/菜单/卡片/图片）；Corner radius 令牌 Medium=4px（按钮）、Large=8px（大按钮）、X-Large=12px（button sheet/popover）；"移动端场景跟随 iOS / Android 指南"。

## 决策

A2 视觉语言修正为（Win11 真实做法）：

1. **卡片**：`--borderRadiusXLarge`（8px）+ 1px 细边框 `--colorNeutralStroke1` + 背景分层（卡片 `--colorNeutralBackground1` / 页面 `--colorNeutralBackground2`）+ **无阴影**。
2. **控件**（按钮 / segmented / 行卡 / 子标签）：`--borderRadiusMedium`（4px）——已符合，保持不变。
3. **浮层/抽屉**（SeriesSheet / ReaderSettingsSheet）：顶部圆角 `--borderRadius4XLarge`（24px）→ `--borderRadius3XLarge`（16px），向 Win11 收敛（移动端平台惯例上限）。
4. **NavBar**（glass 材质）：保留——Fluent 2 Materials 支柱（acrylic 毛玻璃）是 Win11 签名体验之一，不与卡片冲突。
5. **危险卡**（SettingsCard tone=danger）：边框色用 danger 语义色，其余同卡片规范。

## 影响面

全部已 A2 页面与组件回改（8px + 边框 + 去阴影）：
- `uno.config.ts` `image-card` shortcut（影响所有 Feed 卡）
- `SettingsCard`（elevated / danger）
- `/me`（MenuRow / Avatar 卡片）
- `/home` 顶栏卡片 + 原型（NovelCardA2 / HistoryRowA2 / SectionCardA2）
- `/illust`（DetailHeader / DetailCard / BottomActionBar）
- `/novel`（NovelTopBar / NovelCoverCard / NovelFooterNav）
- 抽屉（SeriesSheet / ReaderSettingsSheet）圆角 16px
- `StartupUpdateDialog` / `ImageHostSettings` / `ClientSwitch` / `__root` 等含 2XLarge 卡片处

## 后果

- 正面：视觉与 Win11 设置应用一致（用户预期）；边框+分层替代阴影后深色模式下边界更清晰。
- 负面：一次全系统视觉改动（视觉回归需人工确认）；Feed 卡无阴影后与页面背景的分离度略降，由边框补偿。
- 保留：NavBar 材质体系（ADR-0044）；底部抽屉移动端圆角上限 16px。

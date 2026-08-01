# ADR 0044: app-lynx 响应式单位选型——字号 rpx + 宽高间距 vw

## 状态

已采纳

## 分类

技术决策

## 日期

2026-08-01

## 背景

`packages/app-lynx`（vue-lynx 双 Client MVP）最初所有样式（字号、间距、宽高、圆角）均为固定 `px`，导致跨设备不缩放、在小屏上"显示不全、像老人模式"。

诊断链：

1. **Lynx 的 `px` 是绝对逻辑像素**（1/96 inch，等同 iOS pt / Android dp），不随屏幕宽度缩放——这是"所有设备字号相同"的直接原因。
2. **`rpx` 是 Lynx 的响应式单位**（750rpx = 屏宽），官方一等公民；但 **web-core 预览环境下，rpx 布局属性会塌陷**：web-core 把 rpx 转成 `calc(N * var(--rpx-unit))`，而 `--rpx-unit: calc(1cqw / 7.5)` 定义在 `lynx-view` 自身并引用**自身**容器宽度（cqw）——CSS 容器查询规范禁止元素用自身尺寸解析 cqw，循环失效导致 `--rpx-unit` 计算值为空，所有 rpx 布局属性塌成 0（间距/宽高全部挤在一起）。用户实证 + web-core 源码 `packages/web-platform/web-core/src/style_transformer/token_transformer.rs` 的 `var(--rpx-unit)` 模板确认。
3. **`vw` 默认不经过该变量链**：web-core 的 vw 转换由 `transformVW`（`lynx-view` 的 `transform-vw` 属性）开关控制，**默认关闭**——`vw` 由浏览器 CSSOM 原生解析（视口宽度），预览环境 100% 可靠；原生 LynxView 亦全平台支持 `vw`（官方 `<length>` 文档确认）。

## 决策

`packages/app-lynx` 全部页面与 tokens.css 采用**混合响应式单位策略**：

| 类别 | 单位 | 换算基准（375 设计稿） |
|------|------|------------------------|
| 字号 / 行高 | `rpx` | 20rpx = 10px（750 基准） |
| 宽高 / 间距 / 圆角 | `vw` | 1vw = 3.75px（16px→4.267vw、bar 44px→11.733vw） |
| 细边框（border-width） | `px` | 1px/2px 物理细线，不缩放 |
| 阴影（elevation） | `px` | 模糊半径不缩放 |
| 封面图 | `auto-size` | 按图片真实宽高比自适应（替代固定高度） |

换算关系：**750rpx = 100vw**，即 `vw = rpx / 7.5`（页面内由 32rpx→4.267vw 等值验证）。

## 核心动机

1. **双环境可靠性**：web 预览（开发期主要验证环境）下 vw 原生解析可靠，rpx 布局属性塌陷不可用；原生 LynxView（交付目标）下两者皆可靠。
2. **响应式一致性**：vw 与 rpx 语义等价（都是按屏宽线性缩放），混用不产生行为分叉；字号保持 rpx 因 web 预览实测正常（`font-size` 走独立路径）。
3. **官方路线背书**：Lynx 官方 styling 文档的 PostCSS 示例（`postcss-px-to-viewport`，`viewportWidth: 375`）即 px→vw 构建期转换路线，vw 是被官方文档认可的工作流。postcss 插件作为后续兜底（若手写 vw 维护成本升高）。

## 风险与反面

- **vw 基准是 LynxView 容器宽度而非屏幕宽度**：原生集成（#41）时若 LynxView 非全屏，vw 数值会整体偏移——宿主侧需确认容器尺寸。rpx 同理。
- **圆角 vw 化**：iPad 等宽屏下圆角等比放大（12px→768 屏 24px），观感偏大；如不可接受可改回 px。
- **字号 rpx 在原生与 web 的基准一致性**：web 预览下字号经独立路径解析正常，原生路径未实测（待 #41 验证）。
- **tokens.css 的 `--fontSize*` / `--spacing*` 令牌当前零引用**（页面为硬编码值），属历史遗留；清理时应收敛页面硬编码到令牌。

### 正面

- web 预览（开发期主环境）布局 100% 可靠，不再出现间距塌陷
- 响应式语义统一（750rpx = 100vw），跨设备等比缩放
- 保留 px 的两类值（边框、阴影）符合"物理值不缩放"直觉

### 反面

- 字号与宽高间距用两种单位（rpx + vw），认知成本略高于纯 rpx；但语义等价，换算固定（/7.5）
- vw 依赖 LynxView 容器尺寸，宿主集成时需复核

## 相关

- `docs/research/lynx-migration-feasibility.md`、`vue-lynx-deep-dive.md`（五份可行性评估）
- `packages/app-lynx/README.md`（架构与已知限制）
- `glossary-lynx-units.md`（单位与换算机制术语表）
- 实施提交：`1b63b21 feat(app-lynx): 宽高间距改用 vw 响应式，字号保持 rpx`

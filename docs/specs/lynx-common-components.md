# Spec: lynx 公共组件层抽取

> 架构决策：ADR-0194（app-lynx 公共组件层抽取——六组件收口）；统一术语：`docs/adr/glossary-lynx-four-features.md`（**公共层** / **PageTopBar（页级顶栏）** / **SubTabBar（二级 tab 切换条）** / **EmptyState（空态）** / **FeedListFooter（列表尾）** / **BottomSheet（底部弹层壳）** / **UserRow（用户行）** 均以术语表为准，本文不另造别称）。
> 同范式先驱：ADR-0190（`<M3SegmentedButton>` 单组件收口）；本批首批消费方：稍后看（ADR-0191）、下载命名（ADR-0192）、好P友（ADR-0193）。
> 状态：spec（/to-spec 产出）；性质：**纯重构，零行为变化**。

## Problem Statement

app-lynx 页面层存在大规模模板复制粘贴：同一批 UI 模式在各页手写、无共享实现。重复度审计（2026-09-27，ADR-0194）：

| 模式 | 重复量 | 现状 |
|------|--------|------|
| 列表尾三态（加载中 / 分页错误 / 到底） | **10 实例** | 各页手写条件渲染段，措辞与结构已出现 drift |
| 空态（图标 + 标题 + 提示） | **13 实例** | 各页手写空态段，图标 / 间距 / 文案层级不一致 |
| 二级 tab 切换条 | **4 实例** | 手写胶囊 / 下划线切换，选中态样式各自为政 |
| 页级顶栏 | **19 文件 / 13 返回头** | 居中标题与「‹返回 + 标题 + 右动作」两类手写头并存，返回键 / a11y 挂法不一 |
| 底部弹层壳 | **7 组件** | `PagePickerSheet`、`NovelExportSheet`、`CommentOverlay` 等各自复制 scrim + 面板 + 关闭按钮壳 |
| 用户行（头像 + 名 + 动作） | 散在 FollowList 等 | 现仅 FollowList 单副本，好P友 MyPixiv（ADR-0193）即将成为第二消费方 |

这是「无共享组件时修一处漏 N 处是结构性必然而非偶发」的典型病灶——ADR-0190（5 处 inline 分段控件收口）已验证过同一病理，本批是其放大版：不是单组件收口，而是六类高频模式同时漂移。每新增一个页面，就要再手抄一遍顶栏、空态、列表尾；每修一处视觉 / 交互问题，都要在 N 份拷贝间逐行比对，漏一处即产生新的不一致。底部弹层壳的风险最高：命中测试语义（ADR-0123/0147 平台约束）在 7 份拷贝中各自手写，任何一份写错，回归表现为真机点透 / 吞点击，且 web-core 预览无法暴露。

## Solution

抽取 **6 个公共组件**——PageTopBar、SubTabBar、EmptyState、FeedListFooter、BottomSheet、UserRow——落既有公共层（包内目录惯例，**非独立 npm 包**，ADR-0194 D2 工具链四锚点否决独立包），并把**全部现存调用点一次性迁移**到组件上。纯重构、**零行为变化**硬门禁：视觉（类串 / 几何 / 色 token）、交互（事件时序 / a11y 挂法）、键序全部原样保留，唯一变化是 markup 收进组件。

业务语义（i18n 文案、a11y 注册表 value、store 绑定、路由决策）留在调用方——只抽「结构 + 三态 / 变体」这层稳定共性。本批其余三个功能（稍后看 / 下载命名 / 好P友）即为首批真实消费方：抽取先行落地，新页直接以组件拼装，抽取与消费在同一批内互相验证。

## User Stories

1. As a **维护者**, I want 列表尾三态的措辞或结构修复只需改 FeedListFooter 一处、10 个实例全局生效, so that 不再有「改 10 处漏 N 处」的 PR
2. As a **维护者**, I want 空态的视觉调整（图标 / 间距 / 层级）在 EmptyState 单点生效、13 处同步, so that 各页空态不再各自漂移
3. As a **维护者**, I want 新页面（本批稍后看列表页）直接复用 PageTopBar / EmptyState / FeedListFooter 拼装, so that 不再手抄顶栏 / 空态 / 列表尾模板
4. As a **维护者**, I want 好P友（MyPixiv）新页直接复用 UserRow, so that 第二消费方接入前组件已就位，避免副本先落地再返工
5. As a **维护者**, I want FollowList 迁到 UserRow 后关注 / 取关的业务语义（端点、乐观更新）留在调用方, so that 表现层与业务层边界清晰
6. As a **维护者**, I want 新弹层基于 BottomSheet 壳组装, so that 命中测试语义（父级 v-if 挂载 / scrim @tap 关闭 / 面板 @tap.stop / z 序）不再各自手写
7. As a **维护者**, I want SubTabBar 的选中态指示条类名在组件单点逐字保留, so that 真机验证过的写法不被四处拷贝稀释或误改
8. As a **测试维护者**, I want 每个新组件带 template 快照测试守护契约（渲染结构 / 关键类名 / 事件绑定）, so that 未来改动破坏契约时 CI 先红
9. As a **测试维护者**, I want 全部既有页面 template 测试零修改语义通过, so that 迁移等价性有机器证明而非人工逐页比对
10. As a **维护者**, I want 门禁测试（mdTokenRefs / hardcode-gate / palettes-drift / noDeadKeys）迁移后继续全绿, so that token 与文案键纪律在收口后仍被机器守护（且守卫命中面收窄为单点）
11. As a **代码审阅者**, I want grep 证明旧重复块清零（不留旧副本、不留 shadow 死代码）, so that 「迁移完备」可机械核对而非逐文件目检
12. As a **后续贡献者**, I want 卡片类组件等下一批抽取有 documented 路径（本 spec 挂账清单 + ADR-0190/0194 范式）, so that 后续立项不必从零重新盘点

## Implementation Decisions

**D1 落位与风格**：六组件落既有公共层目录（**平铺**，跟随现状目录惯例，不建子目录命名空间）；对齐 `RefreshableList` / `CoverImage` 已确立的「深模块 + 头注释契约」风格——props 即契约，头注释写清职责边界与 props 语义。六组件仅 lynx 端（webview Fluent 体系不共享，与 ADR-0190 排除面一致）。

**D2 PageTopBar（页级顶栏）**：props `title`（已解析文案，调用方经 i18n 传入）+ 可选返回（‹）+ 右动作 slot；两变体——**居中标题**变体（一级页）/ **‹返回 + 标题**变体（二级页）。返回事件上抛调用方（`router.back` / `goBack` 决策留调用方）；a11y 标注沿用既有 accessibility 注册表模式（调用方传注册表 value，组件不自持业务 a11y 文案）。

**D3 SubTabBar（二级 tab 切换条）**：props `items`（`{key, label}[]`）+ `modelValue` + `change` 事件（数据驱动 + 受控）。**选中态指示条类名逐字保留**——现状真机验证过的写法原样搬运，禁止在抽取中「顺手优化」（统一 / 改写属行为变化，须另走视觉与交互验收）。一级 tab（`NavigationBar` / 放射 FAB）不混淆，不在本组件范围。

**D4 EmptyState（空态）**：props 图标字符 / 标题 / 提示三段。文案由页面经 i18n 传入，组件自身**零文案、零 CJK 字符**——hardcode-gate 约束（noDeadKeys 面不因抽取稀释，ADR-0190 排除面同款）。

**D5 FeedListFooter（列表尾）**：props `loading` / `error` / `end` 三态（互斥由 props 驱动）；错误态重试事件 emit 上抛调用方；作 list-item full-span 子内容使用（挂在列表流内，非页面级浮动元素）。

**D6 BottomSheet（底部弹层壳，本批唯一高风险组件）**：slots `title` / `default` + `close` 事件；壳 = scrim + 80vh 面板 + 标题栏 + ×。**原样保留 ADR-0123/0147 命中测试语义**：父级 `v-if` 控制挂载（卸载式显隐，非 `v-show` / visibility）、scrim `@tap` 关闭、面板 `@tap.stop` 防冒泡、z 序 scrim < 面板。各既有弹层（`PagePickerSheet`、`NovelExportSheet`、`CommentOverlay` 等 7 组件）迁移后行为**逐字节等价**；各实例挂法差异逐例保留，禁止趁机统一。

**D7 UserRow（用户行）**：props 用户对象 + 关注态（`is_followed` / `busy`）+ `toggle` / `row-tap` 事件。消费方 = FollowList（关注 / 粉丝）与新 MyPixiv 页（好P友，ADR-0193）；两者共用 UserPreview（用户预览）形状数据。UserRow 只是表现层——关注 / 取关的业务语义（端点、乐观更新、busy 锁）留调用方。

**D8 全量迁移硬要求**：

- **所有现存调用点全部迁移**：不留旧副本、不留 shadow 死代码——留副本等于白抽，drift 照旧
- **script-setup 禁 export**（ADR-0116）
- **样式只用既有 Tailwind M3 token 类**：mdTokenRefs / palettes-drift 门禁保持绿
- **不新增依赖**
- **零行为变化硬门禁**：视觉（类串 / 几何 / 色 token）、交互（事件时序 / a11y 挂法）、键序全部原样保留；唯一变化是 markup 收进组件

**D9 抽取先行**：本批其余三个功能（稍后看 / 下载命名 / 好P友）消费这些组件——抽取必须最先落地，新页直接以组件拼装，避免副本先落地再返工。

**D10 明确挂账（后续候选，本批不做）**：插画瀑布流卡 / 小说行卡**三副本**收口、`FirstLoadGate`、`useMixFeedPage`、Bookmarks / UserHome 孪生页脚手架、跨端纯逻辑下沉包（`@pictelio/pixiv-types` 与 moderation-core 下沉共享）。每项独立立项（沿 ADR-0190 单点收口节奏），不阻塞本批。

## Testing Decisions

- **seam（测试缝隙）三层防线**：
  1. **组件契约**：每个新组件带 template 快照测试（先例 = `*.template.test.ts` 族，如 M3SegmentedButton 的同名先例；断言渲染结构与关键类名 / 事件绑定，锁死契约字面量）
  2. **迁移等价性**：全部既有页面 template 测试保持绿——这是「迁移零行为变化」的机器证明
  3. **门禁纪律**：门禁测试（mdTokenRefs / hardcode-gate / palettes-drift / noDeadKeys）全绿——组件收口后守卫命中面收窄（单点命中替代 N 点），属附带收益
- **验收口径**：零行为变化 = 既有测试**零修改语义**通过（允许 import 路径类机械改动）；grep 证明旧重复块不再存在（列为 review 检查项，与 D8「全量迁移」互为表里）。

## Out of Scope

- **卡片类组件抽取**（插画瀑布流卡 / 小说行卡三副本）——D10 挂账，另行立项
- **孪生页合并**（Bookmarks / UserHome 脚手架）——同上
- **跨包 lynx-ui**——独立 npm 包已被 ADR-0194 D2 工具链四锚点否决
- **视觉改版**——任何「顺手统一 / 顺手优化」均被零行为变化硬门禁排除；差异统一属独立验收
- **M3 新组件**——M3Switch / M3SegmentedButton 已存在，勿动

## Further Notes

- **seam 决策声明**：本 spec 为无人值守产出，seam 沿用仓库最高可用惯例（template 快照测试 + 既有页面测试回归 + 门禁测试三层），供事后审阅；如与后续 grill / to-tickets 阶段结论冲突，以后者为准并回改本文。
- **真机验证要求**：BottomSheet / 列表类（FeedListFooter 作 list-item 子内容）组件改动必须在原生侧模拟器验收——web-core 预览与原生 LynxView 行为不一致已有记录在案（ADR-0123/0147 家族：命中测试回归表现为点透 / 吞点击），**模拟器验收必过，web-core 绿不算数**。
- **双锚**：本文档与 ADR-0194（架构语义准绳）和 `docs/adr/glossary-lynx-four-features.md`（术语准绳）双锚；语义冲突时以 ADR / 术语表为准。

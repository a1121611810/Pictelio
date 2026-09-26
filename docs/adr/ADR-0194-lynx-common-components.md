# ADR-0194：app-lynx 公共组件层抽取（Common Layer——六组件收口）

- 状态：Accepted（已采纳）
- 日期：2026-09-27
- 关联：`docs/adr/glossary-lynx-four-features.md`（术语表——公共层与六组件定义）、`docs/specs/lynx-common-components.md`（规格，随 /to-spec 产出）、ADR-0123（原生 LynxView hit-testing 平台约束）、ADR-0147（ScrollView overlay hit-testing）、ADR-0190（`<M3SegmentedButton>` 抽取同范式先驱）、ADR-0191（WatchLater.vue 为新增消费方）、ADR-0193（MyPixiv 为 UserRow 消费方）、ADR-0097（机器防线）

## 背景

重复度审计（2026-09-27，grep/人工盘点 app-lynx 页面与组件层）：

| 模式 | 重复量 | 现状 |
|------|--------|------|
| 列表尾三态（加载中/分页错误/到底） | **10 实例** | 各页手写 `loading`/`error`/`no more` 条件渲染段，措辞与结构已出现 drift |
| 空态（图标+标题+提示） | **13 实例** | 各页手写空态段，图标/间距/文案层级不一致 |
| 二级 tab 切换条 | **4 实例** | 手写胶囊/下划线切换，选中态样式各自为政 |
| 页级顶栏 | **19 文件 / 13 返回头** | 居中标题与「‹返回+标题+右动作」两类手写头并存，返回键/a11y 挂法不一 |
| 底部弹层壳 | **7 组件** | `PagePickerSheet`、`NovelExportSheet`、`CommentOverlay` 等各自复制 scrim + 面板 + 关闭按钮壳 |
| 用户行（头像+名+动作） | 散在 FollowList 等 | 现仅 FollowList 单副本，但 MyPixiv（ADR-0193）即将成为第二消费方——先抽组件再接新页，避免副本落地 |

这是 ADR-0190（`<M3SegmentedButton>` 收口 5 处 inline 分段控件）同病灶的放大版：无共享组件时"修一处漏 N 处"是结构性必然而非偶发。与 ADR-0190 的差异：本批不是单组件收口，而是**一次性建立公共层**，且本批新功能即为首批真实消费方——WatchLater 列表页（ADR-0191）消费 PageTopBar/EmptyState，MyPixiv（ADR-0193）消费 UserRow，抽取与消费在同一批内互相验证。

## 调研结论

1. **落点已有惯例**：`packages/app-lynx/src/components/` 平铺 + `*.template.test.ts` 模板快照先例成熟（`M3SegmentedButton.template.test.ts` 等）；`RefreshableList` / `CoverImage` 已确立「深模块 + 头注释契约」风格（props 即契约、头注释写清职责边界）。
2. **独立包不可行**（工具链四锚点，见 D2）：tailwind content glob、守卫测试扫描根、i18n `t()` 耦合、vue-lynx 跨包 `.vue` 编译，全部锚定 `./src/**`。
3. **纯重构可行**：六组件的现有实例均为纯表现段（无跨页状态耦合），逐实例 diff 迁移可做到零行为变化；BottomSheet 壳的命中测试语义有 ADR-0123/0147 明文契约可对照。
4. **抽取边界要防"过度抽象"**：只抽"结构 + 三态/变体"这层稳定共性，业务语义（i18n 文案、a11y 注册表 value、store 绑定）留在调用方——与 ADR-0190「i18n / a11y 注册表 value 不进组件」的排除面一致。

## 决策

**D1 本批抽取六组件，落 `packages/app-lynx/src/components/`（平铺），纯重构硬门禁 = 零行为变化。**

| 组件 | 职责与变体 | 契约要点 |
|------|-----------|---------|
| `PageTopBar.vue` | 页级顶栏：**居中标题**变体（一级页）/ **‹返回 + 标题 + 右动作**变体（二级页） | 标题经 props 传已解析文案；返回事件上抛调用方（`router.back`/`goBack` 决策留调用方）；右动作 slot |
| `SubTabBar.vue` | 二级 tab 切换条（一级 tab = `NavigationBar`/放射 FAB，不混淆） | v-model 受控 + options 数据驱动；选中态 token 单点 |
| `EmptyState.vue` | 图标 + 标题 + 提示三段空态 | 图标/标题/提示均 props；不内置业务文案 |
| `FeedListFooter.vue` | 列表尾三态：加载中 / 分页错误（带重试事件上抛）/ 到底 | 三态互斥由 props 驱动；重试 `emit` 上抛 |
| `BottomSheet.vue` | 底部弹层壳：scrim + 80vh 面板 + 标题栏 + × | 见 D5 命中测试契约；内容 slot |
| `UserRow.vue` | 用户行：头像 + 用户名 + 可选动作按钮 slot | 头像/名 props；动作区 slot（关注按钮留调用方） |

落 `packages/app-lynx/src/components/` **平铺**（跟随现状目录惯例，不建子目录命名空间）；对齐 `RefreshableList` / `CoverImage` 的「深模块 + 头注释契约」风格（头注释写职责边界与 props 语义）。**硬门禁：零行为变化**——视觉（类串/几何/色 token）、交互（事件时序/a11y 挂法）、键序全部原样保留；唯一变化是 markup 收进组件。

**D2 否决独立 `@pictelio/lynx-ui` 包——工具链四锚点钉死在包内。**
① **单消费方**：唯一 app 包（`packages/app` 是 Solid + Fluent 视觉体系，组件不可共享），独立包零复用收益；② **tailwind content glob** 锚定 `./src/**`（`tailwind.config.ts:16`），跨包组件类名不进产物；③ **守卫测试**（`tests/mdTokenRefs.test.ts`、`tests/hardcode-gate.test.ts` / `hardcodeColorGate.test.ts`、`tests/palettes-drift.test.ts`、`tests/noDeadKeys.test.ts`）扫描根为 `src`，包外组件脱离防线；④ **i18n `t()` 耦合**：组件模板普遍消费已解析文案，跨包需重做 i18n 注入面（且 vue-lynx 跨包 `.vue` 编译无先例）。四条任一都足以否决，叠加后无讨论空间。

**D3 全量迁移 + 模板快照测试 + 守卫保持绿。**
抽取后**所有现存调用点必须迁移**（不留旧副本——留副本等于白抽，drift 照旧）；每个新组件带 `*.template.test.ts` 模板快照测试（对齐 `M3SegmentedButton.template.test.ts` 先例：接口边界 + 关键类串/事件绑定精确断言）；迁移后既有守卫门禁（mdTokenRefs / hardcode-gate / hardcodeColorGate / palettes-drift / noDeadKeys）**必须保持绿**——组件收口后守卫命中面反而收窄（单点命中替代 N 点），这是本决策的附带收益。六组件零 `t()` 内置：文案全部调用方传入，noDeadKeys 面不变。

**D4 明确挂账（本批不做，记入后续候选）。**
以下重复已盘点、收益已确认，但与本批六组件正交，避免一次性大爆炸迁移：插画瀑布流卡/小说行卡**三副本**、`FirstLoadGate`、`useMixFeedPage`、Bookmarks/UserHome 孪生页脚手架（**361 行重复**）、`@pictelio/pixiv-types` 与 moderation-core **下沉共享**。每项独立立项（同 ADR-0190 的单点收口节奏），不阻塞本批。

**D5 BottomSheet 抽取必须原样保留 ADR-0123/0147 命中测试语义与 z 序。**
全屏层 `v-if`（非 `v-show`/visibility——原生 LynxView 对 overlay 的命中规则要求卸载式显隐）、scrim `@tap` 关闭、面板根 `@tap.stop` 防冒泡（ADR-0123/0147 平台约束），z 序挂法（`modalStack` / 层级上下文）逐实例对齐——7 个壳实例中若有挂法差异，以 spec 的实例对照表裁决，不许在抽取中"顺手统一"（统一属行为变化，另行走视觉/交互验收）。这是本批唯一的**高风险组件**：命中测试回归表现为真机点透/吞点击，必须真机验证（对齐 ADR-0123「原生为准」）。

## 备选与否决理由（汇总）

| 备选 | 否决理由 |
| --- | --- |
| 独立 `@pictelio/lynx-ui` 包 | D2 四锚点（单消费方/tailwind glob/守卫扫描根/i18n+跨包编译），全钉死在包内 |
| 只抽重复最多的 1-2 个（如仅 EmptyState） | 剩余模式继续 drift；六组件共享同一批调用页，一次性建立公共层让新页（WatchLater/MyPixiv）直接以正确姿势消费 |
| 抽象时顺手统一视觉差异 | 违反零行为变化硬门禁；差异统一属独立验收，混入纯重构无法归因回归 |
| 组件内置业务文案/i18n | noDeadKeys 面被稀释；调用方失去文案控制权（ADR-0190 排除面同款） |
| BottomSheet 保留 `v-show` 优化 | 命中测试语义变化（ADR-0123/0147）；性能未证明是问题 |
| 留旧副本做渐进迁移 | 副本即 drift 温床（ADR-0190 的病灶本身）；迁移是一次性机械 diff，无渐进价值 |

## 后果

- 正面：六类高频模式的视觉/交互单点化，"修一处漏 N 处"结构性消失；守卫扫描面收窄、模板测试集中；WatchLater（ADR-0191）与 MyPixiv（ADR-0193）两个新页直接以组件拼装，页面代码量显著下降；后续挂账项（瀑布流卡等）有了明确的落位范式。
- 取舍（已接受）：props/slot 接口略厚于任意单页手写段（接口即契约，收益在多消费方）；7 个 BottomSheet 实例的挂法差异逐例保留（不趁机统一）；六组件仅 lynx 端（webview Fluent 体系不共享，与 ADR-0190 排除面一致）。
- 风险：BottomSheet 迁移是命中测试回归高危面——真机（原生 LynxView）逐实例验证 + web-core 预览双跑；模板快照测试锁类串，未来刻意改视觉需同步快照（这是防 drift 的代价，接受）。
- 后续候选（不在本期，D4 挂账清单）：插画瀑布流卡/小说行卡三副本收口、`FirstLoadGate`、`useMixFeedPage`、Bookmarks/UserHome 孪生页脚手架（361 行重复）、`@pictelio/pixiv-types` 与 moderation-core 下沉。

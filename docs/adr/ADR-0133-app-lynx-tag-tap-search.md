# ADR-0133: app-lynx 点击标签触发全局搜索（预填关键词）

- 状态：accepted
- 日期：2026-09-01
- 关联：ADR-0132（全局搜索弹层 + FAB 双形态入口）、ADR-0118（推荐页轮播 TagChipRow 决策 4）、ADR-0123（FAB hit-testing，（0,0）锚点）、glossary `docs/adr/glossary-app-lynx-global-search.md`、issue #302
- 来源：用户需求「lynx 增加点击标签触发搜索」（2026-09-01）；背景为 ADR-0132 落地后，app-lynx 标签展示点（推荐页轮播 TagChipRow、插画详情页标签行）仍为纯展示——注释「纯展示不可点（app-lynx 无搜索路由）」的前提已随 ADR-0132 过时。

## 背景

app-lynx 全局搜索（ADR-0132）已合入 main（2026-09-01）：SearchSheet 底部弹层 + FAB 双形态入口，关键词为组件私有 ref，无外部预填通道。webview client 有可点击标签先例（`SearchableTag.tsx`：点击 → `navigate('/search?word=...')` 即搜，搜索词 = 原始 `tag.name`）。app-lynx 两处标签展示点（`TagChipRow.vue` 轮播卡片、`IllustDetail.vue` 标签行）均为纯展示 `<text>`。本 ADR 把「全局搜索」的能力接上标签入口：**点击标签 → 打开搜索弹层 + 预填关键词 + 自动搜索**。

## 决策

1. **入口 = 标签点击 → 搜索弹层（非路由页跳转）**：与 webview 的「点标签跳 `/search` 路由页」**行为语义对齐（点击即搜）**，但载体是 ADR-0132 的弹层——弹层开合经 `searchSheetStore` 全局单例，无 URL、无深链，与 FAB 入口共用同一弹层实例（glossary「弹层全局单例」）。不新建路由、不复制弹层状态。

2. **预填机制 = `openSearch(initialKeyword?)` 扩展**（向 store 传入、组件挂载时消费）：
   - `searchSheetStore.openSearch(keyword?)`：有参时写入模块级 `prefillKeyword`；幂等逻辑不变（已打开时不重复注册 modal）；
   - `SearchSheet` `onMounted` 消费：非空 → `keyword.value = 词` + `controller.search(词)`（300ms debounce 在控制器内，与手动输入路径同一条链）；
   - **消费后即清**（消费并清空 store 中的 prefill，或 closeSearch 时清空）：防「关闭 → 再手动打开」残留下一次词。选型：`closeSearch()` 清空 + 组件消费后清空双保险——单例 store 不允许跨打开残留状态。

3. **搜索词 = 原始 `tag.name`，显示不变**：chip 文本仍 `#translated_name || #name`（ADR-0118 决策 4 不动）；点击传递 `tag.name`（Pixiv 原生标签）——与 webview `SearchableTag` 一致，搜索准确度优先（R-18 等标签翻译名不同）。**纯函数契约升级**：`resolveTagChips` 返回 `chips: { text, name }[]`（text=展示文本，name=原始标签），`tagChips.test.ts` 同步（契约测试 + 重构行为变化点标注）。

4. **scope/sort = 弹层默认态**（scope `all`、sort `date_desc`）：不按来源锁定——标签来自插画详情/轮播卡片可能是插画或小说（轮播插画小说混排），锁定会漏搜；默认态 = FAB 打开弹层的行为，改动最小、无可观测差异。

5. **预填路径不写搜索历史**：对齐 webview——其 hydration 路径（`syncFromUrl` + `executeSearch`）不 `addToHistory`，提交点仍是回车/点历史词条/点结果行三处（glossary「搜索提交点」）。点击标签是「程序化唤起」而非用户确认的搜索提交，不污染历史。

6. **交互细节**：
   - `+N` 折叠芯片**不可点**（是计数不是标签）；
   - chip `@tap.stop`：TagChipRow 位于轮播卡片遮罩内（父级 `@tap` = 进详情），不 stop 会点击标签后同时进详情页——`IllustDetail` 标签行同理（父级暂无 tap，统一 `.stop` 防后续嵌套）；
   - **命中区 = 视觉尺寸（视觉即命中）**：chip 视觉高度 ≈ 8.5vw（约 32px）略低于 M3 最小触控目标 40dp。**不做** `-m-1 p-1` 负 margin + padding 扩展——负 margin 在 Lynx 原生布局引擎未实证（flex 数学上该组合会把视觉位置外移 8px，视觉不再零变化），风险大于收益；对齐项目既有 tap 先例（CommentInputBar「取消」/ SearchSheet ×= 视觉即命中），40dp 达标列为后续增强（M3 辅助功能目标，不阻塞主功能）。
   - **事件挂 text 上**（非 view 包裹）：lynx 中 text 可承载 @tap（先例：CommentItem「回复」/「删除」、SearchSheet 历史 ×），无需额外包裹层。原生 LynxView hit-testing 不接受 pointer-events CSS（ADR-0123 教训）——事件直接绑定元素本体，不依赖 CSS 命中层。

## 被考虑的方案

- **仅预填不自动搜**：点击标签后弹层打开且填入词，由用户回车。已被否决——webview「点击即搜」语义是既定行为基准，预填不搜会产生「为什么点了没反应」的困惑（输入框已有关键词但结果区是历史）。
- **点击标签跳 webview `/search`**：跨引擎跳转破坏弹层语义（弹层无 URL），且 webview 侧改动排除（原则：共享契约 = API 参数/响应，双端各自呈现）。
- **scope 按来源锁定**（插画页标签→illust scope）：轮播混排标签无法确定来源、NovelDetail 无标签；锁定帮助有限，增加上下文传递成本。否决。
- **预填词写搜索历史**：webview hydration 路径无此行为；写历史会污染「真实搜索提交」语义。否决。
- **TagChipRow 发事件、页面决定**对 `openSearch` 的接线而非直接 import：组件纯展示 → 广播 `tag-tap` 事件（携带 name），页面层调用 `openSearch`——组件不依赖 store（保持 TagChipRow 的「纯展示/可测」性质），但行为随页面接线。**采用**（vs. 组件内直接 import openSearch：耦合 store，不可独立测）。

## 后果

**正面**：
- 两处标签展示点从「纯展示」升级为「全局搜索入口」，app-lynx 与 webview 的功能差距再收敛一项（#60 差距清单的残余项）；
- 复用 ADR-0132 全链路（弹层/控制器/历史/返回键），新增面收敛为 1 个 store 参数 + 1 个纯函数契约升级 + 2 个组件的 tap 接线；
- 预填走控制器同一 `search()` 链（防竞态轮换、五态机、提交点）——无第二套搜索路径。

**风险 / 验证项**：
- **热区与冒泡**（模拟器验证点）：TagChipRow 在轮播卡片遮罩内——`@tap.stop` 必须生效（否则点击标签误触卡片进详情）；命中区扩展后不影响轮播滑动（tap 与 fling 手势区分）；
- **契约升级 blast radius**：`resolveTagChips` 返回结构变更，调用方 = `TagChipRow.vue` + `tagChips.test.ts`（全仓 grep 确认无第三处）；
- **预填词消费时序**：onMounted 时 store prefill ≠ 空才消费——弹层由 v-if 挂载（App.vue），打开=新建、关闭=卸载，无「已打开再带词」状态（openSearch 幂等：已打开时 prefill 写入但组件不 re-mount——**边界**：已打开时再点标签（理论上弹层遮罩下不可达）→ 不处理，per 幂等语义）。

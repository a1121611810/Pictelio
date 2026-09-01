# ADR-0131: app-lynx 全局搜索（底部弹层命令面板 + FAB 双形态入口）

- 状态：accepted
- 日期：2026-09-01
- 关联：ADR-0120（放射导航 FAB）、ADR-0123（FAB hit-testing，（0,0）锚点）、ADR-0066（系统返回 + modalStack 扩展）、ADR-0103（账号级设置 / SharedPreferences 契约）、ADR-0111（RefreshableList FAB menu）、研究 `docs/research/global-search-patterns.md`、术语 `docs/adr/glossary-app-lynx-global-search.md`、spec `docs/specs/app-lynx-global-search.md`、issue #60（差距 #1）
- 来源：issue #60 差距清单 #1（搜索页未实现，最大缺口）；用户要求「更灵活、全局方便调用」而非固定搜索页 → 三变体原型（throwaway 分支 `prototype/lynx-global-search` f07f3fd）A 底部弹层 / B 全屏页 / C 半屏速览 → **用户拍板变体 A** + 全员 FAB 入口（2026-09-01），触发方式按推荐（即输即搜）。

## 背景

app-lynx 与 webview client 的功能差距中，**搜索**是剩余最大缺口（#60 差距 #1）：`pages/` 无 Search、`router.ts` 无 search 路由、`api/` 无 search 模块（2026-08-07 核查，2026-09-01 仍然）。webview 已有完整搜索蓝本（`Search.tsx` + `api/search.ts` + `searchStore`）。

用户对形态的意见：「要更灵活、全局方便调用」——不限定搜索页。原型 + 联网调研（官方规范 M3 / Apple HIG + 竞品 pixiv / B 站 / Notion 等 + 5 模式打分）后，用户拍板：**变体 A —— 底部弹层（全局命令面板式）**，并从任意内容页经 FAB 唤起。

## 决策

1. **形态 = 底部弹层（search sheet），非路由页**：遮罩 + 80vh 面板，复用评论弹层范式（`CommentOverlay.vue`）：遮罩 `@tap` 关闭、面板 `@tap.stop` 防穿透、DOM 顺序后置覆盖（不依赖 z-index）、`registerModal` 注册返回键先关弹层（ADR-0066）。关闭后回到原页，无 URL、无深链（区别于 webview `/search` 路由页）。

2. **入口 = FAB 双形态（用户定案）**：
   - **4 顶层 tab 页**（推荐/插画/小说/我的）：放射 FAB（ADR-0120）内环新增**全局内置「搜索」项**（位于内环首位，页面动作项顺延）；
   - **非 tab 内容页**：放射 FAB **默认形态即搜索按钮**（直达模式），点按直接展开搜索弹层（不展开放射菜单）；
   - **显示门扩展**：ADR-0120 原「可见性门」= 仅 4 tab 页显示；扩展为三态 `mode`：`menu`（tab 页，放射菜单）/ `search`（内容页 = 除 `/login`、`/update`、`/error` 外全部路由，FAB=搜索）/ `hidden`（非内容页）。「所有页面展示」语义收敛为「所有内容页展示」——会话/系统页（未登录、强制更新、会话失效）不提供搜索入口（搜索需登录态 + 无可搜上下文）。
   - **双 FAB 竖排堆叠**：非 tab **列表页**（Following/FollowList/Watchlist/Bookmarks/UserHome）已有 RefreshableList 的 feed 分页 FAB（同角 56dp）。搜索 FAB 与其**同角竖排堆叠**（搜索在上、分页在下，M3 多 FAB 布局惯例），保留分页能力与「内容页皆有搜索 FAB」双约束。

3. **触发方式 = 即输即搜**：输入变化 **300ms debounce** 自动搜索，弹层内就地出结果；**防竞态 = AbortController 轮换**（abort 上一在途请求，`useComments.ts` 同款范式，lynx 全路径已验证可用）；屏蔽 `AbortError` 不报错。搜索结果**全局 LRU 缓存**不做——弹层生命周期短、每次打开关键词通常不同，简洁胜出（webview 的 searchCache 是页面常驻场景的优化，不迁移）。

4. **搜索范围与排序 = 对齐 webview 蓝本**：scope **全部 / 插画 / 小说**（全部 = `mergeSearchResults` 混合时间线）；排序 **最新 / 最早 / 热门**（热门走 `/v1/search/popular-preview/{illust,novel}` 端点，不分页）。**无用户搜索**（差距清单定义 + webview 无先例）。搜索目标 `search_target` 沿用 `partial_match_for_tags` / 含空格转 `exact_match_for_tags` 派生规则（复用 webview 语义）。

5. **结果呈现 = 弹层内行式列表 + next_url 分页**：list-item 行（缩略图 + 标题 + 作者 + 类型/字数），`scrolltolower` 自动分页 + 「没有更多了」footer；分页失败保留已加载结果 + 内联重试（复用 glossary-search-pagination 的 paginationError / 内联重试模式语义）。R18/R18G 行按 `isRestricted()` 遮罩（不预过滤，与既有列表页策略一致）。空态 = 换词提示（dead-end 规避）；错误态 = 保留关键词 + 重试，不静默清空。

6. **搜索历史 = 设备级 idbKV 持久化**：仅**搜索提交点**写入（回车 / 点击历史词条 / 点击结果行），去重、上限 10 条、chips 展示、单删 + 全清。**设备级而非账号级**：搜索历史属敏感数据（HIG 隐私 + 调研含 R18 关键词场景），不跨引擎同步、不经 ADR-0103 SharedPreferences 契约键；掉级路径 = idbKV 不可用时内存态 + warn。

7. **排除项**：联想（autocomplete，webview `searchAutocomplete` 未接线）；热门词（无数据源蓝本，原型为 mock）；小说正文内查找（独立阅读器功能）；webview 侧任何改动（共享契约 = API 参数/响应，不改 webview 代码）；详情页顶部放大镜入口（后续增强，本次不做）。

8. **架构形状（移植非重设计）**：
   - `src/api/search.ts`（新）：`searchIllust` / `searchNovel` / `searchIllustNext` / `searchNovelNext`，含 **next_url 仅允许 Pixiv API 域**校验（防卫 SSRF，webview `assertPixivUrl` 先例移植）；
   - `src/primitives/useSearch.ts`（新）：状态原语（仿 `useComments` seam：`SearchTransport` 注入 + 五态状态机 + AbortController 轮换 + loadMore + scope/sort 重搜 + 提交点回调），node 可单测；
   - `src/stores/searchHistoryStore.ts`（新）：idbKV 读写 / 去重 / 上限 / 单删全清；
   - `src/stores/searchSheetStore.ts`（新，或并入 globalFab 命令通道）：弹层开合的全局单例状态（App.vue 只挂一份 SearchSheet）；
   - `src/components/SearchSheet.vue`（新）：弹层 UI（词条区 / 结果区 / 五态），仿 CommentOverlay 生命周期（onMounted 开层、registerModal、onBeforeUnmount 注销）；
   - `src/primitives/createGlobalFab.ts`（扩展）：`view.mode` 三态显示门 + `search` 命令 + 内环全局搜索项；`GlobalFab.vue`（扩展）：search 模式渲染 + 堆叠偏移。

## 被考虑的方案

- **变体 B 全屏搜索路由页**：可发现性好（底部 Tab 常驻）但需消耗 Tab 名额；用户明确否——「要更灵活、全局方便调用」，弹层从任何位置唤起更贴近命令面板诉求；B 的原型/调研价值保留（研究中 P1 主方案为 B 的论证过程，供 webview 侧参考）。
- **变体 C 半屏速览（spotlight）**：60vh 空间不足承载「插画缩略图 + 小说摘要」的密集结果列表，且与底部导航/返回手势干扰；调研数据支持全屏/弹层（80vh）而否决半屏。
- **提交式触发（回车/按钮）**：请求更省、对齐 webview 蓝本；但弹层 = 命令面板，即输即搜是其核心价值（输入 → 就地结果 → 点即走）；历史有提交点机制防污染，请求量由 debounce 控制。否决（用户同推荐）。
- **联想层 + 提交式两段**：webview 无联想蓝本（autocomplete 未接线），多一段 UI/逻辑成本；否决，首版直搜。
- **顶部常驻搜索栏**：增加 UI 密度、与放射 FAB 入口体系割裂、Fitts 定律差（顶部单手难达，调研实证）；否决。
- **单 FAB 替换（非 tab 页放射 FAB 顶替 feed 分页 FAB）**：丢失列表页分页/刷新/回顶能力；否决（堆叠两全）。

## 后果

**正面**：
- 全局搜索从任意内容页一触即达 = 唯一搜索入口（对齐 HIG 单入口原则），弹层回原页上下文不割裂；
- 复用已验证范式的比例高：弹层（CommentOverlay）/ 返回键（modalStack）/ 状态原语 seam（useComments）/ FAB 体系（ADR-0120/0123），新架构面收敛为 1 弹层 + 1 原语 + 1 存储；
- API 契约与 webview 全一致（端点、参数、响应、次页校验），双端行为不分叉。

**风险 / 验证项**（spec §验证 + tickets）：
- FAB 显示门与命令通道扩展对 ADR-0120 深模块的 blast radius：`FabCommand` / `FabView` 变更 → `GlobalFab.vue` + 测试（createGlobalFab / createFabMenu 单测）同步，非 tab 页现有行为（隐藏）是回归点；
- 双 FAB 堆叠的布局验证：非 tab 列表页搜索 FAB 与 feed 分页 FAB 同角不遮挡（web-core 预览 + 模拟器截图）；
- 非 tab 页放射 FAB 出现后与页面自身 UI（如详情页底部操作栏）是否冲突（每页核查）；
- 「即输即搜」在 lynx input 上的触发节奏（输入事件 / IME / 中文 input）与 300ms debounce 实测；
- 弹层在原生 LynxView 的键盘弹出交互（输入框自动聚焦 + 键盘遮挡 80vh 面板底部输入区）——现有 CommentInputBar 有键盘适配先例可参照。

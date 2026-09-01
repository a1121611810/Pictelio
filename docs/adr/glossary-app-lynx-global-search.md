# app-lynx 全局搜索 — 术语表

> 范围：`packages/app-lynx` 的**全局搜索**功能——底部弹层命令面板（变体 A），从任意内容页唤起，搜索对象为**插画 + 小说**。配套 ADR：[ADR-0131](./ADR-0131-app-lynx-global-search.md)；形态蓝本:原型 `PrototypeSearch.vue`（throwaway 分支 `prototype/lynx-global-search`，不入 main）+ 研究 `docs/research/global-search-patterns.md`。**复用术语**（SearchScope、热门排序、next_url、mergeSearchResults、paginationError、内联重试模式、搜索目标）见 [glossary-search-pagination.md](./glossary-search-pagination.md)，本表不重复定义。

## 核心术语

| 术语 | 定义 |
|------|------|
| **全局搜索（global search）** | app-lynx 搜索功能的统称：以**底部弹层命令面板**为形态（非路由页），搜索对象为插画 + 小说，从任意内容页唤起。与 webview 的「搜索页（`/search` 路由页面，见 glossary-search-pagination.md）」是**两种形态、同一套 Pixiv 搜索 API 语义**。_Avoid_: 搜索页（webview 专属路由形态，勿混用） |
| **搜索弹层（search sheet）** | 全局搜索的呈现形态：遮罩 + 底部 80vh 面板（标题栏 + 输入框 + 词条区 + 结果区）。**非路由、非页面**——关闭后回到原页；复用评论弹层（`CommentOverlay.vue`）范式：遮罩 `@tap` 关闭、面板 `@tap.stop`、DOM 后置覆盖、`registerModal` 返回键可关（ADR-0066 扩展）。 |
| **词条区（pre-input zone）** | 弹层在**关键词为空**时展示的区域：搜索历史 chips（可单删/全清）。原型中的「热门搜索」区**不落地**（无真实数据源蓝本，webview 搜索页亦无热搜）。 |
| **结果行（search result row）** | 结果区的最小单位：**缩略图 + 标题 + 作者 + 类型/字数** 的单行列表项（list-item），非网格卡片——弹层空间有限，行式替代首页网格卡。 |
| **即输即搜（search-as-you-type）** | 输入触发方式：输入变化后 **300ms debounce** 自动执行搜索、弹层内就地出结果。与「提交式」（回车/按钮才搜，webview 蓝本模式）相对。_Avoid_: 联想（autocomplete）——webview 的 `searchAutocomplete` 未接线，首版不做联想层。 |
| **搜索提交点（search commit point）** | 「即输即搜」下**历史写入时机**：①回车键确认；②点击历史词条；③点击结果行进入详情。三个事件之一发生时关键词才入历史——避免半截输入污染历史（来源：global-search-patterns.md §4.1「仅确认提交时保存」）。 |
| **搜索历史（search history）** | 设备级持久化（`utils/idbKV.ts`，key `search_history`）：仅搜索提交点写入、去重、上限 **10 条**、chips 展示、支持单删/全清。**设备级而非账号级**——搜索历史属敏感数据（HIG），默认不跨引擎同步，不经 SharedPreferences（ADR-0103 契约键仅用于账号级开关）。 |
| **FAB 搜索入口（search FAB entry）** | 全局搜索的唤起入口，**双形态**（用户定案 2026-09-01）：①顶层 tab 页 = 放射 FAB **内环「搜索」项**（与刷新/回顶并列，全局内置项）；②非 tab 内容页 = 放射 FAB **本体即搜索按钮**（直达模式）。 |
| **直达模式（FAB search mode）** | 放射 FAB 在非 tab 内容页的形态：**不展开放射菜单**，FAB 默认形态即为「搜索按钮」（🔍），点按直接展开搜索弹层。是 ADR-0120「可见性门（仅 4 tab 页显示）」的扩展：非 tab 页从『隐藏』变为『搜索态显示』。 |
| **搜索态显示门（search-mode visibility gate）** | `view.mode` 派生规则：`routeState.name ∈ 4 tab 名` → `menu` 模式（放射菜单 + 内环含搜索项）；否则为**内容页** → `search` 模式（FAB=搜索按钮）；否则（**非内容页**）→ 隐藏。 |
| **内容页（content page）** | 可出现搜索 FAB 的路由范围：**除 `/login`、`/update`、`/error` 之外的全部路由**（含详情页、列表页、个人中心等）。排除页为会话/系统页（未登录、强制更新、会话失效），不承载搜索入口。用户意图「所有页面展示」落为「所有内容页展示」。 |
| **双 FAB 竖排堆叠（stacked FABs）** | 非 tab **列表页**（Following/FollowList/Watchlist/Bookmarks/UserHome）已有 RefreshableList 的「feed 分页 FAB」（`bottom-4 right-4` 56dp）。搜索 FAB 与其**同角竖排**（搜索在上、分页在下，M3 多 FAB 布局惯例），两者并存互不遮挡——是「所有内容页都有搜索 FAB」与「保留分页能力」两约束的交集解。 |
| **防竞态轮换（race-guard rotation）** | 即输即搜的竞态防护：debounce 触发后 **abort 上一在途请求**（AbortController 轮换，`useComments.ts` 同款），防乱序响应覆盖新结果；屏蔽 `AbortError` 不报错（global-search-patterns.md §4.3）。 |
| **搜索五态（search states）** | 弹层结果区的状态机：**待输入**（词条区：历史）→ **搜索中**（保留旧结果 + 轻量指示）→ **结果**（行列表 + 分页）→ **无结果**（换词提示）→ **错误**（保留关键词 + 重试）。不合并「未搜索」与「无结果」。 |
| **弹层全局单例（sheet global singleton）** | 搜索弹层只在 **App.vue 挂载一份**（与 GlobalFab 同层、全局 FAB 兄弟节点），开合状态经全局 store 控制——各页面**不**各自 v-if 弹层（区别于 CommentOverlay 的页面内 v-if，因为搜索弹层是全页面级别的全局入口）。 |
| **搜索词内容范围（R18 内容）** | 结果行按既有 `isRestricted()`（settingsStore）判定 R18/R18G 受限态 → 行内遮罩，不预过滤——与列表页（IllustList/FollowList 等）卡片遮罩策略一致。 |

## 边界约定

- **复用不重定义**：SearchScope（全部/插画/小说）、热门排序（popular-preview 端点）、next_url 分页、mergeSearchResults、paginationError / 内联重试模式——全部沿用 [glossary-search-pagination.md](./glossary-search-pagination.md) 定义；app-lynx 蓝本 = webview `Search.tsx` + `api/search.ts`，交互对齐、API 契约一致。
- **全局搜索 ≠ 搜索页**：webview `/search` 是路由页（URL 可深链、scope/sort 入 query param）；app-lynx 是弹层（无 URL、无深链），两者形态不同但共享同一后端语义。
- **FAB 家族三分**：放射导航 FAB（全局导航中枢，tab 页）、搜索 FAB（全局搜索入口，非 tab 页同角堆叠）、feed 分页 FAB（RefreshableList 局部列表操作）；tab 页由放射 FAB 承接后二者合一，非 tab 页三者并存。
- **排除概念**：联想（autocomplete）与热门词首版不做；用户搜索（搜索对象明确为插画 + 小说，无 webview 蓝本先例）；小说正文内查找（独立阅读器功能，非全局搜索）。

# Spec: app-lynx 全局搜索（底部弹层命令面板）

> 状态：ready-for-agent · 关联：ADR-0132 / glossary-app-lynx-global-search / issue #60（差距 #1）· 蓝本：webview `Search.tsx` + `api/search.ts` + `searchStore.ts` · 定案：用户 2026-09-01（变体 A + FAB 双形态入口 + 即输即搜）
> 术语遵循 docs/adr/glossary-app-lynx-global-search.md（**全局搜索 / 搜索弹层 / 即输即搜 / 搜索提交点 / 直达模式 / 双 FAB 竖排堆叠** 等）。

## Problem Statement

app-lynx（Lynx 移动端客户端）没有搜索功能：用户想找特定插画或小说时没有入口，只能切换到 webview 客户端或用外部浏览器——这是 #60 差距清单中剩余的最大缺口（`pages/` 无 Search、`api/` 无 search 模块、router 无 search 路由）。webview 已有完整搜索蓝本，但 app-lynx 用户要求的不止"补个搜索页"，而是"更灵活、全局方便调用"。

## Solution

从任意内容页经 **FAB** 唤起的**底部弹层命令面板**（搜索弹层）：输入即搜（插画 + 小说）、结果就地分页呈现、点结果关层跳详情、历史本地持久化。FAB 双形态入口：顶层 tab 页 = 放射 FAB 内环「搜索」项；非 tab 内容页 = 放射 FAB 本体为搜索按钮（直达模式，与既有 feed 分页 FAB 同角竖排堆叠）。

## User Stories

**入口（FAB 双形态）**

1. 作为用户，我在**推荐/插画/小说/我的**任一顶层页，想搜索时能在放射 FAB（ADR-0120）内环看到「搜索」项，点它即打开搜索弹层，以便全局进入搜索。
2. 作为用户，我在**详情页等非 tab 内容页**（如作品详情、小说详情、用户主页、关注/收藏列表），看到右下角放射 FAB 本体即为**搜索按钮**（🔍），点它**直接**展开搜索弹层（不展开放射菜单），以便任何内容页都能立即搜索。
3. 作为用户，我在非 tab **列表页**（关注/粉丝/收藏/追更/用户作品），看到搜索 FAB 与既有「分页/回顶 FAB」**同角竖排**、互不遮挡，以便搜索结果与列表分页两者都有。
4. 作为用户，我在 `/login`（未登录）、`/update`（强制更新）、`/error`（会话失效）页面**看不到**搜索 FAB，以便会话/系统页不被无关功能打扰。
5. 作为用户，我在非 tab 内容页关闭弹层后，放射 FAB 仍是搜索按钮（不误展放射菜单），以便入口状态稳定。

**弹层交互**

6. 作为用户，我点搜索入口后弹层打开且**输入框自动聚焦**（手机键盘弹出），以便立即输入。
7. 作为用户，我打开弹层时关键词为空，看到**搜索历史 chips**（如有）与输入提示（placeholder「输入标签 / 关键词」），以便快速复搜。
8. 作为用户，我输入关键词后（300ms 防抖）**即输即搜**，弹层内就地出结果；空关键词立即清空结果（不防抖），以便零等待复位。
9. 作为用户，我快速连续输入时，最终只看到**最后一次输入**的结果（在途旧请求被取消、不回填乱序结果），以便结果永远对应我的当前输入。
10. 作为用户，我能切 **scope 全部 / 插画 / 小说**，切换即对当前关键词重新搜索（全部 = 插画 + 小说按时间合并），以便缩小/放宽范围。
11. 作为用户，我能切 **排序 最新 / 最早 / 热门**，切换即重新搜索（热门走独立端点、无分页），以便按需排序。
12. 作为用户，我在结果区看到**行式结果**（缩略图 + 标题 + 作者 + 类型/字数），以便一屏多看几条、扫读正误。
13. 作为用户，我点击结果行 → 弹层关闭 + 跳转对应**作品/小说详情页**，以便一步直达（回到原页时的位置感由导航历史保持）。
14. 作为用户，我滚动到结果底部**自动加载下一页**；加载完显示「没有更多了」，以便连续浏览。
15. 作为用户，我分页加载失败时**已有结果保留**，底部显示内联重试，以便不丢已看内容。
16. 作为用户，我首搜失败时看到**错误提示 + 重试按钮**且关键词保留，以便直接重试。
17. 作为用户，我搜索无结果时看到「没有找到相关内容，试试换一个关键词」，以便知道下一步（去搜索"另一个词"）。
18. 作为用户，我通过遮罩 / 面板「×」/ 系统返回键关闭弹层并**回到原页**，以便在搜索结果与浏览间灵活往返。
19. 作为用户，我按系统返回键时**弹层优先关闭**（比页面返回更高优先），以便符合 Android 弹层惯例。

**搜索历史**

20. 作为用户，我**回车确认 / 点击历史词条 / 点击结果行**时，关键词才被写入历史（输入中间态不写），以便历史里都是完整有效的词。
21. 作为用户，我看到历史**去重、上限 10 条**（最新在前），以便列表不膨胀。
22. 作为用户，我能**单条删除**与**全清**历史，以便掌控隐私。
23. 作为用户，我下次打开弹层（含重启应用）仍能看到之前的搜索历史（设备级 idbKV 持久化），以便连续性。

**内容安全**

24. 作为开启 R18 内容过滤的用户，我看到结果行中 R18/R18G 条目被**遮罩**（与我的开关实时联动，不预过滤），以便与列表页既有策略一致。

**系统一致性**

25. 作为用户，弹层打开时底层页面**不滚动**、关闭后恢复，以便不迷失位置。
26. 作为用户，弹层只存在一份（App.vue 全局单例），多个入口打开的都是同一个弹层，以便状态不分裂。

## Implementation Decisions

> 模块接口以「行为契约」描述（模块名 + 职责/接口），不写具体文件路径。seam 与 `useComments`/`CommentsTransport`（api/comment.ts 导出接口 + 默认实例）同构：**api 层 seam 1 个 + 存储 seam 1 个**。

### D1 数据模块 api/search（新）

- 契约线：`SearchTransport` 接口导出 + `searchTransport` 默认实例（seam，node 单测注入 fake）：
  - `searchIllust(word, sort, searchTarget, signal)` / `searchNovel(...)`：`sort=popular_desc` 路由 `/v1/search/popular-preview/{illust,novel}`（不分页），否则标准端点 `filter=for_ios`；`search_target` 由「关键词含空格 → exact_match_for_tags，否则 partial_match_for_tags」派生（对齐 webview 语义）
  - `searchIllustNext(url, signal)` / `searchNovelNext(url, signal)`：**先断言 next_url host ∈ {app-api.pixiv.net, /pixiv-api 代理路径}（SSRF 防卫，webview assertPixivUrl 先例移植）**，再交由 `apiClient.get(url)`（其内部 rewriteUrl 已执行相对路径归一化，ADR-0057/glossary-search-pagination「相对路径契约」）→ 域名断言失败抛错（warn 可见，不静默）
  - 返回类型复用 `api/types.ts`（PixivIllustListResponse/PixivNovelListResponse，双端共享契约）
- 不实现：autocomplete、热搜、用户搜索（Out of Scope）。

### D2 状态原语 useSearch（新，仿 useComments）

- `useSearch(config?: { transport?: SearchTransport })` → `SearchController`（只读 state 快照 computed 聚合 + 唯一写者，`ref` 内部态，getter 只读；`disposed`/AbortController 轮换与 useComments 同款）
- state 五态：`status: 'idle' | 'loading' | 'ready' | 'error'` + `results` + `hasMore` + `error`（中文文案，`toApiError` 归一）+ `scope` + `sort` + `isSearching`（debounce 窗口内标记）；空态由 `results.length===0 && status==='ready'` 派生（UI 层区分「无结果」与「未搜索」= idle）
- 控制器方法：`search(word)`（输入变化调用：300ms debounce 内层实现 or 组件层实现？→ **控制器内实现 debounce**（测试用 fake timers），keyword.trim() 空 → 立即清空回 idle；触发时 abort 上一请求 + 轮换 AbortController）、`setScope`/`setSort`（关键词存在时重搜）、`loadMore()`（next_url 分页，失败保留列表置 error + paginationError 语义同 useComments loadMore）、`refresh()`（错误态重试）、`reset()`、`dispose()`
- 提交点 → 历史：控制器不写历史（关注点分离）；暴露 `hadCommit`？→ 否——历史写入由 SearchSheet 组件在三个提交点事件处调用历史 store（回车/点历史词条/点结果行）

### D3 历史存储 searchHistoryStore（新）

- ref `history: string[]` + `loadHistory()`（启动/弹层打开时拉取 idbKV key `search_history`，JSON）、`addHistory(word)`（trim 后去重、插头部、slice(0,10)）、`removeHistory(word)`、`clearHistory()`；写失败 warn 可见（`[searchHistoryStore]` 前缀），读失败维持内存态。
- **设备级** idbKV（不经 SharedPreferences；与 R18 账号级契约键无关）。

### D4 弹层开合 searchSheetStore（新，全局单例）

- `isOpen` ref + `openSearch()`/`closeSearch()`；SearchSheet 在 App.vue 挂载一份（`v-if="isOpen"`），打开时 `registerModal(closeSearch)`、关闭时注销（modalStack 返回键拦截，ADR-0066）。

### D5 弹层组件 SearchSheet（新，仿 CommentOverlay）

- 结构（自上而下）：标题栏（「搜索」+ ×）→ 输入行（占位「输入标签 / 关键词」+ 清除 ×）→ 词条区（idle 态：历史 chips + 单删/全清）→ scope 段（全部/插画/小说 chips）→ sort 段（最新/最早/热门 chips）→ 结果区（flex-1 `list`/`list-item` 行式结果；行 = 缩略图 + 标题 + 作者 · 类型/字数 + R18 行内遮罩）
- 状态渲染：idle（词条区）/ loading（保留旧结果 + 顶部轻量指示）/ ready（列表）/ 无结果（换词提示）/ error（关键词保留 + 重试按钮）；分页失败 = 保留结果 + 底部内联重试行
- 交互：遮罩 `@tap` 关、面板 `@tap.stop`、DOM 后置覆盖（App.vue 内排 GlobalFab 之后）；输入/scope/sort 变化 → 控制器；回车 / 历史词条点选 / 结果行点击 = 提交点（写历史）；结果行点击 = `closeSearch()` + `navigate(详情)`；**关闭即重置**（keyword/结果清空，回到 idle；历史保留）
- 键盘：输入自动聚焦（web-core 与原生验证点）；80vh 面板底部输入区不被键盘遮挡（参照 CommentInputBar 既有键盘适配）

### D6 FAB 扩展（createGlobalFab + GlobalFab.vue）

- `FabView` 新增 `mode: 'menu' | 'search' | 'hidden'`（原 visible 布尔扩展）：4 tab 路由 → menu；内容页（除 /login /update /error）→ search；其余 → hidden
- 内环：**全局内置「搜索」项**（kind `'search'`，icon 🔍，label 搜索，固定内环首位；`FabInnerItem.kind` 扩展）
- 命令通道：`FabCommand` 新增 `{ type: 'search' }` → 菜单收起 + 调用注入的 `openSearch()` 回调（deps 注入，纯逻辑可测；默认 no-op + warn）
- 渲染（GlobalFab 薄适配器）：menu 模式 = 现有双层环（内环含搜索项）；search 模式 = 仅主 FAB（🔍 形态，点按 dispatch('search')）；**堆叠偏移**：search 模式下 FAB 位置较 menu 模式上移一档（避开 feed 分页 FAB，间距 ≈ 1.067vw，具体常量实现时按 ADR-0123 锚点核算）
- KeepAlive/路由切换：menu 关闭语义沿用（watch routeState 收菜单）；search mode 无菜单

### D7 范围与安全

- 结果总数/计数器：不做（B 站式「Tab 带计数」仅适用多 Tab 结构；本弹层 scope 是切换式 chips，计数需求低，Spec 定义「不显示计数」——与原型 A 一致；如需计数后续增强）。
- R18：仅展示层遮罩（`isRestricted()` + 行内 RestrictOverlay 缩放复用），结果照常加载。

## Testing Decisions

**什么是好测试**：断言**外部行为**（controller state 快照 / store 内容 / transport 调用参数与次数），不测内部 ref 实现；fake timers 测 debounce；测试注入 fake transport，mock 数据来自真实 API 响应结构（`tests/fixtures` 或 api/types 契约构造，禁止自洽 mock 字段）。

**测试模块（node，vitest，与现有 lynx 测试同目录就近/单测组织）**：

| 模块 | 关键用例 | 先例 |
|---|---|---|
| api/search | popular_desc 路由到 popular-preview；search_target 空格派生；next_url 域名断言（非法 host 抛错、合法/代理路径放行）；成功/失败双路径（错误归一）；列表分页透传 | `api/client.test.ts`（lynx）、webview `tests/unit/api/search.test.ts` |
| useSearch | 即输即搜 debounce（fake timers：连续输入只发最后一次）；AbortController 轮换（旧请求被 abort、返回不回填）；last-write-wins；空关键词回 idle；scope/sort 重搜；分页失败保留结果（paginationError 语义）；错误态 refresh 重试；dispose 后 no-op | `primitives/useComments.test.ts` |
| searchHistoryStore | addHistory 去重/上限 10/最新在前；remove/clear；idbKV 失败降级（内存态 + warn）；读回持久化 | `stores/settingsStore.test.ts` |
| createGlobalFab | mode 派生（menu/search/hidden 三态）；内环含全局搜索项；dispatch('search') → openSearch 注入回调被调 + 菜单关闭；search 模式下非 tab 页现有行为无回归 | `primitives/createGlobalFab.test.ts`（已有）+ `createFabMenu.test.ts` |
| SearchSheet（模板测试） | 五态渲染切片（idle 历史/结果行/无结果/错误重试/分页内联重试）；提交点 × 3 触发历史写入；点击结果 → close + navigate 调用；R18 行遮罩 | `components/ugoiraViewerTemplate.test.ts`、`components/illustTypeBadges.test.ts` |
| searchSheetStore | open/close 幂等；modalStack 注册/注销 | `stores/modalStack` 既有测试 |

**验证闭环（非单测）**：web-core 预览（`PICTELIO_LYNX_DEV=1`）交互闭环 → 模拟器（adb + 截图/像素断言）→ 真机 OPPO R11s 回归（`lynx-flow-check.sh` 补搜索片段或新增 `lynx-search-check.sh`）：重点 = 搜索词 2 个（含中文 + 英文标签）、scope 切 3 态、排序切 3 态、分页两页、历史写入/删除/全清、R18 行遮罩、弹层返回键关闭、双 FAB 堆叠不遮挡。

## Out of Scope

- 用户搜索（差距 #1 定义 = 插画 + 小说；无 webview 蓝本）
- 联想（autocomplete）与热门词（无数据源；webview `searchAutocomplete` 未接线）
- 搜索词 URL 深链 / 路由页面形态（弹层非路由；webview `/search` 不动）
- 小说正文内查找（独立阅读器功能）
- webview 侧任何代码改动（契约共享 = API 端点/参数/响应）
- 结果计数显示、排序次级筛选（按尺寸/标签）、详细搜索选项（解像度/縦横比等 pixiv 官方 2026-04 功能，未要求）
- 详情页顶部放大镜入口（后续增强）
- 搜索结果的收藏/关注快速操作（行式结果点击即跳，不做行内操作）

## Further Notes

- 原型资产：throwaway 分支 `prototype/lynx-global-search`（f07f3fd）的 `PrototypeSearch.vue` 为形态蓝本（3 变体对比），不入 main；交互细节参考 `docs/research/global-search-patterns.md`（已收编实现分支）
- 已知坑（实现时先读）：ADR-0053（NativeModule callback 无 null）、ADR-0055/0056（list、text/tap、item-key String、number v-bind）、glossary-web-core-pitfalls、ADR-0066（modalStack 返回键）、ADR-0120/0123（FAB 锚点/hit-testing）、ADR-0108（keyframes 动画）
- 双端一致性：本 spec 全部 API 契约与 webview `api/search.ts` 逐字对齐（端点、参数、`filter=for_ios`、popular-preview 路由、next_url 断言），改契约须同步 ADR

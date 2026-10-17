# ADR-0132: app-lynx 全局搜索（底部弹层 + FAB 双形态入口）（底部弹层命令面板 + FAB 双形态入口）

- 状态：accepted（编号修订 2026-09-01：原 ADR-0131 与内容区尺寸契约撞号，改 0132；决策 4 修订 2026-10-16：搜索范围新增「用户」第四档，推翻「无用户搜索」，见文末「修订（2026-10-16）」；决策 4 再修订 2026-10-17：搜索目标改用户可选档位，删除含空格 → exact 派生，见文末「修订（2026-10-17）」；同日起按外部锚点一手实测做**证据订正**（非行为变更）：用户端 `search_target` 由「不消费」订正为「枚举校验、任何取值皆 400 ⇒ 必须不发」；档位映射的**理由**降级为未证实（映射不变）；缓存键条目由「正确性硬要求」改口为「前瞻性接线」；**小说端 `title_and_caption` 由「不识别（推断，未实测）」订正为「实测被拒（HTTP 400）」——置灰保值挡的是一次 400，放宽需显式决策**）
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

4. **搜索范围与排序 = 对齐 webview 蓝本**：scope **全部 / 插画 / 小说 / 用户**（全部 = `mergeSearchResults` 混合时间线；用户 = `/v1/search/user` 独立端点，单类型不混排）；排序 **最新 / 最早 / 热门**（热门走 `/v1/search/popular-preview/{illust,novel}` 端点，不分页）。~~**无用户搜索**（差距清单定义 + webview 无先例）~~ —— **2026-10-16 推翻**（原句原样保留划线，推翻理由与一手证据见文末「修订（2026-10-16）」）。~~搜索目标 `search_target` 沿用 `partial_match_for_tags` / 含空格转 `exact_match_for_tags` 派生规则（复用 webview 语义；**用户端点不发该参数**）。~~ —— **2026-10-17 推翻**（派生规则作废、改用户可选档位；**用户端点不发该参数**这半句仍然成立，见文末「修订（2026-10-17）」）。

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

## 修订（2026-09-12，wayfinder #474 → spec `docs/specs/search-advanced-filters.md`）

- **第 8 条修订**：lynx `src/api/search.ts` 与 webview 的「逐字对齐」契约升级为**参数构建单点共享**——新增共享包 `@pictelio/search-core`（筛选状态 → 请求参数 / URL 编解码 / 缓存键的零 IO 纯函数，先例 `@pictelio/update-check` 双端共用），两端 `api/search.ts` 降级为同构薄传输层（fetch/代理 + `next_url` 域名断言）。逐字镜像约定对该文件不再适用；仓库其余镜像/差分约定不变。
- **第 4 条行为更新**：`search_target` 派生规则以 spec `docs/specs/search-advanced-filters.md` §6.1 为准（illust 端 partial 场景**不传**该参数以并入标题命中（Shaft #906）；novel 端恒显式传；~~含空格多标签仍传 `exact_match_for_tags`~~ —— 该分句 2026-10-17 作废，含空格不再触发 exact 派生，见文末「修订（2026-10-17）」；该行对 Shaft #906 依据的置信度亦已于 2026-10-17 随一手实测降级，映射不变），并恒发 `merge_plain_keyword_results=true` / `include_translated_tag_results=true`。
- 依据：双端搜索高级筛选 spec（用户终审通过 2026-09-12，#475~#480 全闭）。

## 修订（2026-10-16，issue #1023 → spec `docs/specs/search-user-scope.md`）

- **第 4 条推翻**：「**无用户搜索**」作废，搜索范围由三档改为四档 **全部 / 插画 / 小说 / 用户**（用户 = `/v1/search/user` 独立端点，单类型不混排）。原句在 §4 中划线保留，不抹改。
- **原理由已不成立**：原文写的「差距清单定义 + webview 无先例」是**内部对齐**（issue #60 差距清单未列该项 + 被参照的 webview 蓝本没有），**不是官方能力边界**。拿内部对齐结论当「不做」的理由，本身就是这次推翻的根因。
- **官方产品面确有用户搜索**：pixiv 官方帮助中心 article `235646387`「pixivで作品を検索する方法を知りたい」的【ユーザー検索】节原文「検索結果のページ内にある、[ユーザー]のタブを選択してください。」。2026-10-16 经 Zendesk HC API v2 复核（`https://www.pixiv.help/api/v2/help_center/ja/articles/235646387.json`，注意网页版 `/hc/ja/articles/...` 在本环境被 Cloudflare 403 拦，API 路径可用）。
- **第三方共识**：spec `docs/specs/search-user-scope.md` §1 记录的六个第三方客户端（Pixiv-Shaft / Mako / PixivBiu / pixez / Pixiv-SwiftUI / pixivpy）全部实现用户搜索；其中 pixez `getSearchUser` 与 Mako `UserSearchEngine` **只发 `filter` + `word`**，与本仓 `buildUserSearchRequest` 的参数口径同款。
- **端点响应面已一手实测**（2026-10-16，脚本 `docs/research/verify-search-user-api.sh` + fixture `packages/app-lynx/src/api/__fixtures__/search-users.json`）：顶层键只有 `user_previews` / `next_url`；`PixivUser`（4 必填）/ `PixivIllust`（15）/ `PixivNovel`（11）在实测样例中**零必填字段缺失**，故不新造这三种类型。`user` 是**轻量对象无 `profile`**，术语与坑见 `docs/adr/glossary-search-pagination.md`「用户搜索范围」。
- **第 4 条其余部分不变**：三档排序、三个既有端点、`mergeSearchResults` 混排；**用户端点必须不发 `search_target`**——2026-10-17 一手反向实测订正：该端点对它做**枚举校验**，传任何值一律 **HTTP 400**，而不相关的未知参数名（`foo=bar`）**200 且结果不变** ⇒ 它是校验已识别参数、忽略未识别参数，**不是「不消费」**（本轮原文写「不消费 `search_target` 与任何筛选参数」，其中 `search_target` 一半方向危险，已订正）；**其余筛选参数不发**的依据是实测未发 + 第三方实现同款，**尚未做反向实验**（见 `docs/specs/search-advanced-filters.md` §3.2 / `docs/specs/search-user-scope.md` §5.1）。~~`search_target` 派生规则原样保留~~ —— 该分句 2026-10-17 作废，见文末「修订（2026-10-17）」。
- 配套：术语 `docs/adr/glossary-search-pagination.md` / `packages/app-lynx/CONTEXT.md` §搜索「用户搜索范围」。

## 修订（2026-10-17，issue #1025~#1028 → spec `docs/specs/search-target-mode.md`）

- **第 4 条再修订（搜索目标）**：~~沿用 `partial_match_for_tags` / 含空格转 `exact_match_for_tags` 派生规则~~ 作废——`search_target` 改由**用户可选档位** `SearchTargetMode`（`partial` / `exact` / `title_and_caption`）决定，两端查表映射且**不对称**（spec `docs/specs/search-target-mode.md` §4）：插画端 `partial` → **整个参数不传**；小说端 `partial` → **显式发**；小说端 `title_and_caption` → **实测被拒（HTTP 400）**，UI 置灰、值保留不发。`word.includes(" ")` 派生两侧一并移除。
  - ⚠️ **「小说端 `title_and_caption`」由「不识别」升级为「实测被拒」，措辞方向不同**（2026-10-17 一手实测，交错 2 轮逐位一致，端点 `/v1/search/novel`、`word=東方`）：省略 `search_target` → **200 / 30 条**；显式发 `search_target=title_and_caption` → **HTTP 400 / 0 条**；`search_target=partial_match_for_tags` 与未知参数名 `foo=bar`（对照）均 **200 / 30 条**。对照组说明**不是「参数名不被认识所以忽略」而是服务端明确拒绝该取值**（未知参数名 200 且结果不变，与用户端 `/v1/search/user` 对同参数的硬拒同性质）⇒ 早期「不识别属推断（未实测）」**低估了后果强度**（旧推断证据 Mako `SearchNovelTagMatchOption` 只有 partial/exact/text/keyword + 官方帮助中心未列该档，**保留作历史留痕**）。
  - ⚠️ **后果强度（决定了这条不能当 UI 细节随手改）**：置灰保值挡的不是「结果不准」这类体验问题，而是「**每一次小说搜索直接 400 失败**」——一旦 UI 置灰逻辑哪天回归、请求层开始真发这个参数，scope=novel 的搜索会整片报错。⇒ **放开这一档需要一次显式决策**。取证脚本 `docs/research/verify-novel-title-target.sh`（可复跑），一手记录 `docs/research/pixiv-query-syntax-verified-2026-10.md` §4。
  - **映射不变，但理由已按 2026-10-17 一手实测降级**（三条依次对应下述三条事实）：
    - **插画端 partial 不传 = 保守选择，不是已证实的必需**。初稿理由「不传 ≡ partial 并入标题命中；显式传 partial 反而做严格标签匹配并忽略 `merge_plain_keyword_results`（Shaft #906）」出自**第三方源码推断，本次一手实测未复现**：omit / 显式 partial / `merge_plain_keyword_results=true` / 两者并用四组组合 × 3 个检索词（東方 / 初音ミク / `Rosmontis rosemary`）× 2 轮**交错**采样共 12 次比对，ID 序列 **md5 完全相同**。决定性一条：多词 `Rosmontis rosemary` 在 omit 与显式 partial 下**同为 4 条**，而 exact 是 1 条——若显式 partial 真会触发严格标签匹配，此处应退回 1 条。映射维持 `partial → null`（无害、保守、与既有第三方实现同款），但**不得再断言「显式发会坏行为」**；Shaft #906 保留为「第三方源码推断，本次未复现」。
    - ⚠️ **方法论警告（与该结论同在，勿删）**：插画端结果集**随时间漂移**（同一查询连续采样 md5 即变，首位 ID 从 150944641 漂到 150944731，秒级内稳定）。任何「A/B 序列相同/不同」的断言**必须交错采样**——顺序采样会产生方向完全相反的假差异（本次实测首轮即中招）。
    - **小说端 partial 必须显式发：映射方向可信，但该机制本次未能证实**。#1038 的「不传退化为纯字面匹配、同义词不展开」未复现，实测差异幅度小（東方 2/30 互换、初音ミク 6/30、冴えない彼女 0/30），量级远小于该主张所暗示的。凡依赖此**理由**的表述须标注置信度；依赖**映射**（显式发）的实现不动。
- **行为变更（默认档下多词查询的结果集变化）**：默认档 `partial` 下含空格**不再**发 `exact_match_for_tags`，改为不传该参数 ⇒ 服务端并入关键字/标题命中。实测 `Rosmontis rosemary`：exact 1 条 / partial 4 条（spec `docs/specs/search-target-mode.md` §5）。空格 = AND 的语义不变（`verify-query-syntax.sh` 实测服务端解析 `AND`/`OR`/负号/括号）。按测试硬约束 #4，这属**既有查询的结果集变化**，已在 commit message 与发布说明标注。
- **档位进缓存键 = 前瞻性接线，不是当前正确性要求**：`buildCacheKey` 加 `ft=` 段——默认档 `partial` **不落键**（与未设档同键），非默认落 `ft=exact` / `ft=title_and_caption`；段**追加在末尾**，存量非默认筛选的键逐字不变，升级不撞旧缓存（spec `docs/specs/search-target-mode.md` §6，`cacheKey.ts`）。`buildCacheKey` 现**零生产消费方**——webview 侧 `inFlightSearchKey` 随 ADR-0203 删除，本 ADR 决策 3 与 `useSearch.ts` 亦写明「搜索结果全局 LRU 缓存不做」⇒ 今天不存在会被弄脏的缓存。**本条此前写作「正确性硬要求」，与 `cacheKey.ts` 头注释、spec `docs/specs/search-advanced-filters.md` §6.2、spec `docs/specs/search-target-mode.md` §6 三处已改口的「前瞻性接线」正面矛盾**——ADR 是「理由」层的最高事实源，留着旧措辞会让下一个读本 ADR 的人得出「缺 `ft=` 段是线上 bug」的错误结论。键形态与「筛选进键」纪律仍按该 §6 维护：缓存日后重建时接线即自动正确，search-core 侧无需回头改。
- **本次修订只动 `search_target`**：四档 scope、三档排序、端点路由（含 `/v1/search/user` 三档 sort 直发）、`mergeSearchResults` 混排、`merge_plain_keyword_results=true` / `include_translated_tag_results=true` 恒发，全部维持 2026-10-16 修订后的状态。
  - ⚠️ **恒发两个 bool 的效力已降级**（2026-10-17 一手实测）：`merge_plain_keyword_results` 在 illust / novel / user **三端**传 `true` / `false` / 不传，结果**都不变**——无可观测效果；illust 端对非法值 `zzz` 400（校验枚举），novel 与 user 端静默接受。「三端行为一致」成立，但「恒发 `true` 有用」**未被证实**。**恒发行为保持不变**（无害 + 对齐第三方 + 零 diff），此处只降级声明强度。
- **第 8 条动作不变**：参数构建仍单点共享 `@pictelio/search-core`（本修订落在 `buildParams.ts` 的两张档位映射表 + `SearchFilters.target`），无需再次修订第 8 条。

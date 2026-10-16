# Spec: 搜索范围新增「用户」（app-lynx 搜索弹层第四档）

- 状态：implemented（2026-10-16 实施；门禁 check:all / lint:all / test:all 全绿 + 双轴 code-review。遗留：模拟器批次与 E2E 见 #1024）
- 日期：2026-10-16
- 关联：ADR-0132（app-lynx 全局搜索，§4「无用户搜索」本 spec 推翻）/ ADR-0090 前的 0009-search-feature.md §11「不做的（MVP）：用户搜索」/ `docs/adr/glossary-search-pagination.md` / `docs/specs/search-advanced-filters.md` / 研究 `docs/research/verify-search-user-api.sh`（一手取证脚本）
- 工单：#1019 search-core 参数构建 · #1020 api 层与契约测试 · #1021 useSearch 控制器 · #1022 搜索弹层 UI 与 i18n · #1023 ADR/术语落档 · #1024 模拟器批次与 E2E（挂账）

## 1. 背景与目标

搜索弹层的**搜索范围（SearchScope）** 现为「全部 / 插画 / 小说」三档。用户搜不到作者——`/v1/search/illust` 的 `word` **只认标签**（`docs/adr/ADR-0197-app-lynx-tag-neighbors.md` §更正记录，2026-09-27 实测：纯画师名 0 条）。

**官方产品面有用户搜索**：pixiv 帮助中心 article `235646387` 原文「検索結果のページ内にある、[ユーザー]のタブを選択してください」。

`ADR-0132` §4 记「无用户搜索」，理由是「差距清单定义 + webview 无先例」——**这是内部对齐，不是官方能力边界**。六个第三方客户端（Pixiv-Shaft / Mako / PixivBiu / pixez / Pixiv-SwiftUI / pixivpy）全部实现了它。

本 spec 交付第四档搜索范围：**用户**。

## 2. 非目标

- **不做**搜索目标（`search_target`）用户可选化、`keyword` 档、小说端空结果降级重发、`content_type` 作品类别、查询语法（`-` / `OR` / 括号）——均为独立票（调研结论见本 spec §9）。
- **不做**搜索联想 `/v2/search/autocomplete`、趋势标签 `/v1/trending-tags/illust`——独立功能非修 bug。
- **不做**画师主页的标签高级搜索、以图搜图——与搜索链路无关。
- **不做**画师榜（排行榜维度）。
- 用户主页 `/user/:id` **已存在**，本票不改其任何行为。

## 3. 一手取证（2026-10-16 实测）

脚本：`bash docs/research/verify-search-user-api.sh`（前置：代理 127.0.0.1:7897 + `packages/app-lynx/.env` 的 `PIXIV_REFRESH_TOKEN`）。

```
GET https://app-api.pixiv.net/v1/search/user?word=<名>&filter=for_ios&sort=date_desc
```

实测响应顶层键：`['next_url', 'user_previews']`

`user_previews[0]` 键：`['illusts', 'is_muted', 'novels', 'user']`

### 3.1 关键事实一：三种现有类型零缺失覆盖

fixture：`packages/app-lynx/src/api/__fixtures__/search-users.json`（4 条，`WORD=水上`，各条 illusts/novels 各取前 2）。

| 现有类型 | 必填字段数 | 实测缺失 |
|---|---|---|
| `PixivUser` | 4 | **无** |
| `PixivIllust` | 15 | **无** |
| `PixivNovel` | 11 | **无** |

→ **不新造这三种类型**。唯一新增类型是 `PixivUserPreview`。

### 3.2 关键事实二：`user` 是**轻量对象，无 `profile`**

实测 `user_previews[0].user` 键：`['account', 'id', 'is_accept_request', 'is_access_blocking_user', 'is_followed', 'name', 'profile_image_urls']`

**无 `profile`**——即无 `total_follow_users` / `total_illusts` / `total_followers`（那些只在 `/v1/user/detail` 有）。

→ 用户行**不得**渲染粉丝数/作品数。若要这些数必须二次请求 `getUserDetail`（本票不做，列入 §7）。

`profile_image_urls` 实测**只有 `medium`** 一个键（无 `px_16x16` / `px_50x50` / `px_170x170`）。

→ 头像只取 `medium`。`UserRow.vue` 既有写法 `medium || px_170x170` 的回退分支在此**永远走不到 medium 之外的分支**，属无害冗余，不改。

### 3.3 关键事实三：预览小说 `image_urls` 无 `original`

实测 `novels[0].image_urls` 键：`['large', 'medium', 'square_medium']`——无 `original`。

→ `PixivIllustImageUrls.original` 已是可选，直接兼容。缩略图一律走 `square_medium`。

### 3.4 关键事实四：用户端点**完全忽略** `sort`（2026-10-16 实施期补测）

对 `date_asc` / `date_desc` / `popular_desc` 三档，各取 3 个检索词（`水上` / `柊` / `凛` / `蒼`）
请求 `/v1/search/user`，对比返回的 `user_previews[*].user.id` 序列：

| 检索词 | date_asc | date_desc | popular_desc |
|---|---|---|---|
| 柊 | 519963, 91705072, … | 同左 | 同左 |
| 凛 | 46624621, 37062, … | 同左 | 同左 |
| 蒼 | 30612000, 4065575, … | 同左 | 同左 |

→ 三档返回**逐位相同**的序列，服务端不接受排序语义（且不报 400，三档都返回 200 + 30 条）。

**推论**：spec 初稿「排序 chip 保留三档」是错的——那会给出三个点了没反应的控件。
已改为与筛选折叠区一并隐藏（§5.4 决策 4）。请求侧仍照发 `sort`，无害且日后生效即自动对。

复跑：`bash docs/research/verify-search-user-api.sh`（改 `SORT` 变量）。

## 4. 领域模型

```ts
// packages/app-lynx/src/api/types.ts
// ⚠️ 实施订正（2026-10-16）：PixivUserPreview **在 HEAD 已存在**，被 /v1/user/mypixiv
// 与 /v1/user/following 消费（ADR-0193）。同名类型无法重复声明，故实现未新建，
// 而是**收窄既有类型的 novels 元素类型** unknown[] → PixivNovel[]（可选性保留，
// user.test.ts 的「无 novels 也要能构造」编译期防线不可收紧）。
// 收窄 blast radius：全仓生产侧 `.novels` 读点仅 SearchSheet.vue 一处；
// mypixiv/following 侧零消费，且其 fixture 的 novels 是空数组（无元素证据）——
// 该证据边界已登记在 types.ts 的类型注释里。
export interface PixivUserPreview {
  user: PixivUser;              // 轻量：实测无 profile（§3.2）
  illusts: PixivIllust[];       // 实测完整 illust 形状，零缺失
  novels: PixivNovel[];         // 实测完整 novel 形状，零缺失（image_urls 无 original）
  is_muted: boolean;
}

export interface PixivUserSearchResponse {
  user_previews: PixivUserPreview[];
  next_url: string | null;
}
```

`SearchScope` 加 `"user"`——**两处同名字符串联合都要改**，它们是既有镜像：
`packages/search-core/src/buildParams.ts` 的 `SearchScope` 与 `packages/app-lynx/src/api/types.ts` 的 `SearchScope`（交付态行号见各文件；tsc 会强制两处同改，改一处漏一处即编译红）。

`SearchResultItem` 加第三个成员：

```ts
| { type: "user"; entity: PixivUserPreview; date: null }
```

`date` 恒为 `null`——用户没有 `create_date`，该字段只为 `mergeSearchResults` 的时间线排序存在。**用户行不参与混排**（scope=user 是单一类型，无需混排）。

## 5. 架构

### 5.1 search-core（参数构建单点，守 ADR-0132 修订条目）

`packages/search-core/src/buildParams.ts`：

```ts
export type SearchEndpointPath =
  | "/v1/search/illust" | "/v1/search/novel" | "/v1/search/user"
  | "/v1/search/popular-preview/illust" | "/v1/search/popular-preview/novel";

export function buildUserSearchRequest(input: {
  word: string; sort: SearchSort;
}): BuiltSearchRequest;
```

参数口径（**实测 + pixivpy L576-596 佐证**）：

| 参数 | 值 | 依据 |
|---|---|---|
| `word` | 搜索词 | 实测 |
| `filter` | `for_ios` | 与另两端一致（`baseParams` 同款） |
| `sort` | 直发 | pixivpy `search_user` 有 `sort` 形参 |

**不发**：`search_target`、全部筛选参数（`bookmark_num_*` / `ratio_pattern` / `width_*` / `start_date` / `end_date` / `search_ai_type`）——用户搜索端点不消费这些。**证据强度**：实测未发这些参数且响应正常 + 第三方实现（pixez `getSearchUser` 只发 `word`；Mako `UserSearchEngine` 只发 `filter` + `word`）。⚠️ 未做「发了会不会报错」的反向实验——按不消费处理，若将来发现服务端接受，属增强不属修复。

`cacheKey.ts` 无需改动：`${word}_${scope}_${sort}` 对 `"user"` 天然成立。

### 5.2 api 层（薄传输）

`packages/app-lynx/src/api/search.ts`：

```ts
export function searchUser(word, sort = "date_desc", signal?): Promise<PixivUserSearchResponse>
export function searchUserNext(url, signal?): Promise<PixivUserSearchResponse>
```

`searchUserNext` **必须复用现有 `assertPixivUrl`**（`search.template.test.ts` 源级守卫：禁 `new URL(`、必须走 `extractHostname`、失败必须 `console.warn`）。

`SearchTransport` 接口加这两个方法——⚠️ 这是**接口扩展**，`useSearch.test.ts` 里的内存替身必须同步补方法，否则 tsc 报错（这是有意的编译期护栏，不要用可选方法绕过）。

### 5.3 控制器

`useSearch.ts` 的 `executeSearch` 增 user 分支：

- `scope === "user"` → **只**发 `searchUser`，不发插画/小说请求
- `buildResults` 增 user 分支：原样映射 `{ type: "user", entity, date: null }`，**不经收藏数兜底**（用户无 `total_bookmarks`）
- `loadMore` 增 user 游标：单游标推进
- 部分失败降级：scope=user 是单路，失败即 `status = "error"`，走既有错误态（不新增告警分支）

### 5.4 UI

`SearchSheet.vue`：

1. **scope chips 加第 4 个「用户」**（静态写出，沿用既有 a11y 标注模式，不用 v-for）
2. **用户结果行**（新增分支，与既有插画/小说行并列）：
   - 头像：`profile_image_urls.medium` → `proxyImageUrl`
   - 主标题：`user.name`；副标题：`user.account`
   - 预览缩略图：`illusts` 优先、不足则补 `novels`，最多 3 张，`square_medium`
   - **R18 处理**：预览项 `x_restrict > 0` → 该缩略图渲染 scrim 占位（不渲染图）。**理由**：本仓 R18 策略是行内遮罩（`isRestricted`），预览图绕过遮罩会泄露受限内容
   - 点行 → `navigate('/user/' + user.id)`；**不进 heroTransition**（无插画 id 可测）
3. **scope=user 时隐藏筛选折叠区**（五个维度都是插画/小说概念，用户端点不消费）——`v-if` 挂在筛选开关那一行
4. **排序 chip 同样隐藏**（与筛选折叠区同一个 `v-if`）：**一手实测用户端点完全忽略 `sort`**
   ——`date_asc` / `date_desc` / `popular_desc` 三档在 3 个检索词下返回**完全相同的 ID 序列**
   （见 §3.4）。留着 chip 就是给用户一个点了没反应的三选一控件，故隐藏。
   请求侧仍照发 `sort`（端点忽略它，无害；若 Pixiv 日后开始消费即可直接生效）。

`visibleResults` 的 AI 过滤与标签静音：`settings.isAiWork(entity)` / `isTagMuted(entity)` 对 `PixivUserPreview` **不适用**（无 `illust_ai_type` / `tags`）。

→ **决策**：user scope 下 `visibleResults` 直接透传 `rawResults`，跳过这两个过滤器。在 `visibleResults` 里按 `row.type === 'user'` 分支处理，并在该分支**不调用** `isAiWork`/`isTagMuted`（避免运行时 undefined 访问）。

## 6. 契约变更

| 变更 | 内容 |
|---|---|
| 请求 | 新增 `GET /v1/search/user?word&filter=for_ios&sort` |
| 分页 | user scope 走该端点自身 `next_url`，单游标 |
| 类型 | 新增 `PixivUserPreview` / `PixivUserSearchResponse`；`SearchScope` 两处加 `"user"`；`SearchResultItem` 加 user 成员 |
| **ADR-0132 §4 推翻** | 「无用户搜索」→「搜索范围四档：全部/插画/小说/用户」，并注明推翻理由是官方产品面存在 + 第三方共识（附 pixiv.help article 号） |
| 0009-search-feature.md §11 | 该文件是历史存档（WebView 客户端时代），**不改**（ADR-0203 已删该客户端） |

## 7. 已知取舍

- **用户行不显示粉丝数/作品数**：`user` 无 `profile`（§3.2 实测）。要显示须二次 `getUserDetail`，本票不做。
- **不实测 `popular_desc` 在用户端点的行为**：pixivpy 有该形参，但 pixiv 官方排序对非会员限定的历史结论未覆盖用户端点。scope=user + 热门排序若 400，走既有错误态（关键词保留 + 重试），不静默降级。
- **预览最多 3 张**：超过部分不可达；`/user/:id` 是完整出口。
- **`is_muted` 字段不消费**：本仓有静音体系（ADR-0187 标签静音 / 用户静音），但语义边界未查清（muted 用户是否仍应出现在结果里），本票**只透传不消费**，列入后续。

## 8. 测试与验收（oracle 溯源）

1. **search-core**：`buildUserSearchRequest` 真值表（端点 + 参数集合 = `{word, filter, sort}`，断言**不含** `search_target` / `bookmark_num_min`）；`buildCacheKey(word, "user", sort, DEFAULT)` = `word_user_sort`。
   oracle = 本 spec §3 实测请求 + pixivpy L576-596。
2. **契约测试**（测试硬约束 2）：用 `__fixtures__/search-users.json` **真实样例**反序列化，断言 `user_previews[0].illusts[0]` / `user` / `novels[0]` 的必填字段全部存在——**锁死 §3.1 的「零缺失」结论，防止后续误删类型字段**。
3. **api 层**：`searchUser` 产出的代理路径断言；`searchUserNext` 域外 URL 抛错 + `console.warn`（沿用 `search.test.ts` 既有差分测试形态）。
4. **控制器**：`useSearch.test.ts` 扩 scope=user 用例——只发用户请求不发插画/小说、loadMore 走单游标、空结果判空、`dispose` 后 no-op。**必须同步给测试替身补 `searchUser`/`searchUserNext`**。
5. **门禁**：`pnpm check:all` + `pnpm test:all` + `pnpm lint:all` 全绿。
6. **模拟器批次 + E2E 挂账到 #1024**：本票只做自动化门禁与源级契约断言。
   设备取证（用户行渲染、R18 预览 scrim 的真机效果、`<list>` 内行类型分支不触发 ADR-0162 三态）
   与 E2E 用例统一由 #1024 承接。

## 9. 后续候选（本票外）

- 搜索目标用户可选 + `keyword` 档（调研：六个客户端 3-4 档，本仓 2 档自动派生）
- 小说端空结果降级重发（Shaft `withTitleFallback`）
- `content_type` 作品类别五档
- 查询语法 `-` / `OR` / 括号 / 全半角补全（**须先实测 app-api 是否透传**）
- 搜索联想 `/v2/search/autocomplete`、趋势标签 `/v1/trending-tags/illust`
- 用户搜索结果二跳填充 `profile`（粉丝/作品数）
- ~~补测 `date_asc`/`popular_desc`~~ **已在本票实施期实测完**（§3.4，结论：端点忽略 sort）

## 10. 证据强度

- `/v1/search/user` 响应面：**一手实测**（2026-10-16，脚本 + fixture 可复跑）
- `sort` 参数在用户端点：pixivpy 源码佐证 + 实测 `date_desc`
- 不发其余筛选参数：实测未发 + 三个第三方实现同款；⚠️ 未做反向实验（发了是否报错）
- fixture 裁剪：已提交的是裁剪版（4 条预览，各数组取前 2），覆盖 8 个 illust + 4 个 novel 元素；
  取证脚本默认只打印 `user_previews[0]` 的键，故 §3.1「零缺失」的**原始**取证面是第 0 条，
  裁剪版把覆盖面扩大到 4 条（增强，非失真）
- `sort` 用户端点行为：**已实测**（§3.4）——三档返回同一 ID 序列，端点忽略排序

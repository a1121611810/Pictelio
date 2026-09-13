# Spec: 排行榜（插画榜；双端：app webview + app-lynx）

- 状态：draft（2026-09-13 定稿于 Grill 12 项裁决 + 缝确认；待 `to-tickets` 拆票）
- 日期：2026-09-13
- 关联：原型归档 commit `58170a2b`（入口形态 A/B/C 与 ①/②/③）、`6a2b20fc`（范围层级 S1/S2/S3）；入口形态与范围均已在原型上裁决
- 端点事实：`/v1/illust/ranking`（**非** `/v1/ranking/illust`），响应顶层 `illusts` + `next_url`，条目**无 rank 字段**，单页 30 条
- 工单：spec #待建 / 拆票见 `to-tickets`

## 1. 背景与目标

排行榜是本项目功能差距盘点的**最后一个 P0**（P0-1）：竞品 7/7 均具备（pixez、Pixiv-Shaft、Pixeval、pixiv-viewer、Pix-EzViewer、PixivBiu、PBD），而本仓库两端源码 `grep ranking` 零命中。

官方 App API `/v1/illust/ranking`（`mode` + `date`）可直接复用现有认证、分页与图片流水线。本 spec 的目标是**在不新增导航分类的前提下**把排行榜融进推荐流：

- **webview**：推荐 Feed 顶部注入横滑条入口（与既有「相关作品注入行」同形态）
- **lynx**：插画页推荐 tab 顶部注入「榜首编辑大卡」（App Store Today 风：第 1 名全幅背景 + 信息叠加 + 右侧 2/3 名缩略）
- **两端共用**一个独立榜单页（新路由 `/ranking`）：7 档维度切换 + 按日期回看 + 无限滚动

## 2. 非目标（Out of Scope）

- **小说榜**：`/v1/novel/ranking` 端点存在，但（a）lynx 入口宿主是插画页、小说在独立的 `NovelList` 页，需另开一个入口；（b）小说榜 mode 集不同（无 `month`/`week_original`，另有 `day_r18`）。→ 挂账后续。
- **扩展维度**：性别偏好（`day_male`/`day_female`）、漫画 3 档（`day_manga`/`week_manga`/`month_manga`）、AI 榜（`day_ai`/`day_r18_ai`）、`week_rookie_manga`、`day_r18_manga` 等。UI 是一维 chip 行，扩维会撑爆窄屏。
- **lynx 日历选择器**：lynx 无原生 date input（见 §8 事实），自研月历成本高且与 `search-advanced-filters` 已拍板的 lynx 裁剪口径（「自定义起止日期为 webview 专属，二期补 UI」）冲突。→ lynx 本期只做箭头步进。
- **名次变化/趋势**：API 响应无 `rank` / `previous_rank` 字段，名次只能由 offset + 下标推得，做不了「较昨日 +3」。
- **特辑 Spotlight / PixiVision / 全站最新**：差距报告列为 P2，另议（可能的形态同样是推荐页顶部入口，但与本 spec 无关）。
- **榜单数据预取/离线**：不接入首页空闲预取（`scheduleIdleFeedPrefetch`），避免为次要入口增加启动网络开销。
- **详情页相关区、榜单条目长按菜单、榜单分享**。

## 3. 领域模型

### 3.1 术语

| 术语 | 定义 |
|---|---|
| **榜单维度（mode）** | 服务端榜单种类。本 spec 固定 7 档，**档位即 mode**（不做「期间 × R-18」二维展开） |
| **榜单日期（date）** | `YYYY-MM-DD`；缺省 = 服务端当日（JST）。「今日」= 未传 `date` |
| **入口（entry）** | 推荐流顶部注入的排行榜入口。webview = 横滑条；lynx = 榜首大卡。固定「日榜 · 今日」，不随榜单页的选择变化 |
| **榜单页** | 新路由 `/ranking`。承载维度切换、日期回看、无限滚动榜单 |
| **名次（rank）** | `offset + index + 1`（服务端不返回名次字段）。跨页累加，**不因客户端过滤而重编号** |
| **受限条目** | 被账号级设置（`showR18`/`showR18G`/AI 三态）或屏蔽列表命中的条目。各端沿用自己的既有口径处理（见 §5.6） |

### 3.2 维度目录（单一事实源）

| # | 展示 | 服务端 `mode` | 备注 |
|---|---|---|---|
| 1 | 日榜 | `day` | 默认档 + 入口固定档 |
| 2 | 周榜 | `week` | |
| 3 | 月榜 | `month` | 仅插画榜有 |
| 4 | 新人 | `week_rookie` | |
| 5 | 原创 | `week_original` | |
| 6 | R-18 | `day_r18` | 需账号在 pixiv 网页端开启「显示 R-18 作品」 |
| 7 | R-18G | `week_r18g` | 同上；**服务端仅此一档**（无日榜 R-18G），故 R-18 取日榜、R-18G 取周榜的不对称是服务端 mode 目录决定的，非笔误 |

> 该目录来自三个独立实现的并集核实（pixivpy3 `aapi.py`、Pixiv-Shaft `FragmentRankIllust.java`、pixiv-tiny-api），并对照官方帮助页（デイリー/ウィークリー/マンスリー/ルーキー/オリジナル/R-18/R-18G）。

### 3.3 数据形状（来自原型，编码了「名次 + 过滤 + 展示降级」三个决策）

```ts
/** 榜单条目（渲染用；名次由 offset+index 推得，不由服务端给出） */
interface RankEntry {
  rank: number;          // offset + index + 1，跨页累加，不因过滤重编号
  illust: PixivIllust;   // 复用既有作品类型，直接喂现有卡片/图片流水线
}

/** 入口展示项（webview 横滑条取首屏前 20；lynx 大卡取前 3） */
interface RankingEntryItem {
  rank: number;
  title: string;
  author: string;
  bookmarks: number;
  thumbUrl: string;      // 必须经 /pixiv-img/ 代理（原生 WebView 只对代理路径注入 Referer，裸 pximg 会 403）
}

/** 榜单页查询标识（缓存键 / 请求参数的单点来源） */
interface RankingQuery {
  mode: RankModeId;      // §3.2 的 7 档之一
  date: string | null;   // null = 今日（不传 date 参数）
}
```

### 3.4 常量

| 常量 | 值 | 依据 |
|---|---|---|
| 维度档数 | 7 | §3.2 |
| 服务端单页条数 | 30 | pixivpy / Pixiv-Shaft 一致 |
| 入口横滑条展示数 | 20 | 取首屏 30 条的前 20（原型形态） |
| lynx 大卡展示数 | 3 | 第 1 名全幅 + 右侧第 2/3 名缩略（原型形态） |
| 今日榜 `staleTime` | 5 min | 对齐相关作品注入行的既有 TTL |
| 历史日期 `staleTime` | 30 min | 历史榜单已定格，可放宽 |

## 4. 用户故事

1. 作为浏览推荐流的用户，我想在推荐流顶部直接看到今日榜单的头部作品，这样我不必离开当前页面就能发现热门内容。
2. 作为只想快速看一眼榜单的用户，我想直接点榜单里的作品进入详情，这样我不需要先进入榜单页。
3. 作为想深入看榜单的用户，我想从入口打开完整榜单页，这样我能看到 20 名之后的作品。
4. 作为关心不同时间尺度的用户，我想在日榜/周榜/月榜之间切换，这样我能分别看到短周期与长周期的热门。
5. 作为新画师的支持者，我想看新人榜与原创榜，这样我能发现尚未成名或原创向的作品。
6. 作为成年内容的浏览者，我想看 R-18 / R-18G 榜，这样我能看到受限制分类下的热门作品。
7. 作为想回看历史的用户，我想把榜单日期往前调，这样我能看到某一天（而不是今天）的榜单。
8. 作为想跳到任意日期的用户（webview），我想用日历直接选日期，这样我不必连点很多次箭头。
9. 作为时间敏感的用户，我想让「后一天」在「今日」时不可用，这样我不会请求到未来日期。
10. 作为没在 pixiv 网页端开启 R-18 显示的用户，我想在 R-18/R-18G 档失败时看到明确的指引，这样我知道该去哪里改设置而不是以为应用坏了。
11. 作为长时间浏览的用户，我想在榜单页无限向下滚动，这样我能一直翻到榜单更深的位置。
12. 作为网络不稳定的用户，我想在榜单页下拉刷新，这样我能手动重取当前维度与日期。
13. 作为网络不稳定的用户，我想在分页失败时看到底部内联重试，这样我不会丢掉已经加载的榜单。
14. 作为不想看排行榜的用户，我想在设置里永久关掉这个入口，这样它不再占据我的推荐流顶部。
15. 作为暂时不想看排行榜的用户，我想就地收起入口，这样我本次会话内不再被它打扰（但不改全局设置）。
16. 作为想关掉后恢复到默认的用户，我想开关默认开启，这样新用户不会以为排行榜没做。
17. 作为在意名次准确性的用户，我想让名次跨页连续且不因过滤而重编号，这样第 8 名显示的仍是第 8 名。
18. 作为被自己设置屏蔽了某些内容的用户，我想看到屏蔽行为与推荐流一致（webview 直接不出现 / lynx 显示受限遮罩），这样两个页面的行为不会互相打脸。
19. 作为使用官方 App 习惯了的用户，我想 R-18 档在失败时档位仍然可见，这样我知道这个能力存在、只是账号设置没开。
20. 作为中文/英文用户，我想看到榜单相关的界面文案跟随语言设置，这样我不会在英文界面里看到中文文案。
21. 作为使用 lynx 客户端的用户，我想在没有日历选择器的情况下仍能用箭头回看日期，这样我在 lynx 上也能回看历史榜单。
22. 作为回到推荐流的用户，我想榜单入口不记住我在榜单页里选过的维度与日期，这样「今日排行 Top 20」的标题始终与实际内容一致。
23. 作为从榜单页返回的用户，我想用系统的返回手势/返回键回到推荐流，这样我不用找返回按钮。
24. 作为冷启动的用户，我想榜单入口在没有数据时显示骨架而不是空白，这样我知道它在加载。
25. 作为关心数据量的用户，我想榜单的请求只在入口可见/榜单页打开时发生，这样它不会在启动时抢占带宽。
26. 作为从榜单进入某作品详情的用户，我想返回时回到榜单页而不是推荐流，这样我能继续看榜单。
27. 作为在意性能的用户，我想榜单条目走与 feed 相同的图片加载与预取策略，这样滚动时不会出现明显掉帧。
28. 作为无障碍用户，我想维度 chip 与日期控件有可读的 aria 标签与足够的触控目标，这样我能用读屏与触控操作榜单。
29. 作为误触入口的用户，我想入口收起后能恢复（刷新/重进页面），这样我不是永久失去它。
30. 作为核对榜单正确性的开发者，我想有一份共享的维度目录与参数构造函数，这样两端不会漂移。

## 5. 交互语义

### 5.1 入口渲染位置

- **webview**：推荐 Feed（`IllustFeedPanel`，`recommended` tab × 插画内容类型）列表**第一张卡之前**。仅在排行榜开关开启时渲染；收起后当次挂载不再显示（刷新/重进恢复）。
- **lynx**：插画页（`IllustList.vue`）推荐 tab 的瀑布流 `<list>` **之前**（子 tab 行的下方、刷新容器内）。同样受开关与收起控制。

### 5.2 入口内容（固定「日榜 · 今日」）

- webview：标题行「今日排行 Top 20」+「全部 ›」+「收起」；横向滚动 20 张方形缩略图，左上角名次角标（前 3 名品牌色强调）。
- lynx：第 1 名全幅背景（`62vw` 高）+ 底部渐变 scrim + 左下「第 1 名」徽章 / 榜名 / 标题 / 作者 + 右侧第 2/3 名缩略 +「全部 ›」。
- **入口不提供维度切换**（裁决 #9）：原型中 lynx 大卡顶部的 mini 维度行按此裁决移除。
- 入口不跟随榜单页的选择（裁决 #22 用户故事）：永远是日榜 + 今日。

### 5.3 榜单页（新路由 `/ranking`）

- 顶部：返回 + 标题。webview 走 `PageTransition` + `goBack()`；lynx 标 `requiresAuth`，返回走既有返回栈（系统返回键生效）。
- 维度 chip 行：7 档，窄屏 `flex-wrap` 换行（**不横滚**——横滚会在窄屏裁切 chip，原型实测）。
- 日期回看行：
  - webview：`‹` + 日期文本 +「今日」标记 + `›` + **日历按钮**（原生 `input[type="date"]`，与 `SearchFilterSheet` 的自定义起止同一先例）。`›` 在「今日」时禁用。
  - lynx：`‹` + 日期文本 + `›`，无日历（挂账）。日期文本手写格式化（lynx 运行时无 Intl）。
- 列表：名次 + 缩略图 + 标题 + 作者 + 收藏数；无限滚动到底自动续页；下拉刷新重取当前 `(mode, date)`。
- 状态机：首载骨架 → 错误（`ErrorDisplay`，重试绑刷新）→ 空态 → 内容；分页失败保留列表 + 底部 `InlineRetryBar`（两端沿用既有组件）。

### 5.4 日期回看的边界策略

不写前端硬边界常量（最早可回看范围未经证实）。超出服务端可用范围时，服务端的**空返回或错误都兜成可见提示**，不静默降级为空列表（仓库硬约束：禁止静默降级）。

### 5.5 名次口径

名次 = `offset + index + 1`，跨页累加。**客户端过滤不重编号**——这直接导致 webview 侧名次出现空洞（被过滤的条目留下空位），这是裁决 #7「沿用各端现有口径」的已知后果，属于预期行为而非 bug。

### 5.6 受限条目（沿用各端现有口径，裁决 #7）

- **webview**：沿用 `filterFeedIllusts` 链路（R18/R18G + AI 三态 + 屏蔽用户）→ 条目被**滤除**，名次出现空洞。
- **lynx**：沿用 `isRestricted` / `isAiRestricted` 链路 → 条目**保留并显示受限遮罩**，名次不变。

> 两端不一致是既有事实（feed 层就不同），本 spec 不为榜单页破例；若后续要对齐，属于独立议题。

### 5.7 R-18 / R-18G 失败态（裁决 #12）

档位**常驻不隐藏**。当账号未在 pixiv 网页端开启「显示 R-18 作品」时，服务端返回空或报错——两种情况都渲染面向用户的**可操作指引**（指向 pixiv 网页端的 R-18 浏览设置），而不是通用错误文案。需新增一条 i18n 文案。

### 5.8 退出口（裁决 #8）

- **持久开关**（设备级，默认**开**）：沿用 `related_injection` 的既有模式（`settingsStore.define` + 两端设置页各一行）。关闭后入口不渲染，但榜单页路由仍可达（深链/历史记录）。
- **入口内即时收起**：webview 标题行的「收起」（原型已有）；lynx 大卡补一个同语义收起。收起不持久化。

### 5.9 刷新与缓存会话语义

- 缓存键 = `(mode, date)`；切换维度或日期各自读缓存，**不互相清空**。
- 下拉刷新 = 重取当前 `(mode, date)` 第一页。
- 从榜单进入作品详情再返回：停留在榜单页，滚动位置由平台既有机制承担（webview `scrollRestoration` / lynx `KeepAlive`）。

## 6. 双端实现设计

### 6.1 共享纯函数包 `@pictelio/ranking-core`（唯一新增的缝）

与 `@pictelio/search-core` 同构（双端共用参数契约、纯函数、`packages/*/tests/` 单测）。

| 导出 | 职责 |
|---|---|
| `RANK_MODES` | §3.2 目录的单一事实源：`{ id, apiMode, labelKey }[]`，含展示顺序 |
| `buildRankingRequest({ mode, date })` | → `{ path: "/v1/illust/ranking", params }`；`date = null` 时不传 `date`；统一 `filter` 参数口径 |
| `rankingCacheKey({ mode, date })` | 缓存/查询键分段，两端共用以免键漂移 |
| `shiftDate(iso, deltaDays)` / `isDateString(v)` / `formatRankingDate(iso)` | 日期加减与校验；lynx 无 Intl，格式化必须手写，两端共用同一份避免日期串天 |

**不放进这个包**：任何平台 UI、任何网络调用、任何过滤逻辑（过滤沿用各端既有链）。

### 6.2 webview（pictelio-app）

- **数据层**：TanStack Query，每 `(mode, date)` 一个查询键；分页走 `next_url`。
  - **关键约束**：**不得**用 `createTQFeedStore` 的 merge 路径——它对 items 做 `sortByDate` + 去重，会按 `create_date` 重排，**直接毁掉名次顺序**。走单源分页即可。
- **入口**：`illust` 内容类型 × `recommended` tab 的 `IllustFeedPanel` 顶部；数据源与榜单页共用同一查询（进榜单页不产生第二次首屏请求）。
- **榜单页**：新增 `routes/Ranking.tsx`，在 `src/router.tsx` 注册（**必须排在 catch-all `/*all` 之前**）；`PageTransition` 包裹；无 loader（遵守「先渲染、后加载」硬约束）。
- **样式**：Fluent 令牌 + UnoCSS shortcuts；触控目标 ≥40px；hover/active/focus-visible 三态齐全；动效只用 Fluent 曲线与时长。

### 6.3 lynx（app-lynx）

- **数据层**：复用既有 `createMixFeed`（单源用法，`sources` 只放一路）；每 `(mode, date)` 重建实例（与 `IllustList.switchMode` 同款「dispose + 重建」语义，配合请求代际防竞态）。
- **入口**：`IllustList.vue` 推荐 tab 的 `<list>` 之前。
- **榜单页**：新增 `pages/Ranking.vue` + `router.ts` 注册（静态 import + `meta: { requiresAuth: true }`）。
- **日期**：仅箭头步进；日期文本手写格式化。
- **样式**：Tailwind utility + M3 语义色；`spacing=vw` / `fontSize=rpx` 档位；禁 rem、禁手写 scoped CSS。
- **既有约束（必须遵守）**：列表项内不做横滑容器（原生 waterfall list-item 内不可靠，相关作品行已有同样降级结论）；list-item 图片必须显式高度；间距用 `list-main-axis-gap`/`list-cross-axis-gap`。

## 7. 测试要求（IO 边界 + oracle）

**好测试的标准**：只测外部行为，不测实现细节；期望值必须能指向独立来源（规格/真实样例/独立实现），禁止从被测实现反推。

| 层 | 测什么 | 先例 |
|---|---|---|
| `ranking-core` 纯函数（双端共用） | 维度目录完整性（7 档、apiMode 逐个对齐 §3.2）、参数构造（date 缺省不传 / 传入透传）、缓存键分段、日期加减与校验（跨月/跨年/闰年）、格式化 | `packages/search-core/tests/` 的 `period.test.ts` / `buildParams.test.ts` |
| webview 数据层 | **分页合并保序**（名次不被按 `create_date` 重排——本次最高风险点）、`paginationError` 的置位/复位语义 | `tests/unit/stores/searchExecution.test.ts` |
| lynx 数据层 | 同上（单源 feed 保序）+ 切 `(mode,date)` 的竞态代际（旧响应不覆盖新结果） | `packages/app-lynx/src/primitives/createMixFeed.test.ts` |
| 两端页面/组件 | 入口受开关与收起控制；入口不随榜单页选择变化；榜单页维度切换与日期参数随动；`›` 在今日禁用；R-18 失败态渲染指引文案 | `tests/unit/components/*.test.tsx`；lynx `tests/unit.test.ts` |
| IO 边界 | 榜单请求的成功 + 失败/降级路径都要覆盖（仓库硬约束 1）；失败态必须有 `console.warn`（禁止静默降级） | `tests/unit/api/*.test.ts` |

**契约测试**：维度 `apiMode` 字符串与 `/pixiv-img/` 代理 URL 属跨端共享契约，mock 必须来自真实来源（官方 mode 目录 + 既有 `thumbUrl` 实现），不得手写自洽字段。

## 8. 待实测验证项（实现期，不写成假设）

1. **`date` 的最早可回看范围**——研究未证实（搜到的 2015-04-01 属旧 Public API，非 App API 证据）。
2. **超出范围时服务端的返回形态**——空列表还是错误？决定 §5.4 的提示文案分支。
3. **分页硬上限**——能否翻过 Top 500（`next_url` 何时断）。
4. **R-18 档在账号未开启时的实际返回**——空 vs 报错（决定 §5.7 的分支覆盖）。

## 9. 扩展路径（非本期）

- **小说榜**：`/v1/novel/ranking`（6 档，无 `month`）；lynx 需在 `NovelList` 另开入口；webview 侧可直接复用同一插槽（推荐 Feed 本就随内容类型切换）。
- **扩展维度**：性别偏好、漫画 3 档、AI 榜——需把一维 chip 行升级为「分组 chip」或二级筛选。
- **lynx 日历选择器**：自研单月 grid + 手写 ISO 日期工具（绕开 Intl），可一并回填 `search-advanced-filters` 里 lynx 侧同样挂账的自定义起止日期 UI。
- **详情页相关区 / 榜单分享 / 名次趋势**（后者需服务端能力）。

## 10. 进一步说明

- **原型是本节决策的主要来源**：两端入口形态与范围层级均由 throwaway 原型裁决，归档于 commit `58170a2b` / `6a2b20fc`。正式实现落地时，原型文件（`packages/app/src/components/home/RankingPrototype.tsx`、`packages/app-lynx/src/components/RankingPrototype.vue`）与其挂载点、`utils/devFlag.ts`、`hardcode-whitelist.json` 中的原型豁免条目**应一并移除**。
- **不建议新增 ADR 的点**：维度目录、缓存 TTL、入口条数等都属于可从本 spec 追溯的实现细节。**建议记 ADR 的点**：只有一条——「排行榜不新增导航分类，而是以 feed 内融合入口 + 独立榜单页承载，且两端采用不同融合形态」。理由：难以回退（信息架构决策）、不看上下文会奇怪（为什么两端不一样、为什么不做成 tab）、存在真实取舍（新 tab vs 融合入口；两端统一形态 vs 各自最优）。

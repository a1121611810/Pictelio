# Spec: 搜索高级筛选（双端：app webview + app-lynx）

- 状态：implemented（2026-09-12 终审通过并当日实施于分支 `feat/search-advanced-filters`，9 commits；门禁 check:all/test:all/lint:all 全绿 + 仓库级双轴 code-review 复审；遗留：agent-browser 筛选主流程 E2E 用例与 lynx 折叠区真机批次，见 §8。后续修订：2026-10-16 搜索范围增第四档「用户」（§3.2 增 `scope=user` 列与说明）；2026-10-17 搜索目标改用户可选档位、删除含空格 → exact 派生 ⇒ §3.1 增 `target` 字段、§3.2/§3.3 增「匹配方式」行、§6.1 该行划线并指向新 spec、§6.2 补 `ft=` 段、§7 不可达路径声明改写；**同日证据订正 §3.2 / §3.3：小说端 `title_and_caption` 由「不识别（推断，未实测）」升级为「实测被拒（HTTP 400 / 0 条）」**——置灰保值挡的是一次 400，放宽需显式决策）
- 日期：2026-09-12
- 关联：wayfinder [#474](https://github.com/a1121611810/Pictelio/issues/474)（地图）/ research `docs/research/pixiv-appapi-search-filter-params.md`（分支 `research/search-filter-api-surface`，7781735e）/ 原型 `docs/research/search-filter-ui-proto/`（分支 `prototype/search-filter-ui`，84df25fd）/ ADR-0132（lynx 全局搜索，第 8 条契约）/ ADR-0155（AI 三态）/ feature-gap 报告 P0-2（`docs/research/pictelio-feature-gap-vs-third-party.md`，分支 research/feature-gap-reverify-20260912）
- 工单：待终审后 to-tickets 流水线拆票（地图外）

## 1. 背景与目标

feature-gap 复验（P0-2）确认：官方 App 标配的搜索高级筛选（期间/收藏数/比例/分辨率）在 Pictelio 双端完全缺失，两端搜索当前是「裸四参」（`word/sort/search_target/filter`）。本 spec 交付**双端一致的搜索高级筛选**：

1. **四个筛选维度**：投稿期间、收藏数、比例（横/竖/方）、分辨率（最小边），全部为官方 AppAPI 免费可用项（2026-09-12 当轮的 charted 集；**2026-10-17 起另加第六维 `target` 匹配方式**，见 §3.1）。
2. **AI 覆盖行**：搜索面板内可临时覆盖账号级 AI 三态（仅本次搜索）。
3. **双端形态**：webview = 底部 Sheet（ReaderSettingsSheet 范式）；lynx = SearchSheet 内折叠筛选区（均已拍板，#477）。
4. **行为语义**：即改即搜、会话内保留、热门排序共存、scope 适用性置灰——全部沿用已拍决策（§5）。

## 2. 非目标（Out of Scope）

- **小说专属维度**：正文长度三单位（`text_length`/`word_count`/`reading_time`）、`genre`、`is_original_only`/`is_replaceable_only`——超出本地图 charted 维度集（2026-09-12 当轮为四维 + AI；2026-10-17 起再加 `target` 匹配方式，见 §3.1），列为下期候选（研究文档 §2 已备好参数事实）。
- **`content_type`（作品类别五档）与 `tool`/`lang` 维度**：未入 charted 维度集，候选。
- **服务端 AI 参数（`search_ai_type`）**：#479 裁决**不接入**，三态全部客户端处理；研究文档该参数已标「评估后不接入」。
- **筛选持久化**：#476 裁决会话内保留、冷启动重置，无跨会话存储。
- **收藏内搜索、搜索联想/热门词改造、排行榜**：地图外（见差距报告）。
- **`Xusers入り` 关键字后缀免会员方案**：不采用（§7 客户端兜底已覆盖其价值）。
- iOS / release 流水线 / OpenWiki / CI。

## 3. 领域模型

### 3.1 筛选状态（canonical shape，落 `@pictelio/search-core`）

```ts
export interface SearchFilters {
  /** 投稿期间：预设档或自定义起止；any = 不限 */
  period:
    | { kind: "any" }
    | { kind: "preset"; preset: "1d" | "1w" | "1m" | "6m" | "1y" }
    | { kind: "custom"; start: string; end: string }; // YYYY-MM-DD 闭区间
  /** 收藏数：官方七档带宽（闭区间，max null = 无上界）；null = 不限 */
  bookmark: { min: number; max: number | null } | null;
  /** 比例（仅插画） */
  ratio: "landscape" | "portrait" | "square" | null;
  /** 分辨率（仅插画）：宽度与高度同值下限（px） */
  minPixels: number | null;
  /** AI 覆盖（仅搜索页语义）：follow = 听账号级设置 */
  aiOverride: "follow" | "all" | "hide";
  /** 搜索目标档位（用户可选）：partial / exact / title_and_caption */
  target: SearchTargetMode;
}
```

- 默认值 = 全部不限 + `aiOverride: "follow"` + `target: "partial"`；**无值即默认**，不引入「显式不过滤」状态位（#476 Q6）。
- `target` 与映射规则是 2026-10-17 后加的第六个维度（spec `docs/specs/search-target-mode.md`），本 spec §3.2 / §3.3 的对应行随之补齐。
- 七档收藏数带宽**硬编码常量**（值 = 官方 iOS 8.7.3 抓包 `/v1/search/options` 下发值，研究文档 §1.2）：`10-29 / 30-49 / 50-99 / 100-299 / 300-499 / 500-999 / 1000-∞`；UI 标签 `10+`…`1000+`。动态拉取 `/v1/search/options` 列为增强（非本期）。

### 3.2 维度适用矩阵（scope × 维度）

| 维度 | scope=all | scope=illust | scope=novel | scope=user |
|---|---|---|---|---|
| 期间 | ✅ 双路携带 | ✅ | ✅ | ❌ 不适用 |
| 收藏数 | ✅ 双路携带（参数+客户端兜底） | ✅ | ✅ | ❌ 不适用 |
| 比例 / 分辨率 | ✅ **仅传插画路**，控件标「仅插画」 | ✅ | **置灰禁用，值保留** | ❌ 不适用 |
| AI 覆盖 | ✅（客户端，scope 无关） | ✅ | ✅ | ❌ 不适用 |
| 匹配方式（`target`） | ✅ 双路携带（各按本端映射） | ✅ | ✅ **仅 partial / exact**（`title_and_caption` **实测被拒 HTTP 400** → 置灰保值不发，见下方注） | ❌ 不适用 |

**scope=user**（`/v1/search/user`，搜索范围第四档；ADR-0132 §4 于 2026-10-16 推翻「无用户搜索」）：**上表全部维度不适用**——该端点请求只带 `word` / `filter=for_ios` / `sort`。其中 `search_target` 是**「必须不发」而非「不消费」**（2026-10-17 一手反向实测订正）：该端点对它做**枚举校验**，传任何值（空串 / `partial_match_for_tags` / `exact_match_for_tags` / `title_and_caption` / 非法值 `zzz`）一律 **HTTP 400**；对照的不相关**未知参数名**（`foo=bar`）返回 **200 且结果不变** ⇒ 它**校验已识别参数、忽略未识别参数**。其余筛选参数（`bookmark_num_*` / `ratio_pattern` / `width_*` / `start_date` / `end_date` / `search_ai_type`）依据是实测未发 + pixez `getSearchUser` / Mako `UserSearchEngine` 同款（两家也只发 `word` / `filter` + `word`），**尚未做反向实验**（spec `docs/specs/search-user-scope.md` §5.1；一手实测 2026-10-16）。UI 侧 scope=user 时**同时隐藏筛选折叠区与 sort 段**（spec `docs/specs/search-user-scope.md` §5.4）：实测该端点**完全忽略** `sort`——三档在 3 个检索词（柊/凛/蒼）下返回逐位相同的 ID 序列（spec `docs/specs/search-user-scope.md` §3.4；fixture 另用第 4 词 `水上` 取字段形状，非 sort 比对）。
⚠️ 另有一轮**2026-10-17 锚点复核**用了另一组检索词（`水上` / `蒼` / `柊`）：两组都真跑过、结论一致，
`水上` 在两轮里**角色不同**（原始轮只作 fixture 取形状、复核轮才作 sort 比对词），逐轮清单与
`水上` 的角色差异见 `docs/research/pixiv-appapi-search-filter-params.md` §11.4。
留着 chip 就是给用户一个点了没反应的控件。

**scope=novel 的「标题·说明」档是「实测被拒」，不是「不被识别」**（2026-10-17 一手实测，
交错 2 轮逐位一致，端点 `/v1/search/novel`、`word=東方`）：省略 `search_target` → **200 / 30 条**；
显式发 `search_target=title_and_caption` → **HTTP 400 / 0 条**；`search_target=partial_match_for_tags`
与未知参数名 `foo=bar`（对照）均 **200 / 30 条**。对照组是关键：**不是「参数名不被认识所以忽略」
（那会是无害），而是服务端明确拒绝该取值** ⇒ 早期「小说端不识别 `title_and_caption`」的推断**低估了
后果强度**（旧推断证据 Mako `SearchNovelTagMatchOption` 只有 partial/exact/text/keyword + 官方帮助中心
未列该档，保留作历史留痕）。⚠️ **置灰保值挡的不是「结果不准」这类体验问题，是「每一次小说搜索直接
400 失败」**——置灰逻辑哪天回归、小说端开始真发这个参数，scope=novel 搜索就整片报错 ⇒
**放宽它需要一次显式决策**，不能当 UI 细节顺手改掉。取证脚本 `docs/research/verify-novel-title-target.sh`
（与本文档**同 commit 入库**），一手记录见 `docs/research/pixiv-query-syntax-verified-2026-10.md` §4；口径页见 spec
`docs/specs/search-target-mode.md` §4。

### 3.3 筛选状态 → 请求参数映射（由 search-core 单点实现）

| 状态 | 请求参数 | 说明 |
|---|---|---|
| `period` | `start_date` / `end_date`（`YYYY-MM-DD`） | **预设档换算成日期直发，不发 `duration`**（对齐 iOS 8.6.6；duration 与日期语义重叠，且 novel 端 duration 五档未验证）。换算以日本时区当天为界；校验 `end ≤ 今天`、`start ≤ end` |
| `bookmark` | `bookmark_num_min` / `bookmark_num_max`（闭区间） | max null → 只发 min |
| `ratio` | `ratio_pattern`（`landscape/portrait/square`） | 注意参数名非 Web 端的 `ratio` |
| `minPixels` | `width_min` + `height_min`（同值） | 官方预设档即宽高同值 |
| `aiOverride` | **不进请求** | 客户端过滤注入（§5.4） |
| `target` | `search_target`（**按端点查表，两端不对称**） | `partial`：插画端**整个参数不传**（保守选择，理由已降级见 spec `docs/specs/search-target-mode.md` §4）/ 小说端**显式发**（同 §4，映射方向可信、机制本次未能证实）；`exact`：两端同发 `exact_match_for_tags`；`title_and_caption`：插画端发 / 小说端**实测被拒（HTTP 400）**、置灰保值不发（§3.2 注：不是「不被识别」而是服务端拒绝该取值，放宽需显式决策）。来源 = 用户可选档位，**不再按 `word.includes(" ")` 派生**（spec `docs/specs/search-target-mode.md` §4） |

恒定附加（对齐 iOS/Shaft/pixez）：`merge_plain_keyword_results=true`、`include_translated_tag_results=true`、`filter=for_ios`（现状）、`search_ai_type` **不传**。

⚠️ **`merge_plain_keyword_results` 的置信度已下调**（2026-10-17 一手实测）：illust / novel / user **三端**传 `true` / `false` / 不传，**结果都不变**——无可观测效果。附带：illust 端对非法值 `zzz` **400**（校验枚举），novel 与 user 端对 `zzz` **静默接受**。⇒ 「三端行为一致」这个事实成立，但「恒发 `true` 有用」**未被证实**，原表述（定级为「可用；pixez 恒发 true」）强于证据。**恒发行为保持不变**（无害 + 对齐第三方 + 与既有实现零 diff），此处只降级声明强度。

### 3.4 热门排序共存矩阵（#478 拍板：都能用，只灰收藏数）

| 排序 | 筛选态 | 行为 |
|---|---|---|
| 最新/最早 | 任意 | 普通搜索端点，筛选全量携带 |
| 热门 | 未激活 | `/v1/search/popular-preview/*`，现状不变（不分页、无加载更多） |
| 热门 | 期间/比例/分辨率/AI 任一 | **透传 popular-preview**（官方 iOS 同用法） |
| 热门 | 收藏数激活态 | 请求**不携带**收藏数；该维度置灰+标注「热门榜不支持按收藏数筛」；值保留，切回最新/最早恢复；客户端兜底过滤同样不生效 |

scope 轴不改变矩阵（popular-preview 两端对称接受各自端筛选面）。

## 4. 架构

```
packages/search-core/          # 新共享包 @pictelio/search-core（零 IO 纯函数）
  src/filters.ts               #   SearchFilters 类型 + 默认值 + 校验（日期/带宽）
  src/buildParams.ts           #   筛选状态 → 端点参数对象（含 scope/排序路由与 §3.4 矩阵）
  src/period.ts                #   预设档 → start/end_date 换算（日本时区当天为界）
  src/urlCodec.ts              #   筛选状态 ↔ webview URL query 编解码（§6.3）
  src/cacheKey.ts              #   缓存键构建（word_scope_sort + filters 规范段）
  tests/                       #   真值表单测（oracle = 研究文档官方抓包值）
```

- **单点共享**（#480 拍板，替代 ADR-0132 的双端镜像约定）：参数构建/换算/编解码只有一份代码。先例：`@pictelio/update-check` 已被 webview+lynx 双端共用，构建链集成已被验证。
- **双端薄传输层**：
  - webview `api/search.ts`：参数构建挪出至 search-core，保留 fetch/代理与 `next_url` 域名断言（SSRF 防卫）。
  - lynx `api/search.ts`：同上。
- **状态归属**（#476 派生结论）：
  - webview：扩展现有 `createSearchStore`（+筛选 signals）；`Search.tsx` URL 编解码接 search-core；新增 `components/search/SearchFilterSheet.tsx`（底部 Sheet，ReaderSettingsSheet 范式，入口=搜索栏筛选 icon+激活数徽标）。
  - lynx：扩展 `useSearch` controller（+filters ref，与 scopeRef/sortRef 同位）；`SearchSheet.vue` 新增折叠筛选区组件（默认折叠，#477 拍板）。**一期裁剪：lynx 期间仅预设五档，自定义起止日期为 webview 专属**（lynx 无便利的原生 date input；状态/参数层已支持 custom，二期补 UI 即可）。

## 5. 交互与数据流（#476 全部拍板）

1. **生命周期**：会话内保留、冷启动重置（不持久化）；改关键词、切 scope 只重搜不清筛选。
2. **生效时机**：即改即搜——面板内最后一次改动后 400-500ms debounce 自动重搜；自定义日期在 start/end 两字段齐后生效；请求风暴由 debounce + 既有 AbortController/generation gate 兜底。
3. **重置**：面板顶部「清除全部」（仅有激活筛选时出现）+ 各维度可单独调回默认（chips 再点已选项回默认档）；筛选入口 icon 带激活数徽标（0 个激活时隐藏）。
4. **AI 覆盖**（#479）：面板 chips = **跟随设置（默认）/ 全部显示 / 隐藏 AI**；改动只影响本次搜索、不写回账号级设置 `ai_filter_mode_${uid}`；实现 = 客户端过滤模式注入（webview `filterSearchResultsByAiMode` 的 mode 参数、lynx 同源 composable），覆盖值进缓存键与 URL。「仅看」仅经全局设置生效（跟随设置路径），面板不设仅看档。
5. **R18 正交声明**：`isRestricted`/`r18Filter` 客户端逻辑本次不动；AI 遮罩徽章 UI 复用不变。
6. **URL 同步（仅 webview）**：筛选随 `word/scope/sort` 进 `/search` query（§6.3 键表）；lynx 弹层存续期保留、关闭即重置（与 keyword/结果现状对称）。

## 6. 契约面变更

### 6.1 请求参数变更（行为变更点，发布说明需标注）

| 变更 | 内容 | 依据 |
|---|---|---|
| 新增筛选参数 | `start_date`/`end_date`/`bookmark_num_min`/`bookmark_num_max`/`ratio_pattern`/`width_min`/`height_min`（按状态按矩阵携带） | 研究文档 §1/§2/§3/§4 |
| 恒发两个 bool | `merge_plain_keyword_results=true`、`include_translated_tag_results=true`（**恒发行为不变**；但 2026-10-17 实测 `merge_plain_keyword_results` 三端传 true/false/不传结果均不变，**无可观测效果**，置信度见 §3.3 注） | iOS/Shaft/pixez 一致行为（研究文档 §1.2） |
| `search_target` 修复 | **illust 端**：partial 档**不传** `search_target`（不传 ≡ partial 且并入标题命中；「显式传 partial 会转严格标签匹配并忽略 merge 参数」出自 Shaft #906 第三方源码推断，**2026-10-17 一手实测未复现**——omit / 显式 partial / `merge_plain_keyword_results=true` / 两者并用四组交错采样，ID 序列 md5 完全相同；映射维持不传是**保守选择**而非已证实的必需）；exact 档显式传 `exact_match_for_tags`。**novel 端**：partial/exact 恒显式传（#1038；其「不传退化为纯字面匹配」的机制本次**未能证实**，映射方向可信、理由置信度低）。popular-preview 两端同规则。**user 端**：**任何取值一律不发**——该端点对 `search_target` 做枚举校验，传任何值皆 **HTTP 400**，未知参数名（`foo=bar`）200 ⇒ 是校验不是忽略（口径与证据见本 spec **§3.2** scope=user 段）。~~exact 场景（含空格多标签）显式传 `exact_match_for_tags`~~ —— **2026-10-17 作废**：档位改用户可选，含空格不再触发 exact 派生（默认档 partial 下多词**不传**该参数 ⇒ 并入关键字/标题命中，结果集变大；spec `docs/specs/search-target-mode.md` §5） | 研究文档 §1.1/§2/§9.3（两端现状恰好各踩一半坑）；档位化与派生删除见 search-target-mode §4/§5 |
| 不发 `include_potential_violation_works` | 维持现状不传（iOS 默认 false 会隐藏部分作品，Shaft 特意不传以免漏结果） | 研究文档 §1.2 |
| 不发 `duration`/`search_ai_type` | duration 换算成日期；AI 参数 #479 裁决不接入 | §3.3 |

### 6.2 缓存键

`word_scope_sort` → `word_scope_sort|<filters 规范段>`（search-core `buildCacheKey` 产出，分隔符 `|`）。规范段各槽：`fp`=期间预设 / `fd`=自定义起止 / `fb`=收藏数带宽序号 / `fr`=比例 / `fw`=最小边 px / `fa`=AI 覆盖（follow 不落键、非 follow 落键）/ **`ft`=搜索目标档位**（默认档 `partial` 不落键；`exact` / `title_and_caption` 落 `ft=exact` / `ft=title_and_caption`，spec `docs/specs/search-target-mode.md` §6）。全默认筛选时省略整段。`ft` **追加在段末尾**，存量非默认筛选的键逐字不变，升级不撞旧缓存。~~webview `inFlightSearchKey` 判重键同步扩展。防脏缓存是正确性硬要求。~~ —— 当轮成立是因为 webview 侧有 `inFlightSearchKey` 消费方；该消费方随 ADR-0203 整包删除，ADR-0132 决策 3 与 `useSearch.ts` 亦写明「搜索结果全局 LRU 缓存不做」⇒ `buildCacheKey` 现**零生产消费方**（2026-10-17 grep 实测），今天不存在会被弄脏的缓存。键形态与「筛选进键」纪律仍按本节维护，属**前瞻性接线**（缓存日后重建时接线即自动正确），可达性逐落点核对见 spec `docs/specs/search-target-mode.md` §6。

### 6.3 URL query 键表（webview）

| 键 | 值 | 示例 |
|---|---|---|
| `fp` | period preset：`1d/1w/1m/6m/1y` | `fp=1w` |
| `fd` | 自定义起止 `YYYY-MM-DD_YYYY-MM-DD`（与 `fp` 互斥，`fd` 优先） | `fd=2026-08-01_2026-08-15` |
| `fb` | 收藏数带宽序号 `0-6`（对应 §3.1 七档） | `fb=3` |
| `fr` | `landscape/portrait/square` | `fr=landscape` |
| `fw` | 最小边 px（正整数） | `fw=2000` |
| `fa` | `all/hide`（follow 为默认不落键） | `fa=hide` |

非法/未知值一律忽略回默认（容忍手改 URL 与旧链接）。详情页返回靠 URL 回填筛选 + LRU 缓存恢复结果（现状机制的延伸，#476 Q5）。

**本表不含 `ft`**（2026-10-17 核对）：URL 编解码 `packages/search-core/src/urlCodec.ts` 没有档位字段，手写 `ft=` 也不被识别（有单测锁定）；且该模块随 webview 客户端删除后**零生产消费方**，属死代码（spec `docs/specs/search-target-mode.md` §2 已列为票外技术债）。⇒ §3.3 的 `target` 行**当前没有 URL 往返路径**，档位只在会话内存活。

### 6.4 ADR 动作

- **ADR-0132 第 8 条修订**：lynx `api/search.ts`「逐字对齐 webview」→「同构薄传输（fetch/next_url 断言）+ 参数构建单点共享（@pictelio/search-core）」。第 4 条的 scope/sort 语义不动。（**该行是本票 2026-09-12 当时的动作记录**：第 4 条此后两次被修订——2026-10-16 搜索范围增第四档「用户」、2026-10-17 搜索目标改档位化，见 ADR-0132 文末两条「修订」小节）
- **ADR-0155 增补条目**（非新 ADR）：搜索筛选面板 AI 行覆盖语义——默认跟随设置、仅本次搜索、不写回账号级设置；三态维持全客户端处理，`search_ai_type` 评估后不接入（#479）。
- **不新开 ADR**：共享包决策并入 ADR-0132 修订条目。

## 7. 免费账号与边界

- **收藏数客户端兜底**：搜索结果落地后按 `total_bookmarks` 字段本地过滤（Shaft 先例「客户端兜底让区间在非会员路径上也成立」）——会员/非会员/普通端点统一成立，热门路径除外（§3.4 置灰语义）。代价 = 免费账号下结果页稀疏（已知取舍 §9）。候选档七档常量与 UI 对 `is_premium` 无感知（不做会员检测）。
- **不可达路径声明（2026-10-17 更正）**：`sort=popular_desc` 直发**普通端点**对非会员 400（研究文档 §7，该结论覆盖 `/v1/search/{illust,novel}` 两端）。应用内热门在插画/小说两路恒走 popular-preview，故**该 400 在这两条路上仍不可达**；但**「全部不可达」这句已不成立**——scope 切到「用户」时 `sortRef` **不重置**（`useSearch.ts` `setScope` 只改 `scopeRef`）且 sort 段 UI 已被隐藏（`SearchSheet.vue` scope=user 隐藏），隐藏的 `popular_desc` 会直发 `/v1/search/user`。该端点**实测忽略 sort**：`date_asc` / `date_desc` / `popular_desc` 三档在多个检索词下返回**逐位相同**的 ID 序列、三档均返回 200（2026-10-16 一手实测，脚本 `docs/research/verify-search-user-api.sh`，spec `docs/specs/search-user-scope.md` §3.4；结论限于该次测试账号态）。故**当前无实际影响**，此处如实改写而非删除：日后 Pixiv 若对该端点启用会员校验，这条路径会变成真 400。`popular_male/female_desc` 仍不提供（novel 端不识别、会员限定）。
- **静默降级禁令**：筛选被服务端忽略的场景必须有 UI 表达（热门下收藏数置灰标注）；客户端兜底生效的场景无需提示。
- **空态/少结果态**：热门+筛选的少结果态、AI 仅看空结果——分页判空必须基于服务端原始返回（ADR-0155 教训：lynx 曾因全过滤白屏）；空态文案可渲染、可清除筛选重试。

## 8. 测试与验收（oracle 溯源）

1. **search-core 单测**（一处覆盖双端）：参数构建真值表（期望值 = 研究文档官方抓包值，禁止从实现反推）；期间预设→日期换算（日本时区边界）；URL 编解码 round-trip；缓存键构建；矩阵路由（scope/sort → 端点与参数子集）。
2. **webview**：searchStore 单测（筛选状态/URL 回填/缓存键/inFlight 判重）；SearchFilterSheet 组件测试（即改即搜 debounce、置灰、徽标、清除全部）。
3. **lynx**：useSearch 单测扩展（filters ref 重搜语义）；SearchSheet 折叠区组件测试；**模拟器过折叠区点击可达性**（原生 pointer-events 怪癖：全屏 pointer-events-none 容器吞点击的历史坑）+ 80vh 内滚动布局。
4. **契约/差分**：URL 编解码与参数构建 round-trip 差分；transport 层 next_url 断言保持既有差分测试。
5. **E2E**：agent-browser 搜索筛选主流程（设筛选 → URL 回填 → 刷新/返回保持）；S 端切换回归。
   - **交付状态（2026-09-12 实施 + 模拟器批次补验）**：1-4 已交付（自动化门禁 check:all / test:all / lint:all 全绿）。
     **模拟器批次已补验**（emulator pictelio_ui / WebView 113，webview+lynx 双引擎）：
     ① webview CDP 冒烟 11/11 PASS（脚本 `scripts/audit-real-interaction/search_filter_smoke.mjs`）——
     期间预设落 URL（fp）/结果集刷新/横图 w≥h 语义/★ 下限/热门置灰标注+比例透传可用/scope=小说
     置灰+值保留标注/清除全部清 URL；② lynx 真机驱动：FAB 直达搜索 → 输入即搜 → 筛选折叠区
     **点击可达性通过**（pointer-events 怪癖未复现：chip 点击生效、徽标计数、清除全部浮现、
     scope=小说 置灰+筛选值保留）；③ 引擎往返切换（webview→lynx→webview）正常。
     **仅剩**：agent-browser 筛选主流程 E2E 用例（可选后续，CI 化时补）。

## 9. 已知取舍与未来候选

- 隐藏 AI 为客户端过滤 → 免费账号收藏数 fallback 同理：**结果页稀疏**（一页 30 条可能只剩几条可看）——#479 拍板接受。
- 热门榜不分页是官方端点性质：热门+筛选天然少结果。
- 七档收藏数带宽硬编码：官方档位若变需手动更新（动态 `/v1/search/options` 拉取列为增强）。
- 未来候选（按价值排序）：小说正文长度三单位（官方免费四档）> `content_type` 作品类别 > `tool`/`lang` > 动态档位拉取 > `search_ai_type` 服务端化翻案（入口 = 研究文档 + #479 resolution）。

## 10. 交付边界

本 spec 终审通过 = wayfinder 地图 #474 到达目的地；实现走地图外 to-spec→to-tickets→implement 流水线（建议 effort 分支首个 commit 即本 spec + ADR 两处动作）。
